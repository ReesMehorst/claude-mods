import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { CacheClock, Mood } from '../types'
import { sceneSvg, soundFor } from './art'
import { makeColors } from './make-colors.js'
import { ALL_ON, cacheStateAt, CALM, gearFor, sameMood, shown, ttlFrom } from './mood'
import type { Signals } from './mood'

// The theme's colors. The theme-builder skill's check-theme.mjs reads this constant and
// COLD_PALETTE from this file's text, so keep both plain literals (COLD_PALETTE may spread PALETTE).
export const PALETTE: Parameters<typeof makeColors>[0] = {
  label: '__LABEL__',
  roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d3',
        'surface-1': '#f4ecdc',
        'surface-2': '#faf5e9',
        'text-primary': '#2a241d',
        'text-secondary': '#544a3d',
        'text-muted': '#6a5f50',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1f1a15',
        'surface-1': '#28221b',
        'surface-2': '#312a22',
        'surface-3': '#3a3229',
        'text-primary': '#f0e7d7',
        'text-secondary': '#cfc4b2',
        'text-muted': '#aca08d',
      },
    },
  },
}

// The same theme while the prompt cache is cold: the grays cooled toward blue, roles kept.
export const COLD_PALETTE: Parameters<typeof makeColors>[0] = {
  ...PALETTE,
  label: '__LABEL__, cache cold',
  light: {
    gray: {
      anchors: {
        'surface-0': '#e1e7ef',
        'surface-1': '#eaeff5',
        'surface-2': '#f5f8fb',
        'text-primary': '#0a0f17',
        'text-secondary': '#28344a',
        'text-muted': '#506079',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a0f17',
        'surface-1': '#141c28',
        'surface-2': '#1c2737',
        'surface-3': '#243143',
        'text-primary': '#e3e8ef',
        'text-secondary': '#c2cad6',
        'text-muted': '#8b96a8',
      },
    },
  },
}

const WARM = makeColors(PALETTE)
const COLD = makeColors(COLD_PALETTE)

// Message style, if the theme has one (see look.md); empty leaves the app's own.
const STYLE: ThemeSetArgs['style'] = {}

const SCENE = 'live-scene'
// '__MOD_NAME__' must match plugin.json's name and the mod's folder name, written out here:
// the engine reads each atom's plugin and key as string literals.
const mood = atom({ plugin: '__MOD_NAME__', key: 'mood' } as const, CALM)
const cache = atom({ plugin: '__MOD_NAME__', key: 'cache' } as const, { at: null, ttlMs: 300e3, isActive: false } as CacheClock)

// The whole look for a mood; `isFull` false leaves out what an older build may refuse.
export const look = (m: Mood, s: Signals, isFull = true): ThemeSetArgs => ({
  colors: (m.cache === 'cold' ? COLD : WARM).theme,
  backdrop: { scene: SCENE },
  ...(isFull ? { style: STYLE, sound: soundFor(m, s.soundFollows) } : {}),
})

// What the colors and sound depend on: a theme.set only when this changes. The scene redraws
// from the mood atom by itself.
const lookKey = (m: Mood, s: Signals) => JSON.stringify([m.cache === 'cold', s.soundFollows ? m : null])

// Set by register from the options; a reload runs register again and starts these over.
// Functions that take $ stay at the top of the module: the engine refuses them inside register.
let signals: Signals = ALL_ON
let applied = '' // the lookKey last sent to theme.set
let isFull = true // false once this build refused style or sound

async function apply($: EngineInterface, m: Mood) {
  const key = lookKey(m, signals)
  if (key === applied) return
  applied = key
  try {
    const set = await $.theme.set(look(m, signals, isFull))
    if (!set.isDrawn) $.ui.status(set.reason)
  } catch (error) {
    if (!isFull) throw error
    $.ui.log(String(error))
    isFull = false // keep to colors and the scene from now on
    await $.theme.set(look(m, signals, false))
  }
}

// Recomputes the mood from what changed, redraws the scene and resets the look when it differs.
async function feel($: EngineInterface, change: Partial<Mood>) {
  const now = await $.clock.now()
  const c = await read($, cache)
  const prev = await read($, mood)
  const next = shown({ ...prev, ...change, cache: cacheStateAt(c, now) }, signals)
  if (!sameMood(prev, next)) await update($, mood, () => next)
  await apply($, next)
}

export const register: Register = (on, options) => {
  signals = {
    contextSpeed: options.contextSpeed !== false,
    moveWhileWorking: options.moveWhileWorking !== false,
    coldCache: options.coldCache !== false,
    soundFollows: options.soundFollows !== false,
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const problem = [...WARM.problems, ...COLD.problems].find(line => line.startsWith("Desktop won't paint"))
    if (problem !== undefined) $.ui.toast(problem)
    applied = ''
    const u = await $.session.usage()
    await feel($, { isMoving: false, gear: gearFor(u.context.percent) })
    // The cache lapses with no event of its own, so look at the clock.
    if (signals.coldCache || signals.soundFollows) $.clock.every(10000, () => feel($, {}))
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, cache, c => ({ ...c, at, isActive: true }))
      await feel($, { isMoving: true })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, cache, c => ({ at, ttlMs: ttlFrom(e.usage, c.ttlMs), isActive: false }))
      const u = await $.session.usage()
      await feel($, { isMoving: false, gear: gearFor(u.context.percent) })
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    const u = await $.session.usage()
    await feel($, { gear: gearFor(u.context.percent) })
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) return next(e)
    const m = await read($, mood)
    const { Svg } = $.ui.resolve(e)
    const what = m.cache === 'cold' ? 'stilled and cooled, the prompt cache is cold' : m.isMoving ? 'moving while Claude works' : 'at rest'
    return <Svg source={sceneSvg(m)} alt={`__SCENE_ALT__, ${what}`} isInteractive />
  })
}
