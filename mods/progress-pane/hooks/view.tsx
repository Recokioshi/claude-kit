/**
 * progress-pane drawings: the band (one line, its count and step pressable),
 * the pane (Overview / Plan / Log, and one step's details) and the text form.
 * Pure: element table + data in, tree out.
 *
 * Glyphs (shared with the other kit mods): ✓ done · ✗ failed · ● doing ·
 * ○ todo · ▶ current · ? decision · ! needs you · ~ drift · – skipped ·
 * ━/─ meter.
 */
import type { ElementConstructor, ElementTable, InputProps, RenderChildren } from 'claude-code'

import { ago, isStaleGate } from './observe'
import type { AgentRow, Drift, Facts } from './observe'
import { counts, currentPhase, endedMs, phaseState } from './worklog'
import type { Attention, Phase, Step, Worklog } from './worklog'

export type ViewData = {
  doc: Worklog
  path: string
  facts: Facts
  drift: Drift[]
  now: number
  startedMs: number | null
  /** When each step went to doing / done, as the mod saw it. */
  startedAt: Record<string, number>
  doneAt: Record<string, number>
  /** Answers given in the pane: delivered to Claude, or still on their way. */
  answered: Answer[]
}

export type Answer = { id: string; question: string; answer: string; at: number; isDelivered: boolean }

export type Tab = 'overview' | 'plan' | 'log' | 'step' | 'needs'
/** What the pane shows: a tab, or one step (`step`) reached from `back`. */
export type PaneView = { tab: Tab; step?: string; back?: 'overview' | 'plan'; expanded: Record<string, boolean> }

const GLYPH: Record<Step['status'], string> = { todo: '○', doing: '●', done: '✓', blocked: '!', skipped: '–' }
const TONE: Record<Step['status'], string | undefined> = { todo: undefined, doing: 'success', done: 'success', blocked: 'error', skipped: undefined }

export const shortModel = (model: string) => (/opus/.test(model) ? 'opus' : /sonnet/.test(model) ? 'sonnet' : /haiku/.test(model) ? 'haiku' : /fable/.test(model) ? 'fable' : model.split('-').slice(0, 2).join('-'))

export function meter(done: number, total: number, cells: number): { filled: string; empty: string } {
  const n = total === 0 ? 0 : Math.round((done / total) * cells)
  return { filled: '━'.repeat(n), empty: '─'.repeat(cells - n) }
}

/**
 * How long the run took, or has been going: from `started` to now while
 * active, to its last update once finished or paused (not to whenever the
 * pane is opened again).
 */
export function elapsedOf(data: ViewData): string {
  if (!data.startedMs) return ''
  const end = endedMs(data.doc)
  return end === null ? ago(data.now - data.startedMs) : `took ${ago(end - data.startedMs)}`
}

/** The run's one-glyph health: gate red, needs the person, finished, working. */
export function healthOf(data: ViewData): { glyph: string; tone: string } {
  if (data.drift.some(d => d.rule === 'D6')) return { glyph: '✗', tone: 'error' }
  if (data.doc.attention.length > 0) return { glyph: '!', tone: 'error' }
  if (data.doc.meta.status === 'done') return { glyph: '✓', tone: 'success' }
  return { glyph: '▶', tone: 'success' }
}

/** The latest gate run, past background runs that never reported back (30 min). */
function lastGate(facts: Facts, now: number) {
  return [...facts.gates].reverse().find(g => !isStaleGate(g, now))
}

function gateText(facts: Facts, now: number, short = false): { text: string; tone?: string } | null {
  const g = lastGate(facts, now)
  if (!g) return null
  if (g.ok === null) return { text: short ? '● gate' : 'gate ● running' }
  return { text: `${short ? '' : 'gate '}${g.ok ? '✓' : '✗'} ${ago(now - g.at)}`, tone: g.ok ? 'success' : 'error' }
}

/** The step the run is on: the first doing one, else the next todo one. */
export function currentStepOf(doc: Worklog): Step | undefined {
  const steps = doc.phases.flatMap(p => p.steps)
  return steps.find(s => s.status === 'doing') ?? steps.find(s => s.status === 'todo')
}

type Seg = { key: string; text: string; tone?: string; dim?: boolean; bold?: boolean; drop: number }

