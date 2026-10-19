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
    isDraft: !!p.isDraft,
    author: p.author?.login,
    branch: p.headRefName,
    base: p.baseRefName,
    decision: p.reviewDecision || undefined,
  }
}

export type Pill = { text: string; tone: Tone }
const CI: Record<Tone, string> = { success: 'CI passing', error: 'CI failing', warning: 'CI running', subtle: 'No checks' }
const RUN: Record<Tone, string> = { success: 'Passed', error: 'Failed', warning: 'Running', subtle: 'Skipped' }
const REVIEW_PILL: Record<string, Pill> = {
  APPROVED: { text: 'Approved', tone: 'success' },
  CHANGES_REQUESTED: { text: 'Changes requested', tone: 'error' },
  REVIEW_REQUIRED: { text: 'Review required', tone: 'warning' },
}

// A row as the desktop draws it: title, meta line and pills (the terminal folds review and draft into the text).
export const desktopRow = (r: Row): { title: string; meta: string; pills: Pill[] } => {
  if (r.kind === 'pr') {
    const review = r.isDraft ? { text: 'Draft', tone: 'subtle' as Tone } : REVIEW_PILL[r.decision ?? '']
    return {
      title: r.isDraft ? r.title.replace(/^\[draft\] /, '') : r.title,
      meta: [`#${r.id}`, r.branch && r.base && `${r.branch} → ${r.base}`, r.author && `@${r.author}`].filter(Boolean).join(' · '),
      pills: [...(review ? [review] : []), { text: CI[r.tone], tone: r.tone }],
    }
  }
  return { title: r.title, meta: r.sub, pills: r.kind === 'run' ? [{ text: RUN[r.tone], tone: r.tone }] : [] }
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
    isPending: s === PENDING,
    branch: r.headBranch,
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

// What one poll saw, for toasts: all PRs, PRs asking your review, your PRs, runs on your PRs' branches.
export type Seen = { prs: Row[]; asked: Row[]; authored: Row[]; runs: Row[] }

// Toast texts for what changed since the last poll (first poll: none, so a reload never replays).
export const toasts = (prev: Seen | null, next: Seen): string[] => {
  if (!prev) return []
  const was = (list: Row[], r: Row) => list.find(p => p.id === r.id)
  return [
    ...next.prs.filter(r => r.isFailed && was(prev.prs, r)?.isFailed === false)
      .map(r => `✗ Checks failed on #${r.id}: ${r.title}`),
    ...next.asked.filter(r => !was(prev.asked, r))
      .map(r => `Review requested on #${r.id}: ${r.title}`),
    ...next.authored.filter(r => { const p = was(prev.authored, r); return r.decision === 'APPROVED' && p && p.decision !== 'APPROVED' })
      .map(r => `✓ Approved #${r.id}: ${r.title}`),
    ...next.runs.filter(r => !r.isPending && was(prev.runs, r)?.isPending)
      .map(r => `${r.isFailed ? '✗' : '✓'} Run finished: ${r.title} (${r.sub})`),
  ]
}

// Failed-log tail: drop the "job\tstep\t" prefix gh puts on each line, ANSI colours,
// and each job's "Post job cleanup." section (it buries the error).
export const logTail = (raw: string, lines = 30) => {
  let job = ''
  let cleanup = false
  return raw.split(/\r?\n/).filter(Boolean)
    .filter(l => {
      const j = l.split('\t')[0]
      if (j !== job) { job = j; cleanup = false }
      return !(cleanup ||= l.endsWith('Post job cleanup.'))
    })
    .slice(-lines).map(l => l.split('\t').at(-1)!.replace(/^\S+Z /, '').replace(/\x1b\[[\d;]*m/g, '')).join('\n')
}

// Errors a retry can't fix: no repo, no remote, gh missing or signed out.
const FATAL = /not a git repository|no git remotes|none of the git remotes|gh auth login|not logged in|ENOENT|executable file not found|command not found/i

// Next poll delay: base when ok, doubling up to 10 min on errors, null (stop) when fatal.
export const nextDelay = (prev: number, error: string | null, base: number) =>
  !error ? base : FATAL.test(error) ? null : Math.min(prev * 2, 600_000)

// `gh pr view --json body,reviewRequests,latestReviews,mergeable,mergeStateStatus,additions,deletions,changedFiles` → detail text.
export const prDetail = (p: any, bodyLines = 20) => {
  const low = (x: unknown) => String(x ?? 'unknown').toLowerCase().replace(/_/g, ' ')
  const reviewed = (p.latestReviews ?? []).map((r: any) => `  @${r.author?.login} ${low(r.state)}`)
  const asked = (p.reviewRequests ?? []).map((r: any) => `  ${r.login ? `@${r.login}` : r.name ?? r.slug} requested`)
  const body = String(p.body ?? '').trim().split(/\r?\n/)
  const more = body.length - bodyLines
  return [
    `+${p.additions ?? 0} −${p.deletions ?? 0} · ${p.changedFiles ?? 0} files`,
    `${low(p.mergeable)} · ${low(p.mergeStateStatus)}`,
    ...(reviewed.length + asked.length ? ['Reviewers:', ...reviewed, ...asked] : ['No reviewers.']),
    '',
    body[0] ? body.slice(0, bodyLines).join('\n') : 'No description.',
    ...(more > 0 ? [`… ${more} more lines`] : []),
  ].join('\n')
}

// Two-press confirm: first press on a key arms it, second press on the same key runs (and disarms).
export const confirmPress = (armed: string | null, key: string) =>
  armed === key ? { run: true, armed: null } : { run: false, armed: key }

// Notification subject URLs point at the API: PRs and issues map to their page, anything else to the repo.
export const notifUrl = (n: any) => {
  const m = /repos\/([^/]+\/[^/]+)\/(pulls|issues)\/(\d+)$/.exec(n.subject?.url ?? '')
  return m ? `https://github.com/${m[1]}/${m[2] === 'pulls' ? 'pull' : 'issues'}/${m[3]}` : n.repository?.html_url ?? ''
}

// `gh api repos/<repo>/notifications` item → row; id is the thread id (for mark read).
export const notifRow = (n: any, now: number): Row => ({
  key: `notif-${n.id}`,
  kind: 'notif',
  id: Number(n.id),
  glyph: n.unread ? '●' : '○',
  tone: n.unread ? 'warning' : 'subtle',
  title: clip(n.subject?.title),
  sub: [String(n.reason ?? '').replace(/_/g, ' '), n.subject?.type].filter(Boolean).join(' · '),
  age: ago(n.updated_at, now),
  url: notifUrl(n),
  isFailed: false,
})

// `gh pr checks --json link,state` → the first failed Actions run id, or null (external checks have no run).
export const failedRunId = (cs: any[]) => {
  for (const c of cs) {
    const m = /\/actions\/runs\/(\d+)/.exec(c.link ?? '')
    if (m && /FAIL|ERROR|CANCEL|TIMED_OUT/i.test(c.state ?? '')) return Number(m[1])
  }
  return null
}

// Draft for the prompt box: what failed, where, and the log tail.
export const fixPrompt = (r: Row, runId: number, log: string) =>
  [
    `CI failed on ${r.kind === 'pr' ? `PR #${r.id}, ` : ''}run ${runId}${r.branch ? ` (branch ${r.branch})` : ''}.`,
    '```',
    logTail(log, 60),
    '```',
    'Find and fix the cause of this CI failure.',
  ].join('\n')
