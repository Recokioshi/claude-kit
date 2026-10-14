// Builds companions.html: the companion design sheet for owner review.
// Run: node docs/progress-pane-themes/companions/build.mjs (Node 24 strips the TypeScript types).
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as C from '../../../mods/progress-pane/hooks/companions.ts'

const here = dirname(fileURLToPath(import.meta.url))
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku', 'other']
const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const POSES = ['working', 'resting', 'done', 'failed']
/**
 * A terminal rendering: the frames' rasterCells strings, decoded in the page
 * (decodeTerms below) back to 12×5 half-block glyphs with their colors, as the
 * engine reads them. Keeping the cells encoded keeps the sheet small.
 */
const CELLS = []
const intern = cells => (CELLS.includes(cells) ? CELLS.indexOf(cells) : CELLS.push(cells) - 1)
const termBoth = (frames, cls = '') => ['dark', 'light'].map(t =>
  `<div class="term ${t} ${cls}" data-cells="${frames.map(p => intern(C.rasterCells(p))).join(',')}"></div>`).join('')
const label = (f, e) => `${C.creatureName(f)}${C.accessoryName(e) ? ` · ${C.accessoryName(e)}` : ''}`
/** As the engine's Svg element draws it by default: an image, so its CSS animation runs inside the image. Each document is embedded once (SVGS) and set as the images' src in the page. */
const SVGS = {}
const svg = (f, e, p, size) => {
  const key = `${f}/${e}/${p}`
  SVGS[key] ??= C.companionSvg(f, e, p, 48)
  return `<span class="svg"><img alt="${label(f, e)}, ${p}" width="${size}" data-svg="${key}"></span>`
}

let grid = `<table><tr><th></th>${EFFORTS.map(e => `<th>${e}<br><small>${C.accessoryName(e) || 'no accessory'}</small></th>`).join('')}</tr>`
for (const f of FAMILIES) {
  grid += `<tr><th>${f}<br><small>${C.creatureName(f)} ${C.companionGlyph(f)}</small></th>`
  for (const e of EFFORTS) {
    const frames = Array.from({ length: C.WORKING_FRAMES }, (_, i) => C.companionPixels(f, e, 'working', i))
    grid += `<td title="${label(f, e)}">${termBoth(frames, 'anim')}<div class="svgs">${svg(f, e, 'working', 48)}${svg(f, e, 'working', 24)}</div></td>`
  }
  grid += '</tr>'
}
grid += '</table>'

let poses = `<table><tr><th></th>${POSES.map(p => `<th>${p}</th>`).join('')}<th>working frames 0–3</th><th>SVG (resting / done / failed)</th></tr>`
for (const f of FAMILIES) {
  for (const e of ['none', 'max']) {
    poses += `<tr><th>${f}<br><small>${e}</small></th>`
    for (const p of POSES) {
      const frames = p === 'working' ? Array.from({ length: C.WORKING_FRAMES }, (_, i) => C.companionPixels(f, e, p, i)) : [C.companionPixels(f, e, p, 0)]
      poses += `<td>${termBoth(frames, p === 'working' ? 'anim big' : 'big')}</td>`
    }
    poses += `<td class="strip">${Array.from({ length: C.WORKING_FRAMES }, (_, i) => termBoth([C.companionPixels(f, e, 'working', i)])).join('')}</td>`
    poses += `<td class="svgcol">${['resting', 'done', 'failed'].map(p => svg(f, e, p, 48)).join('')}</td></tr>`
  }
}
poses += '</table>'

