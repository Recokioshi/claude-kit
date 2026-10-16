/**
 * The Overview page's sections, each through the Notebook frame: the header
 * (title, branch, the one-box-per-step meter), NEEDS YOU (or ~ NOTICED), PLAN
 * (the current phase, its steps, the doing row highlighted) and SIGNALS.
 */
import type { RenderNode } from 'claude-code'

import { fmtCost, fmtTokens } from './cost'
import { modelName, rosterOf } from './crew'
import { ago, lasted, since } from './observe'
import { tokensIn } from './runstats'
import type { RunStats } from './runstats'
import type { AgentRow, Facts } from './observe'
import { counts, currentPhase, phaseState } from './worklog'
import type { Phase, Step, Worklog } from './worklog'
import { blank, phaseGlyph, row, rule, stepGlyph } from './frame'
import type { Frame, Part } from './frame'
import { elapsedOf, healthOf, lastGate, meter, needsOf, paneMeterCells, shortModel } from './text'
import type { Needs } from './text'
import type { PaneActions, ViewData } from './view-types'

/** The main thread's figures, worded as an agent entry's: model and effort, tokens, cost, time worked. */
export function mainLine(run: RunStats): Part[] | null {
  const m = run.main
  if (m.requests === 0) return null
  const who = [m.model ? modelName(m.model) : '', m.effort ?? ''].filter(Boolean).join(' · ')
  return [
    ...(who ? [{ text: `${who} · `, dim: true }] : []),
    { text: `${fmtTokens(tokensIn(m))} tokens`, dim: true },
    { text: ` · ≈${fmtCost(m.costUsd)}`, dim: true },
    ...(m.workingMs > 0 ? [{ text: ` · ${lasted(m.workingMs)} working`, dim: true }] : []),
  ]
}

/** Header rows: title, branch with the meter, and the main thread's figures once it made a request. */
export const headerRows = (data: ViewData): number => (data.isAdhoc ? 1 + (data.facts.branch ? 1 : 0) : 2) + (mainLine(data.run) ? 1 : 0)

/** A session with no worklog: the title is "Session", the branch stands alone and there is no meter. */
function sessionHeader(f: Frame, data: ViewData): RenderNode[] {
  const health = healthOf(data)
  const elapsed = elapsedOf(data)
  const main = mainLine(data.run)
  return [
    row(f, 'h1', { glyph: health.glyph, color: health.tone, bold: true, body: [{ text: data.doc.meta.title, bold: true }], ...(elapsed ? { note: [{ text: elapsed, dim: true }] } : {}) }),
    ...(data.facts.branch ? [row(f, 'h2', { body: [{ text: data.facts.branch, dim: true }] })] : []),
    ...(main ? [row(f, 'h3', { body: main })] : []),
  ]
}

export function header(f: Frame, data: ViewData): RenderNode[] {
  if (data.isAdhoc) return sessionHeader(f, data)
  const { doc } = data
  const { done, total } = counts(doc)
  const health = healthOf(data)
  const bar = meter(done, total, paneMeterCells(total, f.width, f.mono))
  const elapsed = elapsedOf(data)
  const main = mainLine(data.run)
  return [
    row(f, 'h1', { glyph: health.glyph, color: health.tone, bold: true, body: [{ text: doc.meta.title, bold: true }], ...(elapsed ? { note: [{ text: elapsed, dim: true }] } : {}) }),
    row(f, 'h2', {
      body: [{ text: doc.meta.branch ?? data.path, dim: true }],
      note: [{ text: bar.filled, color: data.tones.ink }, { text: bar.empty, dim: true }, { text: '  ' }, { text: `${done}/${total}`, bold: true }],
    }),
    ...(main ? [row(f, 'h3', { body: main })] : []),
  ]
}

function agentOf(facts: Facts, step: Step): AgentRow | undefined {
  return [...facts.agents].reverse().find(a => a.step === step.id && (a.status === 'running' || step.status === 'doing'))
}

