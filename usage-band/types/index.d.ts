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

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snap: Snapshot | null; tokens: Tokens; trend: Trend; warned: string[]; compact: boolean; cache: Cache; keepWarm: boolean; pulse: number }
  }
}