const clipTitle = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/** The band's segments, dropped by priority (higher `drop` goes first) to fit the width. */
export function bandSegments(data: ViewData, columns: number): { left: Seg[]; right: Seg[] } {
  const { doc, facts, now } = data
  const { done, total } = counts(doc)
  const health = healthOf(data)
  const step = currentStepOf(doc)
  const running = facts.agents.filter(a => a.status === 'running').length
  const gate = gateText(facts, now)
  const commit = facts.commits[facts.commits.length - 1]
  const decisions = doc.attention.filter(a => a.kind === 'decision').length
  const needs = doc.attention.filter(a => a.kind === 'blocker').length + data.drift.filter(d => d.rule !== 'D6').length
  const bar = meter(done, total, 10)

  const left: Seg[] = [
    { key: 'health', text: `${health.glyph} `, tone: health.tone, bold: true, drop: 0 },
    { key: 'count', text: `${done}/${total} `, bold: true, drop: 0 },
    { key: 'bar', text: `${bar.filled}`, tone: 'success', drop: 6 },
    { key: 'bar2', text: `${bar.empty} `, dim: true, drop: 6 },
    ...(step ? [{ key: 'step', text: ` ${step.id} ${clipTitle(step.title, columns >= 100 ? 60 : 26)}`, drop: 1 }] : []),
    ...(running > 0 ? [{ key: 'agents', text: ` · ${running} ${running === 1 ? 'agent' : 'agents'}`, dim: true, drop: 4 }] : []),
    ...(gate ? [{ key: 'gate', text: ` · ${gate.text}`, tone: gate.tone, drop: 3 }] : []),
    ...(commit ? [{ key: 'git', text: ` · ${commit.sha} ${ago(now - commit.at)}`, dim: true, drop: 5 }] : []),
    ...(data.startedMs ? [{ key: 'elapsed', text: ` · ${elapsedOf(data)}`, dim: true, drop: 7 }] : []),
  ]
  const right: Seg[] = [
    ...(decisions > 0 ? [{ key: 'q', text: `? ${decisions}`, tone: 'warning', bold: true, drop: 0 }] : []),
    ...(needs > 0 ? [{ key: 'n', text: `${decisions > 0 ? '  ' : ''}! ${needs}`, tone: 'error', bold: true, drop: 0 }] : []),
  ]

  const width = (segs: Seg[]) => segs.reduce((n, s) => n + s.text.length, 0)
  const room = columns - width(right) - 3
  let kept = [...left]
  for (const level of [7, 6, 5, 4, 3]) {
    if (width(kept) <= room) break
    kept = kept.filter(s => s.drop !== level)
  }
  // The step title is truncated, never dropped.
  const over = width(kept) - room
  if (over > 0) {
    kept = kept.map(s => (s.key === 'step' ? { ...s, text: s.text.length - over > 4 ? `${s.text.slice(0, s.text.length - over - 1)}…` : s.text.slice(0, 4) } : s))
  }
  return { left: kept, right }
}

/** What the band's pressable parts open. */
export type BandActions = { openPlan: () => void; openStep: (id: string) => void; openNeeds: () => void }

