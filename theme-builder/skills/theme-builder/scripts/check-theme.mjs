#!/usr/bin/env node
// Checks a theme mod's palettes before it loads: runs the mod's own makeColors on PALETTE
// (and COLD_PALETTE, in a live theme) in hooks/register.ts(x), prints their problems and a
// contrast table, and can write a swatch page. Exits 1 when Desktop would refuse to paint one.
//
//   node check-theme.mjs <mod folder> [--all] [--html <out.html>]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const showAll = args.includes('--all')
const htmlAt = args.indexOf('--html')
const out = htmlAt === -1 ? undefined : args[htmlAt + 1]
const modDir = args.find((a, i) => !a.startsWith('--') && (htmlAt === -1 || i !== htmlAt + 1))

if (modDir === undefined || (htmlAt !== -1 && out === undefined)) {
  console.error('usage: node check-theme.mjs <mod folder> [--all] [--html <out.html>]')
  process.exit(2)
}

const fail = message => {
  console.error(message)
  process.exit(2)
}

const hooks = resolve(modDir, 'hooks')
const { makeColors } = await import(pathToFileURL(resolve(hooks, 'make-colors.js')).href)

// The palettes are read from the module's source text, not imported: a .tsx module holds JSX
// that Node can't run. Each must be a plain literal; COLD_PALETTE may spread PALETTE.
const source = ['register.ts', 'register.tsx'].map(f => resolve(hooks, f)).find(existsSync)
if (source === undefined) fail(`No hooks/register.ts or hooks/register.tsx in ${resolve(modDir)}`)
const text = readFileSync(source, 'utf8')

function readConst(name, scope) {
  const start = text.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`))
  if (start === -1) return undefined
  const open = text.indexOf('{', text.indexOf('=', start))
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i)
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        return new Function(...Object.keys(scope), `return (${text.slice(open, i + 1)})`)(...Object.values(scope))
      } catch (error) {
        fail(`${name} isn't a plain literal: ${error.message}`)
      }
    }
  }
  fail(`${name} never closes`)
}

const PALETTE = readConst('PALETTE', {})
if (PALETTE === undefined) fail(`${source} has no \`export const PALETTE = { ... }\``)
const COLD_PALETTE = readConst('COLD_PALETTE', { PALETTE })
const palettes = [['PALETTE', PALETTE], ...(COLD_PALETTE ? [['COLD_PALETTE', COLD_PALETTE]] : [])]

// WCAG relative luminance and contrast ratio.
const channel = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = hex => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => channel(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The bars from the skill: primary text 7:1 on every surface, secondary and muted 4.5:1 on 0 and 2.
const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3']
const TEXTS = { 'text-primary': 7, 'text-secondary': 4.5, 'text-muted': 4.5 }
const modesOf = p => ['light', 'dark'].filter(m => p[m]?.gray?.anchors)
let blockerCount = 0

for (const [name, palette] of palettes) {
  let result
  try {
    result = makeColors(palette)
  } catch (error) {
    console.error(`makeColors refused ${name}: ${error.message}`)
    process.exit(1)
  }

  const weak = []
  console.log(`\n== ${name}: ${palette.label}`)
  for (const mode of modesOf(palette)) {
    const a = palette[mode].gray.anchors
    const surfaces = SURFACES.filter(s => a[s])
    console.log(`\n${mode}`)
    console.log(['', ...surfaces].map(s => s.padEnd(15)).join(''))
    for (const [t, bar] of Object.entries(TEXTS)) {
      if (!a[t]) continue
      const cells = surfaces.map(s => {
        const r = ratio(a[t], a[s])
        const checked = t === 'text-primary' || s === 'surface-0' || s === 'surface-2'
        if (checked && r < bar) weak.push(`${mode}: ${t} on ${s} is ${r.toFixed(2)}:1, aim for ${bar}:1`)
        return `${r.toFixed(2)}${checked && r < bar ? ' !' : ''}`.padEnd(15)
      })
      console.log(t.padEnd(15) + cells.join(''))
    }
    for (let i = 1; i < surfaces.length; i++) {
      if (luminance(a[surfaces[i]]) < luminance(a[surfaces[i - 1]])) {
        weak.push(`${mode}: ${surfaces[i]} is darker than ${surfaces[i - 1]}; each later surface should be as light or lighter`)
      }
    }
  }

  const blockers = result.problems.filter(p => p.startsWith("Desktop won't paint"))
  const rest = result.problems.filter(p => !p.startsWith("Desktop won't paint"))
  blockerCount += blockers.length
  console.log('')
  for (const line of blockers) console.log(`BLOCKER  ${line}`)
  for (const line of weak) console.log(`AIM      ${line}`)
  if (showAll) for (const line of rest) console.log(`note     ${line}`)
  console.log(
    blockers.length > 0
      ? `${name}: ${blockers.length} blocker(s): Desktop ignores the whole theme until these are gone.`
      : `${name}: Desktop will paint it. ${weak.length} aim(s), ${rest.length} note(s) under the design system's own bar${showAll || rest.length === 0 ? '' : ' (--all lists them)'}.`,
  )
}

if (out !== undefined) {
  const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
  const panel = (palette, mode) => {
    const a = palette[mode].gray.anchors
    const fg = a['text-primary']
    const roles = Object.entries(palette.roles ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : v.seed])
    const cards = SURFACES.filter(s => a[s])
      .map(s => `<div class="card" style="background:${a[s]}">
        <b style="color:${fg}">${s}</b>
        ${Object.keys(TEXTS).filter(t => a[t]).map(t => `<div style="color:${a[t]}">${t} ${ratio(a[t], a[s]).toFixed(1)}:1</div>`).join('')}
      </div>`)
      .join('')
    const chips = roles.filter(([, v]) => v).map(([k, v]) => `<span class="chip" style="background:${v}">${k}</span>`).join('')
    return `<section style="background:${a['surface-0']};color:${fg}"><h2>${esc(palette.label)}: ${mode}</h2><div class="row">${cards}</div><div class="row">${chips}</div></section>`
  }
  writeFileSync(
    out,
    `<!doctype html><meta charset="utf-8"><title>${esc(PALETTE.label)}</title>
<style>body{margin:0;font:14px system-ui,sans-serif}section{padding:24px}h2{margin:0 0 12px;font-weight:600}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}.card{padding:12px 16px;border-radius:8px;min-width:150px;line-height:1.6}
.chip{color:#fff;padding:4px 10px;border-radius:99px;text-shadow:0 1px 1px #0006}</style>
<h1 style="padding:24px 24px 0;margin:0">${esc(PALETTE.label)}</h1>${palettes.flatMap(([, p]) => modesOf(p).map(m => panel(p, m))).join('')}`,
  )
  console.log(`Swatches written to ${resolve(out)}`)
}

process.exit(blockerCount > 0 ? 1 : 0)
