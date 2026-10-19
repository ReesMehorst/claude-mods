import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const now = Date.parse('2026-10-19T12:00:00Z')
const PR = { number: 5, title: 'Add thing', isDraft: true, author: { login: 'ann' }, headRefName: 'feat', baseRefName: 'main', statusCheckRollup: [], updatedAt: '2026-10-19T11:00:00Z', url: 'https://github.com/o/r/pull/5' }
const PROPS = { title: 'GitHub', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { top: 0, bodyRows: 40 } } as unknown as RenderPropsOf['Pane']

const NOTIF = { id: '42', unread: true, reason: 'mention', updated_at: '2026-10-19T11:00:00Z', subject: { title: 'Ping', type: 'Issue', url: 'https://api.github.com/repos/o/r/issues/3' } }
const RUN = { databaseId: 9, status: 'completed', conclusion: 'failure', displayTitle: 'CI run', workflowName: 'CI', headBranch: 'feat', createdAt: '2026-10-19T11:00:00Z', url: 'https://github.com/o/r/actions/runs/9' }

const ran: string[][] = []
const filled: string[] = []

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
      : a[0] === 'api' && a[1] === 'user' ? 'me'
      : a[0] === 'api' && a[1].endsWith('/notifications') ? [NOTIF]
      : a[0] === 'api' ? ''
      : a[0] === 'run' && a[1] === 'list' ? [RUN]
      : a[0] === 'run' && a[1] === 'view' ? 'build\tstep\t2026-10-19T11:00:00Z boom'
      : a[0] === 'pr' && a[1] === 'status' ? { currentBranch: null }
      : a[0] === 'pr' && a[1] === 'view' ? { additions: 1, deletions: 2, changedFiles: 3, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: 'hello' }
      : a[0] === 'pr' && a[1] === 'list' ? [PR]
      : a[0] === 'pr' ? ''
      : []
    return { value: { exitCode: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '' } }
  })
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
  await $.command.run({ command: 'github', args: '' } as any)
}

test('pane draws on every surface; details, ready, two-press merge', async ($, on) => {
  await start($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ plugin: 'github-pane', surface, component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
    expect(await ui.find({ text: /Add thing/ })).toBeDefined()
    if (surface === 'desktop') {
      expect(await ui.find({ key: 'box-pr-5' })).toBeDefined()
      expect(await ui.find({ text: / Draft / })).toBeDefined()
      expect(await ui.find({ text: / No checks / })).toBeDefined()
    } else {
      expect(await ui.find({ key: 'box-pr-5' })).toBeUndefined()
      expect(await ui.find({ text: /\[draft\] Add thing/ })).toBeDefined()
    }
    await ui.press({ key: 'row-pr-5' })
    await ui.press({ key: 'details' })
    expect(await ui.find({ text: /\+1 −2 · 3 files/ })).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ key: 'pr-body' })).toBeDefined() // body as Markdown
    expect(await ui.find({ key: 'approve' })).toBeDefined() // ann's PR, viewer is me
    expect(await ui.find({ key: 'ready' })).toBeDefined()
    await ui.press({ key: 'merge' })
    expect(ran.some(a => a[1] === 'merge')).toBe(false)
    if (surface === 'desktop') {
      expect(await ui.find({ text: /Squash-merge #5 into main\?/ })).toBeDefined()
      expect(await ui.find({ key: 'merge' })).toBeUndefined() // the card replaces the actions
      await ui.press({ key: 'cancel-merge' })
      expect(await ui.find({ key: 'merge-confirm' })).toBeUndefined()
      await ui.press({ key: 'merge' })
      await ui.press({ key: 'confirm-merge' })
    } else {
      expect(await ui.find({ text: /Press m again/ })).toBeDefined()
      await ui.press({ key: 'merge' })
    }
    expect(ran.some(a => a[1] === 'merge')).toBe(true)
    await ui.press({ key: 'row-pr-5' }) // deselect for the next surface
    await ui.unmount()
  }
})

