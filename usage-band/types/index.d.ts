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

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snap: Snapshot | null; tokens: Tokens; trend: Trend; warned: string[]; compact: boolean }
  }
}