/** The step row's margin note: its agent (`opus 6m · Edit`), else the decision holding it (`? D1`), else its sha. */
function stepNote(f: Frame, step: Step, data: ViewData): Part[] {
  const narrow = f.mono && !f.ruled
  const agent = narrow ? undefined : agentOf(data.facts, step)
  if (agent) {
    const tool = step.status === 'doing' && agent.lastTool && f.width >= 52 ? ` · ${agent.lastTool.split(' ')[0] ?? ''}` : ''
    return [{ text: `${shortModel(agent.model)} ${ago(data.now - agent.startedAt)}${tool}`, dim: true }]
  }
  const ask = narrow ? undefined : data.doc.attention.find(a => a.kind === 'decision' && a.blocks === step.id)
  if (ask) return [{ text: `? ${ask.id}`, color: 'warning' }]
  if (step.sha) return [{ text: step.sha.slice(0, 7), dim: true }]
  if (step.owner && step.status === 'doing' && !narrow) return [{ text: step.owner, dim: true }]
  return []
}

export function stepRow(f: Frame, step: Step, data: ViewData, open?: () => void): RenderNode {
  const drifted = data.drift.some(d => d.step === step.id)
  const settled = step.status === 'done' || step.status === 'skipped'
  const doing = step.status === 'doing'
  return row(f, `s-${step.id}`, {
    ...stepGlyph(step.status, data.tones, drifted),
    body: [{ text: `${step.id} ${step.title}`, ...(settled ? { dim: true } : {}), ...(doing ? { bold: true } : {}) }],
    ...(open ? { press: { key: `open-${step.id}`, onPress: open, ...(settled ? { dim: true } : {}) } } : {}),
    note: stepNote(f, step, data),
    highlight: doing,
    rail: data.tones.ink,
  })
}

/** The phase strip: `✓A ▸B □C`. */
export function chips(doc: Worklog): string {
  return doc.phases.map(p => `${phaseState(p) === 'done' ? '✓' : phaseState(p) === 'current' ? '▸' : '□'}${p.key}`).join(' ')
}

const doneOf = (p: Phase) => p.steps.filter(s => s.status === 'done' || s.status === 'skipped').length

/**
 * A phase's row, its title bold. Given `fold`, the terminal makes the title the
 * fold Button; a proportional font keeps the title bold Text and folds with a
 * `▾ 3/3` Button in the note's place (a desktop Button drops a bold label).
 */
export function phaseRow(f: Frame, data: ViewData, p: Phase, fold?: { key: string; onPress: () => void; isOpen: boolean }): RenderNode {
  const state = phaseState(p)
  const count = `${doneOf(p)}/${p.steps.length}`
  const title = { text: `${p.key} ${p.title}`, bold: true, ...(state === 'done' ? { dim: true } : {}) }
  const head = { ...phaseGlyph(state, data.tones), body: [title] }
  if (fold && !f.mono) return row(f, `ph-${p.key}`, { ...head, action: { key: fold.key, label: `${fold.isOpen ? '▾' : '▸'} ${count}`, onPress: fold.onPress } })
  return row(f, `ph-${p.key}`, {
    ...head,
    ...(fold ? { press: { key: fold.key, onPress: fold.onPress, ...(state === 'done' ? { dim: true } : {}) } } : {}),
    note: [{ text: count, dim: true }],
  })
}

/** A needs item's margin note: what a decision blocks, or how long ago drift was seen. */
function needsNote(n: Needs): Part[] {
  if (n.blocks) return [{ text: `blocks ${n.blocks}`, color: 'warning' }]
  return n.age ? [{ text: n.age, dim: true }] : []
}

export function needsGlyph(n: Needs) {
  return { glyph: n.glyph, color: n.tone, bold: true }
}

