/**
 * Worklog format WL1: parse, check and write. Pure.
 *
 * The grammar (docs/worklog-spec.md) is strict and line-oriented on purpose:
 * every line belongs to a known block or it is an error with its line
 * number, so the pane never draws a guess and Claude is told exactly what to
 * fix.
 */

export type StepStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'skipped'

export type Step = {
  id: string
  title: string
  status: StepStatus
  sha?: string
  owner?: string
  note?: string
}

export type Phase = { key: string; title: string; steps: Step[] }

/** What the person needs to answer from the pane: why it is asked, what it holds up, Claude's pick. */
export type AttentionDetail = { why?: string; blocks?: string; recommend?: string }

export type Attention =
  | ({ kind: 'decision'; id: string; text: string; options?: string[] } & AttentionDetail)
  | ({ kind: 'blocker'; id: string; text: string } & AttentionDetail)

export type Meta = {
  worklog: 1
  title: string
  status: 'active' | 'paused' | 'done'
  plan?: string
  branch?: string
  gate?: string
  started?: string
  updated?: string
}

export type Worklog = {
  meta: Meta
  goal?: string
  rules: string[]
  attention: Attention[]
  phases: Phase[]
  notes: string[]
  log: string[]
}

export type ParseError = { line: number; message: string }

export const MARKS: Record<string, StepStatus> = { ' ': 'todo', '~': 'doing', x: 'done', X: 'done', '!': 'blocked', '-': 'skipped' }
export const MARK_OF: Record<StepStatus, string> = { todo: ' ', doing: '~', done: 'x', blocked: '!', skipped: '-' }

export const LIMITS = { title: 80, stepTitle: 90, note: 120, why: 400, log: 140, phases: 12, stepsPerPhase: 30, logLines: 30, rules: 8, notes: 10, doing: 3 }

const STEP_ID = /^[A-Za-z]{0,4}\d+(?:\.\d+)?[a-z]?$/
const STEP_LINE = /^- \[([ ~xX!-])\] (\S+) (.+)$/
const PHASE_LINE = /^## Phase ([A-Za-z0-9]{1,4}) · (.+)$/
const DECISION_LINE = /^- \[\?\] (D\d+) (.+?)(?: — options: (.+))?$/
const BLOCKER_LINE = /^- \[!\] (\S+) (.+)$/
/** An indented detail under an attention item: `  why: …`, `  blocks: B2`, `  recommend: keep`. */
const DETAIL_LINE = /^ {2,}(why|blocks|recommend): (.+)$/
const LOG_LINE = /^- (?:\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2} .+$/

/** Splits a step's tail: `title · sha @owner — note`. */
function stepParts(rest: string): Pick<Step, 'title' | 'sha' | 'owner' | 'note'> {
  let text = rest
  let note: string | undefined
  const dash = text.indexOf(' — ')
  if (dash !== -1) {
    note = text.slice(dash + 3).trim()
    text = text.slice(0, dash)
  }
  let owner: string | undefined
  const at = /\s@([\w.-]+)\s*$/.exec(text)
  if (at) {
    owner = at[1]
    text = text.slice(0, at.index)
  }
  let sha: string | undefined
  const dot = /\s·\s([0-9a-f]{7,40})\s*$/.exec(text)
  if (dot) {
    sha = dot[1]
    text = text.slice(0, dot.index)
  }
  return { title: text.trim(), sha, owner, note }
}

/** Why a step title would not read back as itself (it holds a note, owner or sha marker), or null. */
export function stepTitleProblem(title: string): string | null {
  if (title.includes(' — ')) return 'a step title cannot contain " — " (that starts the note; pass note instead)'
  if (/(^|\s)@[\w.-]+$/.test(title)) return 'a step title cannot end with @word (that is the owner; pass owner instead)'
  if (/\s·\s[0-9a-f]{7,40}$/.test(title)) return 'a step title cannot end with " · <sha>" (pass commit instead)'
  return null
}

type Block = 'none' | 'rules' | 'attention' | 'phase' | 'notes' | 'log'

