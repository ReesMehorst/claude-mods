import type { Cache, DayLog, DayTile, MonthLog, Snapshot, Suggestion, Tokens, Trend } from '../types'

export type Mode = 'plan' | 'api' | 'usage'
export type Level = 'success' | 'warning' | 'error'
export type Segment = {
  label: string
  value: string
  detail: string
  short: string // compact-line form
  percent: number | null
  level: Level
  isMuted?: boolean
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }
const LABEL: Record<string, string> = { five_hour: '5h limit', seven_day: 'Weekly', spend_limit: 'Spend limit' }
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'limit' }

export const emptyTokens: Tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
export const emptyTrend: Trend = { lastCost: null, lastTurnUsd: null, ctxHistory: [] }

export const emptyCache: Cache = { at: null, ttlMs: 300e3, active: false, pings: 0, alerted: [], missed: false }

export const num = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

// Local wall-clock HH:MM; adds the weekday when it is not today.
export const clock = (ms: number, now: number) => {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`
}

const level = (p: number, warn: number, err: number): Level => (p >= err ? 'error' : p >= warn ? 'warning' : 'success')

// rateLimits is also empty on a plan until the first response reports them, so
// no windows only means API once something has been billed.
export const mode = (s: Snapshot): Mode => (s.rateLimits.length ? 'plan' : (s.costUsd ?? 0) > 0 ? 'api' : 'usage')

export const bar = (percent: number, width = 8) => {
  const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return ['━'.repeat(full), '─'.repeat(width - full)] as const
}

const FILL: Record<Level, string> = { success: '#3fb950', warning: '#d29922', error: '#f85149' }

// Rounded meter for graphical surfaces; translucent grey track reads on light and dark.
export const barSvg = (percent: number, level: Level, width = 120, height = 6) => {
  const w = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#8b949e" fill-opacity="0.25"/>` +
    (w > 0 ? `<rect width="${Math.max(w, height)}" height="${height}" rx="${height / 2}" fill="${FILL[level]}"/>` : '') +
    `</svg>`
}

export const elapsedFraction = (resetsAt: string | undefined, kind: string, now: number) => {
  const dur = WINDOW_MS[kind]
  if (!dur || !resetsAt) return null
  const f = (dur - (Date.parse(resetsAt) - now)) / dur
  return f < 0.02 ? null : f // ponytail: too early to extrapolate, noise
}

// Projected % at reset if the current pace holds.
export const projected = (percentUsed: number, resetsAt: string | undefined, kind: string, now: number) => {
  const f = elapsedFraction(resetsAt, kind, now)
  return f == null ? null : Math.round(percentUsed / f)
}

// When the window hits 100% at the current pace; null when it resets first.
export const eta = (percentUsed: number, resetsAt: string | undefined, kind: string, now: number) => {
  const f = elapsedFraction(resetsAt, kind, now)
  if (f == null || percentUsed <= 0 || !resetsAt) return null
  if (percentUsed >= 100) return now
  const elapsedMs = f * WINDOW_MS[kind]!
  const at = now + ((100 - percentUsed) / percentUsed) * elapsedMs
  return at < Date.parse(resetsAt) ? at : null
}

export const cacheHit = (t: Tokens) => {
  const input = t.in + t.cacheRead + t.cacheWrite
  return input ? Math.round((t.cacheRead / input) * 100) : null
}

export const addUsage = (t: Tokens, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): Tokens => ({
  in: t.in + u.input_tokens,
  out: t.out + u.output_tokens,
  cacheRead: t.cacheRead + u.cache_read_input_tokens,
  cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
})

// Records one finished turn: its cost and the context it left. A drop of over
// 30% is a /compact or /clear, so growth before it no longer predicts anything.
export const recordTurn = (t: Trend, costUsd: number | null, ctxTokens: number | null): Trend => {
  const last = t.ctxHistory.at(-1)
  const hist = ctxTokens == null ? t.ctxHistory : last != null && ctxTokens < last * 0.7 ? [ctxTokens] : [...t.ctxHistory, ctxTokens].slice(-5)
  return {
    lastCost: costUsd ?? t.lastCost,
    lastTurnUsd: costUsd != null && t.lastCost != null ? costUsd - t.lastCost : null,
    ctxHistory: hist,
  }
}

