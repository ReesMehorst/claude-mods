import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage } from 'claude-code'

import type { Cache, DayLog, MonthLog, Snapshot, Tokens, Trend } from '../types'
import { addUsage, asLimits, bar, cacheAlerts, fromProxy, proxyWillPing, cacheLeft, compactLine, dayLevels, elapsedFraction, emptyCache, emptyTokens, emptyTrend, endTurn, explain, freshestLimits, isPaused, leadMs, mayPing, mode, pingMissed, projected, recordDay, recordPing, recordSpend, recordTurn, segments, spentReport, startTurn, suggest, warnings } from './summarize'
import type { Limit, ProxyChat, Segment } from './summarize'
import { dayTilesSvg, gaugeSvg, iconSvg, mascotSvg, miniMeterSvg, paceSvg, ringSvg, splitSvg, thermometerSvg } from './art'
import type { IconName } from './art'

// Shared by every chat: the band's look, the redraw pulse and the weekly day log.
const compact = atom({ plugin: 'usage-band', key: 'compact' } as const, false)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, 0) // bumped by the tick so the countdown redraws
const menuOpen = atom({ plugin: 'usage-band', key: 'menuOpen' } as const, false)
const weekLog = atom({ plugin: 'usage-band', key: 'weekLog' } as const, null)

// Everything about one conversation, keyed by its session id. A /clear or a resume goes on under
// a new id (no session.start fires for a /clear), so it starts from fresh values by itself.
// Each atom is written out at its read and update, as the module scan needs to list them.
// keepWarm is null until loaded from the store; dismissed is the suggestion key hidden by Later.
const chatState = ($: EngineInterface, id: string) => ({
  get: {
    snap: () => read($, atom({ plugin: 'usage-band', key: 'snap', id } as const, null)),
    tokens: () => read($, atom({ plugin: 'usage-band', key: 'tokens', id } as const, emptyTokens)),
    trend: () => read($, atom({ plugin: 'usage-band', key: 'trend', id } as const, emptyTrend)),
    warned: () => read($, atom({ plugin: 'usage-band', key: 'warned', id } as const, [] as string[])),
    cache: () => read($, atom({ plugin: 'usage-band', key: 'cache', id } as const, emptyCache)),
    keepWarm: () => read($, atom({ plugin: 'usage-band', key: 'keepWarm', id } as const, null)),
    dismissed: () => read($, atom({ plugin: 'usage-band', key: 'dismissed', id } as const, '')),
    proxyPings: () => read($, atom({ plugin: 'usage-band', key: 'proxyPings', id } as const, null)),
  },
  set: {
    snap: (f: (v: Snapshot | null) => Snapshot | null) => update($, atom({ plugin: 'usage-band', key: 'snap', id } as const, null), f),
    tokens: (f: (v: Tokens) => Tokens) => update($, atom({ plugin: 'usage-band', key: 'tokens', id } as const, emptyTokens), f),
    trend: (f: (v: Trend) => Trend) => update($, atom({ plugin: 'usage-band', key: 'trend', id } as const, emptyTrend), f),
    warned: (f: (v: string[]) => string[]) => update($, atom({ plugin: 'usage-band', key: 'warned', id } as const, [] as string[]), f),
    cache: (f: (v: Cache) => Cache) => update($, atom({ plugin: 'usage-band', key: 'cache', id } as const, emptyCache), f),
    keepWarm: (f: (v: boolean | null) => boolean | null) => update($, atom({ plugin: 'usage-band', key: 'keepWarm', id } as const, null), f),
    dismissed: (f: (v: string) => string) => update($, atom({ plugin: 'usage-band', key: 'dismissed', id } as const, ''), f),
    proxyPings: (f: (v: number | null) => number | null) => update($, atom({ plugin: 'usage-band', key: 'proxyPings', id } as const, null), f),
  },
})
type Chat = ReturnType<typeof chatState> & { id: string }
const chat = async ($: EngineInterface): Promise<Chat> => {
  const id = await $.session.id()
  return { id, ...chatState($, id) }
}

// A fork re-reads the cached transcript, which renews its lifetime; no tools, no thinking, one word back.
const PING = 'Cache keep-alive ping. You have no tools here. Reply with the single word "ok" straight away, without thinking it over.'

