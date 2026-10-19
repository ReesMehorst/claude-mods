import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const now = Date.parse('2026-10-19T12:00:00Z')
const PR = { number: 5, title: 'Add thing', isDraft: true, author: { login: 'ann' }, headRefName: 'feat', baseRefName: 'main', statusCheckRollup: [], updatedAt: '2026-10-19T11:00:00Z', url: 'https://github.com/o/r/pull/5' }
const PROPS = { title: 'GitHub', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 40 } } as unknown as RenderPropsOf['Pane']

const ran: string[][] = []

async function start($: Engine, on: On) {
  mock.clock(on, { now })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) => {
    const a = e.argv.slice(1)
    ran.push(a)
    const out = a[0] === 'repo' ? { nameWithOwner: 'o/r' }
      : a[0] === 'api' ? 'me'
      : a[0] === 'pr' && a[1] === 'status' ? { currentBranch: null }
      : a[0] === 'pr' && a[1] === 'view' ? { additions: 1, deletions: 2, changedFiles: 3, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: 'hello' }
      : a[0] === 'pr' && a[1] === 'list' ? [PR]
      : a[0] === 'pr' ? ''
      : []
    return { value: { exitCode: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  await $.command.run({ command: 'github', args: '' } as any)
}

test('pane draws on every surface; details, ready, two-press merge', async ($, on) => {
  await start($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ plugin: 'github-pane', surface, component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
    expect(await ui.find({ text: /Add thing/ })).toBeDefined()
    await ui.press({ key: 'row-pr-5' })
    await ui.press({ key: 'details' })
    expect(await ui.find({ text: /\+1 −2 · 3 files/ })).toBeDefined()
    expect(await ui.find({ key: 'approve' })).toBeDefined() // ann's PR, viewer is me
    expect(await ui.find({ key: 'ready' })).toBeDefined()
    await ui.press({ key: 'merge' })
    expect(ran.some(a => a[1] === 'merge')).toBe(false)
    expect(await ui.find({ text: /Press m again/ })).toBeDefined()
    await ui.press({ key: 'merge' })
    expect(ran.some(a => a[1] === 'merge')).toBe(true)
    await ui.press({ key: 'row-pr-5' }) // deselect for the next surface
    await ui.unmount()
  }
})
