import type { Snapshot, Tokens } from '../types'

export type Mode = 'plan' | 'api'
export type Level = 'success' | 'warning' | 'error'
export type Segment = {
  label: string
  value: string
  detail: string
  short: string // compact-line form
  percent: number | null
  level: Level
  isMuted?: boolean
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }
const LABEL: Record<string, string> = { five_hour: '5h limit', seven_day: 'Weekly', spend_limit: 'Spend limit' }
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'limit' }

export const emptyTokens: Tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }

export const num = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

// Local wall-clock HH:MM; adds the weekday when it is not today.
export const clock = (ms: number, now: number) => {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${hm}`
}

const level = (p: number, warn: number, err: number): Level => (p >= err ? 'error' : p >= warn ? 'warning' : 'success')

export const mode = (s: Snapshot): Mode => (s.rateLimits.length ? 'plan' : 'api')

export const bar = (percent: number, width = 8) => {
  const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return ['━'.repeat(full), '─'.repeat(width - full)] as const
}

const FILL: Record<Level, string> = { success: '#3fb950', warning: '#d29922', error: '#f85149' }

// Rounded meter for graphical surfaces; translucent grey track reads on light and dark.
export const barSvg = (percent: number, level: Level, width = 120, height = 6) => {
  const w = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="#8b949e" fill-opacity="0.25"/>` +
    (w > 0 ? `<rect width="${Math.max(w, height)}" height="${height}" rx="${height / 2}" fill="${FILL[level]}"/>` : '') +
    `</svg>`
}

const elapsedFraction = (resetsAt: string | undefined, kind: string, now: number) => {
  const dur = WINDOW_MS[kind]
  if (!dur || !resetsAt) return null
  const f = (dur - (Date.parse(resetsAt) - now)) / dur
  return f < 0.02 ? null : f // ponytail: too early to extrapolate, noise
}

// Projected % at reset if the current pace holds.
export const projected = (percentUsed: number, resetsAt: string | undefined, kind: string, now: number) => {
  const f = elapsedFraction(resetsAt, kind, now)
  return f == null ? null : Math.round(percentUsed / f)
}

// When the window hits 100% at the current pace; null when it resets first.
export const eta = (percentUsed: number, resetsAt: string | undefined, kind: string, now: number) => {
  const f = elapsedFraction(resetsAt, kind, now)
  if (f == null || percentUsed <= 0 || !resetsAt) return null
  if (percentUsed >= 100) return now
  const elapsedMs = f * WINDOW_MS[kind]!
  const at = now + ((100 - percentUsed) / percentUsed) * elapsedMs
  return at < Date.parse(resetsAt) ? at : null
}

export const cacheHit = (t: Tokens) => {
  const input = t.in + t.cacheRead + t.cacheWrite
  return input ? Math.round((t.cacheRead / input) * 100) : null
}

export const addUsage = (t: Tokens, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): Tokens => ({
  in: t.in + u.input_tokens,
  out: t.out + u.output_tokens,
  cacheRead: t.cacheRead + u.cache_read_input_tokens,
  cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
})

const hours = (s: Snapshot, now: number) => (now - s.startedAt) / 3600e3