const build = (u: SessionUsage): Snapshot => ({
  contextPercent: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  contextWindow: u.context.window,
  costUsd: u.cost?.usd ?? null,
  startedAt: u.startedAt,
  rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
})

// The account's limits are the same in every chat: each chat saves what it last heard to the store,
// and shows the newest sample of each window, its own or another chat's. A chat known to bill API
// credits (spent, yet no limits reported) has no plan windows, so it takes none from the store.
async function withSharedLimits($: EngineInterface, s: Snapshot): Promise<Snapshot> {
  const stored = asLimits(await $.store.get('limits'))
  if (!s.rateLimits.length && (s.costUsd ?? 0) > 0) return s
  const merged = freshestLimits(s.rateLimits, stored, await $.clock.now())
  if (JSON.stringify(merged) !== JSON.stringify(stored)) await $.store.set('limits', merged)
  return { ...s, rateLimits: merged }
}
const snapshot = async ($: EngineInterface) => withSharedLimits($, build(await $.session.usage()))

// The stored day log from an older version or a damaged store reads as no log.
const asDayLog = (v: unknown): DayLog | null => {
  if (!v || typeof v !== 'object') return null
  const { resetsAt, days } = v as { resetsAt?: unknown; days?: unknown }
  if (typeof resetsAt !== 'string' || !days || typeof days !== 'object' || Array.isArray(days)) return null
  return Object.values(days).every(n => typeof n === 'number' && Number.isFinite(n)) ? { resetsAt, days: days as Record<string, number> } : null
}

// The stored month log from an older version or a damaged store reads as no log.
const asMonthLog = (v: unknown): MonthLog | null => {
  if (!v || typeof v !== 'object') return null
  const { month, since, api, plan } = v as Record<string, unknown>
  const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return typeof month === 'string' && typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since) && isMoney(api) && isMoney(plan) ? { month, since, api, plan } : null
}

// Keep-warm per chat, kept in the store by session id so it survives a reload or a resume.
// seen: when the chat last used it; entries untouched for 30 days are dropped.
type WarmChats = Record<string, { isOn: boolean; seen: number }>
const WARM_KEEP_MS = 30 * 86400e3
const asWarmChats = (v: unknown): WarmChats => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) =>
    !!x && typeof x === 'object' && typeof (x as { isOn?: unknown }).isOn === 'boolean' && typeof (x as { seen?: unknown }).seen === 'number')) as WarmChats
}

// The chat's keep-warm: its stored choice, else the plugin option. Loaded once into its atom.
async function loadKeepWarm($: EngineInterface, ch: Chat, fallback: boolean) {
  const held = await ch.get.keepWarm()
  if (held !== null) return held
  const mine = asWarmChats(await $.store.get('keepWarmChats'))[ch.id]
  const isOn = mine ? mine.isOn : fallback
  await ch.set.keepWarm(() => isOn)
  return isOn
}

async function setKeepWarm($: EngineInterface, isOn: boolean) {
  const ch = await chat($)
  const now = await $.clock.now()
  const all = asWarmChats(await $.store.get('keepWarmChats'))
  const kept = Object.fromEntries(Object.entries(all).filter(([id, x]) => id !== ch.id && now - x.seen < WARM_KEEP_MS))
  await $.store.set('keepWarmChats', { ...kept, [ch.id]: { isOn, seen: now } })
  await ch.set.keepWarm(() => isOn)
  return isOn
}

// The size of an art builder's SVG, read from its root tag.
const size = (svg: string) => {
  const head = svg.slice(0, svg.indexOf('>'))
  return { width: Number(/\swidth="([\d.]+)"/.exec(head)?.[1] ?? 0), height: Number(/\sheight="([\d.]+)"/.exec(head)?.[1] ?? 0) }
}

const ICON_OF: Record<string, 'context' | 'cache' | 'clock' | 'calendar' | 'coin' | 'tokens'> = {
  Context: 'context', Cache: 'cache', Weekly: 'calendar', 'API value': 'coin', Spend: 'coin', Tokens: 'tokens',
}
const LEVEL_HEX = { success: '#3fb950', warning: '#d29922', error: '#f85149' } as const
const MUTED_HEX = '#a3a19a'