const big = `<table><tr><th></th>${EFFORTS.map(e => `<th>${e}</th>`).join('')}</tr>${FAMILIES.map(f => `<tr><th>${C.creatureName(f)}</th>${EFFORTS.map(e => `<td>${termBoth(Array.from({ length: C.WORKING_FRAMES }, (_, i) => C.companionPixels(f, e, 'working', i)), 'anim big')}</td>`).join('')}</tr>`).join('')}</table>`

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Progress-pane companions</title>
<style>
:root{--paper:#f8f3e7;--ink:#2a2622;--dim:#8a8376}
body{margin:0;padding:16px;background:var(--paper);color:var(--ink);font:14px/1.4 ui-sans-serif,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}p{max-width:70ch;color:#4a443c}
table{border-collapse:collapse}th,td{border:1px solid #d9d0bf;padding:6px;vertical-align:top;text-align:center}
th small{color:var(--dim);font-weight:normal}
.term{display:inline-block;font:13px/1 Menlo,'SF Mono',monospace;padding:4px;margin:2px;border-radius:4px}
.term div div{white-space:pre;height:13px}
.term span{display:inline-block;width:8px;overflow:hidden;text-align:left}
.term.dark{background:#1e1e1e;--tfg:#ddd}.term.light{background:#ffffff;--tfg:#222;outline:1px solid #ddd}
.term.big{font-size:20px;display:block}.term.big div div{height:20px}.term.big span{width:12px}
.term.anim>div{display:none}.term.anim>div.on{display:block}
.svgs,.svg{display:inline-block;margin:2px}.svg img{display:block}
td .svg{padding:4px;background:#1e1e1e;border-radius:4px}td .svg+.svg{background:#fff;outline:1px solid #ddd}
figure{display:inline-block;margin:0 12px 0 0;text-align:center}
.strip,td.svgcol{white-space:nowrap}.strip>.term{margin:1px}
</style></head><body>
<h1>Companions</h1>
<p>One pixel creature per subagent, 12×10 pixels (12×5 terminal cells). The model family is the creature: fable a fox (Aesop), opus an owl, sonnet a songbird (a blue fairywren, tail cocked), haiku a frog (Bashō's old pond), any other model an ink blot. The effort is the accessory: low buck teeth (the birds show them under the beak; the frog in its grin), medium a pencil tucked behind the head (the owl and the frog, with no ear to tuck it behind, balance it on top), high a mortarboard, xhigh a monocle on the right eye, max both. The state is the pose: working loops four frames at 2 fps (still, a bob, the species' own move: fox tail flick, owl glance, bird song, frog throat puff, a drip falling from the blot; then a blink), resting is the first frame held, done shuts the eyes, failed sinks a pixel, shuts the eyes and greys out.</p>
<p>Terminal renderings are decoded in this page from <code>rasterCells</code> output (▀/▄ glyphs with their colors) on a dark and a light terminal; SVGs (<code>companionSvg</code>, drawn as images as the engine's Svg element does) at 48 px and 24 px on dark and light. Built by <code>node build.mjs</code> from <code>mods/progress-pane/hooks/companions.ts</code>; open with <code>#enlarged</code>, <code>#actual</code> or <code>#poses</code> to show one section.</p>
<section id="enlarged"><h2>Enlarged (1.5×), working loop, dark and light terminal</h2>${big}</section>
<section id="actual"><h2>Actual size: family × effort (working)</h2>${grid}</section>
<section id="poses"><h2>Poses (1.5×; frame strip and SVGs at actual size)</h2>${poses}</section>
<script>
const CELLS = ${JSON.stringify(CELLS)}
const COLS = ${C.COMPANION_COLS}, ROWS = ${C.COMPANION_ROWS}, DEFAULT = 0x01000000
const hex = (n, fallback) => (n === DEFAULT ? fallback : '#' + n.toString(16).padStart(6, '0'))
function decodeTerms() {
  for (const t of document.querySelectorAll('.term[data-cells]')) {
    t.innerHTML = t.dataset.cells.split(',').map(i => {
      const b64 = CELLS[Number(i)]
      const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))
      const v = new DataView(bytes.buffer)
      let html = '<div>'
      for (let r = 0; r < ROWS; r++) {
        html += '<div>'
        for (let c = 0; c < COLS; c++) {
          const o = (r * COLS + c) * 12, cp = v.getUint32(o, true), fg = v.getUint32(o + 4, true), bg = v.getUint32(o + 8, true)
          html += '<span style="color:' + hex(fg, 'var(--tfg)') + ';background:' + hex(bg, 'transparent') + '">' + (cp === 32 ? '&nbsp;' : String.fromCodePoint(cp)) + '</span>'
        }
        html += '</div>'
      }
      return html + '</div>'
    }).join('')
  }
}
if(location.hash)document.querySelectorAll('section').forEach(s=>{if('#'+s.id!==location.hash)s.remove()})
decodeTerms()
const SVGS = ${JSON.stringify(SVGS).replace(/</g, '\\u003c')}
for (const img of document.querySelectorAll('img[data-svg]')) img.src = 'data:image/svg+xml,' + encodeURIComponent(SVGS[img.dataset.svg])
let n=0;setInterval(()=>{n=(n+1)%${C.WORKING_FRAMES};document.querySelectorAll('.term.anim').forEach(t=>t.querySelectorAll(':scope>div').forEach((d,i)=>d.classList.toggle('on',i===n)))},500)
document.querySelectorAll('.term.anim').forEach(t=>t.querySelector(':scope>div').classList.add('on'))
</script></body></html>`
writeFileSync(join(here, 'companions.html'), html)
console.log('wrote', join(here, 'companions.html'), `${html.length} bytes`)
