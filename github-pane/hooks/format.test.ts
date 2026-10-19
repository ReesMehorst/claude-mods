import { test, expect } from 'claude-code/testing'
import { ago, checks, confirmPress, desktopRow, emptyState, failedRunId, fixPrompt, issueRow, logTail, matches, nextDelay, notifRow, notifUrl, prDetail, prRow, prText, runRow, tabCount, tabOption, toasts } from './format'

const now = Date.parse('2026-10-19T12:00:00Z')

test('ago buckets', () => {
  expect(ago('2026-10-19T11:59:50Z', now)).toBe('now')
  expect(ago('2026-10-19T11:15:00Z', now)).toBe('45m')
  expect(ago('2026-10-19T07:00:00Z', now)).toBe('5h')
  expect(ago('2026-10-16T12:00:00Z', now)).toBe('3d')
})

test('checks rollup: fail beats pending beats pass', () => {
  expect(checks([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]).glyph).toBe('◐')
  expect(checks([{ conclusion: 'FAILURE' }, { status: 'QUEUED' }]).glyph).toBe('✗')
  expect(checks([{ state: 'SUCCESS' }]).glyph).toBe('✓')
  expect(checks([]).glyph).toBe('·')
})

test('pr row', () => {
  const r = prRow({
    number: 7, title: 'Add pane', isDraft: true, headRefName: 'feat', baseRefName: 'main', author: { login: 'rees' },
    reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ conclusion: 'FAILURE' }], updatedAt: '2026-10-19T11:00:00Z', url: 'u',
  }, now)
  expect(r.title).toBe('[draft] Add pane')
  expect(r.sub).toBe('#7 · feat → main · @rees · changes requested')
  expect(r.isFailed).toBe(true)
  expect(r.age).toBe('1h')
})

