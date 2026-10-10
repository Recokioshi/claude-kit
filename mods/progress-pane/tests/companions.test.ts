import { describe, expect, test } from 'claude-code/testing'

import {
  COMPANION_COLS, COMPANION_PX_H, COMPANION_PX_W, COMPANION_ROWS, WORKING_FRAMES,
  accessoryName, companionGlyph, companionPixels, companionSvg, creatureName, rasterCells,
} from '../hooks/companions'
import type { Pixels, Pose } from '../hooks/companions'
import type { Effort, Family } from '../hooks/crew'

const FAMILIES: Family[] = ['fable', 'opus', 'sonnet', 'haiku', 'other']
const EFFORTS: Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const POSES: Pose[] = ['working', 'resting', 'done', 'failed']
const DEFAULT = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 back to bytes, as the engine reads `cells`. */
function unbase64(text: string): number[] {
  expect(text.length % 4).toBe(0)
  const bytes: number[] = []
  for (let i = 0; i < text.length; i += 4) {
    const quad = text.slice(i, i + 4)
    const n = [...quad].reduce((acc, ch) => (acc << 6) | (ch === '=' ? 0 : B64.indexOf(ch)), 0)
    bytes.push((n >> 16) & 255)
    if (quad.charAt(2) !== '=') bytes.push((n >> 8) & 255)
    if (quad.charAt(3) !== '=') bytes.push(n & 255)
  }
  return bytes
}

/** Bytes as little-endian u32 [codePoint, fg, bg] triplets. */
function triplets(bytes: number[]): [number, number, number][] {
  const words: number[] = []
  for (let i = 0; i < bytes.length; i += 4) words.push(((bytes[i + 3] ?? 0) * 2 ** 24) + ((bytes[i + 2] ?? 0) << 16) + ((bytes[i + 1] ?? 0) << 8) + (bytes[i] ?? 0))
  const out: [number, number, number][] = []
  for (let i = 0; i < words.length; i += 3) out.push([words[i] ?? -1, words[i + 1] ?? -1, words[i + 2] ?? -1])
  return out
}

const color = (hex: string | null | undefined) => (hex ? parseInt(hex.slice(1), 16) : DEFAULT)
const mask = (p: Pixels) => p.map(row => row.map(px => (px === null ? '.' : '#')).join('')).join('\n')
const flat = (p: Pixels) => JSON.stringify(p)

function everyCombination(fn: (f: Family, e: Effort, p: Pose, frame: number) => void): void {
  for (const f of FAMILIES) for (const e of EFFORTS) for (const p of POSES) for (let frame = 0; frame < WORKING_FRAMES; frame++) fn(f, e, p, frame)
}

