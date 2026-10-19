import { test, expect } from 'claude-code/testing'
import { ago, checks, issueRow, logTail, newlyFailed, prRow, runRow } from './format'

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

test('newlyFailed only flags green-to-red', () => {
  const red = { ...prRow({ number: 1, statusCheckRollup: [{ conclusion: 'FAILURE' }], updatedAt: '2026-10-19T11:00:00Z' }, now) }
  expect(newlyFailed(null, [red])).toEqual([])
  expect(newlyFailed(new Map([[1, true]]), [red])).toEqual([])
  expect(newlyFailed(new Map([[1, false]]), [red]).length).toBe(1)
})

test('logTail strips job/step and timestamp prefixes', () => {
  expect(logTail('build\tRun tests\t2026-10-19T11:00:00.1234567Z FAIL a.test\nbuild\tRun tests\t2026-10-19T11:00:01.0Z exit 1', 1)).toBe('exit 1')
})
