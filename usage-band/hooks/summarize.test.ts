import { test, expect } from 'claude-code/testing'
import { addUsage, bar, barSvg, cacheHit, compactLine, emptyTokens, eta, mode, projected, segments, warnings } from './summarize'
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
