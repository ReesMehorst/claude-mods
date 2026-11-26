// Pure SVG builders for the usage band. Every builder returns one standalone SVG document
// the band draws with <Svg source={...} />. Kept free of DOM and Node APIs so tests run anywhere.
// The engine only accepts plain vector markup: no images, entities, external refs or backslashes.
import type { DayTile, Mood, Tokens } from '../types'
import type { Level } from './summarize'

const FILL: Record<Level, string> = { success: '#3fb950', warning: '#d29922', error: '#f85149' }
const TEXT = '#ecebe6'
const MUTED = '#a3a19a'
const TRACK = 'fill="#8b949e" fill-opacity="0.25"'
const FONT = 'font-family="system-ui, sans-serif"'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
const doc = (w: number, h: number, vb: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="${vb}">${body}</svg>`

// --- Mascot ----------------------------------------------------------------------------
// Ported from the approved Mascot design; viewBox -8 -12 80 80 for every mood, SMIL kept.
const MASCOT: Record<Mood, string> = {
  warm:
    '<ellipse cx="32" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="2.4s" repeatCount="indefinite"/><rect x="14" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="8" y="30" width="6" height="6" rx="1" fill="#D97757"/><rect x="50" y="26" width="6" height="6" rx="1" fill="#D97757"/><rect x="18" y="46" width="4" height="7" fill="#D97757"/><rect x="25" y="46" width="4" height="7" fill="#D97757"/><rect x="35" y="46" width="4" height="7" fill="#D97757"/><rect x="42" y="46" width="4" height="7" fill="#D97757"/><rect x="19" y="26" width="26" height="6" rx="1.5" fill="#1f1e1d"/><rect x="22" y="27.5" width="4" height="1.5" fill="#fff" opacity="0.6"/><rect x="36" y="27.5" width="4" height="1.5" fill="#fff" opacity="0.6"/><rect x="55" y="20" width="9" height="11" rx="1.5" fill="#ecebe6"/><rect x="63" y="23" width="4" height="5" rx="2" fill="none" stroke="#ecebe6" stroke-width="1.5"/><rect x="55" y="24" width="9" height="2" fill="#D97757"/><path d="M58 17 q-2 -3 0 -6 q2 -3 0 -6" stroke="#ecebe6" fill="none" stroke-width="1.2" stroke-linecap="round"><animate attributeName="opacity" values="0.15;0.8;0.15" dur="2s" repeatCount="indefinite"/></path><path d="M62 17 q-2 -3 0 -6 q2 -3 0 -6" stroke="#ecebe6" fill="none" stroke-width="1.2" stroke-linecap="round"><animate attributeName="opacity" values="0.8;0.15;0.8" dur="2s" repeatCount="indefinite"/></path></g>',
  live:
    '<ellipse cx="32" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="0.5s" repeatCount="indefinite"/><rect x="14" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="8" y="14" width="6" height="6" rx="1" fill="#D97757"/><rect x="50" y="14" width="6" height="6" rx="1" fill="#D97757"/><rect x="11" y="19" width="5" height="9" fill="#D97757"/><rect x="48" y="19" width="5" height="9" fill="#D97757"/><rect x="18" y="46" width="4" height="7" fill="#D97757"/><rect x="25" y="46" width="4" height="7" fill="#D97757"/><rect x="35" y="46" width="4" height="7" fill="#D97757"/><rect x="42" y="46" width="4" height="7" fill="#D97757"/><rect x="24" y="25" width="4" height="6" fill="#1f1e1d"/><rect x="38" y="25" width="4" height="6" fill="#1f1e1d"/></g><path transform="translate(2 4)" d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1Z" fill="#e3b341"><animate attributeName="opacity" values="0;1;0" dur="1s" repeatCount="indefinite"/></path><path transform="translate(62 2)" d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1Z" fill="#e3b341"><animate attributeName="opacity" values="0;1;0" dur="1s" begin="0.33s" repeatCount="indefinite"/></path><path transform="translate(32 -6)" d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8Z" fill="#e3b341"><animate attributeName="opacity" values="0;1;0" dur="1s" begin="0.66s" repeatCount="indefinite"/></path>',
  soon:
    '<ellipse cx="32" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><g><animateTransform attributeName="transform" type="translate" values="-0.8 0;0.8 0;-0.8 0" dur="0.16s" repeatCount="indefinite"/><rect x="14" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="10" y="32" width="6" height="6" rx="1" fill="#D97757"/><rect x="48" y="32" width="6" height="6" rx="1" fill="#D97757"/><rect x="18" y="46" width="4" height="7" fill="#D97757"/><rect x="25" y="46" width="4" height="7" fill="#D97757"/><rect x="35" y="46" width="4" height="7" fill="#D97757"/><rect x="42" y="46" width="4" height="7" fill="#D97757"/><rect x="23" y="27" width="4" height="5" fill="#1f1e1d"/><rect x="37" y="27" width="4" height="5" fill="#1f1e1d"/><path d="M21 25 L27 23 M43 25 L37 23" stroke="#1f1e1d" stroke-width="1.5" stroke-linecap="round"/><rect x="13" y="35" width="38" height="5" rx="1" fill="#5b8def"/><rect x="17" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="27" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="40" y="38" width="5" height="12" rx="1" fill="#5b8def"/><rect x="40" y="45" width="5" height="2" fill="#8fb0f5"/></g><circle cx="64" cy="6" r="6.5" fill="#262624" stroke="#d29922" stroke-width="1.5"/><line x1="64" y1="6" x2="64" y2="1.5" stroke="#d29922" stroke-width="1.5" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 64 6" to="360 64 6" dur="1.6s" repeatCount="indefinite"/></line><circle cx="4" cy="14" r="2" fill="#ecebe6" opacity="0.5"><animate attributeName="r" values="1;3;1" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0;0.6" dur="1.4s" repeatCount="indefinite"/></circle>',
  keep:
    '<circle cx="60" cy="44" r="14" fill="#e3b341" opacity="0.15"><animate attributeName="opacity" values="0.1;0.25;0.1" dur="0.9s" repeatCount="indefinite"/></circle><ellipse cx="28" cy="55" rx="16" ry="2.5" fill="#000" opacity="0.28"/><rect x="10" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="4" y="32" width="6" height="6" rx="1" fill="#D97757"/><rect x="46" y="34" width="9" height="5" rx="1" fill="#D97757"/><rect x="14" y="46" width="4" height="7" fill="#D97757"/><rect x="21" y="46" width="4" height="7" fill="#D97757"/><rect x="31" y="46" width="4" height="7" fill="#D97757"/><rect x="38" y="46" width="4" height="7" fill="#D97757"/><path d="M20 31 l2.5 -3 l2.5 3 M34 31 l2.5 -3 l2.5 3" stroke="#1f1e1d" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="9" y="35" width="38" height="5" rx="1" fill="#5b8def"/><rect x="13" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="23" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="14" y="38" width="5" height="12" rx="1" fill="#5b8def"/><rect x="53" y="50" width="16" height="3" rx="1.5" fill="#7a5132" transform="rotate(-14 61 51.5)"/><rect x="53" y="50" width="16" height="3" rx="1.5" fill="#8d6040" transform="rotate(14 61 51.5)"/><g transform="translate(61 50)"><g><animateTransform attributeName="transform" type="scale" values="1 1;0.88 1.1;1.05 0.95;1 1" dur="0.5s" repeatCount="indefinite"/><path d="M0 0 C-7 -5 -3 -12 0 -19 C3 -12 8 -6 0 0Z" fill="#d97757"/><path d="M0 0 C-4 -3 -2 -8 0 -12 C2 -8 4 -4 0 0Z" fill="#e3b341"/></g></g>',
  cold:
    '<ellipse cx="32" cy="58" rx="28" ry="2.5" fill="#000" opacity="0.28"/><rect x="14" y="20" width="36" height="26" rx="3" fill="#c98a74"/><rect x="8" y="30" width="6" height="6" rx="1" fill="#c98a74"/><rect x="50" y="30" width="6" height="6" rx="1" fill="#c98a74"/><rect x="18" y="46" width="4" height="7" fill="#c98a74"/><rect x="25" y="46" width="4" height="7" fill="#c98a74"/><rect x="35" y="46" width="4" height="7" fill="#c98a74"/><rect x="42" y="46" width="4" height="7" fill="#c98a74"/><rect x="22" y="29" width="6" height="2" fill="#1f1e1d"/><rect x="36" y="29" width="6" height="2" fill="#1f1e1d"/><rect x="13" y="35" width="38" height="5" rx="1" fill="#5b8def"/><rect x="17" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="27" y="35" width="3" height="5" fill="#8fb0f5"/><rect x="40" y="38" width="5" height="12" rx="1" fill="#5b8def"/><rect x="1" y="9" width="62" height="48" rx="4" fill="#bfe3ff" opacity="0.4" stroke="#e6f6ff" stroke-opacity="0.8" stroke-width="1.2"/><path d="M6 14 L16 14 M6 18 L11 18" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/><path d="M1 12 Q8 4 18 9 Q26 3 36 8 Q46 3 54 8 Q62 5 63 12Z" fill="#f4fbff"/><path d="M12 57 l2 6 l2 -6 M28 57 l1.5 4 l1.5 -4 M46 57 l2 7 l2 -7" fill="#e6f6ff"/><circle cx="-3" cy="-8" r="1.4" fill="#fff"><animateTransform attributeName="transform" type="translate" values="0 0;3 70" dur="4s" repeatCount="indefinite"/></circle><circle cx="20" cy="-8" r="1.1" fill="#fff"><animateTransform attributeName="transform" type="translate" values="0 0;-3 70" dur="3.4s" begin="1s" repeatCount="indefinite"/></circle><circle cx="44" cy="-8" r="1.4" fill="#fff"><animateTransform attributeName="transform" type="translate" values="0 0;2 70" dur="4.4s" begin="2s" repeatCount="indefinite"/></circle><circle cx="67" cy="-8" r="1.1" fill="#fff"><animateTransform attributeName="transform" type="translate" values="0 0;-2 70" dur="3.8s" begin="0.5s" repeatCount="indefinite"/></circle>',
  full:
    '<ellipse cx="32" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><g><animateTransform attributeName="transform" type="rotate" values="-3 32 20;3 32 20;-3 32 20" dur="1.6s" repeatCount="indefinite"/><rect x="17" y="15" width="30" height="5" rx="1" fill="#ecebe6" stroke="#a3a19a" stroke-width="0.8"/><rect x="19" y="10" width="28" height="5" rx="1" fill="#ecebe6" stroke="#a3a19a" stroke-width="0.8"/><rect x="15" y="5" width="30" height="5" rx="1" fill="#ecebe6" stroke="#a3a19a" stroke-width="0.8"/><rect x="20" y="0" width="27" height="5" rx="1" fill="#ecebe6" stroke="#a3a19a" stroke-width="0.8"/><rect x="17" y="-5" width="28" height="5" rx="1" fill="#ecebe6" stroke="#a3a19a" stroke-width="0.8"/><rect x="21" y="-10" width="24" height="5" rx="1" fill="#d29922" stroke="#a3a19a" stroke-width="0.8"/></g><rect x="14" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="10" y="12" width="6" height="10" rx="1" fill="#D97757"/><rect x="48" y="12" width="6" height="10" rx="1" fill="#D97757"/><rect x="18" y="46" width="4" height="7" fill="#D97757"/><rect x="25" y="46" width="4" height="7" fill="#D97757"/><rect x="35" y="46" width="4" height="7" fill="#D97757"/><rect x="42" y="46" width="4" height="7" fill="#D97757"/><path d="M22 27 L27 30 L22 33 M42 27 L37 30 L42 33" stroke="#1f1e1d" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M55 24 q-3 5 0 6 q3 -1 0 -6Z" fill="#8fb0f5"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></path>',
  budget:
    '<ellipse cx="32" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><rect x="14" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="8" y="30" width="6" height="6" rx="1" fill="#D97757"/><rect x="50" y="22" width="6" height="6" rx="1" fill="#D97757"/><rect x="18" y="46" width="4" height="7" fill="#D97757"/><rect x="25" y="46" width="4" height="7" fill="#D97757"/><rect x="35" y="46" width="4" height="7" fill="#D97757"/><rect x="42" y="46" width="4" height="7" fill="#D97757"/><rect x="22" y="25" width="5" height="8" fill="#1f1e1d"/><rect x="37" y="25" width="5" height="8" fill="#1f1e1d"/><rect x="23" y="26" width="2" height="2" fill="#fff"/><rect x="38" y="26" width="2" height="2" fill="#fff"/><path d="M10 22 q-3 5 0 6 q3 -1 0 -6Z" fill="#8fb0f5"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></path><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -14;0 0" dur="1s" repeatCount="indefinite"/><ellipse cx="54" cy="14" rx="6" ry="6" fill="#e3b341" stroke="#b8862b" stroke-width="1.2"><animate attributeName="rx" values="6;0.6;6;0.6;6" dur="1s" repeatCount="indefinite"/></ellipse></g>',
  pace:
    '<ellipse cx="34" cy="55" rx="18" ry="2.5" fill="#000" opacity="0.28"/><g stroke="#a3a19a" stroke-width="1.5" stroke-linecap="round"><animateTransform attributeName="transform" type="translate" values="4 0;-4 0" dur="0.3s" repeatCount="indefinite"/><line x1="-4" y1="26" x2="8" y2="26"/><line x1="-6" y1="33" x2="6" y2="33"/><line x1="-2" y1="40" x2="9" y2="40"/></g><g transform="skewX(-8)"><rect x="20" y="20" width="36" height="26" rx="3" fill="#D97757"/><rect x="14" y="32" width="6" height="6" rx="1" fill="#D97757"/><rect x="56" y="26" width="6" height="6" rx="1" fill="#D97757"/><rect x="30" y="27" width="4" height="4" fill="#1f1e1d"/><rect x="44" y="27" width="4" height="4" fill="#1f1e1d"/><rect x="24" y="46" width="4" height="7" fill="#D97757"><animate attributeName="height" values="7;3;7" dur="0.3s" repeatCount="indefinite"/></rect><rect x="31" y="46" width="4" height="3" fill="#D97757"><animate attributeName="height" values="3;7;3" dur="0.3s" repeatCount="indefinite"/></rect><rect x="41" y="46" width="4" height="7" fill="#D97757"><animate attributeName="height" values="7;3;7" dur="0.3s" repeatCount="indefinite"/></rect><rect x="48" y="46" width="4" height="3" fill="#D97757"><animate attributeName="height" values="3;7;3" dur="0.3s" repeatCount="indefinite"/></rect></g><circle cx="64" cy="4" r="6.5" fill="#262624" stroke="#f85149" stroke-width="1.5"/><rect x="62.5" y="-4.5" width="3" height="2" fill="#f85149"/><line x1="64" y1="4" x2="64" y2="-0.5" stroke="#f85149" stroke-width="1.5" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 64 4" to="360 64 4" dur="0.6s" repeatCount="indefinite"/></line>',
  nap:
    '<ellipse cx="32" cy="55" rx="20" ry="2.5" fill="#000" opacity="0.28"/><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -0.8;0 0" dur="2.8s" repeatCount="indefinite"/><rect x="11" y="36" width="42" height="14" rx="3" fill="#D97757"/><rect x="5" y="42" width="6" height="5" rx="1" fill="#D97757"/><rect x="53" y="42" width="6" height="5" rx="1" fill="#D97757"/><rect x="16" y="50" width="4" height="3" fill="#D97757"/><rect x="24" y="50" width="4" height="3" fill="#D97757"/><rect x="36" y="50" width="4" height="3" fill="#D97757"/><rect x="44" y="50" width="4" height="3" fill="#D97757"/><rect x="21" y="42" width="6" height="1.8" fill="#1f1e1d"/><rect x="37" y="42" width="6" height="1.8" fill="#1f1e1d"/></g><text x="50" y="28" font-family="system-ui, sans-serif" font-size="9" font-weight="700" fill="#a3a19a">z<animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/></text><text x="57" y="18" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#a3a19a">z<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="0.8s" repeatCount="indefinite"/></text><text x="64" y="6" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#a3a19a">Z<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="1.6s" repeatCount="indefinite"/></text>',
}

export const mascotSvg = (mood: Mood, size = 72) => doc(size, size, '-8 -12 80 80', MASCOT[mood] ?? MASCOT.warm)

// --- Context ring ----------------------------------------------------------------------
const RING_R = 24
const RING_C = 2 * Math.PI * RING_R // 150.8

export const ringSvg = (percent: number | null, level: Level, size = 64) => {
  const len = percent == null ? 0 : r1((clamp(percent) / 100) * RING_C)
  const label = percent == null ? '–' : `${Math.round(clamp(percent, 0, 999))}%`
  return doc(size, size, '0 0 64 64',
    `<circle cx="32" cy="32" r="${RING_R}" fill="none" stroke="#8b949e" stroke-opacity="0.25" stroke-width="8"/>` +
    (len > 0 ? `<circle cx="32" cy="32" r="${RING_R}" fill="none" stroke="${FILL[level]}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len} ${r1(RING_C)}" transform="rotate(-90 32 32)"/>` : '') +
    `<text x="32" y="37" text-anchor="middle" font-size="14" font-weight="700" fill="${TEXT}" ${FONT}>${esc(label)}</text>`)
}

// --- Cache thermometer -----------------------------------------------------------------
// Mercury shows the time left. cold: icy and nearly empty; soon: amber; live: full and pulsing.
const MERCURY = { warm: '#d97757', live: '#d97757', soon: '#d29922', cold: '#8fb0f5' } as const

export const thermometerSvg = (leftFraction: number | null, state: 'warm' | 'soon' | 'cold' | 'live', height = 70) => {
  const f = state === 'live' ? 1 : state === 'cold' ? 0.04 : clamp(leftFraction ?? 0, 0, 1)
  const top = r1(10 + (1 - f) * 56) // tube interior runs y 10..66, bulb below
  const c = MERCURY[state]
  const pulse = state === 'live' ? `<animate attributeName="opacity" values="1;0.6;1" dur="1.2s" repeatCount="indefinite"/>` : ''
  return doc((height * 30) / 70, height, '0 0 40 84',
    `<rect x="14" y="4" width="12" height="62" rx="6" fill="#222221" stroke="${state === 'cold' ? '#8fb0f5' : '#6b6a64'}" stroke-width="1.5"/>` +
    `<rect x="17" y="${top}" width="6" height="${r1(69 - top)}" rx="3" fill="${c}">${pulse}</rect>` +
    `<circle cx="20" cy="72" r="9" fill="${c}"/>`)
}

// --- 5-hour pace bar -------------------------------------------------------------------
// Track, hatched forecast up to the projection (capped at 100), solid used, white tick at the elapsed share.
export const paceSvg = (used: number, projected: number | null, elapsed: number | null, level: Level, width = 170) => {
  const x = (p: number) => r1((clamp(p) / 100) * width)
  const id = `pace-${level}`
  const fc = projected == null ? 0 : x(Math.max(projected, used))
  const u = x(used)
  return doc(width, 16, `0 0 ${r1(width)} 16`,
    `<defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="8" height="8" fill="${FILL[level]}" fill-opacity="0.15"/><rect width="4" height="8" fill="${FILL[level]}" fill-opacity="0.45"/></pattern></defs>` +
    `<rect y="4" width="${r1(width)}" height="8" rx="4" ${TRACK}/>` +
    (fc > 0 ? `<rect y="4" width="${Math.max(fc, 8)}" height="8" rx="4" fill="url(#${id})"/>` : '') +
    (u > 0 ? `<rect y="4" width="${Math.max(u, 8)}" height="8" rx="4" fill="${FILL[level]}"/>` : '') +
    (elapsed == null ? '' : `<rect x="${r1(clamp(elapsed * width, 0, width - 2))}" width="2" height="16" rx="1" fill="${TEXT}"/>`))
}

// --- Spend fuel gauge ------------------------------------------------------------------
// Semicircle centred (50, 50), radius 40; 0% at the left end, 100% at the right.
const arcPt = (p: number, r: number) => {
  const a = Math.PI * (1 - p / 100)
  return `${r1(50 + r * Math.cos(a))} ${r1(50 - r * Math.sin(a))}`
}
const arc = (from: number, to: number, color: string) =>
  `<path d="M${arcPt(from, 40)} A40 40 0 0 1 ${arcPt(to, 40)}" fill="none" stroke="${color}" stroke-width="9"/>`

export const gaugeSvg = (percent: number, width = 72) =>
  doc(width, (width * 60) / 100, '0 0 100 60',
    arc(0, 75, FILL.success) + arc(75, 90, FILL.warning) + arc(90, 100, FILL.error) +
    `<path d="M50 50 L${arcPt(clamp(percent), 34)}" stroke="${TEXT}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<circle cx="50" cy="50" r="5" fill="${TEXT}"/>`)

// --- Token split bar -------------------------------------------------------------------
export const SPLIT_COLORS = { cache: '#8fb0f5', newIn: '#d97757', out: '#e3b341' } as const

export const splitSvg = (t: Tokens, width = 200) => {
  const parts: [number, string][] = (
    [[t.cacheRead, SPLIT_COLORS.cache], [t.in + t.cacheWrite, SPLIT_COLORS.newIn], [t.out, SPLIT_COLORS.out]] as [number, string][]
  ).filter(([n]) => n > 0)
  const total = parts.reduce((s, [n]) => s + n, 0)
  const room = width - 2 * Math.max(0, parts.length - 1)
  let x = 0
  const segs = parts.map(([n, c]) => {
    const w = r1((n / total) * room)
    const s = `<rect x="${r1(x)}" width="${w}" height="8" fill="${c}"/>`
    x += w + 2
    return s
  })
  return doc(width, 8, `0 0 ${r1(width)} 8`,
    `<defs><clipPath id="split-clip"><rect width="${r1(width)}" height="8" rx="4"/></clipPath></defs>` +
    `<rect width="${r1(width)}" height="8" rx="4" ${TRACK}/>` +
    (total > 0 ? `<g clip-path="url(#split-clip)">${segs.join('')}</g>` : ''))
}

// --- Weekly day tiles ------------------------------------------------------------------
const GREEN = ['', '#0e4429', '#006d32', '#26a641', '#39d353']
const EDGE = '#3e3d39'

export const dayTilesSvg = (days: DayTile[], tile = 14) => {
  const pad = 4 // room for today's ring (2px offset + 2px stroke)
  const gap = Math.max(4, Math.round(tile * 0.25))
  const rx = Math.round(tile * 0.2)
  const fs = Math.round(clamp(tile * 0.6, 9, 12))
  const w = pad * 2 + days.length * tile + Math.max(0, days.length - 1) * gap
  const h = pad * 2 + tile + fs + 1
  const body = days.map((d, i) => {
    const x = pad + i * (tile + gap)
    const shape = d.level > 0
      ? `<rect x="${x}" y="${pad}" width="${tile}" height="${tile}" rx="${rx}" fill="${GREEN[d.level]}"/>`
      : `<rect x="${x + 0.5}" y="${pad + 0.5}" width="${tile - 1}" height="${tile - 1}" rx="${rx}" fill="none" stroke="${EDGE}"${d.level < 0 ? ' stroke-dasharray="2 2"' : ''}/>`
    const ring = d.isToday ? `<rect x="${x - 3}" y="${pad - 3}" width="${tile + 6}" height="${tile + 6}" rx="${rx + 3}" fill="none" stroke="${TEXT}" stroke-width="2"/>` : ''
    const letter = `<text x="${r1(x + tile / 2)}" y="${r1(pad * 2 + tile + fs * 0.85)}" text-anchor="middle" font-size="${fs}"${d.isToday ? ' font-weight="700"' : ''} fill="${d.isToday ? TEXT : MUTED}" ${FONT}>${esc(d.label.charAt(0))}</text>`
    return shape + ring + letter
  })
  return doc(w, h, `0 0 ${w} ${h}`, body.join(''))
}

// --- Chip icons ------------------------------------------------------------------------
// 24-unit stroke icons from the compact band design.
const ICON = {
  context: '<path d="M12 3 L21 8 L12 13 L3 8Z M3 12 L12 17 L21 12 M3 16 L12 21 L21 16"/>',
  cache: '<path d="M10 4 a2 2 0 0 1 4 0 v10 a4 4 0 1 1 -4 0Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 6v12M15 9h-4.5a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3H9"/>',
  tokens: '<path d="M4 6h16M4 12h16M4 18h11"/>',
} as const

export const iconSvg = (name: 'context' | 'cache' | 'clock' | 'calendar' | 'coin' | 'tokens', color: string, size = 14) =>
  doc(size, size, '0 0 24 24',
    `<g fill="none" stroke="${esc(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</g>`)

// --- Chip mini meter -------------------------------------------------------------------
export const miniMeterSvg = (percent: number, level: Level, projected: number | null = null, width = 40) => {
  const x = (p: number) => r1((clamp(p) / 100) * width)
  const u = x(percent)
  const fc = projected == null ? 0 : x(Math.max(projected, percent))
  return doc(width, 4, `0 0 ${r1(width)} 4`,
    `<rect width="${r1(width)}" height="4" rx="2" ${TRACK}/>` +
    (fc > 0 ? `<rect width="${Math.max(fc, 4)}" height="4" rx="2" fill="${FILL[level]}" fill-opacity="0.35"/>` : '') +
    (u > 0 ? `<rect width="${Math.max(u, 4)}" height="4" rx="2" fill="${FILL[level]}"/>` : ''))
}
