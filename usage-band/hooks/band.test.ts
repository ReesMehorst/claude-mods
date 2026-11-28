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
// A calm plan: limits well under pace, context at 30%, and a weekly window.
const CALM = {
  ...USAGE,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-18T14:30:00Z' },
    { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-22T00:00:00Z' },
  ],
} as unknown as SessionUsage
const FULL = { ...CALM, context: { percent: 70, tokens: 140000, window: 200000 } } as unknown as SessionUsage
const API = { ...USAGE, rateLimits: [], cost: { usd: 3 } } as unknown as SessionUsage

const ran: string[] = []
let clock: ReturnType<typeof mock.clock>
let sessionId = 'chat-a' // which chat the session is in; a test moves it to switch chats, as /clear or a resume does

// A Map stands as the store itself, so a test can read back what the band wrote.
async function start($: Engine, on: On, usage: SessionUsage = USAGE, store?: Record<string, unknown> | Map<string, unknown>) {
  ran.length = 0
  sessionId = 'chat-a'
  clock = mock.clock(on, { now })
  on('session.id', () => ({ value: sessionId }))
  if (store instanceof Map) {
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
  } else mock.store(on, store)
  on('session.usage', () => ({ value: usage }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.run', (_$, e) => { ran.push(e.command); return { text: '' } })
  await $.session.start({ cwd: '/', surface: null, isInteractive: true })
}

const mountOn = ($: Engine, surface: 'desktop' | 'vscode' | 'mobile' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: PROPS })
type Mounted = Awaited<ReturnType<typeof mountOn>>
const alts = async (ui: Mounted) => (await ui.findAll({ type: 'Svg' })).map(x => String(x.props.alt))

test('graphical band draws the mascot, its bubble and the segment visuals', async ($, on) => {
  await start($, on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await mountOn($, surface)
    const svgs = await ui.findAll({ type: 'Svg' })
    const mascot = svgs.find(x => String(x.props.alt).startsWith('Mascot'))
    expect(mascot?.props.alt).toBe('Mascot: pace') // 60% at half the 5h window is on pace for 120%
    expect(mascot?.props.isInteractive).toBe(true)
    expect(await ui.find({ type: 'Text', text: /At this pace the 5h limit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Plan usage' })).toBeDefined()
    expect(svgs.some(x => String(x.props.alt).startsWith('Context'))).toBe(true)
    expect(svgs.some(x => String(x.props.alt).startsWith('5h limit'))).toBe(true)
    expect(await ui.find({ key: 'act' })).toBeUndefined() // pace has no action
    await ui.unmount()
  }
})

test('the compact action runs /compact, and Later hides it', async ($, on) => {
  await start($, on, FULL)
  const ui = await mountOn($)
  expect(await ui.find({ type: 'Text', text: /Context is at 70%/ })).toBeDefined()
  expect((await ui.find({ key: 'act' }))?.text).toContain('Compact now')
  await ui.press({ key: 'act' })
  expect(ran).toEqual(['compact'])
  await ui.press({ key: 'later' })
  expect(await ui.find({ key: 'act' })).toBeUndefined()
  expect(await ui.find({ key: 'later' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Context is at 70%/ })).toBeDefined() // still says it
  await ui.unmount()
})

test('the keep action turns keep-warm on', async ($, on) => {
  await warmSession($, on, CALM)
  await finishTurn($)
  await clock.advance(4 * 60e3 + 10e3) // 50 s left
  const ui = await mountOn($)
  expect((await ui.find({ key: 'act' }))?.text).toContain('Keep it warm')
  expect(await alts(ui)).toContain('Mascot: soon')
  await ui.press({ key: 'act' })
  expect(await alts(ui)).toContain('Mascot: keep')
  expect(await ui.find({ key: 'act' })).toBeUndefined()
  await ui.press({ key: 'menu' })
  expect((await ui.find({ key: 'm-warm' }))?.text).toContain('Keep cache warm')
  expect(await ui.find({ type: 'Text', text: 'on' })).toBeDefined() // the dropdown row's state
  await ui.unmount()
})

test('a cold cache offers to turn keep-warm on', async ($, on) => {
  await warmSession($, on, CALM)
  await finishTurn($)
  await clock.advance(6 * 60e3)
  const ui = await mountOn($)
  expect((await ui.find({ key: 'act' }))?.text).toContain('Turn on keep-warm')
  expect(await alts(ui)).toContain('Mascot: cold')
  await ui.unmount()
})

test('⋯ toggles the action row, whose buttons run and close it', async ($, on) => {
  await start($, on, CALM)
  const ui = await mountOn($)
  expect(await ui.find({ key: 'm-compact' })).toBeUndefined()
  // No label of its own: the desktop draws a label in place of the text, so it must stay ⋯.
  expect((await ui.find({ key: 'menu' }))?.props.label).toBe('⋯')
  await ui.press({ key: 'menu' })
  for (const k of ['m-compact', 'm-clear', 'm-warm', 'm-refresh', 'm-hide']) expect(await ui.find({ key: k })).toBeDefined()
  await ui.press({ key: 'm-compact' })
  expect(await ui.find({ key: 'm-compact' })).toBeUndefined()
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'm-clear' })
  expect(ran).toEqual(['compact', 'clear'])
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'menu' })
  expect(await ui.find({ key: 'm-clear' })).toBeUndefined()
  await ui.unmount()
})