describe('companionPixels', () => {
  test('is a 10×12 grid of #rrggbb or null for every family, effort, pose and frame', () => {
    everyCombination((f, e, p, frame) => {
      const px = companionPixels(f, e, p, frame)
      expect(px).toHaveLength(COMPANION_PX_H)
      for (const row of px) {
        expect(row).toHaveLength(COMPANION_PX_W)
        for (const cell of row) if (cell !== null) expect(cell).toMatch(/^#[0-9a-f]{6}$/)
      }
    })
  })

  test('is deterministic', () => {
    everyCombination((f, e, p, frame) => expect(flat(companionPixels(f, e, p, frame))).toBe(flat(companionPixels(f, e, p, frame))))
  })

  test('the working loop cycles modulo WORKING_FRAMES, negative frames included', () => {
    for (const f of FAMILIES) {
      for (let frame = 0; frame < WORKING_FRAMES; frame++) {
        const px = flat(companionPixels(f, 'high', 'working', frame))
        expect(flat(companionPixels(f, 'high', 'working', frame + WORKING_FRAMES * 3))).toBe(px)
        expect(flat(companionPixels(f, 'high', 'working', frame - WORKING_FRAMES))).toBe(px)
      }
    }
  })

  test('working is alive: its frames are not all the same; other poses ignore the frame', () => {
    for (const f of FAMILIES) {
      const frames = new Set(Array.from({ length: WORKING_FRAMES }, (_, i) => flat(companionPixels(f, 'none', 'working', i))))
      expect(frames.size).toBe(WORKING_FRAMES)
      for (const p of ['resting', 'done', 'failed'] as const) expect(flat(companionPixels(f, 'none', p, 3))).toBe(flat(companionPixels(f, 'none', p, 0)))
    }
  })

  test('resting is the first working frame; done and failed differ from it', () => {
    for (const f of FAMILIES) {
      const resting = flat(companionPixels(f, 'medium', 'resting', 0))
      expect(flat(companionPixels(f, 'medium', 'working', 0))).toBe(resting)
      expect(flat(companionPixels(f, 'medium', 'done', 0))).not.toBe(resting)
      expect(flat(companionPixels(f, 'medium', 'failed', 0))).not.toBe(resting)
    }
  })

  test('failed is desaturated: every channel spread narrower than resting', () => {
    const spread = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      return Math.max(...ch) - Math.min(...ch)
    }
    for (const f of FAMILIES) {
      const sum = (p: Pixels) => p.flat().reduce((acc, px) => acc + (px ? spread(px) : 0), 0)
      expect(sum(companionPixels(f, 'none', 'failed', 0))).toBeLessThan(sum(companionPixels(f, 'none', 'resting', 0)) / 2)
    }
  })

  test('every family has its own silhouette', () => {
    const masks = new Set(FAMILIES.map(f => mask(companionPixels(f, 'none', 'resting', 0))))
    expect(masks.size).toBe(FAMILIES.length)
  })

  test('every effort but none adds accessory pixels, in every pose', () => {
    for (const f of FAMILIES) {
      for (const p of POSES) {
        const bare = flat(companionPixels(f, 'none', p, 0))
        for (const e of EFFORTS.filter(x => x !== 'none')) expect(flat(companionPixels(f, e, p, 0))).not.toBe(bare)
        const max = flat(companionPixels(f, 'max', p, 0))
        expect(max).not.toBe(flat(companionPixels(f, 'high', p, 0)))
        expect(max).not.toBe(flat(companionPixels(f, 'xhigh', p, 0)))
      }
    }
  })

  test('the efforts look different from one another', () => {
    for (const f of FAMILIES) {
      const looks = new Set(EFFORTS.map(e => flat(companionPixels(f, e, 'resting', 0))))
      expect(looks.size).toBe(EFFORTS.length)
    }
  })
})

describe('rasterCells', () => {
  test('packs 12×5 cells: 720 bytes, 960 base64 characters', () => {
    const cells = rasterCells(companionPixels('opus', 'max', 'working', 1))
    expect(cells).toHaveLength(960)
    expect(cells).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(unbase64(cells)).toHaveLength(COMPANION_COLS * COMPANION_ROWS * 12)
  })

  test('decodes back to the pixels: ▀ upper over lower, ▄ when only the lower is drawn, space when neither', () => {
    everyCombination((f, e, p, frame) => {
      if (frame > 1) return
      const px = companionPixels(f, e, p, frame)
      const cells = triplets(unbase64(rasterCells(px)))
      expect(cells).toHaveLength(COMPANION_COLS * COMPANION_ROWS)
      cells.forEach(([cp, fg, bg], i) => {
        const r = Math.floor(i / COMPANION_COLS)
        const c = i % COMPANION_COLS
        const up = px[2 * r]?.[c] ?? null
        const lo = px[2 * r + 1]?.[c] ?? null
        if (up) expect([cp, fg, bg]).toEqual([UPPER, color(up), color(lo)])
        else if (lo) expect([cp, fg, bg]).toEqual([LOWER, color(lo), DEFAULT])
        else expect([cp, fg, bg]).toEqual([SPACE, DEFAULT, DEFAULT])
      })
    })
  })

  test('transparent pixels are the terminal default color, bit 24 alone', () => {
    const empty: Pixels = Array.from({ length: COMPANION_PX_H }, () => Array.from({ length: COMPANION_PX_W }, () => null))
    for (const cell of triplets(unbase64(rasterCells(empty)))) expect(cell).toEqual([SPACE, DEFAULT, DEFAULT])
    const top: Pixels = empty.map((row, r) => row.map(() => (r % 2 === 0 ? '#123456' : null)))
    for (const cell of triplets(unbase64(rasterCells(top)))) expect(cell).toEqual([UPPER, 0x123456, DEFAULT])
    const bottom: Pixels = empty.map((row, r) => row.map(() => (r % 2 === 1 ? '#abcdef' : null)))
    for (const cell of triplets(unbase64(rasterCells(bottom)))) expect(cell).toEqual([LOWER, 0xabcdef, DEFAULT])
  })
})

