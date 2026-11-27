import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage } from 'claude-code'

import type { DayLog, MonthLog, Snapshot } from '../types'
import { addUsage, bar, cacheAlerts, cacheLeft, compactLine, dayLevels, elapsedFraction, emptyCache, emptyTokens, emptyTrend, endTurn, explain, leadMs, mode, projected, recordDay, recordPing, recordSpend, recordTurn, segments, spentReport, startTurn, suggest, warnings } from './summarize'
import type { Segment } from './summarize'
import { dayTilesSvg, gaugeSvg, iconSvg, mascotSvg, miniMeterSvg, paceSvg, ringSvg, splitSvg, thermometerSvg } from './art'
import type { IconName } from './art'

const snap = atom({ plugin: 'usage-band', key: 'snap' } as const, null)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, emptyTokens)
const trend = atom({ plugin: 'usage-band', key: 'trend' } as const, emptyTrend)
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [] as string[])
const compact = atom({ plugin: 'usage-band', key: 'compact' } as const, false)
const cache = atom({ plugin: 'usage-band', key: 'cache' } as const, emptyCache)
const keepWarm = atom({ plugin: 'usage-band', key: 'keepWarm' } as const, false)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, 0) // bumped by the tick so the countdown redraws
const menuOpen = atom({ plugin: 'usage-band', key: 'menuOpen' } as const, false)
const dismissed = atom({ plugin: 'usage-band', key: 'dismissed' } as const, '') // suggestion key hidden by Later
const weekLog = atom({ plugin: 'usage-band', key: 'weekLog' } as const, null)

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

// The stored day log from an older version or a damaged store reads as no log.
const asDayLog = (v: unknown): DayLog | null => {
  if (!v || typeof v !== 'object') return null
  const { resetsAt, days } = v as { resetsAt?: unknown; days?: unknown }
  if (typeof resetsAt !== 'string' || !days || typeof days !== 'object' || Array.isArray(days)) return null
  return Object.values(days).every(n => typeof n === 'number' && Number.isFinite(n)) ? { resetsAt, days: days as Record<string, number> } : null
}

// The stored month log from an older version or a damaged store reads as no log.
const asMonthLog = (v: unknown): MonthLog | null => {
  if (!v || typeof v !== 'object') return null
  const { month, since, api, plan } = v as Record<string, unknown>
  const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return typeof month === 'string' && typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since) && isMoney(api) && isMoney(plan) ? { month, since, api, plan } : null
}

// The drawn size of an art builder's SVG, read from its root tag.
const size = (svg: string) => {
  const head = svg.slice(0, svg.indexOf('>'))
  return { width: Number(/\swidth="([\d.]+)"/.exec(head)?.[1] ?? 0), height: Number(/\sheight="([\d.]+)"/.exec(head)?.[1] ?? 0) }
}

const ICON_OF: Record<string, 'context' | 'cache' | 'clock' | 'calendar' | 'coin' | 'tokens'> = {
  Context: 'context', Cache: 'cache', Weekly: 'calendar', 'API value': 'coin', Spend: 'coin', Tokens: 'tokens',
}
const LEVEL_HEX = { success: '#3fb950', warning: '#d29922', error: '#f85149' } as const
const MUTED_HEX = '#a3a19a'

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

const closeMenu = ($: EngineInterface) => update($, menuOpen, () => false)

