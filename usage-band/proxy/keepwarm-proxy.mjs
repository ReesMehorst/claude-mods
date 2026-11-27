#!/usr/bin/env node
// Keep-warm proxy for usage-band.
//
// Claude Code sends its API requests here (ANTHROPIC_BASE_URL), and the proxy forwards them to
// the API unchanged. For each chat it remembers the last main request, byte for byte, and
// shortly before that chat's prompt cache lapses it sends the same request again: an identical
// prefix is a cache read, which renews the cache even while the chat is closed. The ping streams,
// and the proxy hangs up after the first event, which already says whether it hit the cache.
//
// Credentials stay in this process's memory: nothing is written to disk or logged.
// Only chats usage-band turned keep-warm on for are pinged.

import http from 'node:http'
import https from 'node:https'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

export const VERSION = '1'
const DAY_MS = 86400e3
const TICK_MS = 5e3
const CONTROL_HEADER = 'x-kw-client' // control calls must carry it, so a web page can't make them without a preflight
const DROP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'])

// Lead window before the lapse: a minute on the 5-minute cache, five on the 1-hour one (as the band's).
export const leadMs = ttlMs => (ttlMs > 600e3 ? 300e3 : 60e3)

// The cache lifetime a request asked for: 1 hour when any of its cache marks says so, else 5 minutes.
export const ttlOf = bodyText => (/"ttl"\s*:\s*"1h"/.test(bodyText) ? 3600e3 : 300e3)

// The usage on a stream's message_start event, once enough of the stream has arrived to read it.
export const messageStartUsage = text => {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).find(l => l.startsWith('data:'))
    if (!data) continue
    try {
      const ev = JSON.parse(data.slice(5))
      if (ev?.type === 'message_start') return ev.message?.usage ?? {}
    } catch { /* an event cut mid-way: wait for more */ }
  }
  return null
}

// A response's body decoded, for reading alone: gzip, brotli and deflate as the API may send them.
const decoded = r => {
  const enc = String(r.headers['content-encoding'] ?? '').trim()
  const z = enc === 'gzip' ? zlib.createGunzip() : enc === 'br' ? zlib.createBrotliDecompress() : enc === 'deflate' ? zlib.createInflate() : null
  return z ? r.pipe(z) : r
}

const contextTokens = u => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
const isMiss = u => (u.cache_creation_input_tokens ?? 0) > (u.cache_read_input_tokens ?? 0)

/**
 * The proxy, without a socket of its own: `handle` serves one request, `tick` sends the pings due.
 * Options: upstream (URL), now (clock), maxPings, minTokens, dailyCap.
 */