export function drawBand(t: ElementTable, data: ViewData, columns: number, actions?: BandActions, mono = true) {
  isMono = mono
  const { Box, Text, Button } = t
  const { left, right } = bandSegments(data, columns)
  const step = currentStepOf(data.doc)
  return (
    <Box flexDirection="row" paddingX={1}>
      {left.map(s => {
        // The count opens the whole plan; the step its details. Buttons draw
        // their label alone, so the spacing around them stays Text.
        if (actions && s.key === 'count') {
          return (
            <Box key="b-count" flexDirection="row">
              <Button key="band-plan" plain label={s.text.trimEnd()} onPress={actions.openPlan} />
              <Text> </Text>
            </Box>
          )
        }
        if (actions && s.key === 'step' && step) {
          return (
            <Box key="b-step" flexDirection="row">
              <Text> </Text>
              <Button key="band-step" plain label={s.text.trimStart()} onPress={() => actions.openStep(step.id)} />
            </Box>
          )
        }
        return <Text key={`b-${s.key}`} color={s.tone} dimColor={s.dim} bold={s.bold} wrap="truncate-end">{s.text}</Text>
      })}
      <Box flexGrow={1} />
      {right.map(s => {
        // `? 1` / `! 2`: the glyph keeps its color, the count is the button.
        const m = /^(\s*)([?!]) (\d+)$/.exec(s.text)
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

export type PaneActions = {
  tab: (tab: 'overview' | 'plan' | 'log') => void
  file: () => void
  close: () => void
  openStep: (id: string, back: 'overview' | 'plan') => void
  togglePhase: (key: string) => void
  back: () => void
  /** To the previous (-1) or next (+1) step in plan order. */
  move: (delta: number) => void
  openNeeds: () => void
  /** Sends the person's answer to a decision or blocker to Claude. */
  answer: (id: string, text: string) => void
  /** Where the surface has no text field: puts `D1: ` in the prompt box instead. */
  replyInChat: (id: string) => void
}

/** A section rule `LABEL ──── tail`, the tail clipped so the row never passes `columns`. */
export function ruleParts(label: string, columns: number, tail = ''): { line: string; tail: string } {
  const room = columns - label.length - 6
  const shown = room < 2 ? '' : clipTitle(tail, room)
  return { line: '─'.repeat(Math.max(2, columns - label.length - shown.length - 4)), tail: shown }
}

/**
 * Whether the surface draws in a monospace grid (the terminal). Desktop and
 * mobile lay text out in a proportional font, where a row of `─` sized to
 * `columns` wraps; there a section is its label alone, with a gap above.
 * Set at the top of each (synchronous) draw.
 */
let isMono = true

function rule(t: ElementTable, key: string, label: string, columns: number, tail = '') {
  const { Box, Text } = t
  if (!isMono) {
    return (
      <Box key={key} flexDirection="row" marginTop={1}>
        <Text bold dimColor>{label}</Text>
        {tail ? <Text dimColor wrap="truncate-end">{`   ${tail}`}</Text> : null}
      </Box>
    )
  }
  const parts = ruleParts(label, columns, tail)
  return (
    <Box key={key} flexDirection="row">
      <Text bold>{label} </Text>
      <Text dimColor>{parts.line}</Text>
      {parts.tail ? <Text> {parts.tail}</Text> : null}
    </Box>
  )
}

function agentOf(facts: Facts, step: Step): AgentRow | undefined {
  return [...facts.agents].reverse().find(a => a.step === step.id && (a.status === 'running' || step.status === 'doing'))
}

function stepRow(t: ElementTable, step: Step, data: ViewData, columns: number, open?: () => void) {
  const { Box, Text, Button } = t
  const agent = agentOf(data.facts, step)
  const drifted = data.drift.some(d => d.step === step.id)
  const right = agent && step.status === 'doing'
    ? `${shortModel(agent.model)} ${ago(data.now - agent.startedAt)}${columns >= 52 && agent.lastTool ? ` ${agent.lastTool.split(' ')[0]}` : ''}`
    : step.sha
      ? step.sha.slice(0, 7)
      : step.owner && step.status === 'doing'
        ? step.owner
        : ''
  return (
    <Box key={`s-${step.id}`} flexDirection="row">
      <Text dimColor={step.status === 'todo' || step.status === 'skipped'} color={drifted ? 'warning' : TONE[step.status]} bold={step.status === 'doing'}>  {drifted ? '~' : GLYPH[step.status]} </Text>
      {open
        ? <Button key={`open-${step.id}`} plain dimColor={step.status === 'done' || step.status === 'skipped'} label={clipTitle(`${step.id} ${step.title}`, Math.max(8, columns - right.length - 6))} onPress={open} />
        : <Text dimColor={step.status === 'done' || step.status === 'skipped'} bold={step.status === 'doing'} wrap="truncate-end">{`${step.id} ${step.title}`}</Text>}
      <Box flexGrow={1} />
      <Text dimColor> {right}</Text>
    </Box>
  )
}

function chips(doc: Worklog): string {
  return doc.phases.map(p => `${phaseState(p) === 'done' ? '✓' : phaseState(p) === 'current' ? '▶' : '○'}${p.key}`).join(' ')
}

type Needs = { glyph: string; tone: string; age: string; text: string; isAsk?: boolean }

/** The question as written, without the id Claude sometimes repeats at its start ("D1 D1 …"). */
export function askText(a: Attention): string {
  return a.text.replace(new RegExp(`^${a.id}\\b[:.)\\s-]*`, 'i'), '')
}

function needsOf(data: ViewData): Needs[] {
  const items: Needs[] = []
  for (const a of data.doc.attention) {
    items.push(a.kind === 'decision'
      ? { glyph: '?', tone: 'warning', age: '', text: `${a.id} ${askText(a)}`, isAsk: true }
      : { glyph: '!', tone: 'error', age: '', text: `${a.id} ${askText(a)}`, isAsk: true })
  }
  for (const d of data.drift) {
    items.push({ glyph: d.rule === 'D6' ? '✗' : '~', tone: d.rule === 'D6' ? 'error' : 'warning', age: ago(data.now - d.at), text: d.text })
  }
  for (const s of data.facts.servers) {
    items.push({ glyph: '!', tone: 'error', age: ago(data.now - s.startedAt), text: `${s.label} left running` })
  }
  return items
}

function needsBlock(t: ElementTable, data: ViewData, columns: number, max: number, actions?: PaneActions) {
  const { Box, Text, Button } = t
  const items = needsOf(data)
  if (items.length === 0) return []
  const shown = items.slice(0, max)
  return [
    rule(t, 'needs-head', '! NEEDS YOU', columns),
    ...shown.map((n, i) => (
      <Box key={`n-${i}`} flexDirection="row">
        <Text color={n.tone} bold> {n.glyph} </Text>
        {n.age ? <Text dimColor>{n.age.padEnd(4)}</Text> : null}
        {actions && n.isAsk
          ? <Button key={`needs-${i}`} plain label={isMono ? clipTitle(n.text, Math.max(8, columns - 4)) : n.text} onPress={actions.openNeeds} />
          : <Text wrap={isMono ? 'truncate-end' : 'wrap'}>{n.text}</Text>}
      </Box>
    )),
    ...(items.length > max ? [<Text key="n-more" dimColor>   +{items.length - max} more</Text>] : []),
  ]
}

function signalsBlock(t: ElementTable, data: ViewData, columns: number) {
  const { Box, Text } = t
  const { facts, now } = data
  const gate = gateText(facts, now, true)
  const g = lastGate(facts, now)
  const commit = facts.commits[facts.commits.length - 1]
  const today = facts.commits.filter(c => now - c.at < 24 * 60 * 60_000).length
  return [
    rule(t, 'sig-head', 'SIGNALS', columns),
    <Box key="sig-1" flexDirection="row" gap={2}>
      <Box flexDirection="row">
        <Text dimColor>gate </Text>
        {gate ? <Text color={gate.tone}>{gate.text}</Text> : <Text dimColor>not run yet</Text>}
        {g?.durationMs ? <Text dimColor> · {Math.round(g.durationMs / 1000)}s</Text> : null}
      </Box>
      <Box flexDirection="row">
        <Text dimColor>git </Text>
        <Text>{commit ? `${commit.sha} ${ago(now - commit.at)}` : '–'}</Text>
        {today > 1 ? <Text dimColor> · {today} today</Text> : null}
      </Box>
    </Box>,
    ...(facts.context
      ? [
          <Box key="sig-2" flexDirection="row">
            <Text dimColor>ctx </Text>
            <Text color={facts.context.percent >= 80 ? 'warning' : undefined}>{facts.context.percent}%</Text>
            {facts.context.cost !== undefined ? <Text dimColor> · ${facts.context.cost.toFixed(2)}</Text> : null}
          </Box>,
        ]
      : []),
  ]
}

function planBlock(t: ElementTable, data: ViewData, columns: number, rows: number, actions?: PaneActions) {
  const { Box, Text } = t
  const { doc } = data
  const phase: Phase | undefined = currentPhase(doc) ?? doc.phases[doc.phases.length - 1]
  const out = [rule(t, 'plan-head', 'PLAN', columns, chips(doc))]
  if (!phase) return out
  const done = phase.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
  out.push(
    <Box key="phase" flexDirection="row">
      <Text bold color="success"> ▶ </Text>
      <Text bold wrap="truncate-end">{`${phase.key} ${phase.title}`}</Text>
      <Box flexGrow={1} />
      <Text dimColor>{done}/{phase.steps.length}</Text>
    </Box>,
  )
  // Keep the doing and next steps in view; fold the done ones above them.
  const firstOpen = Math.max(0, phase.steps.findIndex(s => s.status !== 'done' && s.status !== 'skipped'))
  const start = Math.max(0, Math.min(firstOpen - 2, phase.steps.length - rows))
  const shown = phase.steps.slice(start, start + rows)
  if (start > 0) out.push(<Text key="s-above" dimColor>   ✓ {start} done above</Text>)
  out.push(...shown.map(s => stepRow(t, s, data, columns, actions ? () => actions.openStep(s.id, 'overview') : undefined)))
  const below = phase.steps.length - start - shown.length
  if (below > 0) out.push(<Text key="s-below" dimColor>   +{below} more</Text>)
  const loose = data.facts.agents.filter(a => a.status === 'running' && a.step === null)
  for (const a of loose.slice(0, 2)) {
    out.push(
      <Box key={`loose-${a.id}`} flexDirection="row">
        <Text color="warning">  ~ </Text>
        <Text wrap="truncate-end">agent “{a.description}” (no step)</Text>
        <Box flexGrow={1} />
        <Text dimColor> {shortModel(a.model)} {ago(data.now - a.startedAt)}</Text>
      </Box>,
    )
  }
  return out
}

function logBlock(t: ElementTable, data: ViewData, rows: number) {
  const { Box, Text } = t
  // The pane's body scrolls: draw the whole log, up to a sane cap.
  const lines = data.doc.log.slice(0, Math.max(rows, 300))
  if (lines.length === 0) return [<Text key="log-empty" dimColor>No log lines yet.</Text>]
  return lines.map((line, i) => {
    const m = /^((?:\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2}) (.*)$/.exec(line)
    const ruling = /^Ruling:/.test(m?.[2] ?? '')
    return (
      <Box key={`log-${i}`} flexDirection="row">
        <Text dimColor>{(m?.[1] ?? '').padEnd(6)}</Text>
        <Text color={ruling ? 'warning' : undefined} wrap="truncate-end">{m?.[2] ?? line}</Text>
      </Box>
    )
  })
}

function allStepsOf(doc: Worklog): Step[] {
  return doc.phases.flatMap(p => p.steps)
}

/** Whether a phase is open in the Plan tab: the person's toggle, else open while current. */
export function isExpanded(p: Phase, ui: PaneView): boolean {
  return ui.expanded[p.key] ?? phaseState(p) === 'current'
}

/** Every phase, each a pressable header that folds its steps; every step opens its details. */
function fullPlan(t: ElementTable, data: ViewData, ui: PaneView, actions: PaneActions, columns: number) {
  const { Box, Text, Button } = t
  const out = [rule(t, 'plan-head', 'PLAN', columns, chips(data.doc))]
  for (const p of data.doc.phases) {
    const state = phaseState(p)
    const open = isExpanded(p, ui)
    const done = p.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
    const glyph = state === 'done' ? '✓' : state === 'current' ? '▶' : '○'
    out.push(
      <Box key={`ph-${p.key}`} flexDirection="row">
        <Text color={state === 'todo' ? undefined : 'success'} dimColor={state === 'todo'} bold> {glyph} </Text>
        <Button key={`phase-${p.key}`} plain dimColor={state === 'done'} label={clipTitle(`${open ? '▾' : '▸'} ${p.key} ${p.title}`, Math.max(8, columns - 12))} onPress={() => actions.togglePhase(p.key)} />
        <Box flexGrow={1} />
        <Text dimColor>{done}/{p.steps.length}</Text>
      </Box>,
    )
    if (open) out.push(...p.steps.map(s => stepRow(t, s, data, columns, () => actions.openStep(s.id, 'plan'))))
  }
  return out
}

const hhmm = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** One step, everything known about it: declared, observed, and where they disagree. */
function stepDetail(t: ElementTable, data: ViewData, step: Step, columns: number) {
  const { Box, Text } = t
  const { doc, facts, now } = data
  const phase = doc.phases.find(p => p.steps.includes(step))
  const steps = allStepsOf(doc)
  const index = steps.indexOf(step)
  const startedAt = data.startedAt[step.id]
  const doneAt = data.doneAt[step.id]
  // Step ids are letters, digits and dots ("B6", "2.3").
  const word = new RegExp(`(?:^|[^\\w.])${step.id.replace(/\./g, '\\.')}(?![\\w.])`)
  const commits = facts.commits.filter(c => c.stepAt === step.id || (step.sha !== undefined && step.sha.startsWith(c.sha.slice(0, 7))))
  const gates = startedAt === undefined ? [] : facts.gates.filter(g => g.at >= startedAt && (doneAt === undefined || g.at <= doneAt + 60_000))
  const agents = facts.agents.filter(a => a.step === step.id)
  const drift = data.drift.filter(d => d.step === step.id)
  const log = doc.log.filter(line => word.test(line))
  const asks = doc.attention.filter(a => a.id === step.id || word.test(a.text))

  const field = (key: string, label: string, body: RenderChildren) => (
    <Box key={key} flexDirection="row">
      <Text dimColor>{label.padEnd(8)}</Text>
      <Box flexDirection="column" flexGrow={1}>{body}</Box>
    </Box>
  )
  const timing = step.status === 'done'
    ? `done${doneAt ? ` ${hhmm(doneAt)}` : ''}${startedAt && doneAt ? ` · took ${ago(doneAt - startedAt)}` : ''}`
    : step.status === 'doing'
      ? `doing${startedAt ? ` · ${ago(now - startedAt)} (since ${hhmm(startedAt)})` : ''}`
      : step.status

  const out = [
    <Box key="d-title" flexDirection="row">
      <Text color={TONE[step.status]} bold> {GLYPH[step.status]} </Text>
      <Text bold wrap="wrap">{`${step.id} ${step.title}`}</Text>
    </Box>,
    <Text key="d-where" dimColor wrap="truncate-end">   {phase ? `${phase.key} ${phase.title}` : ''} · step {index + 1} of {steps.length}{step.owner ? ` · @${step.owner}` : ''}</Text>,
    rule(t, 'd-rule', 'DETAILS', columns),
    field('d-status', 'status', <Text color={TONE[step.status]}>{timing}</Text>),
    ...(step.note ? [field('d-note', 'note', <Text wrap="wrap">{step.note}</Text>)] : []),
    field('d-commit', 'commit', commits.length || step.sha
      ? (commits.length ? commits : [{ sha: step.sha ?? '', subject: '', at: 0 }]).map((c, i) => (
          <Box key={`dc-${i}`} flexDirection="row">
            <Text>{c.sha.slice(0, 7)} </Text>
            <Text dimColor wrap="truncate-end">{c.subject}{c.at ? ` · ${ago(now - c.at)} ago` : ''}</Text>
          </Box>
        ))
      : <Text dimColor>none yet</Text>),
    field('d-gate', 'gate', gates.length
      ? gates.slice(-3).map((g, i) => (
          <Text key={`dg-${i}`} color={g.ok === null ? undefined : g.ok ? 'success' : 'error'} wrap="truncate-end">
            {g.ok === null ? '● running' : g.ok ? '✓ passed' : '✗ failed'} {hhmm(g.at)}{g.durationMs ? ` · ${Math.round(g.durationMs / 1000)}s` : ''}{g.background ? ' · background' : ''}
          </Text>
        ))
      : <Text dimColor>{step.status === 'todo' ? 'not started' : startedAt === undefined ? 'no run seen in this session' : 'not run since the step started'}</Text>),
    ...(agents.length
      ? [field('d-agents', 'agents', agents.map(a => (
          <Box key={`da-${a.id}`} flexDirection="row">
            <Text color={a.status === 'running' ? 'success' : a.status === 'failed' ? 'error' : undefined}>{a.status === 'running' ? '●' : a.status === 'failed' ? '✗' : '✓'} </Text>
            <Text wrap="truncate-end">{a.description}</Text>
            <Box flexGrow={1} />
            <Text dimColor> {shortModel(a.model)} · {ago((a.endedAt ?? now) - a.startedAt)} · {a.tools} tools{a.status === 'running' && a.lastTool ? ` · ${a.lastTool.split(' ')[0]}` : ''}</Text>
          </Box>
        )))]
      : []),
    ...(drift.length ? [field('d-drift', 'drift', drift.map((d, i) => <Text key={`dd-${i}`} color="warning" wrap="wrap">~ {d.text}</Text>))] : []),
    ...(asks.length ? [field('d-asks', 'asks', asks.map(a => <Text key={`dq-${a.id}`} color={a.kind === 'decision' ? 'warning' : 'error'} wrap="wrap">{a.kind === 'decision' ? '?' : '!'} {a.id} {a.text}</Text>))] : []),
  ]
  if (log.length) {
    out.push(rule(t, 'd-log-head', 'LOG', columns, `${log.length}`))
    out.push(...logBlock(t, { ...data, doc: { ...doc, log } }, log.length))
  }
  return out
}

/** When Claude asked: the log's `asked D1` line, else nothing. */
function askedAt(doc: Worklog, a: Attention): string {
  const line = doc.log.find(l => new RegExp(`\\basked ${a.id}\\b`).test(l))
  return /^(?:\d{4}-\d{2}-\d{2} )?(\d{1,2}:\d{2})/.exec(line ?? '')?.[1] ?? ''
}

/**
 * Everything waiting on the person, with what they need to answer it: the
 * question, why it is asked, what it holds up, Claude's pick, the options as
 * buttons and a field for their own words. Then drift, then what was answered.
 */
function needsDetail(t: ElementTable, data: ViewData, actions: PaneActions, columns: number) {
  const { Box, Text, Button } = t
  // Terminal and desktop draw a text field; mobile has none.
  const Input = (t as { Input?: ElementConstructor<InputProps> }).Input
  const { doc, now } = data
  const out = [rule(t, 'nd-head', '! NEEDS YOU', columns, `${doc.attention.length || ''}`)]
  if (doc.attention.length === 0) out.push(<Text key="nd-none" dimColor>   Nothing waiting on you.</Text>)
  for (const a of doc.attention) {
    const isDecision = a.kind === 'decision'
    const step = allStepsOf(doc).find(s => s.id === (isDecision ? a.blocks : a.id))
    const at = askedAt(doc, a)
    const meta = [at && `asked ${at}`, step && `${isDecision ? 'blocks' : 'step'} ${step.id} ${clipTitle(step.title, 30)}`].filter(Boolean).join(' · ')
    out.push(
      <Box key={`nd-${a.id}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={isDecision ? 'warning' : 'error'} bold>{isDecision ? '?' : '!'} </Text>
          <Text bold wrap="wrap">{`${a.id} ${askText(a)}`}</Text>
        </Box>
        {meta ? <Text dimColor>  {meta}</Text> : null}
        {a.why ? <Box flexDirection="row"><Text dimColor>  why </Text><Text wrap="wrap">{a.why}</Text></Box> : null}
        {isDecision && a.options?.length
          ? (
              <Box flexDirection="row" gap={2} marginLeft={2} flexWrap="wrap">
                {a.options.map((o, i) => (
                  <Button key={`opt-${a.id}-${i}`} variant={o === a.recommend ? 'primary' : undefined} label={o === a.recommend ? `${o} (recommended)` : o} onPress={() => actions.answer(a.id, o)} />
                ))}
              </Box>
            )
          : null}
        <Box flexDirection="row" marginLeft={2}>
          {Input
            ? <Input key={`ans-${a.id}`} placeholder={isDecision ? 'Or answer in your own words…' : 'Reply: what you did, or what Claude should do…'} submitLabel="Send" onSubmit={(value: string) => { if (value.trim()) actions.answer(a.id, value.trim()) }} />
            : <Button key={`chat-${a.id}`} plain dimColor label="Reply in chat" onPress={() => actions.replyInChat(a.id)} />}
        </Box>
      </Box>,
    )
  }
  const drift = needsOf(data).filter(n => !n.isAsk)
  if (drift.length) {
    out.push(<Box key="nd-drift-gap" marginTop={1}>{rule(t, 'nd-drift', '~ NOTICED', columns, `${drift.length}`)}</Box>)
    out.push(...drift.map((n, i) => (
      <Box key={`ndd-${i}`} flexDirection="row">
        <Text color={n.tone} bold> {n.glyph} </Text>
        {n.age ? <Text dimColor>{n.age.padEnd(4)}</Text> : null}
        <Text wrap="wrap">{n.text}</Text>
      </Box>
    )))
  }
  if (data.answered.length) {
    out.push(<Box key="nd-done-gap" marginTop={1}>{rule(t, 'nd-done', '✓ ANSWERED', columns)}</Box>)
    out.push(...data.answered.slice(0, 5).map(x => (
      <Box key={`nda-${x.id}-${x.at}`} flexDirection="row">
        <Text color="success"> ✓ </Text>
        <Text wrap="truncate-end">{`${x.id} ${clipTitle(x.answer, 60)}`}</Text>
        <Box flexGrow={1} />
        <Text dimColor> {x.isDelivered ? `Claude has it · ${ago(now - x.at)}` : 'on its way to Claude'}</Text>
      </Box>
    )))
  }
  return out
}

export function drawPane(t: ElementTable, data: ViewData, ui: PaneView, actions: PaneActions, columns: number, rows: number, isInline: boolean, mono = true) {
  isMono = mono
  const tab = ui.tab
  const { Box, Text, Button } = t
  const { doc, now } = data
  const { done, total } = counts(doc)
  const width = Math.max(30, columns - 2)
  const bar = meter(done, total, width < 60 || !mono ? 10 : 20)
  const elapsed = elapsedOf(data)
  const health = healthOf(data)

  const header = [
    <Box key="h1" flexDirection="row">
      <Text color={health.tone} bold>{health.glyph} </Text>
      <Text bold wrap="truncate-end">{doc.meta.title}</Text>
      <Box flexGrow={1} />
      <Text dimColor> {elapsed}</Text>
    </Box>,
    <Box key="h2" flexDirection="row">
      <Text dimColor wrap="truncate-end">{doc.meta.branch ?? data.path}</Text>
      <Box flexGrow={1} />
      <Text color="success"> {bar.filled}</Text>
      <Text dimColor>{bar.empty}</Text>
      <Text bold> {done}/{total}</Text>
    </Box>,
  ]

  const footer = (
    <Box key="footer" flexDirection="row" gap={2}>
      <Button key="tab-overview" plain hotkey="1" label={tab === 'overview' ? '[Overview]' : 'Overview'} onPress={() => actions.tab('overview')} />
      <Button key="tab-plan" plain hotkey="2" label={tab === 'plan' ? '[Plan]' : 'Plan'} onPress={() => actions.tab('plan')} />
      <Button key="tab-log" plain hotkey="3" label={tab === 'log' ? '[Log]' : 'Log'} onPress={() => actions.tab('log')} />
      {needsOf(data).length > 0 || tab === 'needs' ? <Button key="tab-needs" plain hotkey="n" label={tab === 'needs' ? `[Needs you ${needsOf(data).length}]` : `Needs you ${needsOf(data).length}`} onPress={actions.openNeeds} /> : null}
      <Button key="file" plain hotkey="o" label="File" onPress={actions.file} />
      <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
    </Box>
  )

  const budget = Math.max(4, rows - 4)

  const step = tab === 'step' ? allStepsOf(data.doc).find(s => s.id === ui.step) : undefined
  if (step) {
    // Controls on top: the details below may scroll.
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box key="step-nav" flexDirection="row" gap={2}>
          <Button key="step-back" plain hotkey="b" label={`← ${ui.back === 'plan' ? 'Plan' : 'Overview'}`} onPress={actions.back} />
          <Button key="step-prev" plain hotkey="k" label="Prev" onPress={() => actions.move(-1)} />
          <Button key="step-next" plain hotkey="j" label="Next" onPress={() => actions.move(1)} />
          <Box flexGrow={1} />
          <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
        </Box>
        {stepDetail(t, data, step, width)}
      </Box>
    )
  }

  if (tab === 'needs') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {footer}
        {needsDetail(t, data, actions, width)}
      </Box>
    )
  }

  if (tab === 'plan') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {footer}
        {fullPlan(t, data, ui, actions, width)}
      </Box>
    )
  }

  if (tab === 'log') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {rule(t, 'log-head', 'LOG', width)}
        {logBlock(t, data, budget - 1)}
        {footer}
      </Box>
    )
  }

  const needs = needsOf(data).length
  const needsRows = Math.min(3, needs) + (needs > 0 ? 1 : 0) + (needs > 3 ? 1 : 0)
  const signalRows = data.facts.context ? 3 : 2

  if (isInline && width >= 96) {
    const half = Math.floor(width / 2) - 1
    const stepRows = Math.max(3, budget - 3)
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        <Box key="cols" flexDirection="row" gap={2}>
          <Box flexDirection="column" width={half}>{planBlock(t, data, half, stepRows, actions)}</Box>
          <Box flexDirection="column" width={half}>
            {needsBlock(t, data, half, 3, actions)}
            {signalsBlock(t, data, half)}
          </Box>
        </Box>
        {footer}
      </Box>
    )
  }

  const stepRows = Math.max(3, budget - needsRows - signalRows - 3)
  return (
    <Box flexDirection="column" paddingX={1}>
      {header}
      {needsBlock(t, data, width, columns < 60 ? 2 : 3, actions)}
      {planBlock(t, data, width, stepRows, actions)}
      {signalsBlock(t, data, width)}
      {footer}
    </Box>
  )
}

/** The overview as Markdown, for /progress text and surfaces that draw nothing. */
export function textOf(data: ViewData): string {
  const { doc, facts, now } = data
  const { done, total } = counts(doc)
  const lines = [`**${doc.meta.title}** · ${done}/${total} done${doc.meta.branch ? ` · \`${doc.meta.branch}\`` : ''}${data.startedMs ? ` · ${elapsedOf(data)}` : ''}`]
  const needs = needsOf(data)
  if (needs.length) {
    lines.push('', '**Needs you**', ...needs.map(n => `- ${n.glyph} ${n.text}`))
  }
  lines.push('', '**Plan**')
  for (const p of doc.phases) {
    const st = phaseState(p)
    const pd = p.steps.filter(s => s.status === 'done' || s.status === 'skipped').length
    lines.push(`- ${st === 'done' ? '✓' : st === 'current' ? '▶' : '○'} ${p.key} ${p.title} (${pd}/${p.steps.length})`)
    if (st === 'current') {
      for (const s of p.steps) lines.push(`  - ${GLYPH[s.status]} ${s.id} ${s.title}${s.sha ? ` · ${s.sha.slice(0, 7)}` : ''}`)
    }
  }
  const running = facts.agents.filter(a => a.status === 'running')
  if (running.length) lines.push('', '**Agents**', ...running.map(a => `- ● ${a.description} · ${shortModel(a.model)} · ${ago(now - a.startedAt)}`))
  const g = lastGate(facts, now)
  const c = facts.commits[facts.commits.length - 1]
  lines.push('', `gate ${g ? (g.ok === null ? 'running' : `${g.ok ? '✓' : '✗'} ${ago(now - g.at)} ago`) : 'not run yet'} · last commit ${c ? `${c.sha} ${ago(now - c.at)} ago` : '–'}`)
  return lines.join('\n')
}
