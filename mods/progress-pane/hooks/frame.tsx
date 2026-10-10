/**
 * The Notebook page: every pane row goes through one frame. On the terminal
 * that is cell 1 a space, cell 2 the margin glyph, cell 3 a space, cell 4 the
 * ruled margin line `│` (theme key `subtle`), cell 5 a space, body from cell 6;
 * a right-aligned note ends on the next-to-last cell, two cells at least from
 * the body. Below 48 columns the line is dropped (glyph + space). In a
 * proportional font (desktop, VS Code, mobile) the frame is kept as layout: a
 * fixed-width margin Box, a body Box, the note pushed right by a spacer.
 *
 * On the terminal the gaps are literal spaces, computed from the width, so
 * every row of a page ends on the same cell. Pure: element table + data in.
 */
import type { ElementTable, RenderNode } from 'claude-code'

import type { Step } from './worklog'
import { clipTitle } from './text'
import type { Tones } from './view-types'

/** A run of text in one style. `color` is a theme key or a hex. */
export type Part = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** One page's frame: the surface's table and grid, and the session's colors. */
export type Frame = { t: ElementTable; width: number; mono: boolean; ruled: boolean; tones: Tones }

/** Below this many columns the terminal page drops its margin line. */
const RULED_MIN = 48
/** SIGNALS and step-details labels share this width (7 + one space). */
export const LABEL_CELLS = 8
const RULE = '┄'
const LINE_KEY = 'subtle'

export function frameOf(t: ElementTable, tones: Tones, width: number, mono: boolean, ruled = true): Frame {
  return { t, width, mono, ruled: mono && ruled && width >= RULED_MIN, tones }
}

/** Cells before the body: ` g │ ` ruled, ` g ` otherwise. */
const marginCells = (f: Frame) => (f.ruled ? 5 : 3)
const len = (s: string) => [...s].length
const partsLen = (parts: Part[]) => parts.reduce((n, p) => n + len(p.text), 0)

/** Parts cut to `max` cells, the last kept one ending in `…`. */
export function clipParts(parts: Part[], max: number): Part[] {
  if (partsLen(parts) <= max) return parts
  const out: Part[] = []
  let room = max
  for (const p of parts) {
    if (room <= 0) break
    const n = len(p.text)
    if (n < room) {
      out.push(p)
      room -= n
    } else {
      out.push({ ...p, text: clipTitle(p.text, room) })
      room = 0
    }
  }
  return out
}

/** Greedy word wrap to `width` cells; a word longer than a line is cut across lines. */
export function wordWrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (len(w) > width) {
      if (line) { lines.push(line); line = '' }
      lines.push([...w].slice(0, width).join(''))
      w = [...w].slice(width).join('')
    }
    if (!w) continue
    if (!line) line = w
    else if (len(line) + 1 + len(w) <= width) line = `${line} ${w}`
    else { lines.push(line); line = w }
  }
  if (line || lines.length === 0) lines.push(line)
  return lines
}

export type Glyph = { glyph: string; color?: string; dim?: boolean; bold?: boolean }

/** A step's margin glyph: □ todo · pen doing · ✓ done · ! blocked · – skipped; `~` when drift names it. */
export function stepGlyph(status: Step['status'], tones: Tones, drifted = false): Glyph {
  if (drifted) return { glyph: '~', color: 'text', bold: true }
  switch (status) {
    case 'todo': return { glyph: '□', dim: true }
    case 'doing': return { glyph: tones.pen, color: tones.ink, bold: true }
    case 'done': return { glyph: '✓', color: 'success' }
    case 'blocked': return { glyph: '!', color: 'error', bold: true }
    case 'skipped': return { glyph: '–', dim: true }
    default: {
      const never: never = status
      return { glyph: String(never) }
    }
  }
}

/** A phase's margin glyph: ✓ done · ▸ current (ink) · □ todo. */
export function phaseGlyph(state: 'done' | 'current' | 'todo', tones: Tones): Glyph {
  return state === 'done' ? { glyph: '✓', color: 'success' } : state === 'current' ? { glyph: '▸', color: tones.ink, bold: true } : { glyph: '□', dim: true }
}

export type RowSpec = Partial<Glyph> & {
  /** A fixed-width dim label before the body (`gate`, `status`); '' keeps the column empty. */
  label?: string
  body: Part[]
  /** The body is a Button: `key` its address. */
  press?: { key: string; onPress: () => void; dim?: boolean }
  /** Right-aligned margin note. */
  note?: Part[]
  /** The doing row: the highlighter runs under the body to the last cell. */
  highlight?: boolean
}