export const segments = (s: Snapshot, t: Tokens, now: number, budgetUsd = 0): Segment[] => {
  const out: Segment[] = []
  const m = mode(s)

  const ctx = s.contextPercent
  out.push({
    label: 'Context',
    value: ctx == null ? '–' : `${ctx}%`,
    detail: s.contextTokens == null ? `${num(s.contextWindow)} window` : `${num(s.contextTokens)} of ${num(s.contextWindow)}`,
    short: `ctx ${ctx ?? '–'}%`,
    percent: ctx,
    level: level(ctx ?? 0, 60, 80),
  })

  for (const r of s.rateLimits) {
    const p = projected(r.percentUsed, r.resetsAt, r.kind, now)
    const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
    const when = hit != null ? `hits 100% ~${clock(hit, now)}` : r.resetsAt ? `resets ${clock(Date.parse(r.resetsAt), now)}` : ''
    out.push({
      label: LABEL[r.kind] ?? r.kind,
      value: `${r.percentUsed}%`,
      detail: [p == null ? '' : `pace → ${p}%`, when].filter(Boolean).join(' · '),
      short: `${SHORT[r.kind] ?? r.kind} ${r.percentUsed}%${p == null ? '' : `→${p}%`}`,
      percent: r.percentUsed,
      // Colour by where the pace lands, not just what's used now.
      level: level(Math.max(r.percentUsed, p ?? 0), 80, 100),
    })
  }

  if (s.costUsd != null) {
    const h = hours(s, now)
    const rate = h > 0.05 ? s.costUsd / h : null
    const usd = `$${s.costUsd.toFixed(2)}`
    if (m === 'plan') {
      out.push({ label: 'API value', value: usd, detail: 'included in plan', short: usd, percent: null, level: 'success', isMuted: true })
    } else if (budgetUsd > 0) {
      const pct = Math.round((s.costUsd / budgetUsd) * 100)
      const left = budgetUsd - s.costUsd
      const etaMs = rate && left > 0 ? now + (left / rate) * 3600e3 : null
      out.push({
        label: 'Spend',
        value: usd,
        detail: [`of $${budgetUsd}`, rate ? `$${rate.toFixed(2)}/hr` : '', etaMs ? `budget ~${clock(etaMs, now)}` : left <= 0 ? 'over budget' : ''].filter(Boolean).join(' · '),
        short: `${usd}/$${budgetUsd}`,
        percent: pct,
        level: level(pct, 75, 90),
      })
    } else {
      out.push({ label: 'Spend', value: usd, detail: rate ? `$${rate.toFixed(2)}/hr` : 'this session', short: usd, percent: null, level: 'success' })
    }
  }

  const total = t.in + t.out + t.cacheRead + t.cacheWrite
  if (total > 0) {
    const hit = cacheHit(t)
    out.push({
      label: 'Tokens',
      value: num(total),
      detail: [`in ${num(t.in + t.cacheWrite)}`, `out ${num(t.out)}`, hit == null ? '' : `cache ${hit}%`].filter(Boolean).join(' · '),
      short: `${num(total)} tok`,
      percent: null,
      level: 'success',
      isMuted: true,
    })
  }

  return out
}

export const compactLine = (m: Mode, segs: Segment[]) => [m.toUpperCase(), ...segs.map(s => s.short)].join(' · ')

export type Warning = { key: string; text: string }

// Keys carry the window's reset so a fresh window can warn again.
export const warnings = (s: Snapshot, now: number, budgetUsd = 0): Warning[] => {
  const out: Warning[] = []
  if ((s.contextPercent ?? 0) >= 80) out.push({ key: 'ctx', text: `Context ${s.contextPercent}% full: consider /compact` })
  for (const r of s.rateLimits) {
    const p = projected(r.percentUsed, r.resetsAt, r.kind, now)
    if (Math.max(r.percentUsed, p ?? 0) < 100) continue
    const hit = eta(r.percentUsed, r.resetsAt, r.kind, now)
    const label = LABEL[r.kind] ?? r.kind
    out.push({
      key: `pace:${r.kind}:${r.resetsAt ?? ''}`,
      text: r.percentUsed >= 100 ? `${label} reached` : `${label}: on pace for ${p}%${hit != null ? `, hits 100% ~${clock(hit, now)}` : ''}`,
    })
  }
  if (mode(s) === 'api' && budgetUsd > 0 && (s.costUsd ?? 0) >= budgetUsd * 0.9)
    out.push({ key: `budget:${budgetUsd}`, text: `Spend $${s.costUsd!.toFixed(2)} of $${budgetUsd} budget` })
  return out
}
