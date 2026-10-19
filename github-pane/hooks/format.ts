import type { Row, Tone } from '../types'

export const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

const clip = (s: unknown, n = 80) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

type Status = { glyph: string; tone: Tone }
const PASS: Status = { glyph: '✓', tone: 'success' }
const FAIL: Status = { glyph: '✗', tone: 'error' }
const PENDING: Status = { glyph: '◐', tone: 'warning' }
const NONE: Status = { glyph: '·', tone: 'subtle' }

export const checks = (rollup: any[] | undefined): Status => {
  const r = (rollup ?? []).map(c => String(c.conclusion || c.state || c.status || '').toUpperCase())
  if (r.some(x => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/.test(x))) return FAIL
  if (r.some(x => /PENDING|PROGRESS|QUEUED|WAITING|EXPECTED/.test(x))) return PENDING
  return r.length ? PASS : NONE
}

const REVIEW: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes requested',
  REVIEW_REQUIRED: 'review required',
}

export const prRow = (p: any, now: number): Row => {
  const c = checks(p.statusCheckRollup)
  return {
    key: `pr-${p.number}`,
    kind: 'pr',
    id: p.number,
    ...c,
    title: `${p.isDraft ? '[draft] ' : ''}${clip(p.title)}`,
    sub: [`#${p.number}`, `${p.headRefName} → ${p.baseRefName}`, p.author?.login && `@${p.author.login}`, REVIEW[p.reviewDecision]]
      .filter(Boolean).join(' · '),
    age: ago(p.updatedAt, now),
    url: p.url,
    isFailed: c === FAIL,
  }
}

export const runRow = (r: any, now: number): Row => {
  const s = r.status !== 'completed' ? PENDING
    : r.conclusion === 'success' ? PASS
    : r.conclusion === 'skipped' || r.conclusion === 'neutral' ? NONE
    : FAIL
  return {
    key: `run-${r.databaseId}`,
    kind: 'run',
    id: r.databaseId,
    ...s,
    title: clip(r.displayTitle),
    sub: [r.workflowName, r.headBranch, r.event].filter(Boolean).join(' · '),
    age: ago(r.createdAt, now),
    url: r.url,
    isFailed: s === FAIL,
  }
}

export const issueRow = (i: any, now: number): Row => ({
  key: `issue-${i.number}`,
  kind: 'issue',
  id: i.number,
  glyph: '○',
  tone: 'success',
  title: clip(i.title),
  sub: [`#${i.number}`, ...(i.labels ?? []).slice(0, 3).map((l: any) => l.name), ...(i.assignees ?? []).map((a: any) => `@${a.login}`)]
    .join(' · '),
  age: ago(i.updatedAt, now),
  url: i.url,
  isFailed: false,
})

// PRs whose checks just turned red since the last poll (first poll: none).
export const newlyFailed = (prev: Map<number, boolean> | null, rows: Row[]) =>
  prev ? rows.filter(r => r.isFailed && prev.get(r.id) === false) : []

// Failed-log tail: drop the "job\tstep\t" prefix gh puts on each line.
export const logTail = (raw: string, lines = 30) =>
  raw.split(/\r?\n/).filter(Boolean).slice(-lines).map(l => l.split('\t').at(-1)!.replace(/^\S+Z /, '')).join('\n')
