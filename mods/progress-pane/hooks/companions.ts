/**
 * Companions: a small pixel creature for each subagent. The model family is
 * the creature, the effort its accessory, the agent's state its pose. Pure:
 * pixels in, terminal cells (Raster) or an SVG string out.
 *
 * - A creature is a grid of COMPANION_PX_W × COMPANION_PX_H pixels, each a
 *   `#rrggbb` hex or null (transparent: the terminal's own background).
 * - On the terminal it is drawn as a Raster of COMPANION_COLS × COMPANION_ROWS
 *   cells, two pixels per cell with the upper-half block `▀` (foreground the
 *   upper pixel, background the lower).
 * - Elsewhere (desktop, VS Code, mobile) it is an SVG of crisp rects, with
 *   CSS keyframes for the working pose and `prefers-reduced-motion` honoured.
 *
 * The set is literary: fable a fox (Aesop), opus an owl, sonnet a songbird
 * (a blue fairywren), haiku a frog (Bashō's old pond), anything else an ink
 * blot. Effort adds buck teeth (low; the birds show them under the beak, the
 * joke being a bird with teeth, the frog in its grin), a pencil tucked behind
 * the head (medium; the owl and the frog balance it on top), a mortarboard
 * (high), a monocle on the right eye (xhigh), mortarboard and monocle (max).
 * Working loops still → bob → the species' own move → blink; resting holds
 * the first frame; done shuts the eyes; failed sinks, shuts them and greys.
 */
import type { Effort, Family } from './crew'

export type Pose = 'working' | 'resting' | 'done' | 'failed'

export const COMPANION_PX_W = 12
export const COMPANION_PX_H = 10
export const COMPANION_COLS = COMPANION_PX_W
export const COMPANION_ROWS = COMPANION_PX_H / 2
/** Frames of the working loop the terminal cycles through with `$.ui.blit`. */
export const WORKING_FRAMES = 4

export type Pixels = (string | null)[][]

type Rows = Record<number, string>
type Part = 'teeth' | 'pencil' | 'cap' | 'monocle'
type Species = {
  name: string
  glyph: string
  /** COMPANION_PX_H rows of COMPANION_PX_W palette keys; `.` is transparent. */
  art: readonly string[]
  palette: Readonly<Record<string, string>>
  /** Rows replaced while the eyes are shut (blink, done, failed). */
  closed: Rows
  /** Rows replaced for the species' own move in the working loop. */
  touch: Rows
  /** The body row dropped when the creature bobs (everything above sinks a pixel). */
  bob: number
  /** Top-left [row, col] of each accessory: teeth under the mouth, the monocle ringing the right eye. */
  at: Record<Part, [number, number]>
  /** The pencil lies flat across the top of the head (no ear to tuck it behind, or no room). */
  flatPencil?: true
}

/** Shared accessory inks: pencil yellow and eraser, cap ink blue with a gold tassel, monocle gold. */
const KIT: Readonly<Record<string, string>> = {
  T: '#fbf6e9', P: '#f2c230', E: '#ee8fa2', W: '#e7c9a0', G: '#4a4a4a',
  C: '#4f78d8', c: '#2f4fa8', Y: '#f5c842', M: '#e8b73c', m: '#b38a2a',
}

type Accessory = { shape: readonly string[]; behind?: boolean }
const TEETH: Accessory = { shape: ['TT'] }
/** Drawn behind the creature: only its ends show, as if tucked behind the ear. */
const PENCIL: Accessory = { shape: ['....E', '...P.', '..P..', '.W...', 'G....'], behind: true }
const PENCIL_FLAT: Accessory = { shape: ['GWPPPE'] }
const CAP: Accessory = { shape: ['CCCCCCC', '.cccccY', '......Y'] }
/** A gold ring around the eye pixel, its chain hanging to the right. */
const MONOCLE: Accessory = { shape: ['.M.', 'M.M', '.Mm', '...m'] }

