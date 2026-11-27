// Run with: node --test usage-band/proxy/keepwarm-proxy.node-test.mjs
// (not *.test.*, which `claude plugin test` would pick up).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import zlib from 'node:zlib'

import { createProxy, leadMs, messageStartUsage, ttlOf } from './keepwarm-proxy.mjs'

const HIT = { input_tokens: 5, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0, output_tokens: 1 }
const MISS = { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 60000, output_tokens: 1 }
const sse = usage => `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage } })}\n\n`
const BODY = JSON.stringify({ model: 'm', stream: true, system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'hi' }] })
const MAIN = { 'x-claude-code-session-id': 'chat-a', 'x-claude-code-request-class': 'main', authorization: 'Bearer secret', 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }

// A fake API: records each request, answers a stream that starts with message_start and then
// stays open a while (so a ping that hangs up early can be told apart), or the status asked for.
async function fakeApi() {
  const seen = []
  const api = { seen, usage: HIT, status: 200, closedEarly: 0 }
  const server = http.createServer((req, res) => {
    const parts = []
    req.on('data', c => parts.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(parts).toString('utf8') })
      if (api.status !== 200) { res.writeHead(api.status); res.end('{}'); return }
      if (api.gzip && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' })
        res.end(zlib.gzipSync(sse(api.usage) + 'event: message_stop\ndata: {"type":"message_stop"}\n\n'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(sse(api.usage))
      const t = setTimeout(() => { res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n'); res.end() }, 300)
      res.on('close', () => { if (!res.writableEnded) { api.closedEarly++; clearTimeout(t) } })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  api.url = `http://127.0.0.1:${server.address().port}`
  api.close = () => new Promise(r => server.close(r))
  return api
}

async function setup(o = {}) {
  const api = await fakeApi()
  let t = Date.parse('2026-11-28T12:00:00Z')
  const proxy = createProxy({ upstream: api.url, now: () => t, ...o })
  const server = http.createServer(proxy.handle)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (path, init = {}) => fetch(base + path, init)
  const ctl = (path, body) => call(path, { method: body ? 'POST' : 'GET', headers: { 'x-kw-client': 'usage-band', 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const turn = async (headers = MAIN, body = BODY) => (await call('/v1/messages?beta=true', { method: 'POST', headers, body })).text()
  return {
    api, proxy, call, ctl, turn, base,
    advance: ms => { t += ms },
    close: async () => { await new Promise(r => server.close(r)); await api.close() },
  }
}

test('helpers: lead window, lifetime, message_start', () => {
  assert.equal(leadMs(300e3), 60e3)
  assert.equal(leadMs(3600e3), 300e3)
  assert.equal(ttlOf('{"cache_control":{"type":"ephemeral","ttl":"1h"}}'), 3600e3)
  assert.equal(ttlOf(BODY), 300e3)
  assert.deepEqual(messageStartUsage(sse(HIT)), HIT)
  assert.equal(messageStartUsage('event: message_start\ndata: {"type":"message_st'), null)
})

test('forwards requests and streams unchanged', async () => {
  const s = await setup()
  try {
    const text = await s.turn()
    assert.match(text, /message_start/)
    assert.match(text, /message_stop/)
    const got = s.api.seen[0]
    assert.equal(got.url, '/v1/messages?beta=true')
    assert.equal(got.body, BODY)
    assert.equal(got.headers.authorization, 'Bearer secret')
    assert.equal(got.headers['anthropic-beta'], 'oauth-2025-04-20')
    assert.equal(s.proxy.chats.get('chat-a').ctx, 60005)
  } finally { await s.close() }
})

test('remembers only main requests', async () => {
  const s = await setup()
  try {
    await s.turn({ ...MAIN, 'x-claude-code-request-class': 'subagent', 'x-claude-code-session-id': 'sub' })
    await s.turn({ ...MAIN, 'x-claude-code-agent-id': 'a1', 'x-claude-code-session-id': 'agent' })
    const { 'x-claude-code-request-class': _, ...noClass } = MAIN
    await s.turn({ ...noClass, 'x-claude-code-session-id': 'unclassed' })
    assert.equal(s.proxy.chats.size, 0)
    await s.turn()
    assert.deepEqual([...s.proxy.chats.keys()], ['chat-a'])
  } finally { await s.close() }
})

test('pings in the lead window with the same bytes, hangs up after message_start', async () => {
  const s = await setup()
  try {
    await s.turn()
    await s.ctl('/_kw/chat/chat-a', { on: true })
    s.advance(200e3) // 100 s left: not yet
    assert.equal(await s.proxy.tick(), 0)
    s.advance(50e3) // 50 s left
    assert.equal(await s.proxy.tick(), 1)
    const ping = s.api.seen[1]
    assert.equal(ping.body, BODY)
    assert.equal(ping.headers.authorization, 'Bearer secret')
    await new Promise(r => setTimeout(r, 50))
    assert.equal(s.api.closedEarly, 1)
    const st = await (await s.ctl('/_kw/chat/chat-a')).json()
    assert.equal(st.pings, 1)
    assert.equal(st.lastPing.result, 'hit')
    assert.equal(st.pingsLeft, 2)
  } finally { await s.close() }
})

test('a chat keep-warm is off for is never pinged', async () => {
  const s = await setup()
  try {
    await s.turn()
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 0)
  } finally { await s.close() }
})

test('stops after a miss, at the cap, and on a 4xx; a real turn re-arms', async () => {
  const s = await setup({ maxPings: 2 })
  try {
    await s.turn()
    await s.ctl('/_kw/chat/chat-a', { on: true })
    s.api.usage = MISS
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 1)
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 0) // missed: the cache was cold, stop paying to re-cache it

    s.api.usage = HIT
    await s.turn() // a real turn re-arms it
    for (let i = 0; i < 2; i++) { s.advance(250e3); assert.equal(await s.proxy.tick(), 1) }
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 0) // at the cap

    await s.turn()
    s.api.status = 401
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 1)
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 0) // stopped: wait for Claude's next request
  } finally { await s.close() }
})

test('never pings once the cache has lapsed, or a small context', async () => {
  const s = await setup()
  try {
    await s.turn()
    await s.ctl('/_kw/chat/chat-a', { on: true })
    s.advance(400e3)
    assert.equal(await s.proxy.tick(), 0)
    await s.ctl('/_kw/options', { minTokens: 100000 })
    await s.turn()
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 0)
  } finally { await s.close() }
})

test('the daily cap holds across chats', async () => {
  const s = await setup({ dailyCap: 1 })
  try {
    for (const id of ['a', 'b']) {
      await s.turn({ ...MAIN, 'x-claude-code-session-id': id })
      await s.ctl(`/_kw/chat/${id}`, { on: true })
    }
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 1)
  } finally { await s.close() }
})

test('control calls need the client header, no Origin, and a loopback Host', async () => {
  const s = await setup()
  try {
    assert.equal((await s.call('/_kw/health')).status, 403)
    assert.equal((await s.call('/_kw/health', { headers: { 'x-kw-client': 'usage-band', origin: 'https://evil.example' } })).status, 403)
    assert.equal((await s.ctl('/_kw/health')).status, 200)
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: Number(new URL(s.base).port), path: '/_kw/health', headers: { host: 'evil.example', 'x-kw-client': 'usage-band' } }, resolve)
      req.on('error', reject)
      req.end()
    })
    assert.equal(res.statusCode, 403) // DNS rebinding: a loopback address under a foreign name
    assert.equal(s.api.seen.length, 0)
  } finally { await s.close() }
})

test('reads a gzip reply for the context size, and pings without asking for one', async () => {
  const s = await setup()
  try {
    s.api.gzip = true
    const text = await s.turn({ ...MAIN, 'accept-encoding': 'gzip' })
    assert.ok(text.length > 0)
    assert.equal(s.proxy.chats.get('chat-a').ctx, 60005)
    await s.ctl('/_kw/chat/chat-a', { on: true })
    s.advance(250e3)
    assert.equal(await s.proxy.tick(), 1)
    assert.equal(s.api.seen[1].headers['accept-encoding'], undefined)
    assert.equal(s.proxy.chats.get('chat-a').lastPing.result, 'hit')
  } finally { await s.close() }
})
