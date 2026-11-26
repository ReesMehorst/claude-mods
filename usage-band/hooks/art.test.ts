import { test, expect } from 'claude-code/testing'
import { dayTilesSvg, gaugeSvg, iconSvg, mascotSvg, miniMeterSvg, paceSvg, ringSvg, splitSvg, thermometerSvg } from './art'
import type { DayTile, Mood } from '../types'

const MOODS: Mood[] = ['warm', 'live', 'soon', 'keep', 'cold', 'full', 'budget', 'pace', 'nap']
const toks = { in: 1000, out: 3000, cacheRead: 8000, cacheWrite: 1000 }
const week: DayTile[] = [
  { label: 'Tue', level: 2, isToday: false, percent: 8 },
  { label: 'Wed', level: 4, isToday: false, percent: 11 },
  { label: 'Thu', level: 0, isToday: true, percent: 0 },
  { label: 'Fri', level: -1, isToday: false, percent: null },
]

const num = (s: string, re: RegExp) => Number(s.match(re)?.[1])
const rects = (s: string) => [...s.matchAll(/<rect x="([\d.]+)" width="([\d.]+)" height="8" fill="(#[0-9a-f]+)"/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]), c: m[3] }))

const all = () => [
  ...MOODS.map((m) => mascotSvg(m)),
  ringSvg(42, 'success'), ringSvg(null, 'warning'),
  thermometerSvg(0.6, 'warm'), thermometerSvg(null, 'cold'), thermometerSvg(0.1, 'soon'), thermometerSvg(null, 'live'),
  paceSvg(38, 71, 0.53, 'success'), paceSvg(80, 140, null, 'error'),
  gaugeSvg(92), gaugeSvg(0),
  splitSvg(toks), splitSvg({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }),
  dayTilesSvg(week), dayTilesSvg([{ label: '<&">', level: 1, isToday: false, percent: 1 }]),
  ...(['context', 'cache', 'clock', 'calendar', 'coin', 'tokens'] as const).map((n) => iconSvg(n, '#a3a19a')),
  miniMeterSvg(38, 'success', 71), miniMeterSvg(0, 'error'),
]

test('every mood is a complete document with its signature part', () => {
  const mark: Record<Mood, string> = {
    warm: '#1f1e1d', // sunglasses
    live: '#e3b341', // sparkles
    soon: 'type="rotate"', // ticking clock hand
    keep: 'C-7 -5 -3 -12 0 -19', // flame
    cold: '#bfe3ff', // ice block
    full: 'stroke="#a3a19a" stroke-width="0.8"', // paper stack
    budget: 'attributeName="rx"', // flipping coin
    pace: 'skewX(-8)', // sprinting lean
    nap: '>z<',
  }
  for (const m of MOODS) {
    const s = mascotSvg(m)
    expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(s.endsWith('</svg>')).toBe(true)
    expect(s).toContain(mark[m])
    expect(s).toContain('width="72" height="72"')
    expect(s.length).toBeLessThan(6000)
  }
  expect(mascotSvg('nap', 32)).toContain('width="32" height="32"')
  expect(new Set(MOODS.map((m) => mascotSvg(m))).size).toBe(MOODS.length)
})