async function toggle($: EngineInterface) {
  const isCompact = !(await read($, compact))
  await $.store.set('compact', isCompact)
  await update($, compact, () => isCompact)
  return isCompact
}

const closeMenu = ($: EngineInterface) => update($, menuOpen, () => false)

// Per session id, in case one process carries several chats (a /clear, a resume).
const lastCost = new Map<string, number | null>() // session cost at the last turn's end, so each turn adds only its own cost to the month
const pinging = new Set<string>() // a keep-warm fork is out; its own events must not count as a turn
const lastTick = new Map<string, number>() // when the tick last ran, to see that the process was paused
const holdOnce = new Set<string>() // a client just attached: decide pings on the next tick, with fresh time

// --- Proxy keep-warm ------------------------------------------------------------------------
// A local proxy (proxy/keepwarm-proxy.mjs) that keeps chats warm even while they're closed: this
// chat's API requests go through it, and it resends a chat's last request before its cache lapses.
// The base URL is set on this chat's own process only, and only while the proxy answers, so a
// proxy that is down never stands between a chat and the API.

type ProxyOptions = { isOn: boolean; port: number }
const proxyState = { isRouted: false, fails: 0, lastLaunch: -Infinity, ownBase: undefined as string | null | undefined, hasToldNoNode: false }

async function kw($: EngineInterface, port: number, path: string, body?: unknown): Promise<unknown> {
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-kw-client': 'usage-band', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return r.ok ? JSON.parse(r.text) : null
  } catch {
    return null
  }
}

async function route($: EngineInterface, port: number | null) {
  await $.env.set('ANTHROPIC_BASE_URL', port == null ? undefined : `http://127.0.0.1:${port}`)
  await $.env.set('CLAUDE_CODE_GATEWAY_HINT_HEADERS', port == null ? undefined : '1')
  proxyState.isRouted = port != null
}

// Every tick with proxy keep-warm on: start the proxy if it isn't running, route this chat through
// it while it answers (and back to the API after two misses), and tell it this chat's keep-warm.
// Returns what the proxy knows of this chat, or null while it doesn't cover it.
async function proxyTick($: EngineInterface, ch: Chat, o: ProxyOptions, isOn: boolean, opts: { maxPings: number; minTokens: number }, now: number): Promise<ProxyChat | null> {
  // A base URL other than the API's own, set before us, is someone's gateway: leave it alone.
  if (proxyState.ownBase === undefined) {
    const base = (await $.env.get('ANTHROPIC_BASE_URL')) ?? ''
    proxyState.ownBase = /^https:\/\/api\.anthropic\.com\/?$/.test(base) || !base ? null : base
  }
  if (proxyState.ownBase) return null
  const health = await kw($, o.port, '/_kw/health')
  if (!health) {
    proxyState.fails++
    if (proxyState.isRouted && proxyState.fails >= 2) {
      await route($, null)
      $.ui.toast('🧊 Keep-warm proxy is not answering: this chat talks to the API directly until it is back', { timeoutMs: 10000 })
    }
    if (now - proxyState.lastLaunch >= 60e3) {
      proxyState.lastLaunch = now
      try {
        await $.process.run(['node', `${$.plugin.root}/proxy/keepwarm-proxy.mjs`, '--launch', '--port', String(o.port)], { timeoutMs: 10e3 })
      } catch {
        if (!proxyState.hasToldNoNode) $.ui.toast('🧊 Proxy keep-warm needs Node.js on the PATH to start the proxy', { timeoutMs: 10000 })
        proxyState.hasToldNoNode = true
      }
    }
    return null
  }
  proxyState.fails = 0
  if (!proxyState.isRouted) {
    await route($, o.port)
    await kw($, o.port, '/_kw/options', opts)
  }
  const p = (await kw($, o.port, `/_kw/chat/${ch.id}`, { on: isOn })) as ProxyChat | null
  return p && typeof p.pings === 'number' ? p : null
}

type CacheOptions = { maxPings: number; minTokens: number; keepWarmDefault: boolean; proxy: ProxyOptions }

