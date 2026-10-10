/**
 * The Agents tab: every subagent of the session as a notebook entry, its
 * companion beside it (the model is the creature, the effort its accessory),
 * its own progress, figures and last move. And one agent's page: everything
 * known about it, then its log. Pure: element table + data in, tree out.
 *
 * Frame (terminal): ` g │ ` margin (status glyph, ruled line on `subtle`),
 * then the companion (a Raster, 12×5 cells), two cells of air, the body.
 * Elsewhere: a fixed-width margin Box and the companion as an Svg.
 */
import type { ElementTable } from 'claude-code'

import { accessoryName, COMPANION_COLS, COMPANION_ROWS, companionGlyph, companionPixels, companionSvg, creatureName, rasterCells, WORKING_FRAMES } from './companions'
import { fmtCost, fmtTokens } from './cost'
import { contextPercent, effortOf, elapsedMs, familyOf, modelName, poseOf, progressOf, rosterOf, totalsOf } from './crew'
import { ago, lasted } from './observe'
import type { AgentRow } from './observe'
import type { PaneActions, PaneView, ViewData } from './view-types'

/** The Raster key of an agent's companion: what the hooks module blits the next frame to. */
export const companionKey = (id: string) => `companion-${id}`

/** The frame the working loop shows at `now`, in step with the hooks module's timer (500 ms). */
const frameAt = (now: number) => Math.floor(now / 500) % WORKING_FRAMES

const SVG_PX = 48
const MARGIN = 5
const GAP = 2
const LABEL = 9