// Turns until context reaches 80% at the recent average growth; null without a trend.
export const turnsLeft = (hist: number[], window: number) => {
  if (hist.length < 3) return null
  const avg = (hist.at(-1)! - hist[0]!) / (hist.length - 1)
  return avg > 0 ? Math.max(0, Math.ceil((0.8 * window - hist.at(-1)!) / avg)) : null
}

// --- Prompt cache warmth ---------------------------------------------------------------

// Alert / keep-warm window before expiry: a minute on the 5-minute cache, five on the 1-hour one.
export const leadMs = (ttlMs: number) => (ttlMs > 600e3 ? 300e3 : 60e3)

// A write of both lifetimes counts as the shorter; a read-only turn keeps the lifetime already known.
export const cacheTtl = (u: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | undefined, prev: number) =>
  (u?.ephemeral_5m_input_tokens ?? 0) > 0 ? 300e3 : (u?.ephemeral_1h_input_tokens ?? 0) > 0 ? 3600e3 : prev

export const startTurn = (c: Cache, now: number): Cache => ({ ...c, at: now, active: true, pings: 0, alerted: [], missed: false })
export const endTurn = (c: Cache, now: number, u?: Parameters<typeof cacheTtl>[0]): Cache => ({ ...c, at: now, ttlMs: cacheTtl(u, c.ttlMs), active: false, pings: 0, alerted: [], missed: false })

// A keep-warm ping counts against the budget whether or not it answered; only an answer renews the cache.
// One that missed re-cached the whole context: the cache is warm again, but no more pings until a real turn.
export const recordPing = (c: Cache, now: number, isAnswered: boolean, missed = false): Cache =>
  ({ ...c, at: isAnswered ? now : c.at, pings: c.pings + 1, alerted: isAnswered ? [] : c.alerted, missed: c.missed || missed })

// A ping that wrote more of the cache than it read found it cold, and paid to re-cache it.
export const pingMissed = (u?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number }) =>
  u != null && (u.cache_creation_input_tokens ?? 0) > (u.cache_read_input_tokens ?? 0)

// The tick runs every 5 s; a longer gap means the process was paused (the chat was closed)
// and time moved on without it, so what it knew about the cache is stale.
export const PAUSE_MS = 30e3
export const isPaused = (lastTick: number | null, now: number) => lastTick != null && now - lastTick > PAUSE_MS

// Whether a keep-warm ping may go out now: still warm with margin, inside the lead window, under the budget.
export const mayPing = (c: Cache, now: number, maxPings: number) => {
  const left = cacheLeft(c, now)
  return left != null && !c.missed && c.pings < maxPings && left > 5e3 && left <= leadMs(c.ttlMs)
}

// --- Account limits, shared by every chat ---------------------------------------------------

export type Limit = Snapshot['rateLimits'][number]
const resetMs = (r: Limit) => (r.resetsAt ? Date.parse(r.resetsAt) : -Infinity)

// Per window, the newest sample: the later reset wins, then (within one window, where use only
// grows) the higher use. Stored samples from a window that has already reset are dropped.
export const freshestLimits = (own: readonly Limit[], stored: readonly Limit[], now: number): Limit[] => {
  const out = new Map<string, Limit>(own.map(r => [r.kind, r]))
  for (const r of stored) {
    if (r.resetsAt && resetMs(r) <= now) continue
    const mine = out.get(r.kind)
    if (!mine || resetMs(r) > resetMs(mine) || (resetMs(r) === resetMs(mine) && r.percentUsed > mine.percentUsed)) out.set(r.kind, r)
  }
  const order = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2)
  return [...out.values()].sort((a, b) => order(a.kind) - order(b.kind))
}

// The stored limits from an older version or a damaged store read as none.
export const asLimits = (v: unknown): Limit[] =>
  Array.isArray(v) ? v.filter((r): r is Limit => !!r && typeof r.kind === 'string' && typeof r.percentUsed === 'number' && (r.resetsAt === undefined || typeof r.resetsAt === 'string')) : []

// Milliseconds until the cache lapses (negative once it has); null before the first turn or while a turn runs.
export const cacheLeft = (c: Cache, now: number) => (c.at == null || c.active ? null : c.at + c.ttlMs - now)

export const fmtLeft = (ms: number) => (ms >= 3600e3 ? `${Math.floor(ms / 3600e3)}h ${Math.ceil((ms % 3600e3) / 60e3)}m` : ms >= 60e3 ? `${Math.ceil(ms / 60e3)}m` : `${Math.max(0, Math.ceil(ms / 1e3))}s`)