function partTexts(t: ElementTable, parts: Part[]): RenderNode[] {
  const { Text } = t
  return parts.map((p, i) => <Text key={`p${i}`} color={p.color} dimColor={p.dim} bold={p.bold}>{p.text}</Text>)
}

/** The margin cells before the body (the cell-5 space excluded: it belongs to the body). */
function margin(f: Frame, g: Partial<Glyph>): RenderNode[] {
  const { Text } = f.t
  return [
    <Text key="m1"> </Text>,
    <Text key="mg" color={g.color} dimColor={g.dim} bold={g.bold}>{g.glyph || ' '}</Text>,
    <Text key="m3"> </Text>,
    ...(f.ruled ? [<Text key="ml" color={LINE_KEY}>│</Text>] : []),
  ]
}

function bodyNode(f: Frame, spec: RowSpec, parts: Part[]): RenderNode {
  const { Text, Button } = f.t
  if (!spec.press) return <Text key="body" wrap="truncate-end">{partTexts(f.t, parts)}</Text>
  const label = parts.map(p => p.text).join('')
  return <Button key={spec.press.key} plain dimColor={spec.press.dim} label={label} onPress={spec.press.onPress}>{partTexts(f.t, parts)}</Button>
}

/** One row of the page. */
export function row(f: Frame, key: string, spec: RowSpec): RenderNode {
  const { Box, Text } = f.t
  const bg = spec.highlight && f.tones.highlighter ? f.tones.highlighter : undefined
  if (!f.mono) {
    return (
      <Box key={key} flexDirection="row">
        <Box width={3} justifyContent="center"><Text color={spec.color} dimColor={spec.dim} bold={spec.bold}>{spec.glyph || ' '}</Text></Box>
        <Box flexDirection="row" flexGrow={1} backgroundColor={bg}>
          {spec.label !== undefined ? <Box width={LABEL_CELLS}><Text dimColor>{spec.label}</Text></Box> : null}
          {bodyNode(f, spec, spec.body)}
          <Box flexGrow={1} minWidth={2} />
          {spec.note?.length ? <Text>{partTexts(f.t, spec.note)}</Text> : null}
        </Box>
      </Box>
    )
  }
  const lead = f.ruled ? 1 : 0
  // The note ends one cell short of the width; the highlighter fills that cell too.
  const avail = f.width - 1 - marginCells(f)
  const labelLen = spec.label !== undefined ? LABEL_CELLS : 0
  let note = spec.note?.length ? spec.note : undefined
  let noteLen = note ? partsLen(note) : 0
  if (note && avail - labelLen - noteLen - 2 < 6) { note = undefined; noteLen = 0 }
  const body = clipParts(spec.body, Math.max(1, avail - labelLen - (note ? noteLen + 2 : 0)))
  const fill = note || bg ? avail - labelLen - partsLen(body) - noteLen : 0
  return (
    <Box key={key} flexDirection="row">
      {margin(f, spec)}
      <Box flexDirection="row" backgroundColor={bg}>
        {lead ? <Text key="m5"> </Text> : null}
        {spec.label !== undefined ? <Text key="label" dimColor>{spec.label.padEnd(LABEL_CELLS)}</Text> : null}
        {bodyNode(f, spec, body)}
        {fill > 0 ? <Text key="fill">{' '.repeat(fill)}</Text> : null}
        {note ? partTexts(f.t, note) : null}
        {bg ? <Text key="end"> </Text> : null}
      </Box>
    </Box>
  )
}

/**
 * A long text as rows: on the terminal word-wrapped to the body column so the
 * margin line runs on beside every line (the first carries the glyph, label,
 * `lead` and note); in a proportional font one row that wraps.
 */
