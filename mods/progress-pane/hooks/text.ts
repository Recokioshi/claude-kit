/**
 * What the drawings say, before anything is drawn: the run's health, the
 * current step, the gate and elapsed figures, what waits on the person, and
 * the overview as Markdown (`textOf`). Pure: data in, strings out.
 *
 * The Markdown form keeps the kit's shared glyphs (✓ done · ● doing · ○ todo ·
 * ▶ current), since it is read in cloud sessions with no theme at all.
 */
import { ago, isStaleGate, since, lasted } from './observe'
import type { Facts } from './observe'
import { allSteps, counts, endedMs, phaseState } from './worklog'
import type { Attention, Phase, Step, Worklog } from './worklog'

import type { PaneView, ViewData } from './view-types'

export const shortModel = (model: string) => (/opus/.test(model) ? 'opus' : /sonnet/.test(model) ? 'sonnet' : /haiku/.test(model) ? 'haiku' : /fable/.test(model) ? 'fable' : model.split('-').slice(0, 2).join('-'))

/** Filled (`■`) and empty (`□`) meter cells: `done` of `total`, rounded to `cells`. */
export function meter(done: number, total: number, cells: number): { filled: string; empty: string } {
  const n = total === 0 ? 0 : Math.round((done / total) * cells)
  return { filled: '■'.repeat(n), empty: '□'.repeat(cells - n) }
}

/**
 * The pane meter's cell count: one box per step (the meter IS the checklist)
 * up to 24 steps, else 20 rounded; 10 where a narrow terminal cannot spare it.
 */
export function paneMeterCells(total: number, width: number, mono: boolean): number {
  const cells = total <= 24 ? total : 20
  return mono && width < 60 && cells > 10 ? 10 : cells
}

/** Text shortened to `max` cells, an ellipsis standing for the rest. */
export const clipTitle = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`)

/**
 * How long the run took, or has been going: from `started` to now while
 * active, to its last update once finished or paused (not to whenever the
 * pane is opened again).
 */
export function elapsedOf(data: ViewData): string {
  if (!data.startedMs) return ''
  const end = endedMs(data.doc)
  return end === null ? ago(data.now - data.startedMs) : `took ${lasted(end - data.startedMs)}`
}

/**
 * The run's one-glyph health: gate red `✗`, needs you `!` (error while a
 * blocker waits, warning when only decisions do), finished `✓`, else the pen
 * in ink (working).
 */
export function healthOf(data: ViewData): { glyph: string; tone: string } {
  if (data.drift.some(d => d.rule === 'D6')) return { glyph: '✗', tone: 'error' }
  if (data.doc.attention.some(a => a.kind === 'blocker')) return { glyph: '!', tone: 'error' }
  if (data.doc.attention.length > 0) return { glyph: '!', tone: 'warning' }
  if (data.doc.meta.status === 'done') return { glyph: '✓', tone: 'success' }
  return { glyph: data.tones.pen, tone: data.tones.ink }
}

/** The latest gate run, past background runs that never reported back (30 min). */
export function lastGate(facts: Facts, now: number) {
  return [...facts.gates].reverse().find(g => !isStaleGate(g, now))
}

/** The band's gate segment: `gate ✓ 4m`, `gate ● running`. */
export function gateText(facts: Facts, now: number): { text: string; tone?: string } | null {
  const g = lastGate(facts, now)
  if (!g) return null
  if (g.ok === null) return { text: 'gate ● running' }
  return { text: `gate ${g.ok ? '✓' : '✗'} ${ago(now - g.at)}`, tone: g.ok ? 'success' : 'error' }
}

/** The step the run is on: the first doing one, else the next todo one. */
export function currentStepOf(doc: Worklog): Step | undefined {
  const steps = allSteps(doc)
  return steps.find(s => s.status === 'doing') ?? steps.find(s => s.status === 'todo')
}

/** Whether a phase is open in the Plan tab: the person's toggle, else open while current. */
export function isExpanded(p: Phase, ui: PaneView): boolean {
  return ui.expanded[p.key] ?? phaseState(p) === 'current'
}

/** The question as written, without the id Claude sometimes repeats at its start ("D1 D1 …"). */
export function askText(a: Attention): string {
  return a.text.replace(new RegExp(`^${a.id}\\b[:.)\\s-]*`, 'i'), '')
}

/** One thing waiting on the person (`isAsk`) or only noticed. `blocks`: the step a decision holds up. */
export type Needs = { glyph: string; tone: string; age: string; text: string; isAsk?: boolean; blocks?: string }

export function needsOf(data: ViewData): Needs[] {
  const items: Needs[] = []
  for (const a of data.doc.attention) {
    items.push(a.kind === 'decision'
      ? { glyph: '?', tone: 'warning', age: '', text: `${a.id} ${askText(a)}`, isAsk: true, ...(a.blocks ? { blocks: a.blocks } : {}) }
      : { glyph: '!', tone: 'error', age: '', text: `${a.id} ${askText(a)}`, isAsk: true })
  }
  for (const d of data.drift) {
    items.push({ glyph: d.rule === 'D6' ? '✗' : '~', tone: d.rule === 'D6' ? 'error' : 'text', age: ago(data.now - d.at), text: d.text })
  }
  for (const s of data.facts.servers) {
    items.push({ glyph: '!', tone: 'error', age: ago(data.now - s.startedAt), text: `${s.label} left running` })
  }
  return items
}

const TEXT_GLYPH: Record<Step['status'], string> = { todo: '○', doing: '●', done: '✓', blocked: '!', skipped: '–' }

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
      for (const s of p.steps) lines.push(`  - ${TEXT_GLYPH[s.status]} ${s.id} ${s.title}${s.sha ? ` · ${s.sha.slice(0, 7)}` : ''}`)
    }
  }
  const running = facts.agents.filter(a => a.status === 'running')
  if (running.length) lines.push('', '**Agents**', ...running.map(a => `- ● ${a.description} · ${shortModel(a.model)} · ${ago(now - a.startedAt)}`))
  const g = lastGate(facts, now)
  const c = facts.commits[facts.commits.length - 1]
  lines.push('', `gate ${g ? (g.ok === null ? 'running' : `${g.ok ? '✓' : '✗'} ${since(now - g.at)}`) : 'not run yet'} · last commit ${c ? `${c.sha} ${since(now - c.at)}` : '–'}`)
  return lines.join('\n')
}
