/**
 * The `worklog` tool's operations: every change Claude makes to the worklog,
 * checked before it is written. Pure.
 */
import { GATE_STALE_MS } from './observe'
import type { GateRun } from './observe'
import { allSteps, counts, LIMITS, startedMs, stepTitleProblem } from './worklog'
import type { Attention, Phase, Step, StepStatus, Worklog } from './worklog'

export type PhaseInput = { key?: string; title: string; steps: (string | { id?: string; title: string })[] }

export type ToolInput = {
  op: 'start' | 'step' | 'add' | 'attention' | 'resolve' | 'log' | 'finish' | 'show' | 'progress'
  // progress (subagents): steps done of total, with `note` as what it is on
  done?: number
  total?: number
  // start
  title?: string
  plan?: string
  branch?: string
  gate?: string
  goal?: string
  rules?: string[]
  phases?: PhaseInput[]
  replace?: boolean
  // step
  id?: string
  status?: StepStatus
  note?: string
  commit?: string
  owner?: string
  force?: boolean
  reason?: string
  gateOk?: boolean
  // add
  phase?: string
  // attention
  kind?: 'decision' | 'blocker'
  text?: string
  options?: string[]
  // resolve
  ref?: string
  /** attention: what Claude found, what the answer changes (≤400). */
  why?: string
  /** attention: the step id the answer holds up. */
  blocks?: string
  /** attention decision: Claude's pick, one of the options. */
  recommend?: string
  answer?: string
  // finish
  summary?: string
}

export type OpContext = {
  /** Now, ms. */
  now: number
  /** "16:40", the person's clock time for log lines. */
  clock: string
  /** ISO minute stamp for `updated`. */
  stamp: string
  /** The gate runs the mod saw this session, oldest first. */
  gates: GateRun[]
  /** When each step went to doing (ms). */
  startedAt: Record<string, number>
  /** When a step was last marked done (ms): a step done straight from todo counts from here. */
  lastDoneAt?: number
}

export type OpResult =
  | { ok: true; doc: Worklog; message: string; started?: string[]; isNew?: boolean; replaced?: Worklog }
  | { ok: false; error: string }

export const TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  todo: ['doing', 'skipped', 'blocked', 'done'],
  doing: ['done', 'blocked', 'skipped', 'todo'],
  blocked: ['doing', 'skipped', 'todo'],
  done: ['doing'],
  skipped: ['todo', 'doing'],
}

const STEP_ID = /^[A-Za-z]{0,4}\d+(?:\.\d+)?[a-z]?$/
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function nextSteps(doc: Worklog, n = 2): Step[] {
  return allSteps(doc).filter(s => s.status === 'todo').slice(0, n)
}

/** The compact line every successful call returns: progress and what comes next. */
export function orientation(doc: Worklog): string {
  const { done, total } = counts(doc)
  const doing = allSteps(doc).filter(s => s.status === 'doing')
  const next = nextSteps(doc)
  const parts = [`${done}/${total} done`]
  if (doing.length) parts.push(`doing: ${doing.map(s => `${s.id} ${s.title}`).join('; ')}`)
  if (next.length) parts.push(`next: ${next.map(s => `${s.id} ${s.title}`).join('; ')}`)
  const asks = doc.attention.length
  if (asks) parts.push(`${asks} waiting on the user`)
  return parts.join(' · ')
}

function findStep(doc: Worklog, id: string): { phase: Phase; step: Step } | null {
  for (const phase of doc.phases) {
    const step = phase.steps.find(s => s.id.toLowerCase() === id.toLowerCase())
    if (step) return { phase, step }
  }
  return null
}

function withLog(doc: Worklog, ctx: OpContext, text: string): Worklog {
  return { ...doc, log: [`${ctx.clock} ${clip(oneLine(text), LIMITS.log - 6)}`, ...doc.log].slice(0, LIMITS.logLines) }
}

