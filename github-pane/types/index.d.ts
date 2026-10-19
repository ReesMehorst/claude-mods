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
  base?: string // PRs only: base branch
}
export type Reviewer = { who: string; text: string; tone: Tone }
export type PrParts = { stat: string; merge: string; reviewers: Reviewer[]; body: string }
// What the detail box shows: text (the terminal draws only this), or a code block, or a PR's parts.
export type Detail = { text: string; code?: boolean; pr?: PrParts }
export type Snapshot = {
  repo: string | null
  rows: Record<Tab, Row[]>
  here: Row | null
  at: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'github-pane': { snap: Snapshot; tab: Tab; selected: string | null; detail: Detail | null; busy: string | null; confirm: string | null }
  }
}
