/**
 * progress-pane: mission control for long tasks.
 *
 * Declared layer: the WL1 worklog (plans/*-worklog.md), written through the
 * `worklog` tool (validated, lead agent only) or by hand (re-parsed; errors go
 * back to Claude on the same tool result).
 * Observed layer: gate runs, commits, agents, dev servers, context and cost,
 * seen from tool calls, spawns and turns.
 * Reconciled: drift rules show where the two disagree, in the UI and, at most
 * every 10 minutes per rule, to Claude.
 *
 * UI: one band line above the prompt while a worklog is active (its count opens
 * the plan, its step that step's details, its ? / ! counts what waits on you);
 * /progress opens the pane (Overview /
 * Plan / Log / a step); /progress text prints it for surfaces that
 * draw nothing.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addAgent, newAgent, normalizeAgent, withEnd, withProgress, withResume, withTool, withUsage } from './crew'
import type { AgentRow } from './observe'
import { COMPANION_COLS, COMPANION_ROWS, companionPixels, rasterCells, WORKING_FRAMES } from './companions'
import { effortOf, familyOf, poseOf, rosterOf } from './crew'
import { applyOp, TOOL_DESCRIPTION, TOOL_SCHEMA } from './ops'
import type { ToolInput } from './ops'
import { commitFromOutput, driftOf, dueNotices, EMPTY_FACTS, gateRunOf, isCommitCommand, isDocsOnly, outputShowsFailure, serverOf, stepOfDescription, toolLabel } from './observe'
import type { Facts } from './observe'
import { companionKey } from './agents'
import { currentStepOf, drawBand, drawPane, isExpanded, textOf } from './view'
import type { Answer, PaneView, ViewData } from './view'
import { tonesOf } from './view-types'
import type { Tones } from './view-types'
import { parseWorklog, serializeWorklog, startedMs } from './worklog'
import type { ParseError, Worklog } from './worklog'

const PANE = 'progress'
const TOOL = 'mcp__progress-pane__worklog'
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit']

type LogState = { path: string | null; doc: Worklog | null; errors: ParseError[]; mtimeMs: number; startedAt: Record<string, number>; doneAt: Record<string, number> }

const EMPTY_LOG: LogState = { path: null, doc: null, errors: [], mtimeMs: 0, startedAt: {}, doneAt: {} }
const worklog = atom({ plugin: 'progress-pane', key: 'worklog' } as const, EMPTY_LOG)
const facts = atom({ plugin: 'progress-pane', key: 'facts' } as const, EMPTY_FACTS)
/** Answers given in the pane, and whether a model turn is running to take them mid-step. */
const inbox = atom({ plugin: 'progress-pane', key: 'inbox' } as const, { answered: [] as Answer[], isTurnRunning: false })
const view = atom({ plugin: 'progress-pane', key: 'view' } as const, { tab: 'overview', expanded: {}, isBandHidden: false } as PaneView & { isBandHidden: boolean })

/** Notebook's colors for this session, from the theme setting (session.start reads it again on reload). */
let tones: Tones = tonesOf(undefined, undefined)
/** How often a working companion moves: two frames a second, calm. */
const BLIT_MS = 500
/** Whether the terminal drew the Agents tab or an agent page last; the timer is quiet otherwise. */
let isCrewShown = false