// Every 5 s: follow the shared limits, redraw the countdown, send a keep-warm ping when one is
// due, else toast the cold warnings.
async function tick($: EngineInterface, { maxPings, minTokens, keepWarmDefault, proxy }: CacheOptions) {
  const ch = await chat($)
  const now = await $.clock.now()
  const wasHeld = holdOnce.delete(ch.id)
  const wasPaused = isPaused(lastTick.get(ch.id) ?? null, now) || wasHeld
  lastTick.set(ch.id, now)

  // A chat with no numbers yet (just cleared, so under a new id) gets its own; one that has
  // them follows the limits other chats saved.
  const held = await ch.get.snap()
  const s = held ? await withSharedLimits($, held) : await snapshot($)
  if (!held || JSON.stringify(s.rateLimits) !== JSON.stringify(held.rateLimits)) await ch.set.snap(() => s)

  const isOn = await loadKeepWarm($, ch, keepWarmDefault)
  // While the proxy covers the chat it does the pinging (also once the chat is closed), and the
  // countdown follows its last ping; this chat's own pings stand down.
  const viaProxy = proxy.isOn ? await proxyTick($, ch, proxy, isOn, { maxPings, minTokens }, now) : null
  await ch.set.proxyPings(() => (viaProxy ? viaProxy.pings : null))
  if (viaProxy) await ch.set.cache(x => fromProxy(x, viaProxy))

  const c = await ch.get.cache()
  const left = cacheLeft(c, now)
  if (left == null) return
  await update($, pulse, n => n + 1)
  const ctx = s?.contextTokens ?? null
  const willPing = isOn && !viaProxy && !c.missed && c.pings < maxPings && (ctx ?? 0) >= minTokens
  // After a pause, what this chat knew is stale: skip a beat and decide on the next tick.
  if (willPing && !wasPaused && !pinging.has(ch.id) && mayPing(c, now, maxPings)) {
    pinging.add(ch.id)
    try {
      // Read the time again right before sending: a ping into a cold cache re-caches the whole context.
      const at = await $.clock.now()
      if (!mayPing(await ch.get.cache(), at, maxPings)) return
      let isAnswered = false
      let missed = false
      try {
        const r = await $.model.fork({ prompt: PING })
        isAnswered = r.isAnswered
        missed = 'usage' in r && pingMissed(r.usage)
      } catch { /* counts as a failed ping */ }
      const done = await $.clock.now()
      await ch.set.cache(x => recordPing(x, done, isAnswered, missed))
    } finally {
      pinging.delete(ch.id)
    }
    return
  }
  const fresh = cacheAlerts(c, now, ctx, minTokens, willPing || (isOn && proxyWillPing(viaProxy))).filter(a => !c.alerted.includes(a.key))
  for (const a of fresh) $.ui.toast(`🧊 ${a.text}`, { timeoutMs: 10000 })
  if (fresh.length) await ch.set.cache(x => ({ ...x, alerted: [...x.alerted, ...fresh.map(a => a.key)] }))
}

// Toasts the warnings not yet shown. Limit warnings belong to the account, so they are kept in the
// store and shown once for each window, whichever chat sees them first; the rest once per chat.
async function warn($: EngineInterface, ch: Chat, s: Snapshot, budget: number) {
  const all = warnings(s, await $.clock.now(), budget, await ch.get.trend())
  const isLimit = (key: string) => key.startsWith('pace:')
  const seenHere = await ch.get.warned()
  const stored = await $.store.get('warnedLimits')
  const seenShared = Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : []
  const fresh = all.filter(w => !(isLimit(w.key) ? seenShared : seenHere).includes(w.key))
  for (const w of fresh) $.ui.toast(`⚠ ${w.text}`, { timeoutMs: 8000 })
  const mine = fresh.filter(w => !isLimit(w.key)).map(w => w.key)
  const shared = fresh.filter(w => isLimit(w.key)).map(w => w.key)
  if (mine.length) await ch.set.warned(ks => [...ks, ...mine])
  if (shared.length) await $.store.set('warnedLimits', [...seenShared, ...shared].slice(-20))
}

