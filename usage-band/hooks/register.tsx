import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { Snapshot } from '../types'
import { addUsage, bar, compactLine, emptyTokens, mode, segments, warnings } from './summarize'

const snap = atom({ plugin: 'usage-band', key: 'snap' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, emptyTokens)
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

export const register: Register = (on, options) => {
  const budget = Number(options.budgetUsd ?? 0)

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
    const fresh = warnings(s, await $.clock.now(), budget).filter(w => !seen.includes(w.key))
    for (const w of fresh) $.ui.toast(`⚠ ${w.text}`, { timeoutMs: 8000 })
    if (fresh.length) await update($, warned, ks => [...ks, ...fresh.map(w => w.key)])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = e.usage
    if (u) await update($, tokens, t => addUsage(t, u))
    return r
  })

  on('command.run', { command: 'usage-band' }, async $ => {
    const isCompact = !(await read($, compact))
    await $.store.set('compact', isCompact)
    await update($, compact, () => isCompact)
    return { text: `Usage band: ${isCompact ? 'compact' : 'full'}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (s === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const m = mode(s)
    const segs = segments(s, await read($, tokens), await $.clock.now(), budget)
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