function touch(doc: Worklog, ctx: OpContext): Worklog {
  return { ...doc, meta: { ...doc.meta, updated: ctx.stamp } }
}

function mapStep(doc: Worklog, id: string, change: (s: Step) => Step): Worklog {
  return { ...doc, phases: doc.phases.map(p => ({ ...p, steps: p.steps.map(s => (s.id === id ? change(s) : s)) })) }
}

/**
 * Whether the gate passed for a step that started at `since`: the latest finished run started
 * since then and is green; or, on the model's word (`isClaimed`), a background run started since
 * then and is under 30 min old.
 */
export function gateEvidence(gates: GateRun[], since: number, now: number, isClaimed: boolean): 'green' | 'claimed' | 'red' | 'waiting' | 'none' {
  const finished = gates.filter(g => g.ok !== null)
  const last = finished[finished.length - 1]
  if (last && last.at >= since && last.ok === true) return 'green'
  const pending = gates.some(g => g.ok === null && g.background === true && g.at >= since && now - g.at < GATE_STALE_MS)
  if (pending && isClaimed) return 'claimed'
  if (last && last.at >= since) return 'red'
  return pending ? 'waiting' : 'none'
}

const GATE_WHY = { red: 'its last run failed', waiting: 'a background run has no result here; once it is green, call again with gateOk: true', none: 'no green run seen since the step started' }

function buildPhases(input: PhaseInput[]): { phases: Phase[] } | { error: string } {
  if (input.length === 0) return { error: 'start needs at least one phase with steps' }
  if (input.length > LIMITS.phases) return { error: `at most ${LIMITS.phases} phases` }
  const ids = new Set<string>()
  const phases: Phase[] = []
  for (let i = 0; i < input.length; i += 1) {
    const p = input[i]
    if (!p || !p.title) return { error: `phase ${i + 1} needs a title` }
    const key = (p.key ?? LETTERS[i] ?? String(i + 1)).toUpperCase()
    if (!/^[A-Z0-9]{1,4}$/.test(key)) return { error: `phase key "${key}" must be 1–4 letters or digits` }
    if (p.steps.length === 0) return { error: `phase ${key} has no steps` }
    if (p.steps.length > LIMITS.stepsPerPhase) return { error: `phase ${key} has more than ${LIMITS.stepsPerPhase} steps` }
    const steps: Step[] = []
    for (let k = 0; k < p.steps.length; k += 1) {
      const raw = p.steps[k]
      let id: string
      let title: string
      if (typeof raw === 'string') {
        const m = /^([A-Za-z]{0,4}\d+(?:\.\d+)?[a-z]?)\s+(.+)$/.exec(raw.trim())
        id = m?.[1] && STEP_ID.test(m[1]) ? m[1] : /^\d+$/.test(key) ? `${key}.${k + 1}` : `${key}${k + 1}`
        title = m?.[1] ? (m[2] ?? '') : raw
      } else {
        id = raw?.id ?? (/^\d+$/.test(key) ? `${key}.${k + 1}` : `${key}${k + 1}`)
        title = raw?.title ?? ''
      }
      title = oneLine(title)
      if (!title) return { error: `step ${id} needs a title` }
      if (title.length > LIMITS.stepTitle) return { error: `step ${id}'s title is ${title.length} chars; keep it under ${LIMITS.stepTitle} (details belong in the plan)` }
      const problem = stepTitleProblem(title)
      if (problem) return { error: `step ${id}: ${problem}` }
      if (ids.has(id)) return { error: `step id ${id} is used twice` }
      ids.add(id)
      steps.push({ id, title, status: 'todo' })
    }
    phases.push({ key, title: oneLine(p.title), steps })
  }
  return { phases }
}