export function needsBlock(f: Frame, data: ViewData, max: number, actions?: PaneActions): RenderNode[] {
  const items = needsOf(data)
  if (items.length === 0) return []
  const asks = items.some(n => n.isAsk)
  const shown = items.slice(0, max)
  return [
    rule(f, 'needs-head', asks ? 'NEEDS YOU' : '~ NOTICED', asks ? 'warning' : 'text'),
    ...shown.map((n, i) => row(f, `n-${i}`, {
      ...needsGlyph(n),
      body: [{ text: n.text }],
      ...(actions && n.isAsk ? { press: { key: `needs-${i}`, onPress: actions.openNeeds } } : {}),
      note: needsNote(n),
    })),
    ...(items.length > max ? [row(f, 'n-more', { body: [{ text: `+${items.length - max} more`, dim: true }] })] : []),
  ]
}

/** How many rows `needsBlock` draws for `max` items. */
export function needsRows(data: ViewData, max: number): number {
  const n = needsOf(data).length
  return n === 0 ? 0 : 1 + Math.min(max, n) + (n > max ? 1 : 0)
}

/** The steps window: the doing and next steps in view, done ones folded above, the rest below. */
function stepWindow(steps: Step[], rows: number): { start: number; count: number } {
  const firstOpen = Math.max(0, steps.findIndex(s => s.status !== 'done' && s.status !== 'skipped'))
  let count = Math.min(steps.length, Math.max(1, rows))
  for (;;) {
    // Up to two done steps of context above the first open one, never at the cost of that step.
    const start = Math.max(0, Math.min(firstOpen - Math.min(2, count - 1), steps.length - count))
    const folds = (start > 0 ? 1 : 0) + (steps.length - start - count > 0 ? 1 : 0)
    if (count + folds <= rows || count <= 1) return { start, count }
    count -= 1
  }
}

const looseOf = (data: ViewData) => data.facts.agents.filter(a => a.status === 'running' && a.step === null).slice(0, 2)
export const looseRows = (data: ViewData) => looseOf(data).length

/** PLAN: the rule with the phase chips, the current phase and up to `rows` rows of its steps. */
export function planBlock(f: Frame, data: ViewData, rows: number, actions?: PaneActions): RenderNode[] {
  const { doc } = data
  const phase: Phase | undefined = currentPhase(doc) ?? doc.phases[doc.phases.length - 1]
  const out = [rule(f, 'plan-head', 'PLAN', data.tones.ink, chips(doc))]
  if (!phase) return out
  out.push(phaseRow(f, data, phase))
  const { start, count } = stepWindow(phase.steps, rows)
  const shown = phase.steps.slice(start, start + count)
  if (start > 0) out.push(row(f, 's-above', { body: [{ text: `✓ ${start} done above`, dim: true }], rail: data.tones.ink }))
  out.push(...shown.map(s => stepRow(f, s, data, actions ? () => actions.openStep(s.id, 'overview') : undefined)))
  const below = phase.steps.length - start - shown.length
  if (below > 0) out.push(row(f, 's-below', { body: [{ text: `+${below} more`, dim: true }], rail: data.tones.ink }))
  for (const a of looseOf(data)) {
    out.push(row(f, `loose-${a.id}`, {
      glyph: '~', color: 'text', bold: true,
      body: [{ text: `agent “${a.description}” (no step)` }],
      note: [{ text: `${shortModel(a.model)} ${ago(data.now - a.startedAt)}`, dim: true }],
      rail: data.tones.ink,
    }))
  }
  return out
}

/** Most agents the session Overview lists; the Agents tab has the rest. */
const CREW_MAX = 5

