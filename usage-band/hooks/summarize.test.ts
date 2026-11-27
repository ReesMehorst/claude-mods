import { test, expect } from 'claude-code/testing'
import { addUsage, bar, barSvg, cacheAlerts, cacheHit, cacheLeft, cacheSegment, cacheTtl, clock, compactLine, dayKey, dayLevels, emptyCache, emptyTokens, emptyTrend, endTurn, eta, explain, fmtLeft, mode, projected, recordDay, recordPing, recordSpend, recordTurn, segments, spentReport, startTurn, suggest, turnsLeft, warnings } from './summarize'
import type { SuggestInput } from './summarize'
import type { Segment } from './summarize'

const now = Date.parse('2026-10-18T12:00:00Z')
const reset = '2026-10-18T14:30:00Z' // 5h window, 2.5h elapsed
const plan = {
  contextPercent: 30, contextTokens: 60000, contextWindow: 200000, costUsd: 2,
  startedAt: now - 2 * 3600e3,
  rateLimits: [{ kind: 'five_hour', percentUsed: 60, resetsAt: reset }],
}
const api = { ...plan, rateLimits: [] }
const toks = addUsage(emptyTokens, { input_tokens: 1000, output_tokens: 3000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1000 })

test('pace extrapolates to reset', () => {
  expect(projected(40, reset, 'five_hour', now)).toBe(80)
  expect(projected(40, undefined, 'five_hour', now)).toBe(null)
})

test('eta: before reset gives a time, after reset gives null', () => {
  // 60% in 2.5h -> 100% after another 1h40m, before the 14:30 reset
  expect(eta(60, reset, 'five_hour', now)).toBe(now + 100 * 60e3)
  expect(eta(20, reset, 'five_hour', now)).toBe(null)
  expect(eta(100, reset, 'five_hour', now)).toBe(now)
})

test('bar fills proportionally and clamps', () => {
  expect(bar(50)).toEqual(['━━━━', '────'])
  expect(bar(150)[0].length).toBe(8)
})

test('barSvg scales fill, clamps, omits empty fill', () => {
  expect(barSvg(50, 'success')).toContain('<rect width="60" height="6" rx="3" fill="#3fb950"/>')
  expect(barSvg(250, 'error')).toContain('width="120" height="6" rx="3" fill="#f85149"')
  expect(barSvg(0, 'success').match(/<rect/g)!.length).toBe(1)
})

test('mode follows rate limits', () => {
  expect(mode(plan)).toBe('plan')
  expect(mode(api)).toBe('api')
  expect(mode({ ...api, costUsd: 0 })).toBe('usage')
})

test('plan segments: pace colour, API value muted, tokens', () => {
  const segs = segments(plan, toks, now)
  expect(segs.map(s => s.label)).toEqual(['Context', '5h limit', 'API value', 'Tokens'])
  const [ctx, lim, cost, tok] = segs as [Segment, Segment, Segment, Segment]
  expect(ctx.detail).toBe('60k of 200k')
  expect(lim.detail.startsWith('pace → 120% · hits 100% ~')).toBe(true)
  expect(lim.level).toBe('error')
  expect(cost.isMuted).toBe(true)
  expect(tok.value).toBe('13k')
  expect(tok.detail).toBe('in 2.0k · out 3.0k · cache 80%')
})

test('api segments: spend vs budget', () => {
  const [, spend] = segments(api, emptyTokens, now, 2.5) as [Segment, Segment]
  expect(spend.label).toBe('Spend')
  expect(spend.percent).toBe(80)
  expect(spend.detail.startsWith('of $2.5 · $1.00/hr · budget ~')).toBe(true)
  expect(segments(api, emptyTokens, now).at(-1)!.detail).toBe('$1.00/hr')
})

test('cache hit and compact line', () => {
  expect(cacheHit(emptyTokens)).toBe(null)
  expect(cacheHit(toks)).toBe(80)
  expect(compactLine('plan', segments(plan, toks, now))).toBe('PLAN · ctx 30% · 5h 60%→120% · $2.00 · 13k tok')
})

test('warnings: context, pace, budget', () => {
  expect(warnings(plan, now).map(w => w.key)).toEqual([`pace:five_hour:${reset}`])
  expect(warnings({ ...api, contextPercent: 85 }, now, 2.1).map(w => w.key)).toEqual(['ctx', 'budget:2.1'])
  expect(warnings(api, now, 10)).toEqual([])
})