const SPECIES: Readonly<Record<Family, Species>> = {
  fable: {
    name: 'fox', glyph: '▼',
    art: [
      'oo....oo....',
      'obo..obo....',
      'obboobbo....',
      'obbbbbbo.oo.',
      'obebbebo.olo',
      'ollbbllo.obo',
      '.olkklo.obbo',
      '.obbbbooobbo',
      'obbllbbbbbo.',
      'oooooooooo..',
    ],
    palette: { o: '#7c3410', b: '#e8833a', l: '#f6ead6', e: '#22140b', k: '#22140b', c: '#b4561c' },
    closed: { 4: 'obcbbcbo.olo' },
    touch: { 3: 'obbbbbbo....', 4: 'obebbebo.oo.', 5: 'ollbbllo.olo' },
    bob: 3,
    at: { teeth: [7, 3], pencil: [0, 6], cap: [0, 1], monocle: [3, 4] },
  },
  opus: {
    name: 'owl', glyph: '◉',
    art: [
      'ob........bo',
      '.oboooooobo.',
      '.obbbbbbbbo.',
      '.olllbblllo.',
      '.olelbblelo.',
      '.olllkklllo.',
      '.odbbkkbbdo.',
      '.odblbblbdo.',
      '..odbbbbdo..',
      '...kk..kk...',
    ],
    palette: { o: '#4b3221', b: '#a8784a', d: '#6e4b2e', l: '#efdcb7', e: '#1d1712', k: '#e59a2f', c: '#6e4b2e' },
    closed: { 4: '.occcbbccco.' },
    touch: { 4: '.oellbbello.' },
    bob: 6,
    at: { teeth: [7, 5], pencil: [0, 3], cap: [0, 2], monocle: [3, 7] },
    flatPencil: true,
  },
  sonnet: {
    name: 'songbird', glyph: '♪',
    art: [
      '..........oo',
      '..oooo...odo',
      '.obbbbo.odo.',
      'obebbbbodo..',
      'kkbbbbddo...',
      '.obbbdddo...',
      '.ollddddo...',
      '..ollddo....',
      '...oooo.....',
      '....k.k.....',
    ],
    palette: { o: '#173d5c', b: '#4aa8dc', d: '#2f6f9e', l: '#e3eef2', e: '#0c1822', k: '#9c8b78', c: '#2f6f9e' },
    closed: { 3: 'obcbbbbodo..' },
    touch: { 3: 'kkebbbbodo..', 4: '.kbbbbddo...' },
    bob: 6,
    at: { teeth: [5, 1], pencil: [0, 5], cap: [0, 0], monocle: [2, 1] },
  },
  haiku: {
    name: 'frog', glyph: '≈',
    art: [
      '............',
      '..ooo..ooo..',
      '.oleloolelo.',
      '.obbbbbbbbo.',
      'obbbbbbbbbbo',
      'obobbbbbbobo',
      'obbooooooobo',
      '.obllllllbo.',
      'oobllllllboo',
      'gg.oooooo.gg',
    ],
    palette: { o: '#2c5a1e', b: '#6cbf4a', l: '#d7ecaa', e: '#13240c', g: '#4c9a34', c: '#3f7a2a' },
    closed: { 2: '.occcooccco.' },
    touch: { 7: 'obllllllllbo', 8: 'oollllllllooo'.slice(0, 12) },
    bob: 4,
    at: { teeth: [6, 5], pencil: [0, 3], cap: [0, 3], monocle: [1, 7] },
    flatPencil: true,
  },
  other: {
    name: 'ink blot', glyph: '✱',
    art: [
      '.b..........',
      '....oooo...b',
      '..oobbbboo..',
      '.obbbbbbbbo.',
      'oobebbbbebo.',
      '.obbbbbbbbo.',
      '.obbboobbboo',
      '..obobbobo..',
      '..ob.ob..b..',
      '...b..b.....',
    ],
    palette: { o: '#2e2766', b: '#7a6ed2', e: '#f4f0ff', c: '#2e2766' },
    closed: { 4: 'oobcbbbbcbo.' },
    touch: { 8: '..ob.ob.....', 9: '...b..b..b..' },
    bob: 5,
    at: { teeth: [7, 5], pencil: [0, 6], cap: [0, 2], monocle: [3, 7] },
  },
}

