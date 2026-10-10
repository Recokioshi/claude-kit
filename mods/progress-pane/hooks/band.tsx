/**
 * The band: one line above the prompt. No margin line (a single row cannot
 * stack one): the health glyph, the count in ink, the 10-cell meter, then the
 * pen and the current step and segments joined by a dim ` · `; the counts of
 * what waits on the person pinned right. The count, the step and the agents
 * are pressable. Pure: element table + data in, tree out.
 */
import type { ElementTable, RenderNode } from 'claude-code'

import { ago } from './observe'
import { counts } from './worklog'
import { clipTitle, currentStepOf, elapsedOf, gateText, healthOf, meter } from './text'
import type { BandActions, ViewData } from './view-types'

/** `sep`: the text starts with ` · `, drawn dim whatever the segment's tone. */
export type Seg = { key: string; text: string; tone?: string; dim?: boolean; bold?: boolean; drop: number; sep?: boolean }

const SEP = ' · '
const BAND_CELLS = 10

/** The band's segments, dropped by priority (higher `drop` goes first) to fit the width. */
export function bandSegments(data: ViewData, columns: number): { left: Seg[]; right: Seg[] } {
  const { doc, facts, now, tones } = data
  const { done, total } = counts(doc)
  const health = healthOf(data)
  const step = currentStepOf(doc)
  const running = facts.agents.filter(a => a.status === 'running').length
  const gate = gateText(facts, now)
  const commit = facts.commits[facts.commits.length - 1]
  const decisions = doc.attention.filter(a => a.kind === 'decision').length
  const blockers = doc.attention.filter(a => a.kind === 'blocker').length
  // A red gate (D6) is the health glyph, not a count.
  const noticed = data.drift.filter(d => d.rule !== 'D6').length
  const bar = meter(done, total, BAND_CELLS)

  const left: Seg[] = [
    { key: 'health', text: `${health.glyph} `, tone: health.tone, bold: true, drop: 0 },
    { key: 'count', text: `${done}/${total} `, tone: tones.ink, bold: true, drop: 0 },
    { key: 'bar', text: bar.filled, tone: tones.ink, drop: 6 },
    { key: 'bar2', text: `${bar.empty} `, dim: true, drop: 6 },
    ...(step
      ? [
          { key: 'pen', text: ` ${tones.pen} `, tone: tones.ink, drop: 1 },
          { key: 'step', text: `${step.id} ${clipTitle(step.title, columns >= 100 ? 60 : 26)}`, drop: 1 },
        ]
      : []),
    ...(running > 0 ? [{ key: 'agents', text: `${SEP}${running} ${running === 1 ? 'agent' : 'agents'}`, dim: true, drop: 4, sep: true }] : []),
    ...(gate ? [{ key: 'gate', text: `${SEP}${gate.text}`, ...(gate.tone ? { tone: gate.tone } : {}), drop: 3, sep: true }] : []),
    ...(commit ? [{ key: 'git', text: `${SEP}${commit.sha} ${ago(now - commit.at)}`, dim: true, drop: 5, sep: true }] : []),
    ...(data.startedMs ? [{ key: 'elapsed', text: `${SEP}${elapsedOf(data)}`, dim: true, drop: 7, sep: true }] : []),
  ]
  // Decisions and blockers wait on the person; drift is only noticed (ink, not pencil).
  const right: Seg[] = [
    ...(decisions > 0 ? [{ key: 'q', text: `? ${decisions}`, tone: 'warning', bold: true, drop: 0 }] : []),
    ...(blockers > 0 ? [{ key: 'n', text: `! ${blockers}`, tone: 'error', bold: true, drop: 0 }] : []),
    ...(noticed > 0 ? [{ key: 'd', text: `~ ${noticed}`, tone: 'text', bold: true, drop: 0 }] : []),
  ].map((s, i) => (i === 0 ? s : { ...s, text: `  ${s.text}` }))

  const width = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.text].length, 0)
  const room = columns - width(right) - 3
  let kept = [...left]
  for (const level of [7, 6, 5, 4, 3]) {
    if (width(kept) <= room) break
    kept = kept.filter(s => s.drop !== level)
  }
  // A ` · ` right after a trailing space (no step, or the bar dropped) keeps one space.
  kept = kept.map((s, i) => (kept[i + 1]?.sep && s.text.endsWith(' ') ? { ...s, text: s.text.slice(0, -1) } : s)).filter(s => s.text !== '')
  // The step title is truncated, never dropped.
  const over = width(kept) - room
  if (over > 0) {
    kept = kept.map(s => (s.key === 'step' ? { ...s, text: s.text.length - over > 4 ? `${s.text.slice(0, s.text.length - over - 1)}…` : s.text.slice(0, 4) } : s))
  }
  return { left: kept, right }
}

function segNode(t: ElementTable, s: Seg, data: ViewData, actions?: BandActions): RenderNode {
  const { Box, Text, Button } = t
  const step = currentStepOf(data.doc)
  // The count opens the whole plan; the step its details; the agents their roster.
  // Buttons draw their label alone, so the spacing around them stays Text.
  if (actions && s.key === 'count') {
    const label = s.text.trimEnd()
    return (
      <Box key="b-count" flexDirection="row">
        <Button key="band-plan" plain label={label} onPress={actions.openPlan}><Text color={s.tone} bold>{label}</Text></Button>
        {s.text.endsWith(' ') ? <Text> </Text> : null}
      </Box>
    )
  }
  if (actions && s.key === 'step' && step) {
    return <Button key="band-step" plain label={s.text} onPress={() => actions.openStep(step.id)} />
  }
  const body = s.sep ? s.text.slice(SEP.length) : s.text
  if (s.sep) {
    return (
      <Box key={`b-${s.key}`} flexDirection="row">
        <Text dimColor>{SEP}</Text>
        {actions && s.key === 'agents'
          ? <Button key="band-agents" plain dimColor label={body} onPress={actions.openAgents} />
          : <Text color={s.tone} dimColor={s.dim} bold={s.bold} wrap="truncate-end">{body}</Text>}
      </Box>
    )
  }
  return <Text key={`b-${s.key}`} color={s.tone} dimColor={s.dim} bold={s.bold} wrap="truncate-end">{s.text}</Text>
}

export function drawBand(t: ElementTable, data: ViewData, columns: number, actions?: BandActions, mono = true) {
  void mono
  const { Box, Text, Button } = t
  const { left, right } = bandSegments(data, columns)
  return (
    <Box flexDirection="row" paddingX={1}>
      {left.map(s => segNode(t, s, data, actions))}
      <Box flexGrow={1} minWidth={3} />
      {right.map(s => {
        // `? 1` / `! 2` / `~ 3`: the glyph keeps its color, the count is the button.
        const m = /^(\s*)([?!~]) (\d+)$/.exec(s.text)
        if (!actions || !m) return <Text key={`b-${s.key}`} color={s.tone} bold={s.bold}>{s.text}</Text>
        return (
          <Box key={`b-${s.key}`} flexDirection="row">
            <Text color={s.tone} bold>{`${m[1] ?? ''}${m[2] ?? ''} `}</Text>
            <Button key={`band-needs-${s.key}`} plain label={m[3] ?? ''} onPress={actions.openNeeds} />
          </Box>
        )
      })}
    </Box>
  )
}
