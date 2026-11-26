import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Snapshot } from '../types'
import { addUsage, bar, barSvg, cacheAlerts, cacheLeft, compactLine, emptyCache, emptyTokens, emptyTrend, endTurn, leadMs, mode, recordPing, recordTurn, segments, startTurn, warnings } from './summarize'

const snap = atom({ plugin: 'usage-band', key: 'snap' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, emptyTokens)
const trend = atom({ plugin: 'usage-band', key: 'trend' } as const, emptyTrend)
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [] as string[])
const compact = atom({ plugin: 'usage-band', key: 'compact' } as const, false)
const cache = atom({ plugin: 'usage-band', key: 'cache' } as const, emptyCache)
const keepWarm = atom({ plugin: 'usage-band', key: 'keepWarm' } as const, false)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, 0) // bumped by the tick so the countdown redraws

// A fork re-reads the cached transcript, which renews its lifetime; no tools, no thinking, one word back.
const PING = 'Cache keep-alive ping. You have no tools here. Reply with the single word "ok" straight away, without thinking it over.'

const build = (u: SessionUsage): Snapshot => ({
  contextPercent: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  contextWindow: u.context.window,
  costUsd: u.cost?.usd ?? null,
  startedAt: u.startedAt,
  rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
})

async function toggle($: EngineInterface) {
  const isCompact = !(await read($, compact))
  await $.store.set('compact', isCompact)
  await update($, compact, () => isCompact)
  return isCompact
}

async function setKeepWarm($: EngineInterface, isOn: boolean) {
  await $.store.set('keepWarm', isOn)
  await update($, keepWarm, () => isOn)
  return isOn
}

let isPinging = false // a keep-warm fork is out; its own events must not count as a turn

type CacheOptions = { maxPings: number; minTokens: number }

// Every 5 s: redraw the countdown, send a keep-warm ping when one is due, else toast the cold warnings.
async function tick($: EngineInterface, { maxPings, minTokens }: CacheOptions) {
  const now = await $.clock.now()
  const c = await read($, cache)
  const left = cacheLeft(c, now)
  if (left == null) return
  await update($, pulse, n => n + 1)
  const ctx = (await read($, snap))?.contextTokens ?? null
  const willPing = (await read($, keepWarm)) && c.pings < maxPings && (ctx ?? 0) >= minTokens
  if (willPing && !isPinging && left > 0 && left <= leadMs(c.ttlMs)) {
    isPinging = true
    let isAnswered = false
    try { isAnswered = (await $.model.fork({ prompt: PING })).isAnswered } catch { /* counts as a failed ping */ }
    const at = await $.clock.now()
    await update($, cache, x => recordPing(x, at, isAnswered))
    isPinging = false
    return
  }
  const fresh = cacheAlerts(c, now, ctx, minTokens, willPing).filter(a => !c.alerted.includes(a.key))
  for (const a of fresh) $.ui.toast(`🧊 ${a.text}`, { timeoutMs: 10000 })
  if (fresh.length) await update($, cache, x => ({ ...x, alerted: [...x.alerted, ...fresh.map(a => a.key)] }))
}