export function applyOp(current: Worklog | null, input: ToolInput, ctx: OpContext): OpResult {
  const fail = (error: string): OpResult => ({ ok: false, error })

  if (input.op === 'start') {
    if (current && current.meta.status === 'active' && !input.replace) {
      return fail('a worklog is already active here; finish it (op: finish) or pass replace: true')
    }
    const title = oneLine(input.title ?? '')
    if (!title) return fail('start needs a title')
    if (title.length > LIMITS.title) return fail(`title is ${title.length} chars; keep it under ${LIMITS.title}`)
    const built = buildPhases(input.phases ?? [])
    if ('error' in built) return fail(built.error)
    // The worklog it replaces is kept, paused.
    const replaced = current && current.meta.status === 'active' ? touch(withLog({ ...current, meta: { ...current.meta, status: 'paused' } }, ctx, `paused: replaced by "${title}"`), ctx) : undefined
    const doc: Worklog = {
      meta: { worklog: 1, title, status: 'active', plan: input.plan, branch: input.branch, gate: input.gate, started: ctx.stamp, updated: ctx.stamp },
      goal: input.goal ? clip(oneLine(input.goal), 160) : undefined,
      rules: (input.rules ?? []).slice(0, LIMITS.rules).map(r => clip(oneLine(r), 160)),
      attention: [],
      phases: built.phases,
      notes: [],
      log: [`${ctx.clock} started${input.branch ? ` on ${input.branch}` : ''}`],
    }
    return { ok: true, doc, message: `OK worklog started${replaced ? ` (the old one is paused)` : ''} · ${orientation(doc)}`, isNew: true, replaced }
  }

  if (current === null) return fail('no active worklog; start one with op: start')
  let doc = current

  switch (input.op) {
    case 'show':
      return { ok: true, doc, message: orientation(doc) }

    case 'progress':
      // A subagent's own progress is a fact the pane shows, never a worklog line.
      return fail('op progress is for subagents reporting their own work; the lead uses op step')

    case 'step': {
      const id = input.id ?? ''
      const status = input.status
      const hit = findStep(doc, id)
      if (!hit) return fail(`no step ${id}; steps are ${allSteps(doc).map(s => s.id).join(', ')}`)
      if (!status) return fail('step needs a status: todo, doing, done, blocked or skipped')
      const from = hit.step.status
      if (from !== status && !TRANSITIONS[from].includes(status)) return fail(`${hit.step.id} cannot go from ${from} to ${status}`)
      if (from === 'done' && status === 'doing' && !input.reason) return fail(`reopening ${hit.step.id} needs a reason`)
      if (status === 'doing' && from !== 'doing') {
        const doing = allSteps(doc).filter(s => s.status === 'doing').length
        if (doing >= LIMITS.doing) return fail(`${doing} steps are already doing; finish one first (at most ${LIMITS.doing})`)
      }
      if (status === 'skipped' && !input.note && !input.reason) return fail('skipping needs a note saying why')
      if (input.owner !== undefined && !/^[\w.-]+$/.test(input.owner)) return fail(`owner "${input.owner}" can hold only letters, digits, _ . and -`)
      if (input.commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(input.commit)) return fail(`commit "${input.commit}" is not a sha (7–40 hex digits)`)

      let ruling: string | null = null
      let claimed = false
      if (status === 'done' && doc.meta.gate) {
        // A step done straight from todo counts from the last step marked done (or the worklog's start).
        const since = ctx.startedAt[hit.step.id] ?? Math.max(ctx.lastDoneAt ?? 0, startedMs(doc) ?? 0)
        const evidence = gateEvidence(ctx.gates, since, ctx.now, input.gateOk === true)
        claimed = evidence === 'claimed'
        if (evidence !== 'green' && evidence !== 'claimed') {
          if (!input.force || !input.reason) {
            return fail(`${hit.step.id} is not done until \`${doc.meta.gate}\` passes after the step started (${GATE_WHY[evidence]}). Run the gate, or pass force: true with a reason.`)
          }
          ruling = `Ruling: ${hit.step.id} done without a green gate — ${input.reason}`
        }
      }

      doc = mapStep(doc, hit.step.id, s => ({
        ...s,
        status,
        sha: input.commit ? input.commit.toLowerCase().slice(0, 12) : s.sha,
        owner: status === 'done' || status === 'skipped' ? undefined : (input.owner ?? s.owner),
        note: input.note ? clip(oneLine(input.note), LIMITS.note) : s.note,
      }))
      if (status === 'blocked' && !doc.attention.some(a => a.kind === 'blocker' && a.id === hit.step.id)) {
        doc = { ...doc, attention: [...doc.attention, { kind: 'blocker', id: hit.step.id, text: clip(oneLine(input.note ?? input.reason ?? 'blocked'), LIMITS.note) }] }
      }
      if (status !== 'blocked') {
        doc = { ...doc, attention: doc.attention.filter(a => !(a.kind === 'blocker' && a.id === hit.step.id)) }
      }
      const sha = input.commit ? ` · ${input.commit.toLowerCase().slice(0, 7)}` : ''
      const claim = claimed ? ' (gate green on the model\'s word: background run)' : ''
      doc = withLog(doc, ctx, ruling ?? `${hit.step.id} ${status}${sha}${claim}${input.note ? `: ${input.note}` : ''}`)
      doc = touch(doc, ctx)
      return { ok: true, doc, message: `OK ${hit.step.id} → ${status}${ruling ? ' (forced; logged as a Ruling)' : claimed ? ' (background gate taken on your word; logged)' : ''} · ${orientation(doc)}`, started: status === 'doing' ? [hit.step.id] : undefined }
    }

    case 'add': {
      const title = oneLine(input.title ?? '')
      if (!title) return fail('add needs a title')
      const phaseKey = (input.phase ?? '').toUpperCase()
      if (input.kind === undefined && phaseKey && !doc.phases.some(p => p.key === phaseKey)) {
        // a new phase
        if (doc.phases.length >= LIMITS.phases) return fail(`at most ${LIMITS.phases} phases`)
        if (!/^[A-Z0-9]{1,4}$/.test(phaseKey)) return fail('phase key must be 1–4 letters or digits')
        doc = { ...doc, phases: [...doc.phases, { key: phaseKey, title, steps: [] }] }
        doc = touch(withLog(doc, ctx, `added phase ${phaseKey} · ${title}`), ctx)
        return { ok: true, doc, message: `OK phase ${phaseKey} added (add steps with op: add, phase: ${phaseKey}) · ${orientation(doc)}` }
      }
      const phase = doc.phases.find(p => p.key === phaseKey) ?? doc.phases[doc.phases.length - 1]
      if (!phase) return fail('no phase to add to')
      if (phase.steps.length >= LIMITS.stepsPerPhase) return fail(`phase ${phase.key} is full`)
      if (title.length > LIMITS.stepTitle) return fail(`keep the title under ${LIMITS.stepTitle} chars`)
      const problem = stepTitleProblem(title)
      if (problem) return fail(problem)
      const used = new Set(allSteps(doc).map(s => s.id))
      let id = input.id ?? ''
      if (!id) {
        let n = phase.steps.length + 1
        do {
          id = /^\d+$/.test(phase.key) ? `${phase.key}.${n}` : `${phase.key}${n}`
          n += 1
        } while (used.has(id))
      }
      if (!STEP_ID.test(id)) return fail(`step id "${id}" should look like A3, 2.1 or DOC2`)
      if (used.has(id)) return fail(`step ${id} already exists`)
      doc = { ...doc, phases: doc.phases.map(p => (p.key === phase.key ? { ...p, steps: [...p.steps, { id, title, status: 'todo' as const }] } : p)) }
      doc = touch(withLog(doc, ctx, `added ${id} ${title}`), ctx)
      return { ok: true, doc, message: `OK ${id} added to phase ${phase.key} · ${orientation(doc)}` }
    }

    case 'attention': {
      // "D1 Should we…": the id is the mod's to give, not part of the question.
      const text = clip(oneLine(input.text ?? '').replace(/^D\d+\b[:.)\s-]*/i, ''), LIMITS.note)
      if (!text) return fail('attention needs text')
      const why = input.why ? clip(oneLine(input.why), LIMITS.why) : undefined
      if (input.kind === 'blocker') {
        const hit = findStep(doc, input.id ?? '')
        if (!hit) return fail('a blocker names its step id')
        const blocked = applyOp(doc, { op: 'step', id: hit.step.id, status: 'blocked', note: text }, ctx)
        if (!blocked.ok || !why) return blocked
        return { ...blocked, doc: { ...blocked.doc, attention: blocked.doc.attention.map(a => (a.kind === 'blocker' && a.id === hit.step.id ? { ...a, why } : a)) } }
      }
      const blocks = input.blocks ? findStep(doc, input.blocks)?.step.id : undefined
      if (input.blocks && !blocks) return fail(`blocks names a step id; no step ${input.blocks}`)
      const options = input.options?.map(o => clip(oneLine(o), 40)).slice(0, 4)
      const recommend = input.recommend ? options?.find(o => o.toLowerCase() === oneLine(input.recommend ?? '').toLowerCase()) : undefined
      if (input.recommend && !recommend) return fail(`recommend is one of the options (${options?.join(' / ') || 'none given'})`)
      // Ids are never reused: past the highest one waiting or asked in the log.
      const asked = doc.log.map(l => Number(/\basked D(\d+)\b/.exec(l)?.[1] ?? 0))
      const n = 1 + Math.max(0, ...asked, ...doc.attention.filter(a => a.kind === 'decision').map(a => Number(a.id.slice(1)) || 0))
      const item: Attention = { kind: 'decision', id: `D${n}`, text: /\?$/.test(text) ? text : `${text}?`, options, ...(why ? { why } : {}), ...(blocks ? { blocks } : {}), ...(recommend ? { recommend } : {}) }
      doc = touch(withLog({ ...doc, attention: [...doc.attention, item] }, ctx, `asked D${n}: ${text}`), ctx)
      return { ok: true, doc, message: `OK D${n} is waiting on the user. Keep working on anything it does not block. · ${orientation(doc)}` }
    }

    case 'resolve': {
      const ref = (input.ref ?? '').trim()
      const item = doc.attention.find(a => a.id.toLowerCase() === ref.toLowerCase())
      if (!item) return fail(`nothing waiting under ${ref}; waiting: ${doc.attention.map(a => a.id).join(', ') || 'none'}`)
      doc = { ...doc, attention: doc.attention.filter(a => a !== item) }
      if (item.kind === 'blocker') {
        doc = mapStep(doc, item.id, s => (s.status === 'blocked' ? { ...s, status: 'todo' } : s))
      }
      doc = touch(withLog(doc, ctx, `${item.id} resolved${input.answer ? `: ${input.answer}` : ''}`), ctx)
      return { ok: true, doc, message: `OK ${item.id} resolved · ${orientation(doc)}` }
    }

    case 'log': {
      const text = oneLine(input.text ?? '')
      if (!text) return fail('log needs text')
      doc = touch(withLog(doc, ctx, text), ctx)
      return { ok: true, doc, message: 'OK logged' }
    }

    case 'finish': {
      const open = [
        ...allSteps(doc).filter(s => s.status === 'todo' || s.status === 'doing' || s.status === 'blocked').map(s => s.id),
        ...doc.attention.filter(a => a.kind === 'decision').map(a => a.id),
      ]
      if (open.length > 0 && (!input.force || !input.reason)) return fail(`${open.join(', ')} still open; settle them (skip with a note, resolve decisions) or pass force: true with a reason`)
      if (open.length > 0) doc = withLog(doc, ctx, `Ruling: finished with ${open.join(', ')} open — ${input.reason ?? ''}`)
      doc = touch(withLog({ ...doc, meta: { ...doc.meta, status: 'done' } }, ctx, `finished${input.summary ? `: ${input.summary}` : ''}`), ctx)
      return { ok: true, doc, message: `OK worklog finished · ${orientation(doc)}` }
    }
  }

  return fail(`unknown op "${String(input.op)}"`)
}

