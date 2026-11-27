// How the session feels: read from the context, the turn and the prompt cache. Leave this file
// as it is; a theme draws the mood in art.ts.

import type { CacheClock, CacheState, Mood } from '../types'

// What the theme reacts to, each switched by a userConfig option of the same name.
export type Signals = { contextSpeed: boolean; moveWhileWorking: boolean; coldCache: boolean; soundFollows: boolean }

export const ALL_ON: Signals = { contextSpeed: true, moveWhileWorking: true, coldCache: true, soundFollows: true }

export const CALM: Mood = { isMoving: false, gear: 0, cache: 'none' }

// Context fill to a gear: 0 under 35%, 1 to 60%, 2 to 80%, 3 from 80% (time to compact).
export const gearFor = (percent: number | null | undefined): Mood['gear'] =>
  percent == null ? 0 : percent >= 80 ? 3 : percent >= 60 ? 2 : percent >= 35 ? 1 : 0

// A write of both lifetimes counts as the shorter; a read-only turn keeps the lifetime already known.
export const ttlFrom = (u: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | undefined, prev: number) =>
  (u?.ephemeral_5m_input_tokens ?? 0) > 0 ? 300e3 : (u?.ephemeral_1h_input_tokens ?? 0) > 0 ? 3600e3 : prev

// The prompt cache's state: warm, `soon` in its last minute (five on the 1-hour cache), cold once lapsed.
export const cacheStateAt = (c: CacheClock, now: number): CacheState => {
  if (c.at == null) return 'none'
  if (c.isActive) return 'warm'
  const left = c.at + c.ttlMs - now
  return left <= 0 ? 'cold' : left <= (c.ttlMs > 600e3 ? 300e3 : 60e3) ? 'soon' : 'warm'
}

// The mood the theme shows, with every switched-off signal held at its calm value.
export const shown = (m: Mood, s: Signals): Mood => ({
  isMoving: s.moveWhileWorking ? m.isMoving : true,
  gear: s.contextSpeed ? m.gear : 0,
  cache: s.coldCache ? m.cache : 'none',
})

export const sameMood = (a: Mood, b: Mood) => a.isMoving === b.isMoving && a.gear === b.gear && a.cache === b.cache
