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

const ran: string[] = []
let clock: ReturnType<typeof mock.clock>

async function start($: Engine, on: On) {
  clock = mock.clock(on, { now })
  mock.store(on)
  on('session.usage', () => ({ value: USAGE }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', (_$, e) => { ran.push(e.command); return { text: '' } })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
}

test('graphical band draws meters and toggles compact on press', async ($, on) => {
  await start($, on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    expect((await ui.find({ key: 'toggle' }))?.text).toContain('Hide')
    await ui.press({ key: 'compact' })
    await ui.press({ key: 'clear' })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ key: 'toggle' }))?.text).toContain('Show')
    await ui.press({ key: 'toggle' })
    await ui.unmount()
    expect(ran.splice(0)).toEqual(['compact', 'clear'])
  }
})

test('terminal keeps the text band', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /PLAN/ })).toBeDefined()
  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})

// --- prompt cache warmth ---------------------------------------------------------------

const toasts: string[] = []
let forks = 0

async function warmSession($: Engine, on: On) {
  toasts.length = 0
  forks = 0
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('turn.start', (_$, e) => ({ text: e.text, turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0 } } }
  })
  await start($, on)
}

const finishTurn = async ($: Engine, usage: Record<string, number> = {}) => {
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({
    answer: 'hello', durationMs: 5, isAborted: false, turnId: 't1', reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm', ...usage },
  } as never)
}

test('cache countdown shows, then goes cold, with one toast for each stage', async ($, on) => {
  await warmSession($, on)
  await finishTurn($)
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  let ui = await mount()
  expect(await ui.find({ text: /CACHE/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(4 * 60e3 + 10e3) // 50 s left
  expect(toasts.filter(t => t.includes('goes cold'))).toHaveLength(1)
  await clock.advance(2 * 60e3)
  expect(toasts.filter(t => t.includes('went cold'))).toHaveLength(1)
  await clock.advance(10 * 60e3)
  expect(toasts).toHaveLength(2) // no repeats while idle
  ui = await mount()
  expect(await ui.find({ text: /cold/ })).toBeDefined()
  await ui.unmount()
  expect(forks).toBe(0) // keep-warm is off by default
})

test('a new turn re-arms the alerts', async ($, on) => {
  await warmSession($, on)
  await finishTurn($)
  await clock.advance(6 * 60e3)
  expect(toasts).toHaveLength(2)
  await finishTurn($)
  await clock.advance(6 * 60e3)
  expect(toasts).toHaveLength(4)
})

test('keep-warm pings before the lapse, up to the limit, then alerts', async ($, on) => {
  await warmSession($, on)
  await $.command.run({ command: 'keep-warm', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await finishTurn($)
  await clock.advance(4 * 60e3 + 10e3)
  expect(forks).toBe(1)
  expect(toasts).toEqual([]) // the ping answered, so nothing lapsed
  await clock.advance(4 * 60e3)
  await clock.advance(4 * 60e3)
  expect(forks).toBe(3)
  await clock.advance(4 * 60e3) // out of pings: the notice comes back
  expect(forks).toBe(3)
  expect(toasts.some(t => t.includes('goes cold'))).toBe(true)
})

test('a 1-hour cache write stretches the countdown', async ($, on) => {
  await warmSession($, on)
  await finishTurn($, { cache_creation_input_tokens: 5000, ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 })
  await clock.advance(30 * 60e3)
  expect(toasts).toEqual([])
  await clock.advance(26 * 60e3) // 4 min left, inside the 5 min lead
  expect(toasts.filter(t => t.includes('goes cold'))).toHaveLength(1)
})