test('notifications tab marks read; fix fills the prompt box without sending', async ($, on) => {
  await start($, on)
  ran.length = 0
  const ui = await $.ui.mount({ plugin: 'github-pane', surface: 'terminal', component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
  await ui.press({ key: 'tab-notifs' })
  expect(await ui.find({ text: /Ping/ })).toBeDefined()
  await ui.press({ key: 'row-notif-42' })
  await ui.press({ key: 'read' })
  expect(ran.some(a => a.join(' ') === 'api -X PATCH notifications/threads/42')).toBe(true)

  await ui.press({ key: 'tab-checks' })
  await ui.press({ key: 'row-run-9' })
  await ui.press({ key: 'fix' })
  expect(filled.at(-1)).toContain('CI failed on run 9 (branch feat).')
  expect(filled.at(-1)).toContain('boom')
  expect(await ui.find({ text: /prompt box/ })).toBeDefined()
  await ui.unmount()
})

test('desktop: failed log in a code block under the run', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'github-pane', surface: 'desktop', component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
  await ui.press({ key: 'tab-checks' })
  expect(await ui.find({ text: /CI run/ })).toBeDefined()
  await ui.press({ key: 'row-run-9' })
  expect(await ui.find({ key: 'card-run-9' })).toBeDefined()
  await ui.press({ key: 'log' })
  expect(await ui.find({ type: 'Code' })).toMatchObject({ props: { source: 'boom' } })
  await ui.unmount()
})

test('desktop: filter narrows the tab, tab change clears it; empty tabs say why', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'github-pane', surface: 'desktop', component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
  await ui.input({ key: 'filter', text: 'zzz', kind: 'change' })
  expect(await ui.find({ text: /Add thing/ })).toBeUndefined()
  expect(await ui.find({ text: /No matches/ })).toBeDefined()
  expect((await ui.find({ key: 'seg-prs' }))?.text).toBe('Pull requests 0 / 1 ')
  await ui.input({ key: 'filter', text: 'FEAT', kind: 'change' })
  expect(await ui.find({ text: /Add thing/ })).toBeDefined()
  expect(await ui.find({ text: /1 of 1 match/ })).toBeDefined()
  await ui.press({ key: 'tab-issues' })
  expect(await ui.find({ text: /No open issues in this repo\./ })).toBeDefined()
  await ui.press({ key: 'tab-prs' })
  expect((await ui.find({ key: 'seg-prs' }))?.text).toBe('Pull requests 1 ') // filter cleared
  await ui.unmount()
})

test('desktop: segmented tabs, red count on failing runs; narrow pane picks tabs from a View dropdown', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'github-pane', surface: 'desktop', component: 'Pane', requestId: 'github-pane', props: PROPS } as any)
  expect((await ui.find({ key: 'seg-checks' }))?.children[1]).toMatchObject({ props: { color: 'error' } }) // count pill
  expect(await ui.find({ key: 'tab-menu' })).toBeUndefined()
  await ui.unmount()

  const slim = await $.ui.mount({ plugin: 'github-pane', surface: 'desktop', component: 'Pane', requestId: 'github-pane', props: { ...PROPS, bodyColumns: 40 } } as any)
  expect(await slim.find({ key: 'tabs' })).toBeUndefined()
  expect((await slim.find({ key: 'tab-menu' }))?.text).toBe('Pull requests (1)')
  expect(await slim.find({ key: 'opt-checks' })).toBeUndefined() // closed until pressed
  expect(await slim.find({ text: /feat → main/ })).toBeUndefined() // narrow rows drop the branch
  await slim.press({ key: 'tab-menu' })
  expect((await slim.find({ key: 'opt-checks' }))?.text).toBe('Checks (1 failing)')
  await slim.press({ key: 'opt-checks' })
  expect(await slim.find({ key: 'opt-checks' })).toBeUndefined() // a pick closes it
  expect(await slim.find({ text: /CI run/ })).toBeDefined()
  await slim.unmount()
})