const EFFORT_KIT: Readonly<Record<Effort, { name: string; parts: readonly Part[] }>> = {
  none: { name: '', parts: [] },
  low: { name: 'buck teeth', parts: ['teeth'] },
  medium: { name: 'pencil behind the ear', parts: ['pencil'] },
  high: { name: 'scholar’s cap', parts: ['cap'] },
  xhigh: { name: 'monocle', parts: ['monocle'] },
  max: { name: 'scholar’s cap and monocle', parts: ['cap', 'monocle'] },
}

type Keys = (string | null)[][]

const keysOf = (rows: readonly string[]): Keys =>
  Array.from({ length: COMPANION_PX_H }, (_, r) =>
    Array.from({ length: COMPANION_PX_W }, (_, c) => {
      const k = (rows[r] ?? '').charAt(c)
      return k === '' || k === '.' ? null : k
    }))

const withRows = (art: readonly string[], ...patches: Rows[]): string[] =>
  art.map((row, r) => patches.reduce<string>((acc, p) => p[r] ?? acc, row))

/** Paints an accessory at [row, col] as `!`-prefixed kit keys; one drawn behind only fills transparent pixels. */
function paint(grid: Keys, a: Accessory, [r0, c0]: [number, number]): void {
  a.shape.forEach((row, dr) => {
    for (let dc = 0; dc < row.length; dc++) {
      const k = row.charAt(dc)
      const line = grid[r0 + dr]
      if (k === '.' || !line || c0 + dc >= COMPANION_PX_W) continue
      if (a.behind && line[c0 + dc] !== null) continue
      line[c0 + dc] = `!${k}`
    }
  })
}

const normFrame = (frame: number) => ((Math.trunc(frame) % WORKING_FRAMES) + WORKING_FRAMES) % WORKING_FRAMES

/** Grey a color most of the way, for a failed agent: still readable, plainly not well. */
function desaturate(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const y = 0.3 * (ch[0] ?? 0) + 0.59 * (ch[1] ?? 0) + 0.11 * (ch[2] ?? 0)
  return `#${ch.map(v => Math.round(v * 0.25 + y * 0.75).toString(16).padStart(2, '0')).join('')}`
}

/** The creature for a model family, with its effort's accessory, in a pose; `frame` cycles the working loop. */
export function companionPixels(family: Family, effort: Effort, pose: Pose, frame: number): Pixels {
  const s = SPECIES[family]
  const f = pose === 'working' ? normFrame(frame) : 0
  const shut = pose === 'done' || pose === 'failed' || (pose === 'working' && f === 3)
  const art = withRows(s.art, shut ? s.closed : {}, pose === 'working' && f === 2 ? s.touch : {})
  const grid = keysOf(art)
  const shapes: Record<Part, Accessory> = { teeth: TEETH, pencil: s.flatPencil ? PENCIL_FLAT : PENCIL, cap: CAP, monocle: MONOCLE }
  for (const part of EFFORT_KIT[effort].parts) paint(grid, shapes[part], s.at[part])
  const sink = (pose === 'working' && f === 1) || pose === 'failed'
  const rows = sink ? [grid[0]?.map(() => null) ?? [], ...grid.slice(0, s.bob), ...grid.slice(s.bob + 1)] : grid
  return rows.map(row => row.map(k => {
    if (k === null) return null
    const hex = k.startsWith('!') ? KIT[k.slice(1)] : s.palette[k]
    if (hex === undefined) return null
    return pose === 'failed' ? desaturate(hex) : hex
  }))
}

const DEFAULT = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: readonly number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : B64.charAt(n & 63)
  }
  return out
}

