import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Snapshot } from '../types'
import { addUsage, bar, barSvg, compactLine, emptyTokens, emptyTrend, mode, recordTurn, segments, warnings } from './summarize'

const snap = atom({ plugin: 'usage-band', key: 'snap' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, emptyTokens)
const trend = atom({ plugin: 'usage-band', key: 'trend' } as const, emptyTrend)
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [] as string[])
const compact = atom({ plugin: 'usage-band', key: 'compact' } as const, false)

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

export const register: Register = (on, options) => {
  const budget = Number(options.budgetUsd ?? 0)
  const turnWarn = Number(options.turnWarnUsd ?? 0)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'usage-band', description: 'Toggle the usage band between full and compact' })
    const isCompact = (await $.store.get('compact')) === true
    await update($, compact, () => isCompact)
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

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (s === null || e.props.hasSurvey) return next(e)
    const m = mode(s)
    const segs = segments(s, await read($, tokens), await $.clock.now(), budget, await read($, trend))

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
