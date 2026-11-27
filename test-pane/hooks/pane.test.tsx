import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

const now = Date.parse('2026-10-19T12:00:00Z')
const PROPS = { title: 'Tests', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { top: 0, bodyRows: 40 } } as unknown as RenderPropsOf['Pane']
const MOUNT = { plugin: 'test-pane', component: 'Pane', requestId: 'test-pane', props: PROPS } as const

const FAILING = 'tests/a.py::test_ok PASSED\ntests/a.py::test_bad FAILED\nFAILED tests/a.py::test_bad - assert'
const PASSING = 'tests/a.py::test_ok PASSED\ntests/a.py::test_bad PASSED'

const ran: { argv: string[]; cwd?: string }[] = []
const opened: string[] = []
const filled: string[] = []
const toasts: string[] = []
let bashOut = FAILING
let paneOut = PASSING

async function start($: Engine, on: On) {
  ran.length = opened.length = filled.length = toasts.length = 0
  mock.clock(on, { now })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) => { ran.push({ argv: [...e.argv], cwd: e.init?.cwd }); return { value: { exitCode: 0, stdout: paneOut, stderr: '' } as any } })
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? { result: { stdout: bashOut, stderr: '' }, text: bashOut } : { result: {} }))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
}

test('empty pane says what it watches', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop' } as any)
  expect(await ui.find({ text: /No test runs yet/ })).toBeDefined()
  await ui.unmount()
})

test('a Bash test run opens the pane and lists failures; rerun failed runs only those', async ($, on) => {
  await start($, on)
  bashOut = FAILING
  await $.tool.call({ tool: 'Bash', command: 'pytest -q tests/' } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any) // not a test run
  expect(opened).toEqual(['test-pane'])

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...MOUNT, surface } as any)
    expect(await ui.find({ text: /1 failing/ })).toBeDefined()
    expect(await ui.find({ text: /tests\/a\.py::test_bad/ })).toBeDefined()
    expect(await ui.find({ text: /tests\/a\.py::test_ok/ })).toBeUndefined() // passed folded away
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop' } as any)
  await ui.press({ key: 'toggle-passed' })
  expect(await ui.find({ text: /tests\/a\.py::test_ok/ })).toBeDefined()

  await ui.press({ key: 'fix' })
  expect(filled[0]).toContain('- tests/a.py::test_bad')
  expect(filled[0]).toContain('pytest -q tests/')

  paneOut = 'tests/a.py::test_bad PASSED'
  await ui.press({ key: 'rerun-failed' })
  expect(ran[0]).toEqual({ argv: ['bash', '-lc', "pytest -v 'tests/a.py::test_bad'"], cwd: '/repo' })
  expect(await ui.find({ text: /All passing/ })).toBeDefined()
  expect(await ui.find({ text: /Runs \(2\)/ })).toBeDefined()
  await ui.unmount()
})

test('pass then fail with no edit between is flagged flaky; an edit between is not', async ($, on) => {
  await start($, on)
  bashOut = PASSING
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as any)
  bashOut = FAILING
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as any)
  expect(toasts.some(t => t.includes('Flaky test: tests/a.py::test_bad'))).toBe(true)

  const ui = await $.ui.mount({ ...MOUNT, surface: 'desktop' } as any)
  expect(await ui.find({ text: / flaky / })).toBeDefined()
  expect(await ui.find({ text: /Flaky this session \(1\)/ })).toBeDefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ text: /No test runs yet/ })).toBeDefined()
  await ui.unmount()

  toasts.length = 0
  bashOut = PASSING
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as any)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.py', old_string: 'a', new_string: 'b' } as any)
  bashOut = FAILING
  await $.tool.call({ tool: 'Bash', command: 'pytest' } as any)
  expect(toasts).toEqual([])
})