export type KeepWarm = { isOn: boolean; maxPings: number }

export const cacheSegment = (c: Cache, now: number, keep: KeepWarm = { isOn: false, maxPings: 0 }): Segment | null => {
  if (c.at == null) return null
  if (c.active) return { label: 'Cache', value: 'live', detail: 'turn in progress', short: 'cache live', percent: 0, level: 'success' }
  const left = cacheLeft(c, now)!
  const ttl = c.ttlMs >= 3600e3 ? '1h' : '5m'
  const pings = keep.isOn ? `keep-warm ${c.pings}/${keep.maxPings}` : ''
  if (left <= 0)
    return { label: 'Cache', value: 'cold', detail: ['next message re-caches', pings].filter(Boolean).join(' · '), short: 'cache cold', percent: 100, level: 'warning' }
  return {
    label: 'Cache',
    value: fmtLeft(left),
    detail: [`warm · ${ttl} TTL`, pings].filter(Boolean).join(' · '),
    short: `cache ${fmtLeft(left)}`,
    percent: Math.round((1 - left / c.ttlMs) * 100),
    level: left <= leadMs(c.ttlMs) ? 'warning' : 'success',
  }
}

// Toasts for an idle cache. Small contexts are not worth a toast, and while a keep-warm ping is still due
// the "going cold" notice waits: the ping prevents it. Each key toasts once per idle stretch.
export const cacheAlerts = (c: Cache, now: number, ctxTokens: number | null, minTokens: number, willPing: boolean): Warning[] => {
  const left = cacheLeft(c, now)
  if (left == null || (ctxTokens ?? 0) < minTokens) return []
  const size = ctxTokens == null ? '' : ` (~${num(ctxTokens)} tokens)`
  if (left <= 0) return [{ key: 'cold', text: `Prompt cache went cold: your next message re-caches the whole context${size}` }]
  if (left <= leadMs(c.ttlMs) && !willPing) return [{ key: 'soon', text: `Prompt cache goes cold in ${fmtLeft(left)}: send a message to keep it warm` }]
  return []
}

const hours = (s: Snapshot, now: number) => (now - s.startedAt) / 3600e3

// Session spend per hour; null for the first few minutes, when it is noise.
const spendRate = (s: Snapshot, now: number) => {
  const h = hours(s, now)
  return h > 0.05 && s.costUsd != null ? s.costUsd / h : null
}

// When the budget runs out at the current spend rate; null without a rate or once it has.
const budgetEta = (s: Snapshot, now: number, budgetUsd: number) => {
  const rate = spendRate(s, now)
  const rest = budgetUsd - (s.costUsd ?? 0)
  return rate && rest > 0 ? now + (rest / rate) * 3600e3 : null
}