const clip = (text: string, max: number) => (max <= 1 ? '' : text.length <= max ? text : `${text.slice(0, max - 1)}…`)
const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`

type Mark = { glyph: string; tone?: string; bold?: boolean }

function markOf(a: AgentRow, data: ViewData): Mark {
  if (a.status === 'done') return { glyph: '✓', tone: 'success' }
  if (a.status === 'failed') return { glyph: '✗', tone: 'error', bold: true }
  return { glyph: data.tones.pen, tone: data.tones.ink, bold: true }
}

/** "Opus 5.5 · xhigh", the effort left out when the engine sent none. */
function modelLine(a: AgentRow): string {
  const effort = effortOf(a.effort)
  return `${modelName(a.model)}${effort === 'none' ? '' : ` · ${effort}`}`
}

/** `■■■□□ 3/5 writing tests`, or the context fill in pencil when the agent reports no steps. */
function progressParts(a: AgentRow, cells: number): { filled: string; empty: string; label: string; isOwn: boolean } {
  const own = progressOf(a)
  const total = a.progress?.total
  if (own !== null && total && total <= cells) {
    const done = Math.round(own * total)
    return { filled: '■'.repeat(done), empty: '□'.repeat(total - done), label: `${a.status === 'done' ? total : a.progress?.done ?? 0}/${total}${a.progress?.note && a.status === 'running' ? ` ${a.progress.note}` : ''}`, isOwn: true }
  }
  const share = own ?? contextPercent(a) / 100
  const n = Math.round(share * cells)
  const label = own !== null ? (a.status === 'done' ? 'finished' : `${Math.round(own * 100)}%${a.progress?.note ? ` ${a.progress.note}` : ''}`) : `ctx ${contextPercent(a)}%`
  return { filled: '■'.repeat(n), empty: '□'.repeat(cells - n), label, isOwn: own !== null }
}

/** The companion: a Raster on the terminal (moved on by the timer), an Svg elsewhere, a glyph where neither draws. */
function companion(t: ElementTable, a: AgentRow, data: ViewData, mono: boolean) {
  const family = familyOf(a.model)
  const effort = effortOf(a.effort)
  const pose = poseOf(a, data.now)
  // The terminal (the monospace surface) alone draws Raster.
  if (mono && 'Raster' in t) {
    const { Raster } = t
    return <Raster key={companionKey(a.id)} columns={COMPANION_COLS} rows={COMPANION_ROWS} cells={rasterCells(companionPixels(family, effort, pose, frameAt(data.now)))} />
  }
  const alt = [creatureName(family), accessoryName(effort)].filter(Boolean).join(' with ')
  // Every surface without Raster draws Svg; its alt is what a reader without pictures gets.
  if (!('Svg' in t)) return null
  const { Svg } = t
  return <Svg source={companionSvg(family, effort, pose, SVG_PX)} alt={`${alt || companionGlyph(family)}, ${a.status}`} width={SVG_PX} />
}

/** The margin column of an entry: its glyph on the first row, the ruled line on every row. */
function margin(t: ElementTable, key: string, mark: Mark | null, rows: number, mono: boolean) {
  const { Box, Text } = t
  if (!mono) {
    return (
      <Box key={key} width={3} flexShrink={0}>
        {mark ? <Text color={mark.tone} bold={mark.bold}>{mark.glyph}</Text> : null}
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="column" width={MARGIN} flexShrink={0}>
      {Array.from({ length: rows }, (_, i) => (
        <Box key={`${key}-${i}`} flexDirection="row">
          <Text color={i === 0 ? mark?.tone : undefined} bold={i === 0 && mark?.bold}>{` ${i === 0 && mark ? mark.glyph : ' '} `}</Text>
          <Text color="subtle">│ </Text>
        </Box>
      ))}
    </Box>
  )
}

/** A full-width row of the page frame: margin glyph, ruled line, body. */
function line(t: ElementTable, key: string, body: ReturnType<ElementTable['Text']> | null, mono: boolean, mark: Mark | null = null) {
  const { Box, Text } = t
  return (
    <Box key={key} flexDirection="row">
      {mono
        ? <Text><Text color={mark?.tone} bold={mark?.bold}>{` ${mark ? mark.glyph : ' '} `}</Text><Text color="subtle">│ </Text></Text>
        : <Box width={3} flexShrink={0}>{mark ? <Text color={mark.tone} bold={mark.bold}>{mark.glyph}</Text> : null}</Box>}
      {body}
    </Box>
  )
}

/** `AGENTS ┄┄┄┄ tail`: a section label on the body column, the rule on `subtle` (mono only). */
function rule(t: ElementTable, key: string, label: string, tail: string, columns: number, mono: boolean, tone: string) {
  const { Box, Text } = t
  if (!mono) {
    return (
      <Box key={key} flexDirection="row" marginTop={1} paddingLeft={3} gap={3}>
        <Text bold color={tone}>{label}</Text>
        {tail ? <Text dimColor>{tail}</Text> : null}
      </Box>
    )
  }
  const dashes = Math.max(2, columns - MARGIN - label.length - 2 - (tail ? tail.length + 2 : 0))
  return line(t, key, <Text><Text bold color={tone}>{label}</Text><Text color="subtle">{` ${'┄'.repeat(dashes)}`}</Text>{tail ? <Text dimColor>{`  ${tail}`}</Text> : null}</Text>, mono)
}

const blank = (t: ElementTable, key: string, mono: boolean) => (mono ? line(t, key, null, mono) : null)

/** One roster entry: margin, companion, five lines of body; the title opens the agent's page. */
function entry(t: ElementTable, a: AgentRow, data: ViewData, actions: PaneActions, columns: number, mono: boolean) {
  const { Box, Text, Button } = t
  const bodyW = Math.max(16, columns - (mono ? MARGIN : 3) - (mono ? COMPANION_COLS : SVG_PX / 8) - GAP)
  const time = a.status === 'running' ? ago(elapsedMs(a, data.now)) : `took ${lasted(elapsedMs(a, data.now))}`
  const p = progressParts(a, Math.min(10, Math.max(5, bodyW - 24)))
  const meta = [modelLine(a), a.subagentType && a.subagentType !== 'general-purpose' ? a.subagentType : '', a.round > 1 ? `round ${a.round}` : ''].filter(Boolean).join(' · ')
  const figures = [`${fmtTokens(a.tokens)} tokens`, `≈${fmtCost(a.costUsd)}`, `${a.tools} tools`].join(' · ')
  const last = a.status === 'running' ? (a.lastTool ?? 'starting…') : a.status === 'failed' ? (a.endReason === 'aborted' ? 'stopped before it finished' : 'stopped with an error') : (a.log[a.log.length - 1]?.text ?? 'finished')
  const isQuiet = a.status !== 'running'
  return (
    <Box key={`agent-${a.id}`} flexDirection="row">
      {margin(t, `m-${a.id}`, markOf(a, data), COMPANION_ROWS, mono)}
      <Box flexShrink={0} width={mono ? COMPANION_COLS : SVG_PX / 8 + 1}>{companion(t, a, data, mono)}</Box>
      <Box width={GAP} flexShrink={0} />
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row">
          <Button key={`open-agent-${a.id}`} plain onPress={() => actions.openAgent(a.id, 'agents')}>
            <Text bold={!isQuiet} dimColor={isQuiet}>{clip(a.description || a.subagentType || a.id, bodyW - time.length - 2)}</Text>
          </Button>
          <Box flexGrow={1} />
          <Text dimColor>{` ${time}`}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">{meta}</Text>
        <Text wrap="truncate-end">
          <Text color={p.isOwn ? data.tones.ink : undefined} dimColor={!p.isOwn}>{p.filled}</Text>
          <Text dimColor>{p.empty}</Text>
          <Text dimColor={!p.isOwn}>{` ${p.label}`}</Text>
        </Text>
        <Text dimColor wrap="truncate-end">{figures}</Text>
        <Text color={a.status === 'failed' ? 'error' : undefined} dimColor={a.status !== 'failed'} wrap="truncate-end">{last}</Text>
      </Box>
    </Box>
  )
}

/** The roster, below the pane header. `mono`: the surface draws a monospace grid (the terminal). */
export function agentsBlock(t: ElementTable, data: ViewData, ui: PaneView, actions: PaneActions, columns: number, mono: boolean) {
  void ui
  const { Text } = t
  const rows = rosterOf(data.facts.agents)
  const sum = totalsOf(rows, data.now)
  const head = sum.count ? `${sum.count} · ${sum.running} running` : ''
  const out = [blank(t, 'ag-gap', mono), rule(t, 'ag-head', 'AGENTS', head, columns, mono, data.tones.ink)]
  if (rows.length === 0) {
    out.push(line(t, 'ag-empty', <Text dimColor wrap="wrap">No subagents yet. Each one Claude starts appears here with its companion: the model picks the creature, the effort its accessory.</Text>, mono))
    return out.filter(Boolean)
  }
  out.push(line(t, 'ag-sum', <Text dimColor wrap="truncate-end">{`≈${fmtCost(sum.costUsd)} at API prices · ${fmtTokens(sum.tokens)} tokens · ${ago(sum.spanMs)}${sum.failed ? ` · ${sum.failed} failed` : ''}`}</Text>, mono))
  rows.forEach((a, i) => {
    out.push(blank(t, `ag-gap-${i}`, mono))
    out.push(entry(t, a, data, actions, columns, mono))
  })
  return out.filter(Boolean)
}

/** One agent's page: companion, model and effort, progress, figures, then its log (newest first). */
export function agentPage(t: ElementTable, data: ViewData, id: string, columns: number, mono: boolean) {
  const { Box, Text } = t
  const a = data.facts.agents.find(x => x.id === id)
  if (!a) return [line(t, 'ap-gone', <Text dimColor>This agent is no longer in the list (only the newest finished ones are kept).</Text>, mono)]
  const family = familyOf(a.model)
  const effort = effortOf(a.effort)
  const who = [creatureName(family), accessoryName(effort)].filter(Boolean).join(' with ')
  const state = a.status === 'running' ? `running ${lasted(elapsedMs(a, data.now))} (since ${hhmm(a.startedAt)})` : `${a.status === 'done' ? 'done' : 'failed'} ${a.endedAt ? hhmm(a.endedAt) : ''} · took ${lasted(elapsedMs(a, data.now))}`
  const p = progressParts(a, 12)
  const field = (key: string, label: string, value: string, tone?: string) =>
    line(t, key, (
      <Box flexDirection="row" flexGrow={1}>
        <Box width={LABEL} flexShrink={0}><Text dimColor>{label}</Text></Box>
        <Text color={tone} wrap="truncate-end">{value}</Text>
      </Box>
    ), mono)
  const out = [
    <Box key="ap-head" flexDirection="row">
      {margin(t, 'ap-m', markOf(a, data), COMPANION_ROWS, mono)}
      <Box flexShrink={0} width={mono ? COMPANION_COLS : SVG_PX / 8 + 1}>{companion(t, a, data, mono)}</Box>
      <Box width={GAP} flexShrink={0} />
      <Box flexDirection="column" flexGrow={1}>
        <Text bold wrap="wrap">{a.description || a.subagentType || a.id}</Text>
        <Text dimColor wrap="truncate-end">{`${who} · ${modelLine(a)}`}</Text>
        <Text dimColor wrap="truncate-end">{[a.subagentType, a.round > 1 ? `round ${a.round}` : '', a.step ? `step ${a.step}` : ''].filter(Boolean).join(' · ')}</Text>
        <Text color={a.status === 'failed' ? 'error' : a.status === 'done' ? 'success' : undefined} wrap="truncate-end">{state}</Text>
      </Box>
    </Box>,
    blank(t, 'ap-gap', mono),
    rule(t, 'ap-rule', 'DETAILS', '', columns, mono, data.tones.ink),
    line(t, 'ap-progress', (
      <Box flexDirection="row" flexGrow={1}>
        <Box width={LABEL} flexShrink={0}><Text dimColor>progress</Text></Box>
        <Text wrap="truncate-end"><Text color={p.isOwn ? data.tones.ink : undefined} dimColor={!p.isOwn}>{p.filled}</Text><Text dimColor>{p.empty}</Text><Text>{` ${p.isOwn ? p.label : 'not reported'}`}</Text></Text>
      </Box>
    ), mono),
    field('ap-ctx', 'context', `${contextPercent(a)}% of ${fmtTokens(a.contextMax)} · ${fmtTokens(a.contextTokens)}`),
    field('ap-tokens', 'tokens', `${fmtTokens(a.tokens)} over ${a.requests} ${a.requests === 1 ? 'request' : 'requests'}`),
    field('ap-cost', 'cost', `≈${fmtCost(a.costUsd)} at API list prices (an estimate)`),
    field('ap-tools', 'tools', `${a.tools}${a.lastTool ? ` · last ${a.lastTool}` : ''}`),
    blank(t, 'ap-gap2', mono),
    rule(t, 'ap-log-rule', 'LOG', `${a.log.length}`, columns, mono, data.tones.ink),
  ]
  if (a.log.length === 0) out.push(line(t, 'ap-log-empty', <Text dimColor>Nothing yet.</Text>, mono))
  for (const [i, l] of [...a.log].reverse().entries()) {
    const mark: Mark | null = l.isError ? { glyph: '✗', tone: 'error' } : l.kind === 'note' ? { glyph: data.tones.pen, tone: data.tones.ink } : null
    out.push(line(t, `ap-log-${i}`, <Text wrap="truncate-end"><Text dimColor>{`${hhmm(l.at)}  `}</Text><Text color={l.isError ? 'error' : undefined} dimColor={l.kind === 'tool' && !l.isError}>{l.text}</Text></Text>, mono, mark))
  }
  return out.filter(Boolean)
}