test('run and issue rows', () => {
  expect(runRow({ databaseId: 1, status: 'completed', conclusion: 'success', displayTitle: 'x', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2026-10-19T11:58:00Z', url: 'u' }, now).sub)
    .toBe('CI · main · push')
  expect(runRow({ databaseId: 2, status: 'completed', conclusion: 'failure', createdAt: '2026-10-19T11:00:00Z' }, now).isFailed).toBe(true)
  expect(issueRow({ number: 3, title: 'Bug', labels: [{ name: 'bug' }], assignees: [{ login: 'rees' }], updatedAt: '2026-10-19T11:00:00Z', url: 'u' }, now).sub)
    .toBe('#3 · bug · @rees')
})

test('toasts: first poll none, then one per change', () => {
  const at = '2026-10-19T11:00:00Z'
  const pr = (number: number, more: object = {}) => prRow({ number, title: `T${number}`, updatedAt: at, ...more }, now)
  const run = (status: string, conclusion = '') => runRow({ databaseId: 9, status, conclusion, displayTitle: 'CI run', workflowName: 'CI', headBranch: 'feat', createdAt: at }, now)
  const before = { prs: [pr(1, { statusCheckRollup: [{ conclusion: 'SUCCESS' }] })], asked: [pr(2)], authored: [pr(3, { reviewDecision: 'REVIEW_REQUIRED' })], runs: [run('in_progress')] }
  const after = {
    prs: [pr(1, { statusCheckRollup: [{ conclusion: 'FAILURE' }] })],
    asked: [pr(2), pr(4)],
    authored: [pr(3, { reviewDecision: 'APPROVED' }), pr(5, { reviewDecision: 'APPROVED' })],
    runs: [run('completed', 'failure')],
  }
  expect(toasts(null, after)).toEqual([])
  expect(toasts(before, after)).toEqual([
    '✗ Checks failed on #1: T1',
    'Review requested on #4: T4',
    '✓ Approved #3: T3',
    '✗ Run finished: CI run (CI · feat)',
  ])
  expect(toasts(after, after)).toEqual([])
})

test('logTail strips job/step and timestamp prefixes', () => {
  expect(logTail('build\tRun tests\t2026-10-19T11:00:00.1234567Z FAIL a.test\nbuild\tRun tests\t2026-10-19T11:00:01.0Z exit 1', 1)).toBe('exit 1')
})

test('logTail skips each job\'s post-job cleanup and ANSI colours', () => {
  const log = [
    'a\ts\tT0Z \x1b[33mleaks found: 1\x1b[0m', 'a\ts\tT1Z Post job cleanup.', 'a\ts\tT2Z git version',
    'b\ts\tT3Z boom', 'b\ts\tT4Z Post job cleanup.', 'b\ts\tT5Z rm -rf tmp',
  ].join('\n')
  expect(logTail(log)).toBe('leaks found: 1\nboom')
})

test('nextDelay: reset on ok, back off on errors, stop when fatal', () => {
  expect(nextDelay(240_000, null, 60_000)).toBe(60_000)
  expect(nextDelay(60_000, 'HTTP 502', 60_000)).toBe(120_000)
  expect(nextDelay(480_000, 'HTTP 502', 60_000)).toBe(600_000)
  expect(nextDelay(60_000, 'fatal: not a git repository (or any of the parent directories): .git', 60_000)).toBe(null)
  expect(nextDelay(60_000, 'To get started with GitHub CLI, please run:  gh auth login', 60_000)).toBe(null)
})

test('pr row carries draft flag and author', () => {
  const r = prRow({ number: 8, isDraft: true, author: { login: 'rees' }, updatedAt: '2026-10-19T11:00:00Z' }, now)
  expect(r.isDraft).toBe(true)
  expect(r.author).toBe('rees')
})

test('prDetail parts; prText joins them with the body clipped', () => {
  const d = prDetail({
    additions: 12, deletions: 3, changedFiles: 4, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    latestReviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }],
    reviewRequests: [{ login: 'bob' }, { name: 'core-team' }],
    body: 'a\r\nb\nc\nd',
  })
  expect(d.stat).toBe('+12 −3 · 4 files')
  expect(d.merge).toBe('mergeable · blocked')
  expect(d.reviewers).toEqual([
    { who: '@ann', text: 'changes requested', tone: 'error' },
    { who: '@bob', text: 'requested', tone: 'warning' },
    { who: 'core-team', text: 'requested', tone: 'warning' },
  ])
  expect(prText(d, 2)).toBe('+12 −3 · 4 files\nmergeable · blocked\nReviewers:\n  @ann changes requested\n  @bob requested\n  core-team requested\n\na\nb\n… 2 more lines')
  expect(prText(prDetail({}))).toBe('+0 −0 · 0 files\nunknown · unknown\nNo reviewers.\n\nNo description.')
})

test('confirmPress: merge never runs on a single press', () => {
  expect(confirmPress(null, 'pr-1')).toEqual({ run: false, armed: 'pr-1' })
  expect(confirmPress('pr-2', 'pr-1')).toEqual({ run: false, armed: 'pr-1' })
  expect(confirmPress('pr-1', 'pr-1')).toEqual({ run: true, armed: null })
})

test('notifRow and URL mapping', () => {
  const n = { id: '42', unread: true, reason: 'review_requested', updated_at: '2026-10-19T11:00:00Z', repository: { html_url: 'https://github.com/o/r' },
    subject: { title: 'Add pane', type: 'PullRequest', url: 'https://api.github.com/repos/o/r/pulls/7' } }
  const r = notifRow(n, now)
  expect(r).toMatchObject({ key: 'notif-42', kind: 'notif', id: 42, glyph: '●', title: 'Add pane', sub: 'review requested · PullRequest', age: '1h' })
  expect(r.url).toBe('https://github.com/o/r/pull/7')
  expect(notifUrl({ subject: { url: 'https://api.github.com/repos/o/r/issues/3' } })).toBe('https://github.com/o/r/issues/3')
  expect(notifUrl({ ...n, subject: { url: 'https://api.github.com/repos/o/r/releases/9' } })).toBe('https://github.com/o/r')
})

test('failedRunId and fixPrompt', () => {
  expect(failedRunId([
    { state: 'SUCCESS', link: 'https://github.com/o/r/actions/runs/1/job/2' },
    { state: 'FAILURE', link: 'https://ci.example.com/x' },
    { state: 'FAILURE', link: 'https://github.com/o/r/actions/runs/3/job/4' },
  ])).toBe(3)
  expect(failedRunId([{ state: 'SUCCESS', link: 'https://github.com/o/r/actions/runs/1/job/2' }])).toBe(null)
  const pr = prRow({ number: 7, title: 'x', headRefName: 'feat', updatedAt: '2026-10-19T11:00:00Z' }, now)
  expect(fixPrompt(pr, 3, 'build\tstep\t2026-10-19T11:00:00Z boom\n')).toBe(
    'CI failed on PR #7, run 3 (branch feat).\n```\nboom\n```\nFind and fix the cause of this CI failure.')
  const run = runRow({ databaseId: 9, status: 'completed', conclusion: 'failure', headBranch: 'main', createdAt: '2026-10-19T11:00:00Z' }, now)
  expect(fixPrompt(run, 9, 'x').split('\n')[0]).toBe('CI failed on run 9 (branch main).')
})

test('desktop row: draft pill replaces review, CI pill by tone, runs get one pill', () => {
  const pr = { number: 7, title: 'Add pane', headRefName: 'feat', baseRefName: 'main', author: { login: 'rees' }, updatedAt: '2026-10-19T11:00:00Z', url: 'u' }
  const draft = desktopRow(prRow({ ...pr, isDraft: true, reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'FAILURE' }] }, now))
  expect(draft.title).toBe('Add pane')
  expect(draft.meta).toBe('#7 · feat → main · @rees')
  expect(draft.pills).toEqual([{ text: 'Draft', tone: 'subtle' }, { text: 'CI failing', tone: 'error' }])
  expect(desktopRow(prRow({ ...pr, reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [] }, now)).pills)
    .toEqual([{ text: 'Changes requested', tone: 'error' }, { text: 'No checks', tone: 'subtle' }])
  expect(desktopRow(runRow({ databaseId: 1, status: 'in_progress', displayTitle: 'x', workflowName: 'CI', createdAt: '2026-10-19T11:00:00Z' }, now)).pills)
    .toEqual([{ text: 'Running', tone: 'warning' }])
  expect(desktopRow(issueRow({ number: 3, title: 'Bug', updatedAt: '2026-10-19T11:00:00Z', url: 'u' }, now)).pills).toEqual([])
})

