// The theme's own art: the scene and the sound for each mood. Replace both with the theme's
// idea, keeping the two signatures. The default is soft drifting lights over a ground.
//
// What each mood should read as:
// - isMoving: Claude is working. Move while true, rest (no animation) while false.
// - gear 0..3: the context filling. Faster each gear; gear 3 (80%+) shows WARN: time to compact.
// - cache 'soon': the cache's last minute. A small cue, such as a cooler color on the focal point.
// - cache 'cold': the cache lapsed. Everything stills and cools; COLD_PALETTE recolors the app.
// The plain markup must look finished with every animation removed (reduced motion).

import type { ThemeSound } from 'claude-code'

import type { Mood } from '../types'

// Colors of the scene: the ground per mode, the lights, the 80% warning and the cold tint.
const ART = {
  groundDark: '#101418',
  groundLight: '#e8ecef',
  light: '#4f8fd6',
  warn: '#e0a53b',
  cold: '#9cc3ea',
}

// Seconds for one drift, by gear.
export const driftSeconds = (gear: Mood['gear']) => [36, 24, 15, 9][gear]!

const LIGHTS = [
  [140, 160, 90], [1460, 140, 120], [1380, 820, 70], [210, 860, 110], [1180, 420, 50], [380, 520, 40],
] as const

export function sceneSvg(m: Mood): string {
  const isCold = m.cache === 'cold'
  const color = isCold ? ART.cold : m.gear === 3 ? ART.warn : ART.light
  const drift = m.isMoving && !isCold ? `animation:drift ${driftSeconds(m.gear)}s ease-in-out infinite alternate` : ''
  const lights = LIGHTS.map(([x, y, r], i) =>
    `<circle class="l" cx="${x}" cy="${y}" r="${r}" style="animation-delay:-${i * 3}s"/>`).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs><radialGradient id="glow"><stop offset="0%" stop-color="${color}" stop-opacity=".35"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient>
<radialGradient id="frost" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="${ART.cold}" stop-opacity="0"/><stop offset="100%" stop-color="${ART.cold}" stop-opacity=".16"/></radialGradient></defs>
<style>
.bg{fill:${ART.groundDark}}
.l{fill:url(#glow);transform-box:fill-box;transform-origin:center;${drift}}
.focus{fill:${m.cache === 'soon' ? ART.cold : color};opacity:.7}
.frost{fill:url(#frost);opacity:${isCold ? 1 : 0}}
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(40px,-30px) scale(1.15)}}
@media (prefers-color-scheme: light){.bg{fill:${ART.groundLight}}}
</style>
<rect class="bg" width="1600" height="1000"/>
${lights}
<circle class="focus" cx="1380" cy="540" r="6"/>
<rect class="frost" width="1600" height="1000"/>
</svg>`
}

const BED = { wave: 'brown', drone: true, gain: 0.12, filter: { type: 'lowpass', hz: 300, to: 480 } } as const
const HUSH = { wave: 'pink', drone: true, gain: 0.04, filter: { type: 'bandpass', hz: 900, to: 1400 } } as const

const CUES: NonNullable<ThemeSound['cues']> = {
  send: { layers: [{ wave: 'triangle', notes: ['A4'], glide: 5, gain: 0.12, release: 0.25 }] },
  tool: { layers: [{ wave: 'triangle', notes: ['E5'], gain: 0.07, release: 0.06 }] },
  done: { layers: [{ wave: 'bell', notes: ['E5', 'A5'], step: 0.12, gain: 0.18, release: 0.8 }] },
  ask: { layers: [{ wave: 'bell', notes: ['A5'], gain: 0.16, release: 0.6 }] },
  error: { layers: [{ wave: 'triangle', notes: ['A3', 'F3'], step: 0.15, gain: 0.18, release: 0.3 }] },
}

// Rests while Claude waits, rises a step each gear while it works, and falls to a hush when the
// cache is cold. Without `follows` it plays its resting sound always.
export function soundFor(m: Mood, follows: boolean): ThemeSound {
  const tone = (note: string, hz: number, gain: number) =>
    ({ wave: 'sine', notes: [note], drone: true, gain, tremolo: { hz, depth: 0.25 } }) as const
  if (!follows) return { ambience: { layers: [BED, tone('A2', 0.3, 0.035)] }, cues: CUES }
  if (m.cache === 'cold') return { ambience: { layers: [HUSH] }, cues: CUES }
  if (!m.isMoving) return { ambience: { layers: [BED, tone('A2', 0.3, 0.035)] }, cues: CUES }
  return { ambience: { layers: [BED, tone(['A2', 'B2', 'C#3', 'E3'][m.gear]!, [0.5, 0.8, 1.2, 2][m.gear]!, 0.045)] }, cues: CUES }
}
