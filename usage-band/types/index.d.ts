export type Snapshot = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  startedAt: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snap: Snapshot | null; tokens: Tokens; warned: string[]; compact: boolean }
  }
}