const pad2 = (n: number) => String(n).padStart(2, '0')
const clockOf = (ms: number) => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`
const stampOf = (ms: number) => `${new Date(ms).toISOString().slice(0, 16)}Z`
const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'

/** One worklog write at a time: two tool calls in flight cannot lose each other's change. */
let writing: Promise<unknown> = Promise.resolve()
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task, task)
  writing = run.catch(() => undefined)
  return run
}

async function rootOf($: EngineInterface): Promise<string> {
  try {
    return (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
    return $.session.cwd()
  }
}

/** Reads and parses a worklog file into the session's state. */
async function load($: EngineInterface, path: string): Promise<LogState | null> {
  try {
    const text = await $.fs.read(path)
    const stat = await $.fs.stat(path)
    const parsed = parseWorklog(typeof text === 'string' ? text : '')
    const prev = await read($, worklog)
    const isSame = prev.path === path
    const next: LogState = {
      path,
      doc: parsed.doc,
      errors: parsed.errors,
      mtimeMs: stat.mtimeMs,
      startedAt: isSame ? prev.startedAt : {},
      doneAt: isSame ? (prev.doneAt ?? {}) : {},
    }
    // Steps that went to doing (or done) in a hand edit start (or end) their clock now.
    const now = await $.clock.now()
    const wasDone = new Set(isSame ? (prev.doc?.phases.flatMap(p => p.steps) ?? []).filter(s => s.status === 'done').map(s => s.id) : [])
    for (const s of parsed.doc?.phases.flatMap(p => p.steps) ?? []) {
      if (s.status === 'doing' && next.startedAt[s.id] === undefined) next.startedAt = { ...next.startedAt, [s.id]: now }
      if (isSame && prev.doc && s.status === 'done' && !wasDone.has(s.id)) next.doneAt = { ...next.doneAt, [s.id]: now }
    }
    await update($, worklog, () => next)
    return next
  } catch {
    return null
  }
}

/** Finds the active worklog: the newest plans/*-worklog.md with `status: active`. */
async function discover($: EngineInterface): Promise<void> {
  const root = await rootOf($)
  const dirs = [`${root}/plans`, `${root}/docs/worklogs`]
  const found: { path: string; mtimeMs: number }[] = []
  for (const dir of dirs) {
    try {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind === 'file' && entry.name.endsWith('-worklog.md')) found.push({ path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })
      }
    } catch {
      // no such folder
    }
  }
  for (const f of found.sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    try {
      const text = await $.fs.read(f.path)
      if (typeof text === 'string' && /^status:\s*active\s*$/m.test(text.split('\n---')[0] ?? '')) {
        await load($, f.path)
        return
      }
    } catch {
      // unreadable: skip
    }
  }
}

/** Re-reads the worklog when its file changed (hand edits, scripts, other tools). */
async function poll($: EngineInterface): Promise<void> {
  const state = await read($, worklog)
  if (state.path === null) {
    // A worklog written by hand (no worklog tool) appears without a restart.
    await discover($)
    return
  }
  try {
    const stat = await $.fs.stat(state.path)
    if (stat.mtimeMs !== state.mtimeMs) {
      await load($, state.path)
      await update($, facts, f => ({ ...f, worklogChangedAt: stat.mtimeMs, callsSinceChange: 0 }))
    }
  } catch {
    // the file went away; keep the last good state
  }
}

async function viewData($: EngineInterface): Promise<ViewData | null> {
  const state = await read($, worklog)
  if (state.doc === null || state.path === null) return null
  const read0 = await read($, facts)
  const f = { ...read0, agents: read0.agents.map(normalizeAgent) }
  const now = await $.clock.now()
  return { doc: state.doc, path: state.path, facts: f, drift: driftOf(state.doc, f, state.startedAt, now, state.doneAt ?? {}), now, startedMs: startedMs(state.doc), startedAt: state.startedAt, doneAt: state.doneAt ?? {}, answered: (await read($, inbox)).answered, tones }
}

const answerText = (a: Answer) =>
  `The user answered ${a.id} ("${a.question}") in the progress pane: "${a.answer}". It is already resolved in the worklog. Act on it now where it changes your current work; don't ask it again.`

/**
 * The person answered a decision or blocker in the pane: resolve it in the
 * worklog, then get it to Claude. Mid-turn it rides on the next tool result
 * (Claude reads it between two steps); with no turn running it is sent as a
 * message, which starts one.
 */
async function answerItem($: EngineInterface, id: string, text: string): Promise<void> {
  const question = await serialized(async () => {
    await poll($)
    const state = await read($, worklog)
    const item = state.doc?.attention.find(a => a.id === id)
    if (!state.doc || !state.path || !item) return null
    const now = await $.clock.now()
    const result = applyOp(state.doc, { op: 'resolve', ref: id, answer: `${text} (answered in the progress pane)` }, { now, clock: clockOf(now), stamp: stampOf(now), gates: [], startedAt: state.startedAt })
    if (!result.ok) return null
    await $.fs.write(state.path, serializeWorklog(result.doc))
    await load($, state.path)
    return item.text
  })
  if (question === null) {
    $.ui.toast(`${id} is no longer waiting.`)
    return
  }
  const entry: Answer = { id, question, answer: text, at: await $.clock.now(), isDelivered: false }
  const box = await update($, inbox, b => ({ ...b, answered: [entry, ...b.answered].slice(0, 10) }))
  if (!box.isTurnRunning) {
    await deliverAsMessage($)
  } else {
    $.ui.toast(`${id} answered. Claude reads it after its current tool call.`)
  }
}