let lastCost: number | null = null // session cost at the last turn's end, so each turn adds only its own cost to the month

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
    await $.command.register({ name: 'spent', description: "Show this month's API spend (or plan usage as API value)" })
    await $.command.register({ name: 'keep-warm', description: 'Keep the prompt cache warm while idle: on, off, or no argument to toggle', argumentHint: '[on|off]' })
    const isCompact = (await $.store.get('compact')) === true
    await update($, compact, () => isCompact)
    const stored = await $.store.get('keepWarm')
    await update($, keepWarm, () => (typeof stored === 'boolean' ? stored : options.keepWarm === true))
    const log = asDayLog(await $.store.get('weekLog'))
    await update($, weekLog, () => log)
    $.clock.every(5000, () => tick($, { maxPings, minTokens }))
    const s = build(await $.session.usage())
    lastCost = s.costUsd
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
    // Monthly spend: this turn's share of the session cost, kept across sessions.
    if (s.costUsd != null) {
      const delta = s.costUsd - (lastCost ?? 0)
      lastCost = s.costUsd
      const log = recordSpend(asMonthLog(await $.store.get('monthLog')), await $.clock.now(), delta, mode(s) === 'plan')
      if (log) await $.store.set('monthLog', log)
    }
    // Weekly day tiles: one sample per local day, taken while the mod runs.
    const week = s.rateLimits.find(x => x.kind === 'seven_day')
    if (week?.resetsAt) {
      const log = recordDay(asDayLog(await $.store.get('weekLog')), await $.clock.now(), week.percentUsed, week.resetsAt)
      await $.store.set('weekLog', log)
      await update($, weekLog, () => log)
    }
    return r
  })

  on('command.run', { command: 'usage-band' }, async $ => ({ text: `Usage band: ${(await toggle($)) ? 'compact' : 'full'}` }))

  on('command.run', { command: 'spent' }, async $ => ({ text: spentReport(asMonthLog(await $.store.get('monthLog')), await $.clock.now()) }))

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
    const now = await $.clock.now()
    const c = await read($, cache)
    const tr = await read($, trend)
    const tok = await read($, tokens)
    const keep = { isOn: await read($, keepWarm), maxPings }
    const segs = segments(s, tok, now, budget, tr, c, keep)

    // Graphical surfaces (desktop, vscode, mobile): mascot, bubble and drawn meters. Terminal keeps the text band below.
    if (e.surface !== 'terminal') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      const art = (source: string, alt: string, isInteractive = false) => <Svg source={source} alt={alt} {...size(source)} isInteractive={isInteractive || undefined} />
      const worst = segs.find(x => x.level === 'error') ?? segs.find(x => x.level === 'warning')
      const tint = (seg: Segment) => (seg.level === 'success' ? undefined : seg.level)
      const caption = (seg: Segment) => <Text dimColor size="caption">{seg.label.toUpperCase()}</Text>
      const value = (seg: Segment) => <Text size="heading" weight="bold" tabular dimColor={seg.isMuted} color={tint(seg)}>{seg.value}</Text>

      // Segments after Context (and Cache, once there is one) are the rate limits, in snapshot order.
      const cacheIdx = segs.findIndex(x => x.label === 'Cache')
      const firstLimit = cacheIdx >= 0 ? 2 : 1
      const limitOf = (i: number) => (i >= firstLimit && i < firstLimit + s.rateLimits.length ? s.rateLimits[i - firstLimit] : undefined)

      const left = cacheLeft(c, now)
      const cacheState = c.active ? 'live' : left != null && left <= 0 ? 'cold' : left != null && left <= leadMs(c.ttlMs) ? 'soon' : 'warm'

      const sug = suggest({ s, now, cache: c, keepWarm: keep.isOn, trend: tr, budgetUsd: budget, dismissed: await read($, dismissed) })
      const mascot = (px: number) => art(mascotSvg(sug.mood, px), `Mascot: ${sug.mood}`, true)

      if (await read($, compact)) {
        const chips = segs.flatMap((seg, i) => {
          const r = limitOf(i)
          if (m === 'usage' ? seg.label !== 'Context' && seg.label !== 'Cache' : m === 'plan' && seg.label === 'Tokens') return []
          const icon = r ? (r.kind === 'seven_day' ? 'calendar' : 'clock') : ICON_OF[seg.label] ?? 'tokens'
          const pct = seg.label === 'Cache' ? (seg.percent == null ? null : 100 - seg.percent) : seg.percent
          const proj = r ? projected(r.percentUsed, r.resetsAt, r.kind, now) : null
          return [
            <Box key={`chip-${seg.label}`} flexDirection="row" alignItems="center" columnGap="xs" paddingX={1} borderStyle="round" borderColor="subtle">
              {art(iconSvg(icon, seg.level === 'success' ? MUTED_HEX : LEVEL_HEX[seg.level]), seg.label)}
              <Text weight="bold" tabular dimColor={seg.isMuted} color={tint(seg)}>{seg.value}</Text>
              {pct != null ? art(miniMeterSvg(pct, seg.level, proj), `${seg.label} ${seg.value}`) : null}
            </Box>,
          ]
        })
        return (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs" paddingX={1}>
            {mascot(32)}
            {chips}
            <Box flexGrow={1} />
            <Button key="show" variant="secondary" onPress={() => toggle($)}>Show</Button>
          </Box>
        )
      }

      const actionLabel = sug.action === 'compact' ? 'Compact now' : left != null && left <= 0 ? 'Turn on keep-warm' : 'Keep it warm'
      const doAction = sug.action === 'compact' ? () => void $.command.run({ command: 'compact' }) : () => setKeepWarm($, true)
      const isMenuOpen = await read($, menuOpen)
      const weekLog_ = await read($, weekLog)

      const head = (
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {m === 'usage'
            ? <Text bold dimColor>Usage</Text>
            : <Text bold color={m === 'plan' ? 'claude' : 'suggestion'}>{m === 'plan' ? 'Plan usage' : 'API usage'}</Text>}
          {worst ? <Text color={worst.level}>●</Text> : null}
          <Box flexGrow={1} />
          <Button key="menu" variant="secondary" onPress={() => update($, menuOpen, o => !o)}>⋯</Button>
        </Box>
      )

      // A dropdown under ⋯, drawn over the segments. The band grows to hold it while open,
      // since a placed Box is clipped by the band. void: command.run is queued until idle.
      const item = (key: string, icon: IconName, label: string, onPress: () => unknown, aside?: RenderChildren) => (
        <Box key={`row-${key}`} flexDirection="row" alignItems="center" columnGap="sm">
          {art(iconSvg(icon, MUTED_HEX), label)}
          <Button key={key} plain onPress={onPress}>{label}</Button>
          <Box flexGrow={1} />
          {aside ?? null}
        </Box>
      )
      const ctxSeg = segs.find(x => x.label === 'Context')
      const menu = isMenuOpen
        ? (
          <Box key="dropdown" position="absolute" top={2} right={1} flexDirection="column" rowGap="xs" minWidth={30}
            paddingX={1} paddingY="xs" borderStyle="round" borderColor="subtle" backgroundColor="rgba(40,40,38,0.98)">
            {item('m-compact', 'context', 'Compact conversation', async () => { void $.command.run({ command: 'compact' }); await closeMenu($) },
              ctxSeg ? <Text size="caption" color={tint(ctxSeg)} dimColor={!tint(ctxSeg)}>{ctxSeg.value}</Text> : null)}
            {item('m-clear', 'trash', 'Clear conversation', async () => { void $.command.run({ command: 'clear' }); await closeMenu($) })}
            {item('m-warm', 'cache', 'Keep cache warm', () => setKeepWarm($, !keep.isOn),
              <Text size="caption" weight="bold" color={keep.isOn ? 'warning' : undefined} dimColor={!keep.isOn}>{keep.isOn ? 'on' : 'off'}</Text>)}
            {item('m-refresh', 'refresh', 'Refresh numbers', async () => { const fresh = build(await $.session.usage()); await update($, snap, () => fresh); await closeMenu($) })}
            {item('m-hide', 'collapse', 'Collapse band', async () => { await closeMenu($); await toggle($) })}
          </Box>
        )
        : null

      const bubble = (
        <Box key="bubble" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs" flexShrink={1}
          paddingX={1} paddingY="xs" borderStyle="round" borderColor="subtle" backgroundColor="rgba(139,148,158,0.15)">
          <Text>{sug.text}</Text>
          {sug.action ? <Button key="act" variant="primary" onPress={doAction}>{actionLabel}</Button> : null}
          {sug.action ? <Button key="later" variant="secondary" dimColor onPress={() => update($, dismissed, () => sug.key)}>Later</Button> : null}
        </Box>
      )

      // Every segment gets an equal share of one row. Under its picture, plain words (explain):
      // the main line at full strength, the rest dim, each wrapping within the column.
      const xin = { s, t: tok, now, cache: c, keepWarm: keep.isOn, trend: tr, budgetUsd: budget }
      const words = (seg: Segment) => {
        const lines = explain(seg, xin)
        return (
          <Box key="words" flexDirection="column" alignItems="center">
            {lines.map((l, i) => <Text key={`w${i}`} size="footnote" wrap="wrap" dimColor={i > 0} color={i === 0 ? tint(seg) : undefined}>{l}</Text>)}
          </Box>
        )
      }
      const col = (seg: Segment, ...kids: RenderChildren[]) => (
        <Box key={seg.label} flexDirection="column" alignItems="center" rowGap="xs" flexGrow={1} flexShrink={1} minWidth={0}>{caption(seg)}{kids}<Box key="push" flexGrow={1} />{words(seg)}</Box>
      )
      const said = (seg: Segment) => explain(seg, xin).join('. ')
      const segView = (seg: Segment, i: number) => {
        const r = limitOf(i)
        if (seg.label === 'Context')
          return col(seg, art(ringSvg(s.contextPercent, seg.level, 44), `Context ${seg.value}: ${said(seg)}`))
        if (seg.label === 'Cache')
          return col(seg,
            <Box flexDirection="row" alignItems="center" columnGap="sm">
              {art(thermometerSvg(left == null ? null : left / c.ttlMs, cacheState, 44), `Cache ${seg.value}: ${said(seg)}`, cacheState === 'live')}
              {value(seg)}
            </Box>)
        if (r && r.kind === 'seven_day')
          return col(seg, value(seg),
            r.resetsAt ? art(dayTilesSvg(dayLevels(weekLog_, now, r.resetsAt), 12), 'Weekly use per day') : null)
        if (r)
          return col(seg, value(seg),
            art(paceSvg(r.percentUsed, projected(r.percentUsed, r.resetsAt, r.kind, now), elapsedFraction(r.resetsAt, r.kind, now), seg.level, 120), `${seg.label} ${seg.value}: ${said(seg)}`))
        if (seg.label === 'Spend' && seg.percent != null)
          return col(seg,
            <Box flexDirection="row" alignItems="center" columnGap="sm">
              {art(gaugeSvg(seg.percent, 56), `Spend ${seg.percent}% of budget`)}
              {value(seg)}
            </Box>)
        if (seg.label === 'Tokens')
          return col(seg, value(seg), art(splitSvg(tok, 120), 'Token split: cache reads, new input, output'))
        return col(seg, value(seg))
      }

      // The mascot stands on the card's top edge: placed over the band's own first rows,
      // where the bubble sits beside it, so nothing it draws falls outside the band.
      return (
        <Box flexDirection="column" position="relative">
          <Box flexDirection="row" alignItems="flex-end" paddingLeft={9} minHeight={3}>{bubble}</Box>
          <Box flexDirection="column" rowGap="sm" paddingX={1} paddingY={1} borderStyle="round" borderColor="subtle" minHeight={isMenuOpen ? 13 : undefined}>
            {head}
            <Box flexDirection="row" flexWrap="nowrap" alignItems="stretch" columnGap="md">
              {segs.map(segView)}
            </Box>
            {menu}
          </Box>
          <Box position="absolute" top={1} left={1}>{mascot(64)}</Box>
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