export function wrappedRows(f: Frame, key: string, spec: Omit<RowSpec, 'body' | 'press'> & { lead?: Part; text: Part }): RenderNode[] {
  const { lead, text, ...rest } = spec
  const leadParts = lead ? [lead] : []
  if (!f.mono) {
    const { Box, Text } = f.t
    return [
      <Box key={key} flexDirection="row">
        <Box width={3} justifyContent="center"><Text color={spec.color} dimColor={spec.dim} bold={spec.bold}>{spec.glyph || ' '}</Text></Box>
        {spec.label !== undefined ? <Box width={LABEL_CELLS}><Text dimColor>{spec.label}</Text></Box> : null}
        <Box flexDirection="row" flexGrow={1}><Text wrap="wrap">{partTexts(f.t, [...leadParts, text])}</Text></Box>
        {spec.note?.length ? <Text>{partTexts(f.t, spec.note)}</Text> : null}
      </Box>,
    ]
  }
  const avail = f.width - 1 - marginCells(f) - (spec.label !== undefined ? LABEL_CELLS : 0)
  const noteLen = spec.note?.length ? partsLen(spec.note) + 2 : 0
  const leadLen = partsLen(leadParts)
  const lines = wordWrap(text.text, Math.max(8, avail - noteLen - leadLen))
  return lines.map((line, i) => (i === 0
    ? row(f, `${key}-${i}`, { ...rest, body: [...leadParts, { ...text, text: line }] })
    : row(f, `${key}-${i}`, { ...(spec.label !== undefined ? { label: '' } : {}), body: [{ text: ' '.repeat(leadLen) }, { ...text, text: line }] })))
}

/** A row whose body is drawn by the caller (buttons, a field), still through the frame. */
export function framed(f: Frame, key: string, content: RenderNode, glyph: Partial<Glyph> = {}): RenderNode {
  const { Box, Text } = f.t
  if (!f.mono) {
    return (
      <Box key={key} flexDirection="row">
        <Box width={3} justifyContent="center"><Text color={glyph.color} bold={glyph.bold}>{glyph.glyph || ' '}</Text></Box>
        <Box flexDirection="row" flexGrow={1}>{content}</Box>
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="row">
      {margin(f, glyph)}
      {f.ruled ? <Text key="m5"> </Text> : null}
      <Box flexDirection="row" flexGrow={1}>{content}</Box>
    </Box>
  )
}

/** The one blank row between sections; it still carries the margin line. A proportional font spaces with marginTop instead. */
export function blank(f: Frame, key: string): RenderNode | null {
  const { Box, Text } = f.t
  if (!f.mono) return null
  return (
    <Box key={key} flexDirection="row">
      <Text>{'   '}</Text>
      {f.ruled ? <Text color={LINE_KEY}>│</Text> : null}
    </Box>
  )
}

/**
 * A section rule `LABEL ┄┄┄`, sized to the body column `columns`: alone it
 * runs to the last cell; with a tail (the PLAN chips) the dashes stop two
 * cells before it and the tail ends on the note column, clipped to fit.
 */
export function ruleParts(label: string, columns: number, tail = ''): { line: string; tail: string } {
  const base = columns - len(label) - 1
  const room = base - 2 - 2 - 1
  const shown = tail && room >= 2 ? clipTitle(tail, room) : ''
  const dashes = shown ? base - 1 - 2 - len(shown) : base
  return { line: RULE.repeat(Math.max(2, dashes)), tail: shown }
}

/** The PLAN chips colored: ✓ success, ▸ ink, the rest dim. */
function chipParts(tail: string, tones: Tones): Part[] {
  return tail.split(' ').flatMap((chip, i) => {
    const sep: Part[] = i > 0 ? [{ text: ' ' }] : []
    const color = chip.startsWith('✓') ? 'success' : chip.startsWith('▸') ? tones.ink : undefined
    return [...sep, { text: chip, ...(color ? { color } : { dim: true }) }]
  })
}

export function rule(f: Frame, key: string, label: string, color: string, tail = ''): RenderNode {
  const { Box, Text } = f.t
  if (!f.mono) {
    return (
      <Box key={key} flexDirection="row" marginTop={1}>
        <Box width={3} />
        {/* A gap, not leading spaces: a proportional layout may collapse those. */}
        <Box flexDirection="row" gap={3}>
          <Text bold color={color}>{label}</Text>
          {tail ? <Text dimColor wrap="truncate-end">{tail}</Text> : null}
        </Box>
      </Box>
    )
  }
  const parts = ruleParts(label, f.width - marginCells(f), tail)
  return (
    <Box key={key} flexDirection="row">
      <Text>{'   '}</Text>
      {f.ruled ? <Text color={LINE_KEY}>│</Text> : null}
      {f.ruled ? <Text> </Text> : null}
      <Text bold color={color}>{label}</Text>
      <Text> </Text>
      <Text color={LINE_KEY}>{parts.line}</Text>
      {parts.tail ? <Text>  </Text> : null}
      {parts.tail ? partTexts(f.t, chipParts(parts.tail, f.tones)) : null}
    </Box>
  )
}
