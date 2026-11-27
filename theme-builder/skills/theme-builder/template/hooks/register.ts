import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The theme's colors. The theme-builder skill's check-theme.mjs imports this
// constant to check it, so keep it a plain literal.
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

const { theme, problems } = makeColors(PALETTE)

// The colors alone: what every build that draws themes takes.
const BASE: ThemeSetArgs = { colors: theme }

// Extras an older build may refuse (style, sound). Empty until the theme has them.
const EXTRAS: ThemeSetArgs = {}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    let set

    try {
      set = await $.theme.set({ ...BASE, ...EXTRAS })
    } catch (error) {
      $.ui.log(String(error))
      set = await $.theme.set(BASE)
    }

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })
}