export function parseWorklog(text: string): { doc: Worklog | null; errors: ParseError[] } {
  const errors: ParseError[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const err = (line: number, message: string) => errors.push({ line: line + 1, message })

  if (lines[0]?.trim() !== '---') {
    return { doc: null, errors: [{ line: 1, message: 'a worklog starts with front matter (---)' }] }
  }
  const end = lines.indexOf('---', 1)
  if (end === -1) {
    return { doc: null, errors: [{ line: 1, message: 'front matter is not closed with ---' }] }
  }

  const raw: Record<string, string> = {}
  for (let i = 1; i < end; i += 1) {
    const m = /^([a-z]+):\s*(.*)$/.exec(lines[i] ?? '')
    if (!m) {
      err(i, 'front matter lines are `key: value`')
      continue
    }
    raw[m[1] ?? ''] = (m[2] ?? '').trim()
  }
  if (raw.worklog !== '1') err(1, 'front matter needs `worklog: 1`')
  if (!raw.title) err(1, 'front matter needs a title')
  if (!['active', 'paused', 'done'].includes(raw.status ?? '')) err(1, 'status is active, paused or done')

  const meta: Meta = {
    worklog: 1,
    title: raw.title ?? '',
    status: (['active', 'paused', 'done'].includes(raw.status ?? '') ? raw.status : 'active') as Meta['status'],
    plan: raw.plan || undefined,
    branch: raw.branch || undefined,
    gate: raw.gate || undefined,
    started: raw.started || undefined,
    updated: raw.updated || undefined,
  }

  const doc: Worklog = { meta, rules: [], attention: [], phases: [], notes: [], log: [] }
  const ids = new Set<string>()
  let block: Block = 'none'
  let phase: Phase | null = null

  for (let i = end + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').replace(/\s+$/, '')
    if (line === '') continue

    if (line.startsWith('# ')) {
      // an optional H1 repeating the title
      continue
    }
    if (block === 'none' && line.startsWith('Goal: ')) {
      doc.goal = line.slice(6).trim()
      continue
    }
    if (line === '## Rules') { block = 'rules'; phase = null; continue }
    if (line === '## Attention') { block = 'attention'; phase = null; continue }
    if (line === '## Notes') { block = 'notes'; phase = null; continue }
    if (line === '## Log') { block = 'log'; phase = null; continue }
    const ph = PHASE_LINE.exec(line)
    if (ph) {
      const key = ph[1] ?? ''
      if (doc.phases.some(p => p.key === key)) err(i, `phase ${key} appears twice`)
      phase = { key, title: (ph[2] ?? '').trim(), steps: [] }
      doc.phases.push(phase)
      block = 'phase'
      continue
    }
    if (line.startsWith('## ')) {
      err(i, `unknown section "${line.slice(3)}" (allowed: Rules, Attention, Phase <key> · <title>, Notes, Log)`)
      block = 'none'
      continue
    }

    switch (block) {
      case 'rules':
      case 'notes': {
        if (!line.startsWith('- ')) { err(i, `${block} are "- " bullets`); break }
        ;(block === 'rules' ? doc.rules : doc.notes).push(line.slice(2).trim())
        break
      }
      case 'attention': {
        const detail = DETAIL_LINE.exec(line)
        if (detail) {
          const last = doc.attention[doc.attention.length - 1]
          if (!last) { err(i, `"${detail[1]}:" belongs under a decision or blocker`); break }
          doc.attention[doc.attention.length - 1] = { ...last, [detail[1] as keyof AttentionDetail]: (detail[2] ?? '').trim() }
          break
        }
        const d = DECISION_LINE.exec(line)
        if (d) {
          const options = d[3]?.split('/').map(s => s.trim()).filter(Boolean)
          doc.attention.push({ kind: 'decision', id: d[1] ?? '', text: (d[2] ?? '').trim(), options })
          break
        }
        const b = BLOCKER_LINE.exec(line)
        if (b) {
          doc.attention.push({ kind: 'blocker', id: b[1] ?? '', text: (b[2] ?? '').trim() })
          break
        }
        err(i, 'attention lines are `- [?] D1 question — options: a / b` or `- [!] <step-id> blocker`, each optionally followed by indented `  why: …`, `  blocks: <step-id>`, `  recommend: <option>`')
        break
      }
      case 'phase': {
        const s = STEP_LINE.exec(line)
        if (!s || phase === null) { err(i, 'steps are `- [ ] <id> <title>` with [ ] [~] [x] [!] [-]'); break }
        const id = s[2] ?? ''
        if (!STEP_ID.test(id)) { err(i, `step id "${id}" should look like A3, 2.1 or DOC2`); break }
        if (ids.has(id)) { err(i, `step ${id} appears twice`); break }
        ids.add(id)
        phase.steps.push({ id, status: MARKS[s[1] ?? ' '] ?? 'todo', ...stepParts(s[3] ?? '') })
        break
      }
      case 'log': {
        if (!LOG_LINE.test(line)) { err(i, 'log lines are `- HH:MM text` (newest first)'); break }
        doc.log.push(line.slice(2))
        break
      }
      default:
        err(i, 'text outside a section (only `Goal:` may stand before the first section)')
    }
  }

  if (doc.phases.length === 0) errors.push({ line: end + 2, message: 'a worklog needs at least one `## Phase <key> · <title>`' })
  const doing = doc.phases.flatMap(p => p.steps).filter(s => s.status === 'doing').length
  if (doing > LIMITS.doing) errors.push({ line: end + 2, message: `${doing} steps are doing at once (at most ${LIMITS.doing})` })

  return { doc: errors.length === 0 || doc.phases.length > 0 ? doc : null, errors }
}

function stepLine(s: Step): string {
  return `- [${MARK_OF[s.status]}] ${s.id} ${s.title}${s.sha ? ` · ${s.sha}` : ''}${s.owner ? ` @${s.owner}` : ''}${s.note ? ` — ${s.note}` : ''}`
}

export function serializeWorklog(doc: Worklog): string {
  const m = doc.meta
  const front = [
    '---',
    'worklog: 1',
    `title: ${m.title}`,
    m.plan ? `plan: ${m.plan}` : null,
    m.branch ? `branch: ${m.branch}` : null,
    m.gate ? `gate: ${m.gate}` : null,
    `status: ${m.status}`,
    m.started ? `started: ${m.started}` : null,
    m.updated ? `updated: ${m.updated}` : null,
    '---',
  ].filter((l): l is string => l !== null)

  const out: string[] = [...front, '']
  if (doc.goal) out.push(`Goal: ${doc.goal}`, '')
  if (doc.rules.length) out.push('## Rules', ...doc.rules.map(r => `- ${r}`), '')
  if (doc.attention.length) {
    out.push('## Attention')
    for (const a of doc.attention) {
      out.push(a.kind === 'decision' ? `- [?] ${a.id} ${a.text}${a.options?.length ? ` — options: ${a.options.join(' / ')}` : ''}` : `- [!] ${a.id} ${a.text}`)
      if (a.why) out.push(`  why: ${a.why}`)
      if (a.blocks) out.push(`  blocks: ${a.blocks}`)
      if (a.recommend) out.push(`  recommend: ${a.recommend}`)
    }
    out.push('')
  }
  for (const p of doc.phases) {
    out.push(`## Phase ${p.key} · ${p.title}`, ...p.steps.map(stepLine), '')
  }
  if (doc.notes.length) out.push('## Notes', ...doc.notes.map(n => `- ${n}`), '')
  if (doc.log.length) out.push('## Log', ...doc.log.slice(0, LIMITS.logLines).map(l => `- ${l}`), '')
  return out.join('\n')
}

export const allSteps = (doc: Worklog): Step[] => doc.phases.flatMap(p => p.steps)

/** The front matter's `started`, in ms, or null. */
/** When a finished or paused run stopped: its last `updated` stamp. Null while active. */
export function endedMs(doc: Worklog): number | null {
  if (doc.meta.status === 'active' || !doc.meta.updated) return null
  const ms = Date.parse(doc.meta.updated.replace(/Z?$/, 'Z'))
  return Number.isFinite(ms) ? ms : null
}

export function startedMs(doc: Worklog): number | null {
  const ms = doc.meta.started ? Date.parse(doc.meta.started.replace(/Z?$/, 'Z')) : NaN
  return Number.isFinite(ms) ? ms : null
}

export function counts(doc: Worklog): { done: number; total: number } {
  const steps = allSteps(doc).filter(s => s.status !== 'skipped')
  return { done: steps.filter(s => s.status === 'done').length, total: steps.length }
}

/** The phase holding the first unfinished step (the one being worked on). */
export function currentPhase(doc: Worklog): Phase | undefined {
  return doc.phases.find(p => p.steps.some(s => s.status === 'doing')) ?? doc.phases.find(p => p.steps.some(s => s.status === 'todo' || s.status === 'blocked'))
}

export function phaseState(p: Phase): 'done' | 'current' | 'todo' {
  const open = p.steps.filter(s => s.status !== 'done' && s.status !== 'skipped')
  if (open.length === 0) return 'done'
  if (p.steps.some(s => s.status !== 'todo')) return 'current'
  return 'todo'
}
