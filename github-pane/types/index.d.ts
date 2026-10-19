export type Tab = 'prs' | 'checks' | 'issues' | 'mine' | 'notifs'
export type Tone = 'success' | 'warning' | 'error' | 'subtle'
export type Row = {
  key: string
  kind: 'pr' | 'run' | 'issue' | 'notif'
  id: number
  glyph: string
  tone: Tone
  title: string
  sub: string
  age: string
  url: string
  isFailed: boolean
  isDraft?: boolean // PRs only
  author?: string // PRs only: login
  decision?: string // PRs only: raw reviewDecision
  isPending?: boolean // runs only: not completed
  branch?: string // PRs and runs: head branch
}
export type Snapshot = {
  repo: string | null
  rows: Record<Tab, Row[]>
  here: Row | null
  at: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'github-pane': { snap: Snapshot; tab: Tab; selected: string | null; detail: string | null; busy: string | null; confirm: string | null }
  }
}