test('turnsLeft: steady growth counts down, shrink or short history gives null', () => {
  expect(turnsLeft([100000, 110000, 120000], 200000)).toBe(4)
  expect(turnsLeft([100000, 110000], 200000)).toBe(null)
  expect(turnsLeft([120000, 110000, 100000], 200000)).toBe(null)
})

test('recordTurn: cost delta, history capped, reset on compact', () => {
  let t = recordTurn(emptyTrend, 1, 50000)
  expect(t.lastTurnUsd).toBe(null)
  t = recordTurn(t, 1.5, 60000)
  expect(t.lastTurnUsd).toBe(0.5)
  for (let i = 0; i < 5; i++) t = recordTurn(t, 2, 70000 + i)
  expect(t.ctxHistory.length).toBe(5)
  expect(recordTurn(t, 2, 20000).ctxHistory).toEqual([20000])
})

test('trend shows in segments and ctx-soon warns near 80%', () => {
  const trend = { lastCost: 2, lastTurnUsd: 0.42, ctxHistory: [130000, 140000, 150000] }
  const [ctx, , cost] = segments(plan, toks, now, 0, trend) as [Segment, Segment, Segment]
  expect(ctx.detail).toBe('60k of 200k · ~1 turn to 80%')
  expect(cost.detail).toBe('included in plan · last +$0.42')
  expect(warnings(plan, now, 0, trend).map(w => w.key)).toContain('ctx-soon:130000')
  expect(warnings(plan, now, 0, { ...trend, ctxHistory: [10000, 11000, 12000] }).map(w => w.key)).not.toContain('ctx-soon:10000')
})

// --- prompt cache warmth ---

const warm = endTurn(emptyCache, now)

test('cache lifetime: both writes count as the shorter, a read-only turn keeps what was known', () => {
  expect(cacheTtl({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 }, 300e3)).toBe(3600e3)
  expect(cacheTtl({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 5 }, 3600e3)).toBe(300e3)
  expect(cacheTtl(undefined, 3600e3)).toBe(3600e3)
})

test('cacheLeft is null before a turn and while one runs', () => {
  expect(cacheLeft(emptyCache, now)).toBe(null)
  expect(cacheLeft(startTurn(warm, now), now)).toBe(null)
  expect(cacheLeft(warm, now + 60e3)).toBe(240e3)
  expect(cacheLeft(warm, now + 400e3)).toBe(-100e3)
})

test('fmtLeft', () => {
  expect(fmtLeft(240e3)).toBe('4m')
  expect(fmtLeft(299e3)).toBe('5m')
  expect(fmtLeft(45e3)).toBe('45s')
  expect(fmtLeft(-5e3)).toBe('0s')
  expect(fmtLeft(3600e3 + 30 * 60e3)).toBe('1h 30m')
})

test('cache segment: warm, running out, cold, live', () => {
  const keep = { isOn: true, maxPings: 3 }
  expect(cacheSegment(emptyCache, now)).toBe(null)
  const s1 = cacheSegment(warm, now + 60e3, keep)!
  expect(s1).toMatchObject({ value: '4m', level: 'success', percent: 20 })
  expect(s1.detail).toBe('warm · 5m TTL · keep-warm 0/3')
  expect(cacheSegment(warm, now + 250e3)).toMatchObject({ value: '50s', level: 'warning' })
  expect(cacheSegment(warm, now + 301e3)).toMatchObject({ value: 'cold', level: 'warning', percent: 100 })
  expect(cacheSegment(startTurn(warm, now), now)).toMatchObject({ value: 'live', level: 'success' })
})

test('cache segment sits right after context in the band', () => {
  expect(segments(plan, toks, now, 0, emptyTrend, warm).map(x => x.label).slice(0, 3)).toEqual(['Context', 'Cache', '5h limit'])
  expect(segments(plan, toks, now).map(x => x.label)).not.toContain('Cache')
})

