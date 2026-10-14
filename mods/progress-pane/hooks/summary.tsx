/**
 * The finished run's summary: a card centered on the page (bordered on the
 * terminal) with what the run took and used (time worked by the main thread
 * and the crew, the plan, cost, tokens by kind, tool calls, what git shows),
 * the crew's lineup of companions, then the plan recap. Pure.
 */
import type { RenderNode } from 'claude-code'

import { COMPANION_COLS, COMPANION_ROWS, companionPixels, companionSvg, creatureName, accessoryName, rasterCells } from './companions'
import { fmtCost, fmtTokens } from './cost'
import { LABEL_CELLS, row, rule } from './frame'
import type { Frame, Part } from './frame'
import { lasted } from './observe'
import { phaseRow } from './overview'
import { decisionsOf, grouped, lineupOf, rulingsOf, tokensIn, totalOf } from './runstats'
import type { RunStats } from './runstats'
import { elapsedOf } from './text'
import type { ViewData } from './view-types'

/** The card's widest; it centers on the body column when the page is wider. */
const CARD_MAX = 60
/** Margin cells before the body on the ruled terminal page. */
const MARGIN = 5
const LINEUP_MAX = 4
const SVG_PX = 40

type Line = { label: string; parts: Part[] }

function linesOf(data: ViewData): Line[] {
  const { doc, run } = data
  const all = doc.phases.flatMap(p => p.steps)
  const done = all.filter(s => s.status === 'done').length
  const skipped = all.filter(s => s.status === 'skipped').length
  const open = all.length - done - skipped
  const total = totalOf(run)
  const asks = decisionsOf(doc)
  const rulings = rulingsOf(doc)
  const dim = (text: string): Part => ({ text, dim: true })
  const out: Line[] = []
  if (total.requests > 0) {
    out.push({ label: 'worked', parts: [{ text: lasted(total.workingMs), bold: true }, dim(` · main ${lasted(run.main.workingMs)} + crew ${lasted(run.agents.workingMs)}`)] })
  }
  out.push({ label: 'plan', parts: [{ text: `${done} ${done === 1 ? 'step' : 'steps'} done` }, dim(`${skipped ? ` · ${skipped} skipped` : ''}${open ? ` · ${open} left open` : ''} · ${doc.phases.length} ${doc.phases.length === 1 ? 'phase' : 'phases'}`)] })
  if (asks.asked || rulings) out.push({ label: '', parts: [dim([asks.asked ? `${asks.asked} ${asks.asked === 1 ? 'decision' : 'decisions'} asked` : '', rulings ? `${rulings} ${rulings === 1 ? 'ruling' : 'rulings'}` : ''].filter(Boolean).join(' · '))] })
  if (run.agents.count) out.push({ label: 'crew', parts: [{ text: `${run.agents.count} ${run.agents.count === 1 ? 'subagent' : 'subagents'}` }, dim(`${run.agents.failed ? ` · ${run.agents.failed} failed` : ''} · ${grouped(run.agents.tools)} tool calls`)] })
  if (total.requests > 0) {
    out.push({ label: 'cost', parts: [{ text: `≈${fmtCost(total.costUsd)}`, bold: true }, dim(' at API prices')] })
    out.push({ label: '', parts: [dim(`main ≈${fmtCost(run.main.costUsd)} · crew ≈${fmtCost(run.agents.costUsd)}`)] })
    out.push({ label: 'tokens', parts: [{ text: `in ${fmtTokens(total.input)} · out ${fmtTokens(total.output)}` }] })
    out.push({ label: '', parts: [dim(`cache read ${fmtTokens(total.cacheRead)} · written ${fmtTokens(total.cacheWrite)}`)] })
    out.push({ label: 'requests', parts: [{ text: grouped(total.requests) }, dim(` · ${grouped(run.main.tools)} tool calls on main`)] })
  } else {
    out.push({ label: '', parts: [dim('No usage was recorded for this run: figures cover only what this mod watched.')] })
  }
  const g = run.git
  if (g === undefined) out.push({ label: 'git', parts: [dim('counting…')] })
  else if (g === null) out.push({ label: 'git', parts: [dim('figures unavailable')] })
  else {
    out.push({ label: 'git', parts: [{ text: `${g.commits} ${g.commits === 1 ? 'commit' : 'commits'}` }, dim(` · ${g.merges} ${g.merges === 1 ? 'merge' : 'merges'} · ${g.branches} ${g.branches === 1 ? 'branch' : 'branches'}`)] })
    out.push({ label: 'files', parts: [{ text: `+${g.filesAdded}`, color: 'success' }, dim(' added · '), { text: `${g.filesEdited}` }, dim(' edited · '), { text: `−${g.filesRemoved}`, color: 'error' }, dim(' removed')] })
    out.push({ label: 'lines', parts: [{ text: `+${grouped(g.linesAdded)}`, color: 'success' }, { text: ' ' }, { text: `−${grouped(g.linesRemoved)}`, color: 'error' }] })
  }
  return out
}