// Option values may arrive as text ("true") as well as booleans.
const isTrue = (v: unknown) => v === true || v === 'true'

export const register: Register = (on, options) => {
  const budget = Number(options.budgetUsd ?? 0)
  const turnWarn = Number(options.turnWarnUsd ?? 0)
  const maxPings = Math.max(0, Math.floor(Number(options.keepWarmMaxPings ?? 3)))
  const minTokens = Math.max(0, Number(options.coldMinTokens ?? 20000))
  const keepWarmDefault = isTrue(options.keepWarm)
  const proxy: ProxyOptions = { isOn: isTrue(options.proxyKeepWarm), port: Math.floor(Number(options.proxyPort ?? 8787)) || 8787 }
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'usage-band', description: 'Toggle the usage band between full and compact' })
    await $.command.register({ name: 'spent', description: "Show this month's API spend (or plan usage as API value)" })
    await $.command.register({ name: 'keep-warm', description: 'Keep this chat\'s prompt cache warm while idle: on, off, or no argument to toggle', argumentHint: '[on|off]' })
    const isCompact = (await $.store.get('compact')) === true
    await update($, compact, () => isCompact)
    const ch = await chat($)
    await loadKeepWarm($, ch, keepWarmDefault)
    const log = asDayLog(await $.store.get('weekLog'))
    await update($, weekLog, () => log)
    $.clock.every(5000, () => tick($, { maxPings, minTokens, keepWarmDefault, proxy }))
    // Start the proxy and route through it before the first request when it is already running.
    if (proxy.isOn) await proxyTick($, ch, proxy, await loadKeepWarm($, ch, keepWarmDefault), { maxPings, minTokens }, await $.clock.now())
    const s = await snapshot($)
    lastCost.set(ch.id, s.costUsd)
    await ch.set.snap(() => s)
    return r
  })

  // A client opening the chat (the desktop app, a phone): time may have moved on while nobody watched.
  on('session.attach', async ($, e, next) => {
    holdOnce.add(await $.session.id())
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const ch = await chat($)
    const s = await snapshot($)
    await ch.set.snap(() => s)
    await warn($, ch, s, budget)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const id = await $.session.id()
    if (!e.agentId && !pinging.has(id)) {
      const at = await $.clock.now()
      await chatState($, id).set.cache(c => startTurn(c, at))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const ch = await chat($)
    if (!e.agentId && !pinging.has(ch.id)) {
      const at = await $.clock.now()
      await ch.set.cache(c => endTurn(c, at, e.usage))
    }
    const u = e.usage
    if (u) await ch.set.tokens(t => addUsage(t, u))
    if (e.agentId) return r // ponytail: subagent turns would skew context growth
    const s = await snapshot($)
    await ch.set.snap(() => s)
    const t = await ch.set.trend(t => recordTurn(t, s.costUsd, s.contextTokens))
    if (mode(s) === 'api' && turnWarn > 0 && (t.lastTurnUsd ?? 0) >= turnWarn)
      $.ui.toast(`⚠ That turn cost $${t.lastTurnUsd!.toFixed(2)}`, { timeoutMs: 8000 })
    // Monthly spend: this turn's share of the session cost, kept across sessions.
    if (s.costUsd != null) {
      const delta = s.costUsd - (lastCost.get(ch.id) ?? 0)
      lastCost.set(ch.id, s.costUsd)
      const log = recordSpend(asMonthLog(await $.store.get('monthLog')), await $.clock.now(), delta, mode(s) === 'plan')
      if (log) await $.store.set('monthLog', log)
    }
    // Weekly day tiles: one sample per local day, taken while the mod runs.
    const week = s.rateLimits.find(x => x.kind === 'seven_day')
    if (week?.resetsAt) {
      const log = recordDay(asDayLog(await $.store.get('weekLog')), await $.clock.now(), week.percentUsed, week.resetsAt)
      await $.store.set('weekLog', log)
      await update($, weekLog, () => log)
    }
    return r
  })

  on('command.run', { command: 'usage-band' }, async $ => ({ text: `Usage band: ${(await toggle($)) ? 'compact' : 'full'}` }))

  on('command.run', { command: 'spent' }, async $ => ({ text: spentReport(asMonthLog(await $.store.get('monthLog')), await $.clock.now()) }))

  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    const ch = await chat($)
    const was = await loadKeepWarm($, ch, keepWarmDefault)
    const isOn = await setKeepWarm($, arg === 'on' ? true : arg === 'off' ? false : !was)
    return { text: isOn ? `Keep-warm on for this chat: pings the cache up to ${maxPings}× while idle (billed as cache reads)` : 'Keep-warm off for this chat: you will get an alert when the cache goes cold' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ch = await chat($)
    const s = await ch.get.snap()
    if (s === null || e.props.hasSurvey) return next(e)
    const m = mode(s)
    await read($, pulse) // subscribe: the tick redraws the cache countdown
    const now = await $.clock.now()
    const c = await ch.get.cache()
    const tr = await ch.get.trend()
    const tok = await ch.get.tokens()
    const keep = { isOn: (await ch.get.keepWarm()) ?? keepWarmDefault, maxPings, proxyPings: await ch.get.proxyPings() }
    const segs = segments(s, tok, now, budget, tr, c, keep)

    // Graphical surfaces (desktop, vscode, mobile): mascot, bubble and drawn meters. Terminal keeps the text band below.
    if (e.surface !== 'terminal') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const art = (source: string, alt: string, isInteractive = false) => <Svg source={source} alt={alt} {...size(source)} isInteractive={isInteractive || undefined} />
      const worst = segs.find(x => x.level === 'error') ?? segs.find(x => x.level === 'warning')
      const tint = (seg: Segment) => (seg.level === 'success' ? undefined : seg.level)
      const caption = (seg: Segment) => <Text dimColor size="caption">{seg.label.toUpperCase()}</Text>
      const value = (seg: Segment) => <Text size="heading" weight="bold" tabular dimColor={seg.isMuted} color={tint(seg)}>{seg.value}</Text>

      // Segments after Context (and Cache, once there is one) are the rate limits, in snapshot order.
      const cacheIdx = segs.findIndex(x => x.label === 'Cache')
      const firstLimit = cacheIdx >= 0 ? 2 : 1
      const limitOf = (i: number) => (i >= firstLimit && i < firstLimit + s.rateLimits.length ? s.rateLimits[i - firstLimit] : undefined)

      const left = cacheLeft(c, now)
      const cacheState = c.active ? 'live' : left != null && left <= 0 ? 'cold' : left != null && left <= leadMs(c.ttlMs) ? 'soon' : 'warm'

      const sug = suggest({ s, now, cache: c, keepWarm: keep.isOn, trend: tr, budgetUsd: budget, dismissed: await ch.get.dismissed() })
      const mascot = (px: number) => art(mascotSvg(sug.mood, px), `Mascot: ${sug.mood}`, true)

      if (await read($, compact)) {
        const chips = segs.flatMap((seg, i) => {
          const r = limitOf(i)
          if (m === 'usage' ? seg.label !== 'Context' && seg.label !== 'Cache' : m === 'plan' && seg.label === 'Tokens') return []
          const icon = r ? (r.kind === 'seven_day' ? 'calendar' : 'clock') : ICON_OF[seg.label] ?? 'tokens'
          const pct = seg.label === 'Cache' ? (seg.percent == null ? null : 100 - seg.percent) : seg.percent
          const proj = r ? projected(r.percentUsed, r.resetsAt, r.kind, now) : null
          return [
            <Box key={`chip-${seg.label}`} flexDirection="row" alignItems="center" columnGap="xs" paddingX={1} borderStyle="round" borderColor="subtle">
              {art(iconSvg(icon, seg.level === 'success' ? MUTED_HEX : LEVEL_HEX[seg.level]), seg.label)}
              <Text weight="bold" tabular dimColor={seg.isMuted} color={tint(seg)}>{seg.value}</Text>
              {pct != null ? art(miniMeterSvg(pct, seg.level, proj), `${seg.label} ${seg.value}`) : null}
            </Box>,
          ]
        })
        return (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs" paddingX={1}>
            {mascot(32)}
            {chips}
            <Box flexGrow={1} />
            <Button key="show" variant="secondary" onPress={() => toggle($)}>Show</Button>
          </Box>
        )
      }

      const actionLabel = sug.action === 'compact' ? 'Compact now' : left != null && left <= 0 ? 'Turn on keep-warm' : 'Keep it warm'
      const doAction = sug.action === 'compact' ? () => void $.command.run({ command: 'compact' }) : () => setKeepWarm($, true)
      const isMenuOpen = await read($, menuOpen)
      const weekLog_ = await read($, weekLog)

      const head = (
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {m === 'usage'
            ? <Text bold dimColor>Usage</Text>
            : <Text bold color={m === 'plan' ? 'claude' : 'suggestion'}>{m === 'plan' ? 'Plan usage' : 'API usage'}</Text>}
          {worst ? <Text color={worst.level}>●</Text> : null}
          <Box flexGrow={1} />
          <Button key="menu" variant="secondary" onPress={() => update($, menuOpen, o => !o)}>⋯</Button>
        </Box>
      )

      // A dropdown under ⋯, drawn over the segments. The band grows to hold it while open,
      // since a placed Box is clipped by the band. void: command.run is queued until idle.
      const item = (key: string, icon: IconName, label: string, onPress: () => unknown, aside?: RenderChildren) => (
        <Box key={`row-${key}`} flexDirection="row" alignItems="center" columnGap="sm">
          {art(iconSvg(icon, MUTED_HEX), label)}
          <Button key={key} plain onPress={onPress}>{label}</Button>
          <Box flexGrow={1} />
          {aside ?? null}
        </Box>
      )
      const ctxSeg = segs.find(x => x.label === 'Context')
      const menu = isMenuOpen
        ? (
          <Box key="dropdown" position="absolute" top={2} right={1} flexDirection="column" rowGap="xs" minWidth={30}
            paddingX={1} paddingY="xs" borderStyle="round" borderColor="subtle" backgroundColor="rgba(40,40,38,0.98)">
            {item('m-compact', 'context', 'Compact conversation', async () => { void $.command.run({ command: 'compact' }); await closeMenu($) },
              ctxSeg ? <Text size="caption" color={tint(ctxSeg)} dimColor={!tint(ctxSeg)}>{ctxSeg.value}</Text> : null)}
            {item('m-clear', 'trash', 'Clear conversation', async () => { void $.command.run({ command: 'clear' }); await closeMenu($) })}
            {item('m-warm', 'cache', 'Keep cache warm', () => setKeepWarm($, !keep.isOn),
              <Text size="caption" weight="bold" color={keep.isOn ? 'warning' : undefined} dimColor={!keep.isOn}>{keep.isOn ? 'on' : 'off'}</Text>)}
            {item('m-refresh', 'refresh', 'Refresh numbers', async () => { const fresh = await snapshot($); await ch.set.snap(() => fresh); await closeMenu($) })}
            {item('m-hide', 'collapse', 'Collapse band', async () => { await closeMenu($); await toggle($) })}
          </Box>
        )
        : null

      const bubble = (
        <Box key="bubble" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs" flexShrink={1}
          paddingX={1} paddingY="xs" borderStyle="round" borderColor="subtle" backgroundColor="rgba(139,148,158,0.15)">
          <Text>{sug.text}</Text>
          {sug.action ? <Button key="act" variant="primary" onPress={doAction}>{actionLabel}</Button> : null}
          {sug.action ? <Button key="later" variant="secondary" dimColor onPress={() => ch.set.dismissed(() => sug.key)}>Later</Button> : null}
        </Box>
      )

      // Every segment gets an equal share of one row. Under its picture, plain words (explain):
      // the main line at full strength, the rest dim, each wrapping within the column.
      const xin = { s, t: tok, now, cache: c, keepWarm: keep.isOn, trend: tr, budgetUsd: budget }
      const words = (seg: Segment) => {
        const lines = explain(seg, xin)
        return (
          <Box key="words" flexDirection="column" alignItems="center">
            {lines.map((l, i) => <Text key={`w${i}`} size="footnote" wrap="wrap" dimColor={i > 0} color={i === 0 ? tint(seg) : undefined}>{l}</Text>)}
          </Box>
        )
      }
      const col = (seg: Segment, ...kids: RenderChildren[]) => (
        <Box key={seg.label} flexDirection="column" alignItems="center" rowGap="xs" flexGrow={1} flexShrink={1} minWidth={0}>{caption(seg)}{kids}<Box key="push" flexGrow={1} />{words(seg)}</Box>
      )
      const said = (seg: Segment) => explain(seg, xin).join('. ')
      const segView = (seg: Segment, i: number) => {
        const r = limitOf(i)
        if (seg.label === 'Context')
          return col(seg, art(ringSvg(s.contextPercent, seg.level, 44), `Context ${seg.value}: ${said(seg)}`))
        if (seg.label === 'Cache')
          return col(seg,
            <Box flexDirection="row" alignItems="center" columnGap="sm">
              {art(thermometerSvg(left == null ? null : left / c.ttlMs, cacheState, 44), `Cache ${seg.value}: ${said(seg)}`, cacheState === 'live')}
              {value(seg)}
            </Box>)
        if (r && r.kind === 'seven_day')
          return col(seg, value(seg),
            r.resetsAt ? art(dayTilesSvg(dayLevels(weekLog_, now, r.resetsAt), 12), 'Weekly use per day') : null)
        if (r)
          return col(seg, value(seg),
            art(paceSvg(r.percentUsed, projected(r.percentUsed, r.resetsAt, r.kind, now), elapsedFraction(r.resetsAt, r.kind, now), seg.level, 120), `${seg.label} ${seg.value}: ${said(seg)}`))
        if (seg.label === 'Spend' && seg.percent != null)
          return col(seg,
            <Box flexDirection="row" alignItems="center" columnGap="sm">
              {art(gaugeSvg(seg.percent, 56), `Spend ${seg.percent}% of budget`)}
              {value(seg)}
            </Box>)
        if (seg.label === 'Tokens')
          return col(seg, value(seg), art(splitSvg(tok, 120), 'Token split: cache reads, new input, output'))
        return col(seg, value(seg))
      }

      // The mascot stands on the card's top edge: placed over the band's own first rows,
      // where the bubble sits beside it, so nothing it draws falls outside the band.
      return (
        <Box flexDirection="column" position="relative">
          <Box flexDirection="row" alignItems="flex-end" paddingLeft={9} minHeight={3}>{bubble}</Box>
          <Box flexDirection="column" rowGap="sm" paddingX={1} paddingY={1} borderStyle="round" borderColor="subtle" minHeight={isMenuOpen ? 13 : undefined}>
            {head}
            <Box flexDirection="row" flexWrap="nowrap" alignItems="stretch" columnGap="md">
              {segs.map(segView)}
            </Box>
            {menu}
          </Box>
          <Box position="absolute" top={1} left={1}>{mascot(64)}</Box>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const badge = <Text inverse bold color={m === 'plan' ? 'claude' : 'suggestion'}>{` ${m.toUpperCase()} `}</Text>

    if (await read($, compact)) {
      const worst = segs.find(x => x.level === 'error') ?? segs.find(x => x.level === 'warning')
      return (
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          {badge}
          <Text dimColor wrap="truncate-end">{compactLine(m, segs).slice(m.length + 3)}</Text>
          {worst ? <Text color={worst.level}>●</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1} alignItems="flex-start"
        borderStyle="round" borderColor="subtle" paddingX={1}>
        <Box flexDirection="column">
          {badge}
          <Text dimColor size="caption">/usage-band</Text>
        </Box>
        {segs.map(seg => {
          const tint = seg.level === 'success' ? undefined : seg.level
          const [full, rest] = seg.percent != null ? bar(seg.percent) : ['', '']
          return (
            <Box key={seg.label} flexDirection="column" minWidth={14}>
              <Text dimColor size="caption">{seg.label.toUpperCase()}</Text>
              <Text>
                <Text weight="bold" tabular dimColor={seg.isMuted} color={tint}>{seg.value}</Text>
                {seg.percent != null ? <Text> <Text color={seg.level}>{full}</Text><Text dimColor>{rest}</Text></Text> : null}
              </Text>
              <Text dimColor size="caption" color={tint}>{seg.detail || ' '}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