export const segments = (s: Snapshot, t: Tokens, now: number, budgetUsd = 0, trend = emptyTrend, cache = emptyCache, keep?: KeepWarm): Segment[] => {
  const out: Segment[] = []
  const m = mode(s)

  const ctx = s.contextPercent
  const left = turnsLeft(trend.ctxHistory, s.contextWindow)
  out.push({
    label: 'Context',
    value: ctx == null ? '–' : `${ctx}%`,
    detail: [s.contextTokens == null ? `${num(s.contextWindow)} window` : `${num(s.contextTokens)} of ${num(s.contextWindow)}`,
      left ? `~${left} turn${left === 1 ? '' : 's'} to 80%` : ''].filter(Boolean).join(' · '),
    short: `ctx ${ctx ?? '–'}%`,
    percent: ctx,
    level: level(ctx ?? 0, 60, 80),
  })

  const warm = cacheSegment(cache, now, keep)
  if (warm) out.push(warm)

  for (const r of s.rateLimits) {
    const p = projected(r.percentUsed, r.resetsAt, r.kind, now)
    const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
    const when = hit != null ? `hits 100% ~${clock(hit, now)}` : r.resetsAt ? `resets ${clock(Date.parse(r.resetsAt), now)}` : ''
    out.push({
      label: LABEL[r.kind] ?? r.kind,
      value: `${r.percentUsed}%`,
      detail: [p == null ? '' : `pace → ${p}%`, when].filter(Boolean).join(' · '),
      short: `${SHORT[r.kind] ?? r.kind} ${r.percentUsed}%${p == null ? '' : `→${p}%`}`,
      percent: r.percentUsed,
      // Colour by where the pace lands, not just what's used now.
      level: level(Math.max(r.percentUsed, p ?? 0), 80, 100),
    })
  }

  if (s.costUsd != null) {
    const rate = spendRate(s, now)
    const usd = `$${s.costUsd.toFixed(2)}`
    const turn = trend.lastTurnUsd ? `last +$${trend.lastTurnUsd.toFixed(2)}` : ''
    if (m === 'plan') {
      out.push({ label: 'API value', value: usd, detail: ['included in plan', turn].filter(Boolean).join(' · '), short: usd, percent: null, level: 'success', isMuted: true })
    } else if (budgetUsd > 0) {
      const pct = Math.round((s.costUsd / budgetUsd) * 100)
      const rest = budgetUsd - s.costUsd
      const etaMs = budgetEta(s, now, budgetUsd)
      out.push({
        label: 'Spend',
        value: usd,
        detail: [`of $${budgetUsd}`, rate ? `$${rate.toFixed(2)}/hr` : '', etaMs ? `budget ~${clock(etaMs, now)}` : rest <= 0 ? 'over budget' : '', turn].filter(Boolean).join(' · '),
        short: `${usd}/$${budgetUsd}`,
        percent: pct,
        level: level(pct, 75, 90),
      })
    } else {
      out.push({ label: 'Spend', value: usd, detail: [rate ? `$${rate.toFixed(2)}/hr` : 'this session', turn].filter(Boolean).join(' · '), short: usd, percent: null, level: 'success' })
    }
  }

  const total = t.in + t.out + t.cacheRead + t.cacheWrite
  if (total > 0) {
    const hit = cacheHit(t)
    out.push({
      label: 'Tokens',
      value: num(total),
      detail: [`in ${num(t.in + t.cacheWrite)}`, `out ${num(t.out)}`, hit == null ? '' : `cache ${hit}%`].filter(Boolean).join(' · '),
      short: `${num(total)} tok`,
      percent: null,
      level: 'success',
      isMuted: true,
    })
  }

  return out
}

export const compactLine = (m: Mode, segs: Segment[]) => [m.toUpperCase(), ...segs.map(s => s.short)].join(' · ')

export type Warning = { key: string; text: string }

// Keys carry the window's reset so a fresh window can warn again.
export const warnings = (s: Snapshot, now: number, budgetUsd = 0, trend = emptyTrend): Warning[] => {
  const out: Warning[] = []
  const left = turnsLeft(trend.ctxHistory, s.contextWindow)
  if ((s.contextPercent ?? 0) >= 80) out.push({ key: 'ctx', text: `Context ${s.contextPercent}% full: consider /compact` })
  else if (left != null && left <= 3) out.push({ key: `ctx-soon:${trend.ctxHistory[0]}`, text: `Context ~${left} turn${left === 1 ? '' : 's'} from 80% at this rate: consider /compact` })
  for (const r of s.rateLimits) {
    const p = projected(r.percentUsed, r.resetsAt, r.kind, now)
    if (Math.max(r.percentUsed, p ?? 0) < 100) continue
    const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
    const label = LABEL[r.kind] ?? r.kind
    out.push({
      key: `pace:${r.kind}:${r.resetsAt ?? ''}`,
      text: r.percentUsed >= 100 ? `${label} reached` : `${label}: on pace for ${p}%${hit != null ? `, hits 100% ~${clock(hit, now)}` : ''}`,
    })
  }
  if (mode(s) === 'api' && budgetUsd > 0 && (s.costUsd ?? 0) >= budgetUsd * 0.9)
    out.push({ key: `budget:${budgetUsd}`, text: `Spend $${s.costUsd!.toFixed(2)} of $${budgetUsd} budget` })
  return out
}

// --- Mascot suggestion -------------------------------------------------------------------

export type SuggestInput = { s: Snapshot; now: number; cache: Cache; keepWarm: boolean; trend: Trend; budgetUsd: number; dismissed: string }

const turns = (n: number) => `~${n} turn${n === 1 ? '' : 's'}`