describe('companionSvg', () => {
  test('is one small, script-free SVG document of crisp pixels at the asked width', () => {
    for (const f of FAMILIES) for (const e of EFFORTS) for (const p of POSES) {
      const svg = companionSvg(f, e, p, 48)
      expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="40" viewBox="0 0 12 10"')
      expect(svg).toEndWith('</svg>')
      expect(svg).toContain('shape-rendering="crispEdges"')
      expect(svg.length).toBeLessThan(20_000)
      expect(svg).not.toMatch(/<script|on[a-z]+=|href|url\(|@import/i)
      expect(svg.match(/<svg/g)).toHaveLength(1)
      const opened = (svg.match(/<g\b/g) ?? []).length
      expect((svg.match(/<\/g>/g) ?? []).length).toBe(opened)
    }
  })

  test('animates the working pose and honours reduced motion; other poses are still', () => {
    const working = companionSvg('haiku', 'medium', 'working', 24)
    expect(working).toContain('@keyframes')
    expect(working).toContain('prefers-reduced-motion')
    for (let f = 0; f < WORKING_FRAMES; f++) expect(working).toContain(`class="f f${f}"`)
    for (const p of ['resting', 'done', 'failed'] as const) expect(companionSvg('haiku', 'medium', p, 24)).not.toContain('<style')
  })

  test('draws every pixel of a still pose in its color', () => {
    const svg = companionSvg('fable', 'xhigh', 'resting', 36)
    for (const hex of new Set(companionPixels('fable', 'xhigh', 'resting', 0).flat())) if (hex) expect(svg).toContain(`fill="${hex}"`)
  })
})

describe('names and glyphs', () => {
  test('each family has a distinct width-1 BMP glyph', () => {
    const glyphs = FAMILIES.map(companionGlyph)
    expect(new Set(glyphs).size).toBe(FAMILIES.length)
    for (const g of glyphs) {
      expect([...g]).toHaveLength(1)
      expect(g).toHaveLength(1)
      const cp = g.codePointAt(0) ?? 0
      expect(cp).toBeLessThanOrEqual(0xffff)
      expect(cp >= 0x1100 && cp <= 0x115f).toBe(false)
      expect(cp >= 0x2e80 && cp <= 0xa4cf).toBe(false)
      expect(cp >= 0xac00 && cp <= 0xd7a3).toBe(false)
      expect(cp >= 0xf900 && cp <= 0xfaff).toBe(false)
      expect(cp >= 0xff00 && cp <= 0xff60).toBe(false)
    }
  })

  test('creatures and accessories have short lowercase names; none has no accessory', () => {
    expect(FAMILIES.map(creatureName)).toEqual(['fox', 'owl', 'songbird', 'frog', 'ink blot'])
    expect(accessoryName('none')).toBe('')
    for (const e of EFFORTS.filter(x => x !== 'none')) {
      expect(accessoryName(e)).toMatch(/^[a-z’ ]+$/)
    }
    expect(accessoryName('medium')).toBe('pencil behind the ear')
  })
})