test('no builder emits markup the engine refuses', () => {
  for (const s of all()) {
    expect(s.startsWith('<svg ')).toBe(true)
    expect(s.endsWith('</svg>')).toBe(true)
    for (const bad of ['&#', 'data:', '<image', 'foreignObject', '\\', '<?', '<!', '@import', 'href']) expect(s).not.toContain(bad)
    for (const u of s.match(/url\([^)]*\)/g) ?? []) expect(u).toMatch(/^url\(#[\w-]+\)$/)
    for (const [, n] of s.matchAll(/ (?:x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height)="(-?[\d.]+)"/g)) expect(n!).toMatch(/^-?\d+(\.\d)?$/)
    for (const [, d] of s.matchAll(/ d="([^"]*)"/g)) expect(d!).not.toMatch(/\.\d\d/)
  }
  expect(dayTilesSvg([{ label: '<&">', level: 1, isToday: false, percent: 1 }])).toContain('>&lt;<')
})

test('ring arc grows with percent; null shows a dash and no arc', () => {
  const len = (p: number) => num(ringSvg(p, 'success'), /stroke-dasharray="([\d.]+) /)
  expect(len(50)).toBe(75.4)
  expect(len(100)).toBe(150.8)
  expect(Math.abs(len(25) * 2 - len(50))).toBeLessThan(0.2)
  expect(ringSvg(42, 'error')).toContain('#f85149')
  expect(ringSvg(42, 'error')).toContain('>42%<')
  const none = ringSvg(null, 'success')
  expect(none).toContain('>–<')
  expect(none).not.toContain('stroke-dasharray')
})

test('gauge needle follows percent and clamps', () => {
  const tip = (p: number) => gaugeSvg(p).match(/d="M50 50 L([\d.]+) ([\d.]+)"/)!.slice(1).map(Number)
  expect(tip(0)).toEqual([16, 50])
  expect(tip(50)).toEqual([50, 16])
  expect(tip(100)).toEqual([84, 50])
  expect(tip(92)).toEqual([82.9, 41.5])
  expect(tip(-20)).toEqual(tip(0))
  expect(tip(250)).toEqual(tip(100))
  expect(tip(30)[0]!).toBeLessThan(tip(60)[0]!)
})

test('pace bar: forecast capped at 100, tick only with elapsed', () => {
  const s = paceSvg(38, 71, 0.5, 'success', 200)
  expect(s).toContain('<rect y="4" width="142" height="8" rx="4" fill="url(#pace-success)"/>')
  expect(s).toContain('<rect y="4" width="76" height="8" rx="4" fill="#3fb950"/>')
  expect(s).toContain('<rect x="100" width="2" height="16"')
  const over = paceSvg(80, 140, null, 'error', 200)
  expect(over).toContain('width="200" height="8" rx="4" fill="url(#pace-error)"')
  expect(over).not.toContain('width="2" height="16"')
  expect(paceSvg(30, null, 0.2, 'success')).not.toContain('fill="url(')
})

test('split widths are proportional with 2px gaps; empty when no tokens', () => {
  const r = rects(splitSvg({ in: 1000, out: 2000, cacheRead: 6000, cacheWrite: 1000 }, 104))
  expect(r.map((x) => x.c)).toEqual(['#8fb0f5', '#d97757', '#e3b341'])
  expect(r.map((x) => x.w)).toEqual([60, 20, 20])
  expect(r.map((x) => x.x)).toEqual([0, 62, 84])
  expect(rects(splitSvg({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }))).toHaveLength(0)
  expect(rects(splitSvg({ in: 0, out: 5, cacheRead: 0, cacheWrite: 0 }, 50))).toEqual([{ x: 0, w: 50, c: '#e3b341' }])
})

test('day tiles: colour per level, dashed future, ring on today, letter under each', () => {
  const s = dayTilesSvg(week)
  expect(s).toContain('fill="#006d32"')
  expect(s).toContain('fill="#39d353"')
  expect(s).not.toContain('#0e4429')
  expect(s.match(/stroke-dasharray/g)).toHaveLength(1)
  expect(s.match(/stroke="#3e3d39"/g)).toHaveLength(2)
  expect(s.match(/stroke="#ecebe6" stroke-width="2"/g)).toHaveLength(1)
  for (const l of ['T', 'W', 'F']) expect(s).toContain(`>${l}<`)
  expect(dayTilesSvg([{ label: 'Mon', level: 1, isToday: false, percent: 2 }])).toContain('#0e4429')
  expect(dayTilesSvg([{ label: 'Mon', level: 3, isToday: false, percent: 2 }])).toContain('#26a641')
})

test('thermometer, icons and mini meter', () => {
  expect(thermometerSvg(null, 'cold')).toContain('#8fb0f5')
  expect(thermometerSvg(0.5, 'soon')).toContain('#d29922')
  const h = (s: string) => num(s, /<rect x="17" y="[\d.]+" width="6" height="([\d.]+)"/)
  expect(h(thermometerSvg(0.9, 'warm'))).toBeGreaterThan(h(thermometerSvg(0.2, 'warm')))
  expect(h(thermometerSvg(0, 'live'))).toBe(59)
  expect(h(thermometerSvg(1, 'cold'))).toBeLessThan(10)
  expect(iconSvg('tokens', '#e3b341')).toContain('stroke="#e3b341"')
  expect(iconSvg('clock', '#fff', 20)).toContain('width="20" height="20"')
  const m = miniMeterSvg(25, 'warning', 50)
  expect(m).toContain('<rect width="20" height="4" rx="2" fill="#d29922" fill-opacity="0.35"/>')
  expect(m).toContain('<rect width="10" height="4" rx="2" fill="#d29922"/>')
  expect(miniMeterSvg(25, 'warning')).not.toContain('fill-opacity="0.35"')
})