test('desktop row, narrow: no branch, one pill, a red one first', () => {
  const pr = { number: 7, title: 'Add pane', headRefName: 'feat', baseRefName: 'main', author: { login: 'rees' }, updatedAt: '2026-10-19T11:00:00Z', url: 'u' }
  const failing = desktopRow(prRow({ ...pr, reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'FAILURE' }] }, now), true)
  expect(failing.meta).toBe('#7 · @rees')
  expect(failing.pills).toEqual([{ text: 'CI failing', tone: 'error' }])
  expect(desktopRow(prRow({ ...pr, reviewDecision: 'APPROVED', statusCheckRollup: [] }, now), true).pills).toEqual([{ text: 'Approved', tone: 'success' }])
})

test('tab counts: total or shown / total, red with failures; Select labels name failures', () => {
  const run = (conclusion: string) => runRow({ databaseId: 1, status: 'completed', conclusion, createdAt: '2026-10-19T11:00:00Z' }, now)
  const rows = [run('failure'), run('success'), run('failure')]
  expect(tabCount(rows)).toEqual({ text: '3', tone: 'error' })
  expect(tabCount(rows.slice(1, 2), 0)).toEqual({ text: '0 / 1', tone: 'subtle' })
  expect(tabOption('Checks', rows)).toBe('Checks (2 failing)')
  expect(tabOption('Issues', [])).toBe('Issues (0)')
  expect(tabOption('Checks', rows.slice(1, 2), 0)).toBe('Checks (0 / 1)')
})

test('matches: title, #n, branch or author, any case; blank matches all', () => {
  const r = prRow({ number: 12, title: 'Fix Login', author: { login: 'ann' }, headRefName: 'auth-fix', baseRefName: 'main', updatedAt: '2026-10-19T11:00:00Z' }, Date.parse('2026-10-19T12:00:00Z'))
  for (const q of ['login', '#12', 'AUTH', 'Ann', '  ', '']) expect(matches(r, q)).toBe(true)
  for (const q of ['#1x', 'bob', 'main']) expect(matches(r, q)).toBe(false)
})

test('emptyState: notifications explain the repo scope and link out', () => {
  expect(emptyState('notifs', 'o/r')).toEqual({ title: 'No unread notifications', line: 'No unread notifications for o/r. This tab shows this repo only.', href: 'https://github.com/notifications' })
  expect(emptyState('checks', 'o/r').line).toBe('No workflow runs in this repo.')
})