export const register: Register = (on, options) => {
  const budget = Number(options.budgetUsd ?? 0)
  const turnWarn = Number(options.turnWarnUsd ?? 0)
  const maxPings = Math.max(0, Math.floor(Number(options.keepWarmMaxPings ?? 3)))
  const minTokens = Math.max(0, Number(options.coldMinTokens ?? 20000))
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'usage-band', description: 'Toggle the usage band between full and compact' })
    await $.command.register({ name: 'keep-warm', description: 'Keep the prompt cache warm while idle: on, off, or no argument to toggle', argumentHint: '[on|off]' })
    const isCompact = (await $.store.get('compact')) === true
    await update($, compact, () => isCompact)
    const stored = await $.store.get('keepWarm')
    await update($, keepWarm, () => (typeof stored === 'boolean' ? stored : options.keepWarm === true))
    $.clock.every(5000, () => tick($, { maxPings, minTokens }))
    const s = build(await $.session.usage())
    await update($, snap, () => s)
    return r
  })

  on('session.measure', async ($, e, next) => {
    const s = build(await $.session.usage())
    await update($, snap, () => s)
    const seen = await read($, warned)
    const fresh = warnings(s, await $.clock.now(), budget, await read($, trend)).filter(w => !seen.includes(w.key))
    for (const w of fresh) $.ui.toast(`⚠ ${w.text}`, { timeoutMs: 8000 })
    if (fresh.length) await update($, warned, ks => [...ks, ...fresh.map(w => w.key)])
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId && !isPinging) {
      const at = await $.clock.now()
      await update($, cache, c => startTurn(c, at))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && !isPinging) {
      const at = await $.clock.now()
      await update($, cache, c => endTurn(c, at, e.usage))
    }
    const u = e.usage
    if (u) await update($, tokens, t => addUsage(t, u))
    if (e.agentId) return r // ponytail: subagent turns would skew context growth
    const s = build(await $.session.usage())
    const t = await update($, trend, t => recordTurn(t, s.costUsd, s.contextTokens))
    if (mode(s) === 'api' && turnWarn > 0 && (t.lastTurnUsd ?? 0) >= turnWarn)
      $.ui.toast(`⚠ That turn cost $${t.lastTurnUsd!.toFixed(2)}`, { timeoutMs: 8000 })
    return r
  })

  on('command.run', { command: 'usage-band' }, async $ => ({ text: `Usage band: ${(await toggle($)) ? 'compact' : 'full'}` }))

  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    const isOn = await setKeepWarm($, arg === 'on' ? true : arg === 'off' ? false : !(await read($, keepWarm)))
    return { text: isOn ? `Keep-warm on: pings the cache up to ${maxPings}× while idle (billed as cache reads)` : 'Keep-warm off: you will get an alert when the cache goes cold' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (s === null || e.props.hasSurvey) return next(e)
    const m = mode(s)
    await read($, pulse) // subscribe: the tick redraws the cache countdown
    const keep = { isOn: await read($, keepWarm), maxPings }
    const segs = segments(s, await read($, tokens), await $.clock.now(), budget, await read($, trend), await read($, cache), keep)

    // Graphical surfaces (desktop, vscode, mobile): meters + buttons. Terminal keeps the text band below.
    if (e.surface !== 'terminal') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const isCompact = await read($, compact)
      const worst = segs.find(x => x.level === 'error') ?? segs.find(x => x.level === 'warning')
      const toggleBtn = (
        <Button key="toggle" variant="secondary" onPress={() => toggle($)}>{isCompact ? 'Show' : 'Hide'}</Button>
      )
      const head = (
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          <Text bold color={m === 'plan' ? 'claude' : 'suggestion'}>{m === 'plan' ? 'Plan usage' : 'API usage'}</Text>
          {worst ? <Text color={worst.level}>●</Text> : null}
          <Box flexGrow={1} />
          {/* void: command.run is queued until the session is idle */}
          <Button key="clear" variant="secondary" onPress={() => void $.command.run({ command: 'clear' })}>/clear</Button>
          <Button key="compact" variant="secondary" onPress={() => void $.command.run({ command: 'compact' })}>/compact</Button>
          <Button key="warm" variant="secondary" onPress={() => setKeepWarm($, !keep.isOn)}>{keep.isOn ? 'Keep warm: on' : 'Keep warm: off'}</Button>
          <Button key="refresh" variant="secondary" onPress={async () => { const fresh = build(await $.session.usage()); await update($, snap, () => fresh) }}>Refresh</Button>
          {toggleBtn}
        </Box>
      )
      if (isCompact) {
        return (
          <Box flexDirection="row" alignItems="center" columnGap="sm" paddingX={1}>
            <Text bold color={m === 'plan' ? 'claude' : 'suggestion'}>{m.toUpperCase()}</Text>
            <Text dimColor wrap="truncate-end">{compactLine(m, segs).slice(m.length + 3)}</Text>
            <Box flexGrow={1} />
            {toggleBtn}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" rowGap="sm" paddingX={1} paddingY={1} borderStyle="round" borderColor="subtle">
          {head}
          <Box flexDirection="row" flexWrap="wrap" columnGap="lg" rowGap="md">
            {segs.map(seg => {
              const tint = seg.level === 'success' ? undefined : seg.level
              return (
                <Box key={seg.label} flexDirection="column" minWidth={20} rowGap="xs">
                  <Text dimColor size="caption">{seg.label.toUpperCase()}</Text>
                  <Text size="heading" weight="bold" tabular dimColor={seg.isMuted} color={tint}>{seg.value}</Text>
                  {seg.percent != null
                    ? <Svg source={barSvg(seg.percent, seg.level)} alt={`${seg.label} ${seg.value}`} width={120} height={6} />
                    : null}
                  <Text dimColor size="caption" color={tint}>{seg.detail || ' '}</Text>
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const badge = <Text inverse bold color={m === 'plan' ? 'claude' : 'suggestion'}>{` ${m.toUpperCase()} `}</Text>

    if (await read($, compact)) {
      const worst = segs.find(x => x.level === 'error') ?? segs.find(x => x.level === 'warning')
      return (
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          {badge}
          <Text dimColor wrap="truncate-end">{compactLine(m, segs).slice(m.length + 3)}</Text>
          {worst ? <Text color={worst.level}>●</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1} alignItems="flex-start"
        borderStyle="round" borderColor="subtle" paddingX={1}>
        <Box flexDirection="column">
          {badge}
          <Text dimColor size="caption">/usage-band</Text>
        </Box>
        {segs.map(seg => {
          const tint = seg.level === 'success' ? undefined : seg.level
          const [full, rest] = seg.percent != null ? bar(seg.percent) : ['', '']
          return (
            <Box key={seg.label} flexDirection="column" minWidth={14}>
              <Text dimColor size="caption">{seg.label.toUpperCase()}</Text>
              <Text>
                <Text weight="bold" tabular dimColor={seg.isMuted} color={tint}>{seg.value}</Text>
                {seg.percent != null ? <Text> <Text color={seg.level}>{full}</Text><Text dimColor>{rest}</Text></Text> : null}
              </Text>
              <Text dimColor size="caption" color={tint}>{seg.detail || ' '}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