test('Hide shows chips with the mascot in its current mood, Show brings the band back', async ($, on) => {
  await start($, on, CALM)
  const ui = await mountOn($)
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'm-hide' })
  const a = await alts(ui)
  expect(a).toContain('Mascot: warm')
  expect(a).not.toContain('Mascot: nap')
  expect(a.filter(x => x === 'Context' || x === '5h limit' || x === 'Weekly' || x === 'API value')).toHaveLength(4) // chip icons
  expect(a).not.toContain('Tokens') // no token chip on a plan
  expect(await ui.find({ key: 'm-hide' })).toBeUndefined()
  await ui.press({ key: 'show' })
  expect(await alts(ui)).toContain('Mascot: warm')
  await ui.unmount()
})

test('api mode draws the spend gauge and no pace bars or day tiles', { options: { budgetUsd: 10 } }, async ($, on) => {
  await start($, on, API)
  const ui = await mountOn($)
  expect(await ui.find({ type: 'Text', text: 'API usage' })).toBeDefined()
  const a = await alts(ui)
  expect(a).toContain('Spend 30% of budget')
  expect(a.some(x => x.startsWith('5h limit') || x === 'Weekly use per day')).toBe(false)
  await ui.unmount()
})

test('plan mode draws the 5h pace bar and weekly day tiles, and no gauge', async ($, on) => {
  await start($, on, CALM, { weekLog: 'garbage from an old version' })
  const ui = await mountOn($)
  const a = await alts(ui)
  expect(a).toContain('Weekly use per day')
  expect(a.some(x => x.startsWith('5h limit'))).toBe(true)
  expect(a.some(x => x.startsWith('Weekly 20%'))).toBe(false) // weekly shows day tiles, not a bar
  expect(a.some(x => x.startsWith('Spend'))).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'API value'.toUpperCase() })).toBeDefined()
  await ui.unmount()
})

test('a main turn samples the weekly limit into the store', async ($, on) => {
  const kept = new Map<string, unknown>()
  await warmSession($, on, CALM, kept)
  await finishTurn($)
  expect(kept.get('weekLog')).toEqual({ resetsAt: '2026-10-22T00:00:00Z', days: { '2026-10-18': 20 } })
})

test('turns add their own cost to the month', async ($, on) => {
  const kept = new Map<string, unknown>()
  const usage = { ...API, cost: { usd: 3 } } as unknown as SessionUsage & { cost: { usd: number } }
  await warmSession($, on, usage, kept)
  usage.cost.usd = 5 // the session had $3 when it started: only the $2 since counts
  await finishTurn($)
  usage.cost.usd = 5.5
  await finishTurn($)
  expect(kept.get('monthLog')).toEqual({ month: '2026-10', since: '2026-10-18', api: 2.5, plan: 0 })
})