/** The tool's input schema, as the model reads it. */
export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['start', 'step', 'add', 'attention', 'resolve', 'log', 'finish', 'show', 'progress'] },
    title: { type: 'string', description: 'start: the task title (≤80). add: the new step or phase title.' },
    plan: { type: 'string', description: 'start: the plan file path.' },
    branch: { type: 'string', description: 'start: the working/integration branch.' },
    gate: { type: 'string', description: 'start: the quality-gate command, e.g. "npm run dod". A step can be done only after it passes.' },
    goal: { type: 'string', description: 'start: one line, what done means.' },
    rules: { type: 'array', items: { type: 'string' }, description: 'start: up to 8 standing rules for the task.' },
    phases: {
      type: 'array',
      description: 'start: phases in order; steps are short titles, optionally prefixed with an id ("A3 Pro gating").',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'steps'],
      },
    },
    replace: { type: 'boolean', description: 'start: replace an active worklog.' },
    id: { type: 'string', description: 'step/attention(blocker)/add: the step id, e.g. A3.' },
    status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked', 'skipped'] },
    note: { type: 'string', description: 'step: one short line (≤120). progress: the step you are on (≤80).' },
    done: { type: 'integer', minimum: 0, description: 'progress: steps of your own task finished.' },
    total: { type: 'integer', minimum: 1, description: 'progress: steps in your plan (3-8).' },
    commit: { type: 'string', description: 'step done: the commit sha.' },
    owner: { type: 'string', description: 'step doing: the agent working on it.' },
    force: { type: 'boolean', description: 'step done without a green gate, or finish with open steps or decisions: needs reason.' },
    gateOk: { type: 'boolean', description: 'step done: the gate you ran in the background (after the step started) passed. Logged as your claim.' },
    reason: { type: 'string' },
    phase: { type: 'string', description: 'add: the phase key to add a step to, or a new phase key.' },
    kind: { type: 'string', enum: ['decision', 'blocker'], description: 'attention: a decision for the user, or a blocker on a step.' },
    text: { type: 'string', description: 'attention/log: the text.' },
    options: { type: 'array', items: { type: 'string' }, description: 'attention decision: 2–4 short options.' },
    why: { type: 'string', description: 'attention: the context the user needs to answer from their phone: what you found, what each option changes (≤400).' },
    blocks: { type: 'string', description: 'attention decision: the step id the answer holds up.' },
    recommend: { type: 'string', description: 'attention decision: your pick, one of the options.' },
    ref: { type: 'string', description: 'resolve: D1 or a blocked step id.' },
    answer: { type: 'string', description: 'resolve: the user\'s answer.' },
    summary: { type: 'string', description: 'finish: one line.' },
  },
  required: ['op'],
} as const

export const TOOL_DESCRIPTION = [
  'Read and update the task worklog (the plans/*-worklog.md file the user follows).',
  'Use it at every step transition of a long task: op "step" with status "doing" when you start a step, "done" with the commit sha when its gate is green, "blocked"/"skipped" with a note.',
  'Ask the user with op "attention" (kind "decision", with why, blocks and recommend so they can answer from the pane) and keep working on what it does not block; their answer reaches you on a later tool result, already resolved in the worklog. Record autonomous choices as op "log" lines starting "Ruling:".',
  'Every call returns progress and the next steps, so after a /compact call op "show" to re-orient.',
  'Only the lead agent writes the worklog. A subagent reports its own work with op "progress" (total = its plan in 3-8 steps, done = finished, note = the step it is on): right after reading its brief, then as each step ends; the user sees it in the Agents tab.',
].join(' ')
