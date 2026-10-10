// node check.mjs <key>: measures a theme's band and pane lines, and its motion frames if present.
// Prints every violation; exit code 1 when there is one.
import { readFileSync, existsSync } from 'node:fs'

const DIR = new URL('.', import.meta.url).pathname
const key = process.argv[2]
if (!key) { console.error('usage: node check.mjs <key>'); process.exit(2) }
const TAG = /\{(\/|[a-z0-9]+|#[0-9a-fA-F]{6}|bg#[0-9a-fA-F]{6})\}/g
const TONES = new Set(['success', 'error', 'warning', 'claude', 'dim', 'bold', 'accent', 'accent2', 'inverse', 'bg2', 'italic', 'underline'])
const strip = s => s.replace(TAG, '')
const bad = []

function line(where, s, max) {
  const plain = strip(s)
  if (plain.length > max) bad.push(`${where}: ${plain.length} cells > ${max}`)
  for (const ch of plain) {
    const cp = ch.codePointAt(0)
    if (cp > 0xffff) bad.push(`${where}: "${ch}" is outside the BMP (not width-1)`)
    else if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) bad.push(`${where}: "${ch}" is double-width`)
    else if ((cp >= 0x0300 && cp <= 0x036f) || cp === 0xfe0f || cp === 0x200d) bad.push(`${where}: U+${cp.toString(16)} is a combining mark / joiner`)
  }
  let depth = 0
  for (const m of s.matchAll(TAG)) {
    const t = m[1]
    if (t === '/') { depth -= 1; if (depth < 0) bad.push(`${where}: a {/} closes nothing`) }
    else { depth += 1; if (!TONES.has(t) && !t.startsWith('#') && !t.startsWith('bg#')) bad.push(`${where}: unknown tag {${t}}`) }
  }
  if (depth > 0) bad.push(`${where}: ${depth} tag(s) left open`)
}

const t = JSON.parse(readFileSync(`${DIR}${key}.json`, 'utf8'))
line('band100', t.band100, 100)
line('band60', t.band60, 60)
if (t.paneOverview.length > 26) bad.push(`paneOverview: ${t.paneOverview.length} lines > 26`)
t.paneOverview.forEach((l, i) => line(`pane[${i}]`, l, 72))

const fp = `${DIR}${key}.frames.json`
if (existsSync(fp)) {
  const f = JSON.parse(readFileSync(fp, 'utf8'))
  if (!Array.isArray(f.frames) || f.frames.length < 2) bad.push('frames: need an array of at least 2')
  let total = 0
  ;(f.frames ?? []).forEach((fr, n) => {
    if (typeof fr.ms !== 'number' || fr.ms < 80) bad.push(`frame ${n}: ms must be a number >= 80`)
    total += fr.ms || 0
    if (!fr.label) bad.push(`frame ${n}: needs a short label`)
    if (fr.band100) line(`frame ${n} band100`, fr.band100, 100)
    if (fr.band60) line(`frame ${n} band60`, fr.band60, 60)
    for (const [i, l] of Object.entries(fr.pane ?? {})) {
      if (!/^\d+$/.test(i) || Number(i) >= t.paneOverview.length) bad.push(`frame ${n}: pane key "${i}" is not a line of the still (0..${t.paneOverview.length - 1})`)
      line(`frame ${n} pane[${i}]`, l, 72)
    }
  })
  const f0 = f.frames?.[0]
  if (f0 && (f0.band100 || f0.band60 || Object.keys(f0.pane ?? {}).length)) bad.push('frame 0 must be the still itself (no patches)')
  console.log(`frames: ${f.frames?.length ?? 0}, loop ${(total / 1000).toFixed(1)} s`)
}

if (bad.length) { console.log(bad.join('\n')); process.exit(1) }
console.log(`${key}: ok`)