// The single most urgent thing, first match wins. Which checks apply depends on the mode:
// a plan never talks budget, API never talks pace, usage only talks context and cache.
const pick = ({ s, now, cache, keepWarm, trend, budgetUsd }: SuggestInput): Suggestion => {
  const m = mode(s)

  if (m === 'api' && budgetUsd > 0 && (s.costUsd ?? 0) >= budgetUsd * 0.9) {
    const at = budgetEta(s, now, budgetUsd)
    return { key: `budget:${budgetUsd}`, mood: 'budget', text: `$${(s.costUsd ?? 0).toFixed(2)} of your $${budgetUsd} budget is spent.${at != null ? ` Runs out ~${clock(at, now)}.` : ''}` }
  }

  if (m === 'plan')
    for (const r of s.rateLimits) {
      const p = projected(r.percentUsed, r.resetsAt, r.kind, now)
      if (Math.max(r.percentUsed, p ?? 0) < 100) continue
      const label = LABEL[r.kind] ?? r.kind
      const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
      const text = r.percentUsed >= 100 ? `${label} reached.`
        : hit != null ? `At this pace the ${label} is hit ~${clock(hit, now)}.`
        : `At this pace the ${label} lands at ${p}%.`
      return { key: `pace:${r.kind}:${r.resetsAt ?? ''}`, mood: 'pace', text }
    }

  const ctx = s.contextPercent
  const tl = turnsLeft(trend.ctxHistory, s.contextWindow)
  if ((ctx ?? 0) >= 60 || (tl != null && tl <= 3)) {
    const text = ctx == null ? `Context is ${turns(tl!)} from 80%.`
      : `Context is at ${ctx}%${tl != null ? ` and ${turns(tl)} from 80%` : ''}.`
    return { key: `ctx:${trend.ctxHistory[0] ?? ''}`, mood: 'full', text, action: 'compact' }
  }

  const left = cacheLeft(cache, now)
  if (left != null && left <= 0) {
    const text = `Frozen solid. Your next message re-caches${s.contextTokens == null ? ' the context' : ` ~${num(s.contextTokens)} tokens`}.`
    return keepWarm ? { key: 'cold', mood: 'cold', text } : { key: 'cold', mood: 'cold', text: `${text} Keep it warm next time?`, action: 'keep' }
  }
  if (left != null && left <= leadMs(cache.ttlMs))
    return keepWarm
      ? { key: 'keep', mood: 'keep', text: 'Stoking the fire: a keep-warm ping goes out before the cache lapses.' }
      : { key: 'soon', mood: 'soon', text: `Brr… ${fmtLeft(left)} until the cache goes cold.`, action: 'keep' }
  if (cache.active) return { key: 'live', mood: 'live', text: 'On it! The cache refreshes while Claude works.' }
  const base = left == null ? 'Ready when you are.' : `Toasty. The cache stays warm for ${fmtLeft(left)}.`
  return { key: 'warm', mood: 'warm', text: keepWarm ? `${base} Keep-warm is on.` : base }
}

// A dismissed suggestion keeps talking but stops offering its action.
export const suggest = (i: SuggestInput): Suggestion => {
  const g = pick(i)
  const text = g.action === 'keep' && mode(i.s) === 'api' ? `${g.text} (pings bill as cache reads)` : g.text
  return i.dismissed === g.key ? { key: g.key, mood: g.mood, text } : { ...g, text }
}

// --- Weekly day log ----------------------------------------------------------------------

export const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Latest sample of the day wins; a new weekly window starts a fresh log. Keeps the last 8 days.
export const recordDay = (log: DayLog | null, now: number, percentUsed: number, resetsAt: string): DayLog => {
  const days = { ...(log?.resetsAt === resetsAt ? log.days : {}), [dayKey(now)]: percentUsed }
  return { resetsAt, days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-8)) }
}

const dayLevel = (use: number): DayTile['level'] => (use <= 0 ? 0 : use <= 5 ? 1 : use <= 10 ? 2 : use <= 15 ? 3 : 4)

// Seven tiles over [resetsAt − 7 days, resetsAt): each day's share of the weekly limit, as the
// growth since the last earlier sample. A log from another window counts as empty.
export const dayLevels = (log: DayLog | null, now: number, resetsAt: string): DayTile[] => {
  const days = log?.resetsAt === resetsAt ? log.days : {}
  const keys = Object.keys(days).sort()
  const today = dayKey(now)
  const start = Date.parse(resetsAt) - 7 * 86400e3
  return Array.from({ length: 7 }, (_, i): DayTile => {
    const d = new Date(start)
    d.setDate(d.getDate() + i) // calendar days, so a DST change does not shift a tile
    const key = dayKey(d.getTime())
    const label = d.toLocaleDateString('en-US', { weekday: 'short' })
    const isToday = key === today
    if (key > today) return { label, level: -1, isToday, percent: null }
    const sample = days[key]
    if (sample == null) return { label, level: 0, isToday, percent: null }
    const prev = keys.filter(k => k < key).at(-1)
    const use = Math.max(0, sample - (prev == null ? 0 : days[prev]!))
    return { label, level: dayLevel(use), isToday, percent: use }
  })
}