/** The crew's companions side by side, each with how many ran: Rasters on the terminal, Svgs elsewhere. */
function lineup(f: Frame, run: RunStats, width: number): RenderNode | null {
  const { Box, Text } = f.t
  const all = lineupOf(run)
  const fits = Math.max(1, Math.min(LINEUP_MAX, Math.floor((width + 1) / (COMPANION_COLS + 1))))
  const shown = all.slice(0, fits)
  if (shown.length === 0) return null
  const more = all.slice(fits).reduce((n, c) => n + c.count, 0)
  return (
    <Box key="sum-lineup" flexDirection="row" gap={1} justifyContent="center">
      {shown.map((c, i) => {
        const alt = [creatureName(c.family), accessoryName(c.effort)].filter(Boolean).join(' with ')
        const picture = f.mono && 'Raster' in f.t
          ? (() => { const { Raster } = f.t; return <Raster key={`crew-${i}`} columns={COMPANION_COLS} rows={COMPANION_ROWS} cells={rasterCells(companionPixels(c.family, c.effort, 'resting', 0))} /> })()
          : 'Svg' in f.t ? (() => { const { Svg } = f.t; return <Svg source={companionSvg(c.family, c.effort, 'resting', SVG_PX)} alt={alt} width={SVG_PX} /> })() : null
        return (
          <Box key={`crew-col-${i}`} flexDirection="column" alignItems="center" width={f.mono ? COMPANION_COLS : SVG_PX / 8 + 2}>
            {picture}
            <Text dimColor>{`×${c.count}`}</Text>
          </Box>
        )
      })}
      {more ? <Box key="crew-more" alignSelf="flex-end"><Text dimColor>{`+${more}`}</Text></Box> : null}
    </Box>
  )
}

/** The rows of the card's body: a dim label column, then the value. */
function cardRows(f: Frame, lines: Line[]): RenderNode[] {
  const { Box, Text } = f.t
  return lines.map((l, i) => (
    <Box key={`sum-${i}`} flexDirection="row">
      <Box width={LABEL_CELLS + 1} flexShrink={0}><Text dimColor>{l.label}</Text></Box>
      <Text wrap="truncate-end">{l.parts.map((p, j) => <Text key={`p${j}`} color={p.color} dimColor={p.dim} bold={p.bold}>{p.text}</Text>)}</Text>
    </Box>
  ))
}

/** The finished card, centered on the page; on desktop, below 48 columns or off the terminal, plain labelled rows. */
export function summaryBlock(f: Frame, data: ViewData): RenderNode[] {
  const { Box, Text } = f.t
  const lines = linesOf(data)
  const took = elapsedOf(data) || 'finished'
  const title: Part[] = [{ text: '✓ ', color: 'success', bold: true }, { text: `Finished · ${took}`, bold: true }]
  if (!f.mono || !f.ruled) {
    const pics = lineup(f, data.run, f.width - 3)
    return [
      rule(f, 'sum-head', 'SUMMARY', data.tones.ink),
      row(f, 'sum-title', { glyph: '✓', color: 'success', bold: true, body: [{ text: `Finished · ${took}`, bold: true }] }),
      ...lines.map((l, i) => row(f, `sum-${i}`, { label: l.label, body: l.parts })),
      ...(pics ? [<Box key="sum-pics" marginTop={1}>{pics}</Box>] : []),
    ]
  }
  const body = f.width - MARGIN
  const card = Math.min(CARD_MAX, body)
  const pad = Math.max(0, Math.floor((body - card) / 2))
  const inner = card - 4
  const pics = lineup(f, data.run, inner)
  // Border, title, a blank, the lines, and the lineup (companion rows and the count row) with a blank above.
  const height = 2 + 2 + lines.length + (pics ? 1 + COMPANION_ROWS + 1 : 0)
  return [
    <Box key="sum-card-row" flexDirection="row">
      <Box flexDirection="column" width={MARGIN} flexShrink={0}>
        {Array.from({ length: height }, (_, i) => <Text key={`sm-${i}`}><Text>{'   '}</Text><Text color="subtle">│</Text><Text> </Text></Text>)}
      </Box>
      <Box width={pad} flexShrink={0} />
      <Box flexDirection="column" width={card} borderStyle="round" borderColor="subtle" paddingX={1}>
        <Box key="sum-title" flexDirection="row" justifyContent="center"><Text>{title.map((p, j) => <Text key={`t${j}`} color={p.color} bold={p.bold}>{p.text}</Text>)}</Text></Box>
        <Text key="sum-gap"> </Text>
        {cardRows(f, lines)}
        {pics ? <Text key="sum-gap2"> </Text> : null}
        {pics}
      </Box>
    </Box>,
  ]
}

/** The plan as it ended: every phase with its steps done. */
export function planRecap(f: Frame, data: ViewData): RenderNode[] {
  return [rule(f, 'recap-head', 'PLAN', data.tones.ink), ...data.doc.phases.map(p => phaseRow(f, data, p))]
}
