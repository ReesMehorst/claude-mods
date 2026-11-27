import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionUsage, ThemeSetArgs } from 'claude-code'

import { sceneSvg, soundFor } from './art'
import { makeColors } from './make-colors.js'
import { cacheStateAt, gearFor } from './mood'
import { COLD_PALETTE, PALETTE } from './register'

const PLUGIN = '__MOD_NAME__'
const now = Date.parse('2026-01-01T12:00:00Z')
const usageAt = (percent: number) => ({ startedAt: now, context: { percent, tokens: percent * 2000, window: 200000 }, rateLimits: [] }) as unknown as SessionUsage

let sets: ThemeSetArgs[] = []
let clock: ReturnType<typeof mock.clock>
let context = 20

async function start($: Engine, on: On) {
  sets = []
  context = 20
  clock = mock.clock(on, { now })
  on('session.usage', () => ({ value: usageAt(context) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('theme.set', (_$, e) => { sets.push(e); return { value: { isDrawn: true, requestId: 'r' } } })
  on('turn.start', (_$, e) => ({ text: e.text, turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
}

const turn = async ($: Engine) => {
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({
    answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, model: 'm', ephemeral_5m_input_tokens: 10 },
  } as never)
}

const scene = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Backdrop', props: { scene: 'live-scene', plugin: PLUGIN, glass: false } })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return { alt: String(svg?.props.alt), source: String(svg?.props.source) }
}

const moving = (svg: string) => /animation:[a-z-]+ \d/.test(svg)

test('both palettes paint on Desktop', () => {
  for (const p of [PALETTE, COLD_PALETTE]) {
    expect(makeColors(p).problems.filter(l => l.startsWith("Desktop won't paint"))).toEqual([])
  }
})

test('context fill maps to gears, and the cache lapses on its clock', () => {
  expect([gearFor(null), gearFor(10), gearFor(40), gearFor(65), gearFor(80)]).toEqual([0, 0, 1, 2, 3])
  const c = { at: now, ttlMs: 300e3, isActive: false }
  expect(cacheStateAt({ ...c, at: null }, now)).toBe('none')
  expect(cacheStateAt(c, now + 60e3)).toBe('warm')
  expect(cacheStateAt(c, now + 250e3)).toBe('soon')
  expect(cacheStateAt(c, now + 301e3)).toBe('cold')
  expect(cacheStateAt({ ...c, ttlMs: 3600e3 }, now + 1800e3)).toBe('warm')
})

test('the scene moves only while moving, differs by gear, and stills when cold', () => {
  const rest = sceneSvg({ isMoving: false, gear: 0, cache: 'warm' })
  const slow = sceneSvg({ isMoving: true, gear: 0, cache: 'warm' })
  const full = sceneSvg({ isMoving: true, gear: 3, cache: 'warm' })
  const cold = sceneSvg({ isMoving: true, gear: 3, cache: 'cold' })
  expect(moving(rest)).toBe(false)
  expect(moving(slow)).toBe(true)
  expect(full).not.toEqual(slow)
  expect(moving(cold)).toBe(false)
  for (const svg of [rest, slow, full, cold]) {
    expect(svg.length).toBeLessThan(131072)
    expect(svg).not.toMatch(/<image|<!\[CDATA|href|<!--[^>]*(<|--[^>])/)
  }
})

test('the sound differs at rest, at full context and when cold', () => {
  const rest = JSON.stringify(soundFor({ isMoving: false, gear: 0, cache: 'warm' }, true))
  const full = JSON.stringify(soundFor({ isMoving: true, gear: 3, cache: 'warm' }, true))
  const cold = JSON.stringify(soundFor({ isMoving: false, gear: 0, cache: 'cold' }, true))
  expect(new Set([rest, full, cold]).size).toBe(3)
})

test('a session moves through a turn, rests after it, and cools once the cache lapses', async ($, on) => {
  await start($, on)
  expect((await scene($)).alt).toContain('at rest')
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect((await scene($)).alt).toContain('moving while Claude works')
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm', ephemeral_5m_input_tokens: 10 } } as never)
  expect((await scene($)).alt).toContain('at rest')
  const warmColors = sets.at(-1)?.colors
  await clock.advance(6 * 60e3)
  expect((await scene($)).alt).toContain('the prompt cache is cold')
  expect(sets.at(-1)?.colors).not.toEqual(warmColors)
  await turn($)
  expect((await scene($)).alt).toContain('at rest')
  expect(sets.at(-1)?.colors).toEqual(warmColors)
})

test('a filling context changes the scene on the next turn', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'a', turnId: 't0' })
  const low = (await scene($)).source
  context = 85
  await turn($)
  await $.turn.start({ text: 'b', turnId: 't2' })
  expect((await scene($)).source).not.toEqual(low)
})

test('switched-off signals hold still', { options: { contextSpeed: false, moveWhileWorking: false, coldCache: false, soundFollows: false } }, async ($, on) => {
  await start($, on)
  const before = (await scene($)).source
  context = 90
  await turn($)
  await clock.advance(10 * 60e3)
  const { alt, source } = await scene($)
  expect(alt).toContain('moving while Claude works') // always moves
  expect(source).toEqual(before) // never faster, never cold
  expect(sets).toHaveLength(1) // the look was set once and left alone
})