export function createProxy({ upstream = 'https://api.anthropic.com', now = () => Date.now(), maxPings = 3, minTokens = 20000, dailyCap = 50 } = {}) {
  const up = new URL(upstream)
  const transport = up.protocol === 'http:' ? http : https
  const opts = { maxPings, minTokens, dailyCap }
  const chats = new Map() // session id → what to replay, and how warming it is going
  const wanted = new Map() // session id → keep-warm on/off, as usage-band set it
  const stats = { forwarded: 0, controls: 0, pings: 0, hits: 0, misses: 0, day: '', pingsToday: 0, lastActivity: now() }

  const send = (path, method, headers, body) =>
    transport.request({ protocol: up.protocol, hostname: up.hostname, port: up.port || undefined, path, method, headers: { ...headers, host: up.host } })

  const forwardHeaders = raw => {
    const out = {}
    for (const [k, v] of Object.entries(raw)) if (!DROP_HEADERS.has(k) && !k.startsWith(CONTROL_HEADER)) out[k] = v
    return out
  }

  // Forwards one API request unchanged and streams the answer back. A main request of a chat
  // is remembered, and the start of its answer tells the context size.
  function forward(req, res, body) {
    stats.forwarded++
    stats.lastActivity = now()
    const headers = forwardHeaders(req.headers)
    const id = req.headers['x-claude-code-session-id']
    const pathname = new URL(req.url, 'http://x').pathname
    const isMain = req.method === 'POST' && pathname === '/v1/messages' && typeof id === 'string' && id
      && req.headers['x-claude-code-request-class'] === 'main' && !req.headers['x-claude-code-agent-id']
    let chat = null
    if (isMain) {
      const text = body.toString('utf8')
      const prev = chats.get(id)
      chat = { id, path: req.url, headers, body, at: now(), ttlMs: ttlOf(text), isStream: /"stream"\s*:\s*true/.test(text),
        ctx: prev?.ctx ?? 0, pings: 0, missed: false, stopped: false, lastPing: null }
      chats.set(id, chat)
    }
    const out = send(req.url, req.method, headers, body)
    out.on('response', r => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
      if (chat && r.statusCode === 200) {
        // Read the context size off a decoded copy; Claude gets the bytes as they came.
        const copy = decoded(r)
        let head = ''
        const peek = c => {
          head += c.toString('utf8')
          const u = messageStartUsage(head)
          if (u || head.length > 64e3) { if (u) chat.ctx = contextTokens(u); copy.off('data', peek); if (copy !== r) copy.destroy() }
        }
        copy.on('data', peek)
        copy.on('error', () => {})
      }
    })
    out.on('error', err => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: `keep-warm proxy could not reach the API: ${err.code ?? err.message}` } }))
    })
    res.on('close', () => { if (!res.writableEnded) out.destroy() }) // Claude hung up: stop the upstream call too
    out.end(body)
  }

  // The proxy's own calls, from usage-band only.
  function control(req, res, body) {
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.headers.origin || req.headers[CONTROL_HEADER] !== 'usage-band') return json(403, { error: 'forbidden' })
    stats.controls++
    const { pathname } = new URL(req.url, 'http://x')
    let input = {}
    if (body.length) try { input = JSON.parse(body.toString('utf8')) } catch { return json(400, { error: 'bad json' }) }
    if (pathname === '/_kw/health') return json(200, { ok: true, version: VERSION, controls: stats.controls, forwarded: stats.forwarded, chats: chats.size, pings: stats.pings, hits: stats.hits, misses: stats.misses })
    if (pathname === '/_kw/options' && req.method === 'POST') {
      for (const k of ['maxPings', 'minTokens', 'dailyCap']) if (Number.isFinite(input[k]) && input[k] >= 0) opts[k] = input[k]
      return json(200, opts)
    }
    const m = /^\/_kw\/chat\/([\w-]{1,128})$/.exec(pathname)
    if (m) {
      const id = m[1]
      if (req.method === 'POST') wanted.set(id, input.on === true)
      const c = chats.get(id)
      return json(200, {
        on: wanted.get(id) === true, seen: !!c, at: c?.at ?? null, ttlMs: c?.ttlMs ?? null, ctx: c?.ctx ?? 0,
        pings: c?.pings ?? 0, pingsLeft: Math.max(0, opts.maxPings - (c?.pings ?? 0)), lastPing: c?.lastPing ?? null,
        missed: c?.missed ?? false, stopped: c?.stopped ?? false,
      })
    }
    return json(404, { error: 'not found' })
  }

  function handle(req, res) {
    // Loopback only, and only under a loopback name, so a web page can't reach it by DNS rebinding.
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); res.end(); return }
    const parts = []
    req.on('data', c => parts.push(c))
    req.on('end', () => {
      const body = Buffer.concat(parts)
      if (req.url?.startsWith('/_kw/')) control(req, res, body)
      else forward(req, res, body)
    })
  }

  // One ping: the remembered request again, unchanged. Hangs up once message_start says how it went.
  function ping(chat) {
    return new Promise(resolve => {
      const at = now()
      chat.pings++
      stats.pings++
      stats.pingsToday++
      // Unencoded, so message_start can be read; headers are not part of the cache key.
      const { 'accept-encoding': _, ...headers } = chat.headers
      const out = send(chat.path, 'POST', headers, chat.body)
      let isDone = false
      const done = (result) => {
        if (isDone) return
        isDone = true
        chat.lastPing = { at, result }
        out.destroy()
        resolve(result)
      }
      out.on('response', r => {
        if (r.statusCode !== 200) {
          if ((r.statusCode ?? 0) >= 400 && (r.statusCode ?? 0) < 500) chat.stopped = true // an expired login, say: wait for Claude's next request
          r.resume()
          return done(`http ${r.statusCode}`)
        }
        let head = ''
        r.on('data', c => {
          if (isDone) return
          head += c.toString('utf8')
          const u = messageStartUsage(head)
          if (!u && head.length < 64e3) return
          const missed = u ? isMiss(u) : false
          chat.at = at // either way the cache is warm now
          if (missed) { chat.missed = true; stats.misses++ } else stats.hits++
          done(missed ? 'miss' : 'hit')
        })
        r.on('end', () => done('no message_start'))
      })
      out.on('error', err => done(`error ${err.code ?? err.message}`))
      out.end(chat.body)
    })
  }

  // Which chats are due a ping now.
  function due(t) {
    const day = new Date(t).toDateString()
    if (stats.day !== day) { stats.day = day; stats.pingsToday = 0 }
    const out = []
    for (const chat of chats.values()) {
      const left = chat.at + chat.ttlMs - t
      if (wanted.get(chat.id) !== true || !chat.isStream || chat.missed || chat.stopped) continue
      if (chat.pings >= opts.maxPings || chat.ctx < opts.minTokens || stats.pingsToday + out.length >= opts.dailyCap) continue
      if (left > 5e3 && left <= leadMs(chat.ttlMs)) out.push(chat)
    }
    return out
  }

  // Every few seconds: send the pings due, forget chats idle for a day.
  async function tick() {
    const t = now()
    for (const [id, chat] of chats) if (t - chat.at > DAY_MS) chats.delete(id)
    const list = due(t)
    for (const chat of list) await ping(chat)
    return list.length
  }

  const isIdle = () => chats.size === 0 && now() - stats.lastActivity > DAY_MS

  return { handle, tick, isIdle, chats, wanted, stats, opts }
}

// Run as a program: listen on loopback, tick, and exit after a day with nothing to do.
// With --launch: start a copy of itself in the background, detached from whoever started it (a
// chat that may close), and exit at once.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--launch')) {
  const { spawn } = await import('node:child_process')
  const args = process.argv.slice(1).filter(a => a !== '--launch')
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
  const port = Number(arg('port', '8787'))
  const proxy = createProxy({ upstream: arg('upstream', 'https://api.anthropic.com') })
  const server = http.createServer(proxy.handle)
  server.on('error', err => { console.error(`keep-warm proxy: ${err.code === 'EADDRINUSE' ? `port ${port} is in use` : err.message}`); process.exit(1) })
  server.listen(port, '127.0.0.1', () => console.error(`keep-warm proxy ${VERSION} on 127.0.0.1:${port}`))
  setInterval(() => {
    proxy.tick().catch(() => {})
    if (proxy.isIdle()) process.exit(0)
  }, TICK_MS).unref?.()
}