test('cache alerts: soon, cold, quiet for small contexts, held back while a ping is due', () => {
  expect(cacheAlerts(warm, now + 100e3, 60000, 20000, false)).toEqual([])
  expect(cacheAlerts(warm, now + 250e3, 60000, 20000, false)[0]!.key).toBe('soon')
  expect(cacheAlerts(warm, now + 250e3, 60000, 20000, true)).toEqual([])
  expect(cacheAlerts(warm, now + 310e3, 60000, 20000, true)[0]!.key).toBe('cold')
  expect(cacheAlerts(warm, now + 310e3, 5000, 20000, false)).toEqual([])
  expect(cacheAlerts(emptyCache, now, 60000, 20000, false)).toEqual([])
})

test('a ping renews the cache only when answered, and always uses up a try', () => {
  const ok = recordPing(warm, now + 250e3, true)
  expect(ok).toMatchObject({ at: now + 250e3, pings: 1 })
  const bad = recordPing(warm, now + 250e3, false)
  expect(bad).toMatchObject({ at: now, pings: 1 })
  expect(endTurn(ok, now + 600e3).pings).toBe(0)
})

// --- mascot suggestion ---

const usage = { ...api, costUsd: 0 }
const calm = { ...plan, rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: reset }] } // pace → 40%
const ask = (o: Partial<SuggestInput>) =>
  suggest({ s: usage, now, cache: emptyCache, keepWarm: false, trend: emptyTrend, budgetUsd: 0, dismissed: '', ...o })

test('suggest, plan: pace wins, budget never applies', () => {
  const g = ask({ s: plan, budgetUsd: 1 })
  expect(g).toMatchObject({ key: `pace:five_hour:${reset}`, mood: 'pace' })
  expect(g.text).toBe(`At this pace the 5h limit is hit ~${clock(now + 100 * 60e3, now)}.`)
  expect(ask({ s: { ...plan, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: reset }] } }).text).toBe('5h limit reached.')
  expect(ask({ s: calm, budgetUsd: 1 }).key).toBe('warm')
})

test('suggest, api: budget at 90%, never pace', () => {
  const g = ask({ s: { ...api, contextPercent: 85 }, budgetUsd: 2.1 })
  expect(g).toMatchObject({ key: 'budget:2.1', mood: 'budget' })
  expect(g.text).toBe(`$2.00 of your $2.1 budget is spent. Runs out ~${clock(now + 6 * 60e3, now)}.`)
  expect(ask({ s: { ...api, costUsd: 2.5 }, budgetUsd: 2 }).text).toBe('$2.50 of your $2 budget is spent.')
  expect(ask({ s: api, budgetUsd: 10 }).key).toBe('warm')
  expect(ask({ s: api, budgetUsd: 0 }).key).toBe('warm')
})

test('suggest, usage: only context and cache', () => {
  expect(ask({ s: usage, budgetUsd: 0.01 }).key).toBe('warm')
  expect(ask({ s: { ...usage, contextPercent: 70 }, budgetUsd: 0.01 }).mood).toBe('full')
})

test('suggest: priority budget > context > cold > soon > live > warm', () => {
  const ctx = { ...usage, contextPercent: 68 }
  const trend = { lastCost: null, lastTurnUsd: null, ctxHistory: [100000, 110000, 120000] }
  expect(ask({ s: { ...api, contextPercent: 68 }, budgetUsd: 2, cache: warm, now: now + 400e3 }).mood).toBe('budget')
  expect(ask({ s: { ...plan, contextPercent: 68 } }).mood).toBe('pace')
  const c = ask({ s: ctx, trend, cache: warm, now: now + 400e3 })
  expect(c).toEqual({ key: 'ctx:100000', mood: 'full', text: 'Context is at 68% and ~4 turns from 80%.', action: 'compact' })
  expect(ask({ s: ctx }).text).toBe('Context is at 68%.')
  // a steep trend counts even below 60%
  expect(ask({ s: { ...usage, contextPercent: 40 }, trend: { ...trend, ctxHistory: [130000, 140000, 150000] } }).text).toBe('Context is at 40% and ~1 turn from 80%.')
  expect(ask({ cache: warm, now: now + 400e3 }).mood).toBe('cold')
  expect(ask({ cache: warm, now: now + 252e3 })).toEqual({ key: 'soon', mood: 'soon', text: 'Brr… 48s until the cache goes cold.', action: 'keep' })
  expect(ask({ cache: warm, now: now + 252e3, keepWarm: true })).toEqual({ key: 'keep', mood: 'keep', text: 'Stoking the fire: a keep-warm ping goes out before the cache lapses.' })
  expect(ask({ cache: startTurn(warm, now), keepWarm: true })).toEqual({ key: 'live', mood: 'live', text: 'On it! The cache refreshes while Claude works.' })
  expect(ask({ cache: warm, now: now + 120e3 }).text).toBe('Toasty. The cache stays warm for 3m.')
  expect(ask({ keepWarm: true }).text).toBe('Ready when you are. Keep-warm is on.')
})

