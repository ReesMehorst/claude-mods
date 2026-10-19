import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionUsage } from 'claude-code'

const now = Date.parse('2026-10-18T12:00:00Z')
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20 } as RenderPropsOf['AbovePrompt']
const USAGE = {
  startedAt: now - 3600e3,
  context: { percent: 30, tokens: 60000, window: 200000 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 60, resetsAt: '2026-10-18T14:30:00Z' }],
  cost: { usd: 2 },
} as unknown as SessionUsage

async function start($: Engine, on: On) {
  mock.clock(on, { now })
  mock.store(on)
  on('session.usage', () => ({ value: USAGE }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
}

test('graphical band draws meters and toggles compact on press', async ($, on) => {
  await start($, on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ key: 'toggle' }))?.text).toContain('Expand')
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }
})

test('terminal keeps the text band', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /PLAN/ })).toBeDefined()
  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})