/** An answer given in the pane rides on the lead's next tool result: Claude reads it mid-turn. */
async function withAnswers<R extends { context?: readonly string[]; deny?: string; isError?: true }>($: EngineInterface, agentId: string | undefined, result: R): Promise<R> {
  if (agentId !== undefined || result.deny !== undefined || result.isError) return result
  const waiting = (await read($, inbox)).answered.filter(a => !a.isDelivered)
  if (waiting.length === 0) return result
  await update($, inbox, b => ({ ...b, answered: b.answered.map(a => ({ ...a, isDelivered: true })) }))
  return { ...result, context: [...(result.context ?? []), ...waiting.map(answerText)] }
}

/** Sends the answers not yet delivered as one message (no turn is running to carry them). */
async function deliverAsMessage($: EngineInterface): Promise<void> {
  const waiting = (await read($, inbox)).answered.filter(a => !a.isDelivered)
  if (waiting.length === 0) return
  await update($, inbox, b => ({ ...b, answered: b.answered.map(a => ({ ...a, isDelivered: true })) }))
  try {
    await $.prompt.submit({ text: waiting.map(answerText).join('\n') })
  } catch {
    $.ui.toast('Could not send the answer to Claude; it is in the worklog.')
  }
}

/** Opens the pane on a view: from the band, a command or a step link. */
async function openPane($: EngineInterface, next: Partial<PaneView>): Promise<boolean> {
  await update($, view, v => ({ ...v, ...next }))
  try {
    const opened = await $.ui.open({ id: PANE, title: 'Progress', rows: 24, columns: 72, focus: true, closeOnEscape: true })
    await scrollTop($)
    return opened.isPlaced
  } catch {
    return false
  }
}

/** A new view starts at its top, not where the last one was scrolled. */
async function scrollTop($: EngineInterface): Promise<void> {
  try {
    await $.ui.scroll({ in: PANE, to: 'start' })
  } catch {
    // not drawn yet
  }
}

/** The checkout's branch, for SIGNALS (the worklog's `branch` is the one planned). */
async function refreshBranch($: EngineInterface): Promise<void> {
  try {
    const run = await $.process.run(['git', 'branch', '--show-current'], { cwd: await rootOf($), timeoutMs: 3000 })
    if (run.exitCode !== 0) return
    // Empty on a detached HEAD: no branch to show, not the last one.
    const branch = run.stdout.trim() || undefined
    if (branch !== (await read($, facts)).branch) await update($, facts, ({ branch: _old, ...f }) => (void _old, branch ? { ...f, branch } : f))
  } catch {
    // not a git checkout, or git is missing: no branch row
  }
}

/** The person's theme picks Notebook's ink and highlighter; `pen` is the glyph setting. */
async function refreshTones($: EngineInterface, pen: unknown): Promise<void> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'theme')
    tones = tonesOf(row?.value, pen)
  } catch {
    tones = tonesOf(undefined, pen)
  }
}

async function refreshSession($: EngineInterface): Promise<void> {
  void refreshBranch($)
  try {
    const usage = await $.session.usage()
    const percent = Math.round(usage.context.percent ?? ((usage.context.tokens ?? 0) / Math.max(1, usage.context.window)) * 100)
    await update($, facts, f => ({ ...f, context: { percent, cost: usage.cost?.usd } }))
  } catch {
    // no figures this time
  }
  const f = await read($, facts)
  if (f.servers.length === 0) return
  const alive: Facts['servers'] = []
  for (const s of f.servers) {
    try {
      const run = await $.process.run(['pgrep', '-f', s.pattern], { timeoutMs: 3000 })
      if (run.exitCode === 0) alive.push(s)
    } catch {
      alive.push(s)
    }
  }
  if (alive.length !== f.servers.length) await update($, facts, x => ({ ...x, servers: alive }))
}

/**
 * Moves each running agent's companion one frame on, in place, while the
 * terminal shows the Agents tab or that agent's page. No redraw: a blit.
 */
