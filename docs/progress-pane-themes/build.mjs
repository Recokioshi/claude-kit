// Assembles the gallery page: template + current.json + the ten theme JSONs (in lane order) + judge.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const DIR = new URL('.', import.meta.url).pathname
const ORDER = ['typeset', 'console', 'notebook', 'companion', 'neon', 'transit', 'blueprint', 'brutalist', 'garden', 'departure']
const LANES = {
  typeset: 'editorial / typographic minimal',
  console: 'mission control console',
  notebook: 'warm paper notebook',
  companion: 'pixel companion (the creature above the chat input)',
  neon: 'night-drive cybernetic (the ultracode slider)',
  transit: 'transit line map',
  blueprint: 'blueprint / drafting table',
  brutalist: 'brutalist mono',
  garden: 'garden / growth',
  departure: 'departure board (split-flap)',
}
const out = process.argv[2]
if (!out) throw new Error('usage: node build.mjs <out.html>')

const read = k => (existsSync(`${DIR}${k}.json`) ? JSON.parse(readFileSync(`${DIR}${k}.json`, 'utf8')) : null)
const themes = ['current', ...ORDER].map(read).filter(Boolean)
const missing = ORDER.filter(k => !existsSync(`${DIR}${k}.json`))
if (missing.length) console.warn('missing:', missing.join(', '))
const judge = read('judge')
// Themes revised after the judge read them: { key: 'what changed' }.
const separations = read('separations') ?? {}
for (const t of themes) if (separations[t.key]) t.revisedAfterJudge = separations[t.key]

// Width report, so the gallery never ships a line the terminal would clip.
const strip = s => s.replace(/\{(\/|[a-z0-9]+|#[0-9a-fA-F]{6}|bg#[0-9a-fA-F]{6})\}/g, '')
for (const t of themes) {
  const bad = []
  if (strip(t.band100).length > 100) bad.push(`band100=${strip(t.band100).length}`)
  if (strip(t.band60).length > 60) bad.push(`band60=${strip(t.band60).length}`)
  t.paneOverview.forEach((l, i) => { if (strip(l).length > 72) bad.push(`pane[${i}]=${strip(l).length}`) })
  if (t.paneOverview.length > 26) bad.push(`paneLines=${t.paneOverview.length}`)
  if (bad.length) console.warn(`${t.key}: ${bad.join(' ')}`)
}

// Motion: <key>.frames.json = { frames: [{ ms, label?, band100?, band60?, pane?: { "<line>": "<text>" } }] }, each a patch on the still.
for (const t of themes) {
  const f = read(`${t.key}.frames`)
  if (!f || !Array.isArray(f.frames) || f.frames.length < 2) continue
  const bad = []
  f.frames.forEach((fr, n) => {
    if (fr.band100 && strip(fr.band100).length > 100) bad.push(`f${n}.band100=${strip(fr.band100).length}`)
    if (fr.band60 && strip(fr.band60).length > 60) bad.push(`f${n}.band60=${strip(fr.band60).length}`)
    for (const [i, l] of Object.entries(fr.pane ?? {})) {
      if (Number(i) >= t.paneOverview.length) bad.push(`f${n}.pane[${i}] past the last line`)
      if (strip(l).length > 72) bad.push(`f${n}.pane[${i}]=${strip(l).length}`)
    }
  })
  if (bad.length) console.warn(`${t.key} motion: ${bad.join(' ')}`)
  t.motion = f
}

const html = readFileSync(`${DIR}template.html`, 'utf8')
  .replace('/*__THEMES__*/[]', JSON.stringify(themes))
  .replace('/*__JUDGE__*/null', JSON.stringify(judge))
  .replace('/*__LANES__*/{}', JSON.stringify(LANES))
writeFileSync(out, html)
console.log(`${themes.length} themes → ${out} (${Math.round(html.length / 1024)} KB)`)