/** AGENTS, for a session with no plan to hang them under: running first, each opens its page. */
export function crewBlock(f: Frame, data: ViewData, actions?: PaneActions): RenderNode[] {
  const roster = rosterOf(data.facts.agents)
  if (roster.length === 0) return []
  const running = roster.filter(a => a.status === 'running').length
  return [
    rule(f, 'crew-head', 'AGENTS', data.tones.ink, `${roster.length} · ${running} running`),
    ...roster.slice(0, CREW_MAX).map(a => row(f, `crew-${a.id}`, {
      ...(a.status === 'running' ? { glyph: data.tones.pen, color: data.tones.ink } : a.status === 'done' ? { glyph: '✓', color: 'success' } : { glyph: '✗', color: 'error' }),
      body: [{ text: a.description, ...(a.status === 'running' ? { bold: true } : { dim: true }) }],
      ...(actions ? { press: { key: `open-crew-${a.id}`, onPress: () => actions.openAgent(a.id, 'overview') } } : {}),
      note: [{ text: `${shortModel(a.model)} ${ago(data.now - a.startedAt)}`, dim: true }],
    })),
    ...(roster.length > CREW_MAX ? [row(f, 'crew-more', { body: [{ text: `+${roster.length - CREW_MAX} more`, dim: true }] })] : []),
  ]
}

/** SIGNALS: gate, git (branch, last commit) and context with the session's and the subagents' cost. */
export function signalsBlock(f: Frame, data: ViewData): RenderNode[] {
  const { facts, now } = data
  const g = lastGate(facts, now)
  const commit = facts.commits[facts.commits.length - 1]
  const today = facts.commits.filter(c => now - c.at < 24 * 60 * 60_000).length
  const gate: Part[] = !g
    ? [{ text: 'not run yet', dim: true }]
    : g.ok === null
      ? [{ text: '● running' }]
      : [{ text: `${g.ok ? '✓ passed' : '✗ failed'} ${since(now - g.at)}`, color: g.ok ? 'success' : 'error' }, ...(g.durationMs ? [{ text: ` · took ${Math.round(g.durationMs / 1000)}s`, dim: true }] : [])]
  const git: Part[] = [
    ...(facts.branch ? [{ text: facts.branch, dim: true }, { text: ' · ', dim: true }] : []),
    { text: commit ? `${commit.sha} ${since(now - commit.at)}` : '–' },
    ...(today > 1 ? [{ text: ` · ${today} today`, dim: true }] : []),
  ]
  const ctx = facts.context
  // Two labelled figures, never summed: the session's cost may or may not include its subagents.
  const agentsCost = facts.agents.reduce((n, a) => n + a.costUsd, 0)
  const ctxParts: Part[] = ctx
    ? [
        { text: `${ctx.percent}%`, ...(ctx.percent >= 80 ? { color: 'warning' } : {}) },
        ...(ctx.cost !== undefined ? [{ text: ` · session $${ctx.cost.toFixed(2)}`, dim: true }] : []),
        ...(facts.agents.length > 0 ? [{ text: ` · agents ≈$${agentsCost.toFixed(2)}`, dim: true }] : []),
      ]
    : []
  return [
    rule(f, 'sig-head', 'SIGNALS', data.tones.ink),
    row(f, 'sig-gate', { label: 'gate', body: gate }),
    row(f, 'sig-git', { label: 'git', body: git }),
    ...(ctx ? [row(f, 'sig-ctx', { label: 'ctx', body: ctxParts })] : []),
  ]
}

export const signalRows = (data: ViewData) => (data.facts.context ? 4 : 3)

/** Sections joined by exactly one blank row. */
export function sections(f: Frame, parts: ReadonlyArray<ReadonlyArray<RenderNode | null | undefined>>): RenderNode[] {
  const out: RenderNode[] = []
  const isNode = (n: RenderNode | null | undefined): n is RenderNode => n !== null && n !== undefined
  parts.map(p => p.filter(isNode)).filter(p => p.length > 0).forEach((p, i) => {
    if (i > 0) {
      const b = blank(f, `gap-${i}`)
      if (b) out.push(b)
    }
    out.push(...p)
  })
  return out
}
