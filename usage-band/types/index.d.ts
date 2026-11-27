export type Snapshot = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  startedAt: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

// lastCost: session cost at the last turn's end; ctxHistory: context tokens after the last few turns.
export type Trend = { lastCost: number | null; lastTurnUsd: number | null; ctxHistory: number[] }

export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }

// Prompt cache of the main conversation. at: when the last request that wrote or read it started
// (null before the first turn); active: a turn is running, so it is being refreshed; pings: keep-warm
// pings sent since the last real turn; alerted: alert keys already toasted this idle stretch.
export type Cache = { at: number | null; ttlMs: number; active: boolean; pings: number; alerted: string[] }

// The mascot's poses, one per situation the band can be in.
export type Mood = 'warm' | 'live' | 'soon' | 'keep' | 'cold' | 'full' | 'budget' | 'pace' | 'nap'

// What the mascot's bubble says, and the one action it offers (hidden once dismissed by key).
export type Suggestion = { key: string; mood: Mood; text: string; action?: 'compact' | 'keep' }

// Weekly limit sampled per local day: date (YYYY-MM-DD) → percentUsed at that day's last sample.
// resetsAt ties the log to one weekly window; a new window starts a new log.
export type DayLog = { resetsAt: string; days: Record<string, number> }

// One tile of the weekly strip. level: -1 still to come, 0 no use, 1–4 light to heavy.
export type DayTile = { label: string; level: -1 | 0 | 1 | 2 | 3 | 4; isToday: boolean; percent: number | null }

// Spend of one calendar month (month: YYYY-MM), added up from finished turns while the mod runs, across
// sessions. api: billed on API credits; plan: value of plan usage at API prices (included in the plan).
// since: first day (YYYY-MM-DD) of the month with any spend tracked.
export type MonthLog = { month: string; since: string; api: number; plan: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snap: Snapshot | null; tokens: Tokens; trend: Trend; warned: string[]; compact: boolean; cache: Cache; keepWarm: boolean; pulse: number; menuOpen: boolean; dismissed: string; weekLog: DayLog | null }
  }
}
