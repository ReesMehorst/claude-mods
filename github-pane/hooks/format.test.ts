import { test, expect } from 'claude-code/testing'
import { ago, checks, confirmPress, issueRow, logTail, nextDelay, prDetail, prRow, runRow, toasts } from './format'

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

test('prDetail: stat, merge state, reviewers, clipped body', () => {
  const d = prDetail({
    additions: 12, deletions: 3, changedFiles: 4, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    latestReviews: [{ author: { login: 'ann' }, state: 'CHANGES_REQUESTED' }],
    reviewRequests: [{ login: 'bob' }, { name: 'core-team' }],
    body: 'a\r\nb\nc\nd',
  }, 2)
  expect(d).toBe('+12 −3 · 4 files\nmergeable · blocked\nReviewers:\n  @ann changes requested\n  @bob requested\n  core-team requested\n\na\nb\n… 2 more lines')
  expect(prDetail({})).toBe('+0 −0 · 0 files\nunknown · unknown\nNo reviewers.\n\nNo description.')
})

test('confirmPress: merge never runs on a single press', () => {
  expect(confirmPress(null, 'pr-1')).toEqual({ run: false, armed: 'pr-1' })
  expect(confirmPress('pr-2', 'pr-1')).toEqual({ run: false, armed: 'pr-1' })
  expect(confirmPress('pr-1', 'pr-1')).toEqual({ run: true, armed: null })
})