test('suggest: cold text with and without keep-warm', () => {
  expect(ask({ cache: warm, now: now + 400e3 })).toEqual({ key: 'cold', mood: 'cold', text: 'Frozen solid. Your next message re-caches ~60k tokens. Keep it warm next time?', action: 'keep' })
  expect(ask({ cache: warm, now: now + 400e3, keepWarm: true })).toEqual({ key: 'cold', mood: 'cold', text: 'Frozen solid. Your next message re-caches ~60k tokens.' })
})

test('suggest, api: the keep action mentions billing', () => {
  expect(ask({ s: api, cache: warm, now: now + 252e3 }).text).toBe('Brr… 48s until the cache goes cold. (pings bill as cache reads)')
  expect(ask({ s: api, cache: warm, now: now + 400e3 }).text).toContain('Keep it warm next time? (pings bill as cache reads)')
  expect(ask({ s: calm, cache: warm, now: now + 252e3 }).text).not.toContain('bill')
})

test('suggest: dismissed strips only the action', () => {
  const open = ask({ s: api, cache: warm, now: now + 252e3 })
  const shut = ask({ s: api, cache: warm, now: now + 252e3, dismissed: 'soon' })
  expect(shut).toEqual({ key: open.key, mood: open.mood, text: open.text })
  expect(ask({ s: api, cache: warm, now: now + 252e3, dismissed: 'cold' }).action).toBe('keep')
})

// --- weekly day log (local-time dates, so independent of the machine's zone) ---

const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime() // October 2026; the 18th is a Sunday
const weekReset = new Date(at(22, 9)).toISOString() // window: Thu 15th 09:00 → Thu 22nd 09:00

test('dayKey is the local date', () => {
  expect(dayKey(at(5, 0))).toBe('2026-10-05')
  expect(dayKey(at(5, 23))).toBe('2026-10-05')
})