// --- Plain words for the graphical band ---------------------------------------------------

export type ExplainInput = { s: Snapshot; t: Tokens; now: number; cache: Cache; keepWarm: boolean; trend: Trend; budgetUsd: number }

// The one thing worth knowing about a segment, in a few words, or nothing when the picture
// and value already say it all. The terminal keeps the longer `detail`.
export const explain = (seg: Segment, x: ExplainInput): string[] => {
  const { s, now, cache: c } = x
  const r = s.rateLimits.find(l => (LABEL[l.kind] ?? l.kind) === seg.label)
  if (r) {
    if (r.percentUsed >= 100) return ['Limit reached']
    const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
    if (hit != null) return [`Runs out ~${clock(hit, now)}`]
    return r.resetsAt ? [`Resets ${clock(Date.parse(r.resetsAt), now)}`] : []
  }
  switch (seg.label) {
    case 'Context': {
      const left = turnsLeft(x.trend.ctxHistory, s.contextWindow)
      return left == null ? [] : left === 0 ? ['Time to compact'] : [`~${left} turn${left === 1 ? '' : 's'} left`]
    }
    case 'Cache': {
      const left = cacheLeft(c, now)
      if (left != null && left <= 0) return ['Expired']
      if (x.keepWarm) return ['Keeping warm']
      if (!c.active && left != null && left <= leadMs(c.ttlMs)) return ['Running out']
      return []
    }
    case 'API value': {
      // The first plan limit this pace runs out, if any does before it resets.
      const hits = s.rateLimits.map(l => eta(l.percentUsed, l.resetsAt, l.kind, now)).filter((h): h is number => h != null)
      return hits.length ? [`Runs out ~${clock(Math.min(...hits), now)}`] : []
    }
    case 'Tokens': {
      const hit = cacheHit(x.t)
      return hit == null ? [] : [`${hit}% cache read`]
    }
    case 'Spend': {
      if (x.budgetUsd <= 0) return []
      if ((s.costUsd ?? 0) >= x.budgetUsd) return ['Over budget']
      const at = budgetEta(s, now, x.budgetUsd)
      return at ? [`Runs out ~${clock(at, now)}`] : []
    }
    default:
      return []
  }
}

// --- Monthly spend -----------------------------------------------------------------------

// Adds one turn's cost to the month's log; a new month starts a fresh log. A cost that is not a
// positive number (a reset session, a missing figure) changes nothing.
export const recordSpend = (log: MonthLog | null, now: number, deltaUsd: number, isPlan: boolean): MonthLog | null => {
  if (!(deltaUsd > 0) || !Number.isFinite(deltaUsd)) return log
  const today = dayKey(now)
  const month = today.slice(0, 7)
  const base: MonthLog = log?.month === month ? log : { month, since: today, api: 0, plan: 0 }
  return isPlan ? { ...base, plan: base.plan + deltaUsd } : { ...base, api: base.api + deltaUsd }
}

const usd = (n: number) => `$${n.toFixed(2)}`

// What /spent says: API spend, plan value, and where the month lands at the pace so far.
export const spentReport = (log: MonthLog | null, now: number): string => {
  const d = new Date(now)
  const name = d.toLocaleDateString('en-US', { month: 'long' })
  const cur = log?.month === dayKey(now).slice(0, 7) ? log : null
  if (!cur || cur.api + cur.plan <= 0) return `No spend tracked in ${name} yet: turns are added up as they finish, in every session.`
  const [y, m, day] = cur.since.split('-').map(Number) as [number, number, number]
  const since = new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const lines = [`${name} spend (tracked since ${since})`]
  if (cur.api > 0) lines.push(`API spend: ${usd(cur.api)}`)
  if (cur.plan > 0) lines.push(`Plan usage: ${usd(cur.plan)} at API prices (included in your plan)`)
  const tracked = d.getDate() - day + 1
  const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate()
  const total = cur.api > 0 ? cur.api : cur.plan
  if (tracked >= 3 && daysLeft > 0) lines.push(`On pace for ~${usd(total + (total / tracked) * daysLeft)}${cur.api > 0 ? ' API spend' : ' plan value'} by month end`)
  return lines.join('\n')
}