async function animateCrew($: EngineInterface): Promise<void> {
  if (!isCrewShown) return
  const ui = await read($, view)
  if (ui.tab !== 'agents' && ui.tab !== 'agent') {
    isCrewShown = false
    return
  }
  const now = await $.clock.now()
  // A working companion moves on; a resting one settles on its still frame.
  const running = (await read($, facts)).agents.map(normalizeAgent).filter(a => a.status === 'running' && (ui.tab === 'agents' || a.id === ui.agent))
  const frame = Math.floor(now / BLIT_MS) % WORKING_FRAMES
  let isMounted = running.length === 0
  for (const a of running) {
    const pose = poseOf(a, now)
    const cells = rasterCells(companionPixels(familyOf(a.model), effortOf(a.effort), pose, pose === 'working' ? frame : 0))
    try {
      const r = await $.ui.blit({ requestId: PANE, key: companionKey(a.id), cells, columns: COMPANION_COLS, rows: COMPANION_ROWS })
      if (r.deny === undefined) isMounted = true
    } catch {
      // the pane closed between two ticks
    }
  }
  // Nothing of ours is mounted any more (the pane closed): wait for the next draw.
  if (!isMounted) isCrewShown = false
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'worklog', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA as unknown as Record<string, unknown> })
    await $.command.register({ name: 'progress', description: 'Show the task worklog: pane, text, or band on/off (progress-pane)', argumentHint: '[plan | agents | <step id> | text | band on|off | use <path>]' })
    await discover($)
    await refreshTones($, options.pen)
    void refreshSession($)
    $.clock.every(5000, () => void poll($))
    $.clock.every(BLIT_MS, () => void animateCrew($))
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if ((await read($, worklog)).path === null) await discover($)
    return result
  })

  // The worklog tool: lead agent only, validated, written whole, one call at a time.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as ToolInput & { agentId?: string }
    if (input.op === 'progress') {
      const agentId = input.agentId
      if (agentId === undefined) return { deny: 'op progress is for subagents reporting their own work; the lead uses op step.' }
      const now = await $.clock.now()
      const f = await update($, facts, x => ({ ...x, agents: x.agents.map(a => (a.id === agentId ? withProgress(normalizeAgent(a), input, now) : a)) }))
      const p = f.agents.find(a => a.id === agentId)?.progress
      return { result: `OK progress ${p ? `${p.done}${p.total ? `/${p.total}` : ''}` : 'noted'}` as never }
    }
    if (input.agentId !== undefined && input.op !== 'show') {
      return { deny: 'Only the lead agent writes the worklog. Report your own progress with op "progress" (done, total, note), and your result (commit sha, gate result, notes) back to the lead.' }
    }
    return serialized(async () => {
      // Apply the change to what is on disk now, not to a copy a hand edit has overtaken.
      await poll($)
      const state = await read($, worklog)
      const now = await $.clock.now()
      const f = await read($, facts)
      const done = Object.values(state.doneAt ?? {})
      const result = applyOp(state.doc, input, {
        now,
        clock: clockOf(now),
        stamp: stampOf(now),
        gates: f.gates,
        startedAt: state.startedAt,
        lastDoneAt: done.length ? Math.max(...done) : undefined,
      })
      if (!result.ok) {
        return { deny: `worklog not changed: ${result.error}` }
      }
      if (input.op === 'show') {
        return { result: result.message as never }
      }
      const root = await rootOf($)
      let path = result.isNew || state.path === null
        ? `${root}/plans/${stampOf(now).slice(0, 10)}-${slugOf(result.doc.meta.title)}-worklog.md`
        : state.path
      if (result.replaced && state.path !== null) {
        if (path === state.path) path = path.replace(/-worklog\.md$/, `-${clockOf(now).replace(':', '')}-worklog.md`)
        await $.fs.write(state.path, serializeWorklog(result.replaced))
      }
      await $.fs.write(path, serializeWorklog(result.doc))
      const stat = await $.fs.stat(path)
      const startedAt = { ...(result.isNew ? {} : state.startedAt) }
      for (const id of result.started ?? []) startedAt[id] = now
      const doneAt = { ...(result.isNew ? {} : state.doneAt ?? {}) }
      if (input.op === 'step' && input.status === 'done' && input.id) {
        const id = result.doc.phases.flatMap(p => p.steps).find(s => s.id.toLowerCase() === (input.id ?? '').toLowerCase())?.id
        if (id) doneAt[id] = now
      }
      await update($, worklog, () => ({ path, doc: result.doc, errors: [], mtimeMs: stat.mtimeMs, startedAt, doneAt }))
      await update($, facts, x => ({ ...x, worklogChangedAt: now, callsSinceChange: 0 }))
      if (result.isNew) $.ui.toast('Worklog started. /progress opens the pane.')
      const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
      return { result: `${result.message}${result.isNew ? ` · file: ${rel}` : ''}` as never }
    })
  })

  // Observation: every tool call, main loop and subagents.
  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const command = e.tool === 'Bash' ? String((e as { command?: string }).command ?? '') : ''
    const state = await read($, worklog)
    const startedAt = await $.clock.now()
    const gateRun = command !== '' ? gateRunOf(command, state.doc?.meta.gate) : null
    const isBackground = e.tool === 'Bash' && (e as { run_in_background?: boolean }).run_in_background === true

    if (gateRun !== null) {
      await update($, facts, f => ({ ...f, gates: [...f.gates, { at: startedAt, ok: null, command, ...(isBackground ? { background: true } : {}) }].slice(-20) }))
    }

    const ran = await next(e)
    const now = await $.clock.now()
    const failed = ran.deny !== undefined || ran.isError === true

    if (gateRun !== null && !isBackground) {
      // Moved to the background on a timeout or by the user: no result to see either.
      const isBackgrounded = typeof (ran.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId === 'string'
      // Piped, the exit status is the last program's: the output says whether the gate failed.
      const ok = !failed && !(gateRun.isPiped && outputShowsFailure(ran.text ?? ''))
      await update($, facts, f => ({
        ...f,
        gates: f.gates.map(g => (g.at === startedAt && g.command === command ? (isBackgrounded ? { ...g, background: true } : { ...g, ok, durationMs: now - startedAt }) : g)),
      }))
    }

    if (command !== '' && !failed && isCommitCommand(command)) {
      let commit = commitFromOutput(ran.text ?? '')
      if (commit === null) {
        try {
          const log = await $.process.run(['git', 'log', '-1', '--format=%h%x09%s'], { timeoutMs: 5000 })
          const [sha, subject] = log.stdout.trim().split('\t')
          if (log.exitCode === 0 && sha) commit = { sha: sha.slice(0, 7), subject: subject ?? '' }
        } catch {
          commit = null
        }
      }
      if (commit !== null) {
        const doing = state.doc?.phases.flatMap(p => p.steps).find(s => s.status === 'doing')
        const c = commit
        let docsOnly = false
        try {
          const shown = await $.process.run(['git', 'show', '--name-only', '--format=', c.sha], { timeoutMs: 5000 })
          docsOnly = shown.exitCode === 0 && isDocsOnly(shown.stdout.split('\n').map(l => l.trim()).filter(Boolean))
        } catch {
          docsOnly = false
        }
        await update($, facts, f => (f.commits.some(x => x.sha === c.sha) ? f : { ...f, commits: [...f.commits, { at: now, sha: c.sha, subject: c.subject, stepAt: doing?.id ?? null, ...(docsOnly ? { docsOnly } : {}) }].slice(-30) }))
      }
    }

    if (command !== '' && !failed) {
      const server = serverOf(command, isBackground)
      if (server !== null) {
        await update($, facts, f => (f.servers.some(s => s.pattern === server.pattern) ? f : { ...f, servers: [...f.servers, { ...server, startedAt: now }] }))
      }
      if (/\b(kill|pkill|killall)\b/.test(command)) {
        void refreshSession($)
      }
      if (/\bgit\b[^;&|]*\b(checkout|switch|worktree)\b/.test(command)) void refreshBranch($)
    }

    if (!isMain) {
      const label = toolLabel(e.tool, e as unknown as Record<string, unknown>)
      // Its own progress reports are notes in its log already, not tool lines.
      if (e.tool !== TOOL) await update($, facts, f => ({ ...f, agents: f.agents.map(a => (a.id === e.agentId ? withTool(withResume(normalizeAgent(a)), label, now, failed) : a)) }))
      return withAnswers($, e.agentId, ran)
    }

    if (e.tool === TOOL) return ran

    await update($, facts, f => ({ ...f, callsSinceChange: f.callsSinceChange + 1 }))

    // A hand edit of the worklog is checked at once.
    const filePath = String((e as { file_path?: string }).file_path ?? '')
    if (EDIT_TOOLS.includes(e.tool) && state.path !== null && filePath === state.path && !failed) {
      const loaded = await load($, state.path)
      await update($, facts, f => ({ ...f, worklogChangedAt: now, callsSinceChange: 0 }))
      if (loaded !== null && loaded.errors.length > 0 && ran.deny === undefined) {
        const list = loaded.errors.slice(0, 5).map(x => `line ${x.line}: ${x.message}`).join('; ')
        return withAnswers($, e.agentId, { ...ran, context: [...(ran.context ?? []), `progress-pane: the worklog no longer follows WL1 (${list}). Fix those lines, or make the change through the worklog tool.`] })
      }
      return withAnswers($, e.agentId, ran)
    }

    // Drift the model should hear about, at most every 10 minutes per rule.
    if (state.doc !== null && ran.deny === undefined) {
      const f = await read($, facts)
      const due = dueNotices(driftOf(state.doc, f, state.startedAt, now, state.doneAt ?? {}), f.told, now)
      if (due.length > 0) {
        await update($, facts, x => ({ ...x, told: { ...x.told, ...Object.fromEntries(due.map(d => [d.rule, now])) } }))
        return withAnswers($, e.agentId, { ...ran, context: [...(ran.context ?? []), `progress-pane: the worklog and what happened disagree: ${due.map(d => d.text).join('; ')}. Update the worklog (worklog tool) so it matches.`] })
      }
    }
    return withAnswers($, e.agentId, ran)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && typeof result.agentId === 'string') {
      const state = await read($, worklog)
      const now = await $.clock.now()
      const spawn = { id: result.agentId, description: e.description, step: stepOfDescription(e.description, state.doc), subagentType: e.subagentType, model: result.model ?? e.model ?? e.parentModel, at: now }
      await update($, facts, f => ({ ...f, agents: addAgent(f.agents, newAgent(f.agents, spawn)) }))
    }
    return result
  })

  // Each model request of a subagent: its model and effort as sent, its tokens and estimated cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (agentId === undefined || usage === null) return result
    await update($, facts, f => ({ ...f, agents: f.agents.map(a => (a.id === agentId ? withUsage(withResume(normalizeAgent(a)), usage.model || e.model, e.effort, usage) : a)) }))
    return result
  })

  on('turn.start', async ($, e, next) => {
    await update($, inbox, b => ({ ...b, isTurnRunning: true }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      await update($, inbox, b => ({ ...b, isTurnRunning: false }))
      // Answered after Claude's last tool call: send it, so it is not lost.
      await deliverAsMessage($)
    }
    if (e.agentId !== undefined) {
      const status = e.reason === 'answer' ? ('done' as const) : ('failed' as const)
      const endReason = e.reason === 'aborted' ? ('aborted' as const) : ('error' as const)
      // A run whose requests went unseen still gets the turn's own sum.
      const usage = e.usage
      const end = (a: AgentRow) => withEnd(a.requests === 0 && usage ? withUsage(a, usage.model, a.effort, usage) : a, status, now, endReason)
      await update($, facts, f => ({ ...f, agents: f.agents.map(a => (a.id !== e.agentId ? a : end(normalizeAgent(a)))) }))
    } else {
      await poll($)
      await refreshSession($)
    }
    return result
  })

  // The contract, in the system prompt while a worklog is active (static text, cache-friendly).
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const state = await read($, worklog)
    if (state.doc === null || state.doc.meta.status !== 'active' || state.path === null) return result
    const root = await rootOf($)
    const rel = state.path.startsWith(`${root}/`) ? state.path.slice(root.length + 1) : state.path
    const text = [
      `# Active worklog: ${rel}`,
      `The user follows this task's progress in that worklog (format WL1). Keep it true:`,
      `- Use the \`worklog\` tool (${TOOL}) at every step transition: "doing" when you start a step, "done" with the commit sha after the gate${state.doc.meta.gate ? ` (\`${state.doc.meta.gate}\`)` : ''} passes, "blocked"/"skipped" with a note.`,
      `- Questions for the user go in as op "attention"; keep working on what they do not block. Autonomous choices: op "log" with "Ruling: <what> — <why> — <cost if wrong>".`,
      `- Start every Agent description with its step id (e.g. "A3 soft landing"). Only you (the lead) write the worklog; subagents report back.`,
      `- After a compaction, call the tool with op "show" to re-orient.`,
    ].join('\n')
    return { ...result, sections: [...result.sections, { id: 'progress-pane', text, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = await read($, view)
    const data = await viewData($)
    if (data === null || ui.isBandHidden || data.doc.meta.status === 'paused') return next(e)
    return drawBand($.ui.resolve(e), data, e.props.bodyColumns ?? e.viewport?.columns ?? 100, {
      openPlan: () => void openPane($, { tab: 'plan' }),
      openNeeds: () => void openPane($, { tab: 'needs' }),
      openStep: id => void openPane($, { tab: 'step', step: id, back: 'plan' }),
      openAgents: () => void openPane($, { tab: 'agents' }),
    }, e.surface === 'terminal')
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const data = await viewData($)
    const ui = await read($, view)
    if (data === null) {
      const { Text } = t
      const state = await read($, worklog)
      return <Text dimColor>{state.errors.length ? `The worklog does not parse: ${state.errors[0]?.message ?? ''}` : 'No active worklog. /kickoff starts one, or the worklog tool (op: start).'}</Text>
    }
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    const rows = e.props.scroll?.bodyRows ?? 16
    // The companions' timer runs only while the terminal shows them (a module flag, not state: drawing never writes).
    if (e.surface === 'terminal') isCrewShown = ui.tab === 'agents' || ui.tab === 'agent'
    const steps = data.doc.phases.flatMap(p => p.steps)
    const go = (next: Partial<PaneView>) => void update($, view, v => ({ ...v, ...next })).then(() => scrollTop($))
    return drawPane(
      t,
      data,
      ui,
      {
        tab: tab => go({ tab }),
        file: () => void $.prompt.fill({ text: `@${data.path} `, mode: 'insert' }),
        close: () => void $.ui.close({ id: PANE }),
        openStep: (id, back) => go({ tab: 'step', step: id, back }),
        openAgent: (id, back) => go({ tab: 'agent', agent: id, back }),
        back: () => go({ tab: ui.back ?? 'overview' }),
        move: delta => {
          if (ui.tab === 'agent') {
            const roster = rosterOf(data.facts.agents)
            const at = roster.findIndex(a => a.id === ui.agent)
            const next = roster[Math.min(roster.length - 1, Math.max(0, at + delta))]
            if (next) go({ agent: next.id })
            return
          }
          const i = steps.findIndex(s => s.id === ui.step)
          const target = steps[Math.min(steps.length - 1, Math.max(0, i + delta))]
          if (target) go({ step: target.id })
        },
        openNeeds: () => go({ tab: 'needs' }),
        answer: (id, text) => void answerItem($, id, text),
        replyInChat: id => void $.prompt.fill({ text: `${id}: `, mode: 'insert' }),
        togglePhase: key => {
          const phase = data.doc.phases.find(p => p.key === key)
          if (phase) void update($, view, v => ({ ...v, expanded: { ...v.expanded, [key]: !isExpanded(phase, v) } }))
        },
      },
      columns,
      rows,
      e.props.placement === 'inline',
      e.surface === 'terminal',
    )
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const [verb, arg] = (e.args ?? '').trim().split(/\s+/)
    if (verb === 'band') {
      await update($, view, v => ({ ...v, isBandHidden: arg === 'off' }))
      return { text: arg === 'off' ? 'Progress band hidden. `/progress band on` shows it again.' : 'Progress band shown.' }
    }
    if (verb === 'use' && arg) {
      const root = await rootOf($)
      const loaded = await load($, arg.startsWith('/') ? arg : `${root}/${arg}`)
      return { text: loaded === null ? `Could not read ${arg}.` : loaded.errors.length ? `Loaded ${arg}, with problems: ${loaded.errors.map(x => `line ${x.line}: ${x.message}`).join('; ')}` : `Following ${arg}.` }
    }
    await poll($)
    const data = await viewData($)
    if (data === null) {
      const state = await read($, worklog)
      return { text: state.errors.length ? `The worklog does not parse:\n${state.errors.map(x => `- line ${x.line}: ${x.message}`).join('\n')}` : 'No active worklog in this repo (plans/*-worklog.md with status: active). /kickoff starts one.' }
    }
    if (verb === 'text') return { text: textOf(data) }
    if (verb === 'agents') {
      if (await openPane($, { tab: 'agents' })) return { text: '' }
      return { text: textOf(data) }
    }
    // `/progress plan`, `/progress B6`, or the overview.
    const step = verb ? data.doc.phases.flatMap(p => p.steps).find(s => s.id.toLowerCase() === verb.toLowerCase()) : undefined
    const target: Partial<PaneView> = verb === 'plan' ? { tab: 'plan' } : step ? { tab: 'step', step: step.id, back: 'plan' } : { tab: 'overview' }
    if (await openPane($, target)) return { text: '' }
    return { text: textOf(data) }
  })
}