test('recordDay: latest sample wins, a new window resets, 8 days kept', () => {
  let log = recordDay(null, at(15, 10), 3, weekReset)
  log = recordDay(log, at(15, 20), 4, weekReset)
  log = recordDay(log, at(16), 9, weekReset)
  expect(log).toEqual({ resetsAt: weekReset, days: { '2026-10-15': 4, '2026-10-16': 9 } })
  expect(recordDay(log, at(22, 10), 1, 'next')).toEqual({ resetsAt: 'next', days: { '2026-10-22': 1 } })
  let long = null as ReturnType<typeof recordDay> | null
  for (let d = 1; d <= 10; d++) long = recordDay(long, at(d), d, weekReset)
  expect(Object.keys(long!.days)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
})

test('dayLevels: 7 tiles, future, missing past, deltas, today', () => {
  const log = { resetsAt: weekReset, days: { '2026-10-15': 4, '2026-10-17': 16, '2026-10-18': 40 } }
  const tiles = dayLevels(log, at(18), weekReset)
  expect(tiles.map(t => t.label)).toEqual(['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'])
  expect(tiles.map(t => t.level)).toEqual([1, 0, 3, 4, -1, -1, -1])
  expect(tiles.map(t => t.percent)).toEqual([4, null, 12, 24, null, null, null])
  expect(tiles.map(t => t.isToday)).toEqual([false, false, false, true, false, false, false])
  // a drop clamps to 0; a log from another window counts as empty
  expect(dayLevels({ resetsAt: weekReset, days: { '2026-10-17': 16, '2026-10-18': 10 } }, at(18), weekReset)[3]).toMatchObject({ level: 0, percent: 0 })
  expect(dayLevels({ ...log, resetsAt: 'old' }, at(18), weekReset).map(t => t.level)).toEqual([0, 0, 0, 0, -1, -1, -1])
  expect(dayLevels(null, at(18), weekReset).length).toBe(7)
})

test('explain: one essential line, or none', () => {
  const now = Date.parse('2026-10-20T15:00:00Z')
  const s = {
    contextPercent: 37, contextTokens: 369_000, contextWindow: 1_000_000, costUsd: 16.83, startedAt: now - 2 * 3600e3,
    rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: new Date(now + 4 * 3600e3).toISOString() }], // 1h in: runs out early
  }
  const x = {
    s, now, keepWarm: true, budgetUsd: 0,
    t: { in: 600_000, out: 229_000, cacheRead: 30_000_000, cacheWrite: 30_000 },
    cache: { at: now - 60e3, ttlMs: 3600e3, active: false, pings: 0, alerted: [] },
    trend: { lastCost: 16.83, lastTurnUsd: 0.29, ctxHistory: [] },
  }
  const seg = (label: string): Segment => ({ label, value: '', detail: 'short', short: '', percent: null, level: 'success' })
  expect(explain(seg('Context'), x)).toEqual([]) // no trend yet
  expect(explain(seg('Context'), { ...x, trend: { ...x.trend, ctxHistory: [300_000, 330_000, 369_000] } })).toEqual(['~13 turns left'])
  expect(explain(seg('Cache'), x)).toEqual(['Keeping warm'])
  expect(explain(seg('Cache'), { ...x, keepWarm: false })).toEqual([]) // warm: the value says it
  expect(explain(seg('Cache'), { ...x, keepWarm: false, cache: { ...x.cache, at: now - 3600e3 + 60e3 } })).toEqual(['Running out'])
  expect(explain(seg('Cache'), { ...x, cache: { ...x.cache, at: now - 3600e3 - 1 } })).toEqual(['Expired'])
  expect(explain(seg('5h limit'), x)[0]).toMatch(/^Runs out ~\d\d:\d\d$/)
  expect(explain(seg('API value'), x)).toEqual(explain(seg('5h limit'), x)) // the first limit to run out
  expect(explain(seg('API value'), { ...x, s: { ...s, rateLimits: [] } })).toEqual([])
  expect(explain(seg('Tokens'), x)).toEqual(['98% cache read'])
  expect(explain(seg('Spend'), { ...x, budgetUsd: 10 })).toEqual(['Over budget'])
})

// --- monthly spend ---

test('recordSpend: adds per kind, a new month starts fresh, bad costs change nothing', () => {
  let log = recordSpend(null, at(2), 1.5, false)
  expect(log).toEqual({ month: '2026-10', since: '2026-10-02', api: 1.5, plan: 0 })
  log = recordSpend(log, at(9), 2, true)
  log = recordSpend(log, at(9), 0.5, false)
  expect(log).toEqual({ month: '2026-10', since: '2026-10-02', api: 2, plan: 2 })
  expect(recordSpend(log, at(9), 0, false)).toBe(log)
  expect(recordSpend(log, at(9), -3, false)).toBe(log)
  expect(recordSpend(log, at(9), NaN, false)).toBe(log)
  expect(recordSpend(null, at(9), 0, false)).toBeNull()
  expect(recordSpend(log, new Date(2026, 10, 1, 12).getTime(), 4, false)).toEqual({ month: '2026-11', since: '2026-11-01', api: 4, plan: 0 })
})

test('spentReport: empty, API spend, plan value, and the month-end pace', () => {
  expect(spentReport(null, at(18))).toContain('No spend tracked in October')
  expect(spentReport({ month: '2026-09', since: '2026-09-02', api: 9, plan: 0 }, at(18))).toContain('No spend tracked in October') // last month's log
  const api = spentReport({ month: '2026-10', since: '2026-10-01', api: 18, plan: 0 }, at(18)).split('\n')
  expect(api).toEqual(['October spend (tracked since Oct 1)', 'API spend: $18.00', 'On pace for ~$31.00 API spend by month end']) // $1/day, 13 days left
  const both = spentReport({ month: '2026-10', since: '2026-10-17', api: 1, plan: 40 }, at(18)).split('\n')
  expect(both).toEqual(['October spend (tracked since Oct 17)', 'API spend: $1.00', 'Plan usage: $40.00 at API prices (included in your plan)']) // 2 days tracked: too early to extrapolate
  expect(spentReport({ month: '2026-10', since: '2026-10-01', api: 0, plan: 36 }, at(18))).toContain('On pace for ~$62.00 plan value by month end')
})