const colorOf = (hex: string | null | undefined) => (hex ? parseInt(hex.slice(1), 16) : DEFAULT)

/** Packs pixels as RasterProps `cells`: base64 of little-endian u32 [codePoint, fg, bg] per cell. */
export function rasterCells(pixels: Pixels): string {
  const bytes: number[] = []
  const word = (n: number) => bytes.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255)
  for (let r = 0; r < COMPANION_ROWS; r++) {
    for (let c = 0; c < COMPANION_COLS; c++) {
      const up = pixels[2 * r]?.[c] ?? null
      const lo = pixels[2 * r + 1]?.[c] ?? null
      const [cp, fg, bg] = up ? [0x2580, colorOf(up), colorOf(lo)] : lo ? [0x2584, colorOf(lo), DEFAULT] : [0x20, DEFAULT, DEFAULT]
      word(cp)
      word(fg)
      word(bg)
    }
  }
  return base64(bytes)
}

/** One `<path>` per color: each horizontal run of a color is one rect. */
function paths(cells: readonly (readonly [number, number, string])[]): string {
  const byColor = new Map<string, string>()
  const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let i = 0
  while (i < sorted.length) {
    const [r, c, hex] = sorted[i] ?? [0, 0, '']
    let w = 1
    while (sorted[i + w]?.[0] === r && sorted[i + w]?.[1] === c + w && sorted[i + w]?.[2] === hex) w++
    byColor.set(hex, `${byColor.get(hex) ?? ''}M${c} ${r}h${w}v1h-${w}z`)
    i += w
  }
  return [...byColor].map(([hex, d]) => `<path fill="${hex}" d="${d}"/>`).join('')
}

const cellsOf = (p: Pixels) => p.flatMap((row, r) => row.flatMap((hex, c) => (hex ? [[r, c, hex] as const] : [])))

/** The creature as one SVG document (`size` CSS px wide), animated while `pose` is working. */
export function companionSvg(family: Family, effort: Effort, pose: Pose, size: number): string {
  const w = Math.max(1, Math.round(size))
  const h = Math.round((w * COMPANION_PX_H) / COMPANION_PX_W)
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${COMPANION_PX_W} ${COMPANION_PX_H}" shape-rendering="crispEdges">`
  if (pose !== 'working') return `${open}${paths(cellsOf(companionPixels(family, effort, pose, 0)))}</svg>`
  const frames = Array.from({ length: WORKING_FRAMES }, (_, f) => companionPixels(family, effort, pose, f))
  const same = (r: number, c: number) => frames.every(p => p[r]?.[c] === frames[0]?.[r]?.[c])
  const still = cellsOf(frames[0] ?? []).filter(([r, c]) => same(r, c))
  const moving = frames.map(p => cellsOf(p).filter(([r, c]) => !same(r, c)))
  const period = WORKING_FRAMES * 0.5
  const style = `<style>.f{opacity:0;animation:k ${period}s steps(1,end) infinite}.f0{opacity:1}`
    + `@keyframes k{0%{opacity:1}${100 / WORKING_FRAMES}%,100%{opacity:0}}`
    + moving.map((_, f) => (f ? `.f${f}{animation-delay:-${period - f * 0.5}s}` : '')).join('')
    + '@media (prefers-reduced-motion:reduce){.f{animation:none}}</style>'
  return `${open}${style}${paths(still)}${moving.map((m, f) => `<g class="f f${f}">${paths(m)}</g>`).join('')}</svg>`
}

/** One width-1 glyph standing for the creature, where nothing can be drawn (the band, Markdown). */
export function companionGlyph(family: Family): string {
  return SPECIES[family].glyph
}

/** "owl", "frog": what the person calls the creature, for alt text and the agent page. */
export function creatureName(family: Family): string {
  return SPECIES[family].name
}

/** "pencil behind the ear": the accessory, for alt text and the agent page. */
export function accessoryName(effort: Effort): string {
  return EFFORT_KIT[effort].name
}
