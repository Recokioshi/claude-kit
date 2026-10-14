/**
 * The pane's other pages, on the same Notebook frame: the whole Plan, the Log
 * as a ledger (`§` in the margin for a Ruling), one step's details and
 * everything waiting on the person (Needs you).
 */
import type { ElementConstructor, InputProps, RenderNode } from 'claude-code'

import { ago, since, lasted } from './observe'
import { allSteps } from './worklog'
import type { Attention, Step, Worklog } from './worklog'
import { framed, row, rule, stepGlyph, wrappedRows } from './frame'
import type { Frame, Part, RowSpec } from './frame'
import { chips, needsGlyph, phaseRow, sections, stepRow } from './overview'
import { askText, clipTitle, isExpanded, needsOf, shortModel } from './text'
import type { PaneActions, PaneView, ViewData } from './view-types'

/** Every phase, each a pressable title that folds its steps; every step opens its details. */
export function fullPlan(f: Frame, data: ViewData, ui: PaneView, actions: PaneActions): RenderNode[] {
  const out = [rule(f, 'plan-head', 'PLAN', data.tones.ink, chips(data.doc))]
  for (const p of data.doc.phases) {
    out.push(phaseRow(f, data, p, { key: `phase-${p.key}`, onPress: () => actions.togglePhase(p.key) }))
    if (isExpanded(p, ui)) out.push(...p.steps.map(s => stepRow(f, s, data, () => actions.openStep(s.id, 'plan'))))
  }
  return out
}

const LOG_LINE = /^((?:\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2}) (.*)$/
/** The ledger's time column: `16:40 `. */
const TIME_CELLS = 6

/** Log lines as a ledger: the time, then the entry; a Ruling has `§` in the margin and reads in warning. */
export function ledger(f: Frame, lines: string[], key = 'log'): RenderNode[] {
  if (lines.length === 0) return [row(f, `${key}-empty`, { body: [{ text: 'No log lines yet.', dim: true }] })]
  return lines.flatMap((line, i) => {
    const m = LOG_LINE.exec(line)
    const entry = m?.[2] ?? line
    const ruling = /^Ruling:/.test(entry)
    return wrappedRows(f, `${key}-${i}`, {
      ...(ruling ? { glyph: '§', color: 'warning' } : {}),
      lead: { text: (m?.[1] ?? '').padEnd(TIME_CELLS), dim: true },
      text: { text: entry, ...(ruling ? { color: 'warning' } : {}) },
    })
  })
}

const hhmm = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** A labelled field: the first row carries the label, the rest leave its column empty. */
function field(f: Frame, key: string, label: string, rows: Array<Omit<RowSpec, 'label'>>): RenderNode[] {
  return rows.map((r, i) => row(f, `${key}-${i}`, { ...r, label: i === 0 ? label : '' }))
}

function wrappedField(f: Frame, key: string, label: string, lead: Part | undefined, text: Part): RenderNode[] {
  return wrappedRows(f, key, { label, ...(lead ? { lead } : {}), text })
}

/** One step, everything known about it: declared, observed, and where they disagree. */
export function stepDetail(f: Frame, data: ViewData, step: Step): RenderNode[] {
  const { doc, facts, now } = data
  const phase = doc.phases.find(p => p.steps.includes(step))
  const steps = allSteps(doc)
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
  const glyph = stepGlyph(step.status, data.tones)
  const tone = glyph.color && glyph.color !== data.tones.ink ? glyph.color : undefined

  const timing = step.status === 'done'
    ? `done${doneAt ? ` ${hhmm(doneAt)}` : ''}${startedAt && doneAt ? ` · took ${lasted(doneAt - startedAt)}` : ''}`
    : step.status === 'doing'
      ? `doing${startedAt ? ` · ${ago(now - startedAt)} (since ${hhmm(startedAt)})` : ''}`
      : step.status
  const shownCommits = commits.length ? commits : step.sha ? [{ sha: step.sha, subject: '', at: 0 }] : []

  const details: RenderNode[] = [
    rule(f, 'd-rule', 'DETAILS', data.tones.ink),
    ...field(f, 'd-status', 'status', [{ body: [{ text: timing, ...(tone ? { color: tone } : {}) }] }]),
    ...(step.note ? wrappedField(f, 'd-note', 'note', undefined, { text: step.note }) : []),
    ...field(f, 'd-commit', 'commit', shownCommits.length
      ? shownCommits.map(c => ({ body: [{ text: c.sha.slice(0, 7) }, { text: `${c.subject ? ` ${c.subject}` : ''}${c.at ? ` · ${since(now - c.at)}` : ''}`, dim: true }] }))
      : [{ body: [{ text: 'none yet', dim: true }] }]),
    ...field(f, 'd-gate', 'gate', gates.length
      ? gates.slice(-3).map(g => ({
          body: [{
            text: `${g.ok === null ? '● running' : g.ok ? '✓ passed' : '✗ failed'} ${hhmm(g.at)}${g.durationMs ? ` · ${Math.round(g.durationMs / 1000)}s` : ''}${g.background ? ' · background' : ''}`,
            ...(g.ok === null ? {} : { color: g.ok ? 'success' : 'error' }),
          }],
        }))
      : [{ body: [{ text: step.status === 'todo' ? 'not started' : startedAt === undefined ? 'no run seen in this session' : 'not run since the step started', dim: true }] }]),
    ...(agents.length
      ? field(f, 'd-agents', 'agents', agents.map(a => ({
          body: [
            { text: a.status === 'running' ? data.tones.pen : a.status === 'failed' ? '✗' : '✓', color: a.status === 'running' ? data.tones.ink : a.status === 'failed' ? 'error' : 'success' },
            { text: ` ${a.description}` },
          ],
          note: [{ text: `${shortModel(a.model)} · ${ago((a.endedAt ?? now) - a.startedAt)} · ${a.tools} tools${a.status === 'running' && a.lastTool ? ` · ${a.lastTool.split(' ')[0] ?? ''}` : ''}`, dim: true }],
        })))
      : []),
    ...drift.flatMap((d, i) => wrappedField(f, `d-drift-${i}`, i === 0 ? 'drift' : '', { text: '~ ', color: 'text', bold: true }, { text: d.text })),
    ...asks.flatMap((a, i) => wrappedField(f, `d-ask-${a.id}`, i === 0 ? 'asks' : '', { text: a.kind === 'decision' ? '? ' : '! ', color: a.kind === 'decision' ? 'warning' : 'error', bold: true }, { text: `${a.id} ${a.text}` })),
  ]
  return sections(f, [
    [
      ...wrappedRows(f, 'd-title', { ...glyph, text: { text: `${step.id} ${step.title}`, bold: true } }),
      row(f, 'd-where', { body: [{ text: `${phase ? `${phase.key} ${phase.title}` : ''} · step ${index + 1} of ${steps.length}${step.owner ? ` · @${step.owner}` : ''}`, dim: true }] }),
    ],
    details,
    log.length ? [rule(f, 'd-log-head', 'LOG', data.tones.ink, `${log.length}`), ...ledger(f, log, 'd-log')] : [],
  ])
}

