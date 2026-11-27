// The prompt cache of the main conversation. at: when the last turn that read or wrote it
// started or ended (null before the first); isActive: a turn is running and refreshing it.
export type CacheClock = { at: number | null; ttlMs: number; isActive: boolean }

export type CacheState = 'none' | 'warm' | 'soon' | 'cold'

// What the session is doing, as the theme shows it. gear: context fill, 0 to 3.
export type Mood = { isMoving: boolean; gear: 0 | 1 | 2 | 3; cache: CacheState }

declare module 'claude-code' {
  interface PluginState {
    '__MOD_NAME__': { mood: Mood; cache: CacheClock }
  }
}