test('terminal keeps the text band', async ($, on) => {
  await start($, on)
  const ui = await mountOn($, 'terminal')
  expect(await ui.find({ text: /PLAN/ })).toBeDefined()
  expect(await ui.find({ key: 'menu' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// --- prompt cache warmth ---------------------------------------------------------------

const toasts: string[] = []
let forks = 0

const HIT = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0 }
const MISS = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 60000 }

async function warmSession($: Engine, on: On, usage: SessionUsage = USAGE, store?: Map<string, unknown>, forkUsage = HIT) {
  toasts.length = 0
  forks = 0
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('turn.start', (_$, e) => ({ text: e.text, turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'ok', usage: forkUsage } }
  })
  await start($, on, usage, store)
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
const keepWarmOn = ($: Engine) =>
  $.command.run({ command: 'keep-warm', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('a ping that had to re-cache stops the pings until a real turn', async ($, on) => {
  await warmSession($, on, USAGE, undefined, MISS)
  await keepWarmOn($)
  await finishTurn($)
  await clock.advance(4 * 60e3 + 10e3)
  expect(forks).toBe(1)
  await clock.advance(20 * 60e3)
  expect(forks).toBe(1) // the cache was cold: no more paying to re-cache it
  await finishTurn($)
  await clock.advance(4 * 60e3 + 10e3)
  expect(forks).toBe(2)
})

test('a cold chat with keep-warm on is never pinged', async ($, on) => {
  await warmSession($, on)
  await finishTurn($)
  await clock.advance(6 * 60e3) // went cold with keep-warm off
  await keepWarmOn($)
  await clock.advance(30 * 60e3)
  expect(forks).toBe(0)
})

test('opening the chat holds the ping for one tick, to decide with fresh time', async ($, on) => {
  await warmSession($, on)
  await keepWarmOn($)
  await finishTurn($)
  await clock.advance(3 * 60e3 + 55e3) // 65 s left: not due yet
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.advance(5e3) // due now, but the chat was just opened
  expect(forks).toBe(0)
  await clock.advance(5e3)
  expect(forks).toBe(1)
})

test('keep-warm belongs to the chat it was turned on in', async ($, on) => {
  const kept = new Map<string, unknown>()
  await warmSession($, on, CALM, kept)
  await keepWarmOn($)
  const warmIn = async (id: string) => {
    sessionId = id
    await clock.advance(5e3) // the tick fills a new chat's numbers
    const ui = await mountOn($)
    await ui.press({ key: 'menu' })
    const isOn = (await ui.find({ type: 'Text', text: 'on' })) !== undefined
    await ui.unmount()
    return isOn
  }
  expect(await warmIn('chat-b')).toBe(false)
  expect(await warmIn('chat-a')).toBe(true)
  expect(Object.keys(kept.get('keepWarmChats') as object)).toEqual(['chat-a'])
})

test('tokens and API value belong to the chat', async ($, on) => {
  await warmSession($, on, API)
  await finishTurn($, { input_tokens: 5000 })
  let ui = await mountOn($)
  expect((await alts(ui)).some(x => x.startsWith('Token split'))).toBe(true)
  await ui.unmount()
  sessionId = 'chat-b'
  await clock.advance(5e3)
  ui = await mountOn($)
  expect((await alts(ui)).some(x => x.startsWith('Token split'))).toBe(false) // nothing spent here yet
  await ui.unmount()
})

test('account limits are shared: a new chat shows what another chat saw', async ($, on) => {
  const kept = new Map<string, unknown>([['limits', CALM.rateLimits]])
  await start($, on, { ...CALM, rateLimits: [], cost: { usd: 0 } } as unknown as SessionUsage, kept)
  const ui = await mountOn($)
  expect(await ui.find({ type: 'Text', text: 'Plan usage' })).toBeDefined()
  const a = await alts(ui)
  expect(a.some(x => x.startsWith('5h limit'))).toBe(true)
  expect(a).toContain('Weekly use per day')
  await ui.unmount()
})

test('a chat saves the limits it hears for the others', async ($, on) => {
  const kept = new Map<string, unknown>()
  await start($, on, CALM, kept)
  expect(kept.get('limits')).toEqual(CALM.rateLimits)
})

// --- proxy keep-warm ------------------------------------------------------------------------

type Fetched = { url: string; method: string; body: unknown }
const proxyWorld = { isUp: true, chat: { on: true, at: null as number | null, ttlMs: null as number | null, pings: 0, pingsLeft: 3, missed: false, stopped: false } }
const fetched: Fetched[] = []
const envSet: { name: string; value?: string }[] = []
const launched: string[][] = []

async function proxySession($: Engine, on: On, opts: { base?: string } = {}) {
  fetched.length = envSet.length = launched.length = 0
  proxyWorld.isUp = true
  proxyWorld.chat = { on: true, at: null, ttlMs: null, pings: 0, pingsLeft: 3, missed: false, stopped: false }
  const env = new Map<string, string | undefined>([['ANTHROPIC_BASE_URL', opts.base ?? 'https://api.anthropic.com']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => { envSet.push({ name: e.name, value: e.value }); env.set(e.name, e.value); return { value: {} } })
  on('process.run', (_$, e) => { launched.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('http.fetch', (_$, e) => {
    const body = typeof e.init?.body === 'string' ? JSON.parse(e.init.body) : undefined
    fetched.push({ url: e.url, method: e.init?.method ?? 'GET', body })
    if (!proxyWorld.isUp) throw new Error('ECONNREFUSED')
    const path = new URL(e.url).pathname
    const value = path === '/_kw/health' ? { ok: true } : path.startsWith('/_kw/chat/') ? { ...proxyWorld.chat, on: body?.on ?? proxyWorld.chat.on } : {}
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(value) } }
  })
  await warmSession($, on, USAGE)
}
const routedTo = () => envSet.filter(x => x.name === 'ANTHROPIC_BASE_URL').at(-1)?.value

test('proxy keep-warm routes the chat through the proxy once it answers', { options: { proxyKeepWarm: true } }, async ($, on) => {
  await proxySession($, on)
  expect(routedTo()).toBe('http://127.0.0.1:8787')
  expect(envSet.some(x => x.name === 'CLAUDE_CODE_GATEWAY_HINT_HEADERS' && x.value === '1')).toBe(true)
  expect(fetched.some(f => f.url.endsWith('/_kw/options'))).toBe(true)
  expect(launched).toEqual([]) // it was already running
  await keepWarmOn($)
  await clock.advance(5e3)
  expect(fetched.filter(f => f.url.endsWith('/_kw/chat/chat-a')).at(-1)?.body).toEqual({ on: true })
})

test('proxy keep-warm starts the proxy when it is not running, and routes only once it answers', { options: { proxyKeepWarm: true, proxyPort: 8799 } }, async ($, on) => {
  proxyWorld.isUp = false
  fetched.length = envSet.length = launched.length = 0
  const env = new Map<string, string | undefined>([['ANTHROPIC_BASE_URL', 'https://api.anthropic.com']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => { envSet.push({ name: e.name, value: e.value }); return { value: {} } })
  on('process.run', (_$, e) => { launched.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('http.fetch', (_$, e) => {
    if (!proxyWorld.isUp) throw new Error('ECONNREFUSED')
    return { value: { status: 200, ok: true, headers: {}, text: e.url.includes('/_kw/chat/') ? JSON.stringify(proxyWorld.chat) : '{"ok":true}' } }
  })
  await warmSession($, on, USAGE)
  expect(launched).toHaveLength(1)
  expect(launched[0]!.join(' ')).toMatch(/proxy[\/]keepwarm-proxy\.mjs --launch --port 8799$/)
  expect(envSet).toEqual([]) // not routed while nothing answers
  proxyWorld.isUp = true
  await clock.advance(5e3)
  expect(envSet.find(x => x.name === 'ANTHROPIC_BASE_URL')?.value).toBe('http://127.0.0.1:8799')
})

test('a proxy that stops answering hands the chat back to the API and says so', { options: { proxyKeepWarm: true } }, async ($, on) => {
  await proxySession($, on)
  expect(routedTo()).toBe('http://127.0.0.1:8787')
  proxyWorld.isUp = false
  await clock.advance(5e3)
  expect(routedTo()).toBe('http://127.0.0.1:8787') // one miss may be a blip
  await clock.advance(5e3)
  expect(routedTo()).toBe(undefined)
  expect(toasts.some(t => t.includes('talks to the API directly'))).toBe(true)
  expect(launched).toHaveLength(1) // and tries to start it again
})

test('a gateway someone set up is left alone', { options: { proxyKeepWarm: true } }, async ($, on) => {
  await proxySession($, on, { base: 'https://gateway.example' })
  expect(fetched).toEqual([])
  expect(envSet).toEqual([])
  expect(launched).toEqual([])
})

test('while the proxy covers the chat, the chat pings no more itself and follows the proxy', { options: { proxyKeepWarm: true } }, async ($, on) => {
  await proxySession($, on)
  await keepWarmOn($)
  await finishTurn($)
  await clock.advance(4 * 60e3 + 10e3) // in the lead window
  expect(forks).toBe(0)
  expect(toasts.filter(t => t.includes('goes cold'))).toEqual([]) // the proxy will ping
  // The proxy pinged: the countdown starts again from there.
  proxyWorld.chat = { ...proxyWorld.chat, at: clock.now(), ttlMs: 300e3, pings: 1, pingsLeft: 2 }
  await clock.advance(5e3)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /keep-warm via proxy 1\/3/ })).toBeDefined()
  expect(await ui.find({ text: /\b5m\b|4m/ })).toBeDefined()
  await ui.unmount()
})