/** When Claude asked: the log's `asked D1` line, else nothing. */
function askedAt(doc: Worklog, a: Attention): string {
  const line = doc.log.find(l => new RegExp(`\\basked ${a.id}\\b`).test(l))
  return /^(?:\d{4}-\d{2}-\d{2} )?(\d{1,2}:\d{2})/.exec(line ?? '')?.[1] ?? ''
}

/** One question: the `?` row with its note, the why, the options as buttons, a field for the person's own words. */
function question(f: Frame, data: ViewData, a: Attention, actions: PaneActions): RenderNode[] {
  const { Box, Button } = f.t
  // Terminal and desktop draw a text field; mobile has none.
  const Input = (f.t as { Input?: ElementConstructor<InputProps> }).Input
  const isDecision = a.kind === 'decision'
  const at = askedAt(data.doc, a)
  const blocks = isDecision && a.blocks ? `blocks ${a.blocks}` : ''
  const note = [at && `asked ${at}`, blocks].filter(Boolean).join(' · ')
  return [
    ...wrappedRows(f, `nd-${a.id}`, {
      glyph: isDecision ? '?' : '!', color: isDecision ? 'warning' : 'error', bold: true,
      text: { text: `${a.id} ${askText(a)}`, bold: true },
      ...(note ? { note: [{ text: note, dim: true }] } : {}),
    }),
    ...(a.why ? wrappedRows(f, `nd-why-${a.id}`, { lead: { text: '  why ', dim: true }, text: { text: a.why } }) : []),
    ...(isDecision && a.options?.length
      ? [framed(f, `nd-opts-${a.id}`, (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {a.options.map((o, i) => (
              <Button key={`opt-${a.id}-${i}`} variant={o === a.recommend ? 'primary' : undefined} label={o === a.recommend ? `${o} (recommended)` : o} onPress={() => actions.answer(a.id, o)} />
            ))}
          </Box>
        ))]
      : []),
    framed(f, `nd-ans-${a.id}`, Input
      ? <Input key={`ans-${a.id}`} placeholder={isDecision ? 'Or answer in your own words…' : 'Reply: what you did, or what Claude should do…'} submitLabel="Send" onSubmit={(value: string) => { if (value.trim()) actions.answer(a.id, value.trim()) }} />
      : <Button key={`chat-${a.id}`} plain dimColor label="Reply in chat" onPress={() => actions.replyInChat(a.id)} />),
  ]
}

/**
 * Everything waiting on the person, with what they need to answer it; then
 * what was noticed, then what was answered (`✓`, `Claude has it · 2m`).
 */
export function needsDetail(f: Frame, data: ViewData, actions: PaneActions): RenderNode[] {
  const { doc, now } = data
  const drift = needsOf(data).filter(n => !n.isAsk)
  return sections(f, [
    [rule(f, 'nd-head', 'NEEDS YOU', 'warning', `${doc.attention.length || ''}`), ...(doc.attention.length === 0 ? [row(f, 'nd-none', { body: [{ text: 'Nothing waiting on you.', dim: true }] })] : [])],
    ...doc.attention.map(a => question(f, data, a, actions)),
    drift.length
      ? [rule(f, 'nd-drift', '~ NOTICED', 'text', `${drift.length}`), ...drift.flatMap((n, i) => wrappedRows(f, `ndd-${i}`, { ...needsGlyph(n), text: { text: n.text }, ...(n.age ? { note: [{ text: n.age, dim: true }] } : {}) }))]
      : [],
    data.answered.length
      ? [
          rule(f, 'nd-done', '✓ ANSWERED', 'success'),
          ...data.answered.slice(0, 5).map(x => row(f, `nda-${x.id}-${x.at}`, {
            glyph: '✓', color: 'success',
            body: [{ text: `${x.id} ${clipTitle(x.answer, 60)}` }],
            note: [{ text: x.isDelivered ? `Claude has it · ${ago(now - x.at)}` : 'on its way to Claude', dim: true }],
          })),
        ]
      : [],
  ])
}
