/**
 * model-guard: choose the model versions this session may use.
 *
 * The rules and the model list live in the plugin store, shared by every
 * local Claude Code process, and are read at start, at every turn and on
 * /models. Spawns, subagent requests, workflows and /model are checked per
 * version; the main conversation's own model is never changed. Every `$` call
 * is in this file (the loader follows `$` only within one file); the logic is
 * in the pure modules next to it, reached through plain functions.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalog } from './catalog'
import { editOf, fixedAnswerOf, parseCommand } from './commands'
import { spawnDecision, stepSwap, switchRefusal, workflowRefusal } from './decide'
import { keyOf, parseModelId } from './ids'
import { addSeen, API_VERSION, changeActive, editModels, messageOf, readLists, refreshModels, switchRepo } from './lists'
import type { FetchPort, StorePort } from './lists'
import { isAllowedModel, migratePolicy } from './policy'
import type { LegacyOptions, Policy } from './policy'
import { cycledFallback, EMPTY_STATE, isCurrent, labelOf, mainModelWarningOf, nameOf, newModelText, spawnToastOf, summaryOf, toggledFamily, toggledVersion, withEvent, withUse } from './state'
import type { GuardState } from './state'
import { drawModels, textOf } from './view'

const PANE = 'models'
const KEEP_ONE = 'Something must stay allowed: allow another model first.'
const LET_THROUGH = "model-guard: a check failed and was let through (see /models); this session's guard may be off"
// The shape tag: a hot reload of an older build's state reads as absent, and is seeded again.
const guard = atom({ plugin: 'model-guard', key: 'guard' } as const, EMPTY_STATE, { shape: 'guard-0.3' })

/** Fail-open by choice (as 0.2): a guard that breaks lets the work through and says so, rather than stopping every agent. */
function letThrough<E, R>($: EngineInterface, e: E, next: (e: E) => R): R {
  $.ui.status(LET_THROUGH)
  return next(e)
}

/** The store as plain functions, for lists.ts. */
function storeOf($: EngineInterface): StorePort {
  return { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), delete: key => $.store.delete(key), keys: () => $.store.keys() }
}

/** A Models API fetch carrying the session's own login; null without one (Bedrock, Vertex, a gateway). */
async function loginOf($: EngineInterface): Promise<FetchPort | null> {
  const auth = await $.session.authorize()
  return auth === null ? null : url => $.http.fetch(url, { auth: auth.handle, headers: { 'anthropic-version': API_VERSION } })
}

/** The session's folder: its repo root, else its working directory; null (and said) when neither answers. */
async function rootOf($: EngineInterface): Promise<string | null> {
  try {
    return (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch (error) {
    $.ui.status(`model-guard: this session's folder is unknown (${messageOf(error)}); only the global list applies`)
    return null
  }
}

/** Reads the lists from the store into the session. */
async function loadLists($: EngineInterface, legacy: LegacyOptions): Promise<GuardState> {
  const root = await rootOf($)
  const lists = await readLists(storeOf($), root, legacy)
  const repoName = root === null ? null : (root.split('/').filter(Boolean).pop() ?? null)
  await update($, guard, s => ({ ...(isCurrent(s) ? s : EMPTY_STATE), ...lists, isReady: true, repoRoot: root, repoName }))
  return read($, guard)
}

/** The session's lists: read now when `fresh`, else once; a store that can't be read leaves the 0.2 settings in force. */
async function ensureReady($: EngineInterface, legacy: LegacyOptions, fresh = false): Promise<GuardState> {
  const state = await read($, guard)
  if (isCurrent(state) && !fresh) {
    return state
  }
  try {
    return await loadLists($, legacy)
  } catch (error) {
    $.ui.status(`model-guard: saved lists unreadable (${messageOf(error)}); using ${isCurrent(state) ? "this session's copy" : 'the settings'}`)
    if (!isCurrent(state)) {
      await update($, guard, () => ({ ...EMPTY_STATE, isReady: true, policy: migratePolicy(undefined, legacy) }))
    }
    return read($, guard)
  }
}

/** One change to the list in force (this repo's own, else the global one), decided from the store. */
async function changePolicy($: EngineInterface, legacy: LegacyOptions, change: (policy: Policy, catalog: Catalog) => Policy): Promise<{ isRefused: boolean }> {
  const state = await ensureReady($, legacy)
  const { policy, source, isRefused } = await changeActive(storeOf($), state.repoRoot, legacy, p => change(p, state.catalog))
  await update($, guard, s => ({ ...s, policy, source }))
  return { isRefused }
}

/** A pane press: its work, with what it has to say (a refusal, a failure) as a toast. */
function act($: EngineInterface, work: Promise<string | null>): void {
  // A press has no caller to answer: the toast is where its outcome goes, failures included.
  void work.then(text => text === null || $.ui.toast(`model-guard: ${text}`)).catch(error => $.ui.toast(`model-guard: not saved (${messageOf(error)})`))
}

/** A pane change; a refused one (it would block the last allowed model) says why. */
async function changeFromPane($: EngineInterface, legacy: LegacyOptions, change: (policy: Policy, catalog: Catalog) => Policy, refused = KEEP_ONE): Promise<string | null> {
  return (await changePolicy($, legacy, change)).isRefused ? refused : null
}

/** Gives this repo a list of its own (a copy of the stored global one), or drops it. */
async function switchList($: EngineInterface, legacy: LegacyOptions, to: GuardState['source']): Promise<string> {
  const message = await switchRepo(storeOf($), await ensureReady($, legacy, true), to, legacy)
  await loadLists($, legacy)
  return message
}

/** Adds model ids the session saw running to the shared list (a write only when one is new). */
async function noteSeen($: EngineInterface, legacy: LegacyOptions, models: readonly (string | null | undefined)[]): Promise<void> {
  const catalog = await addSeen(storeOf($), (await ensureReady($, legacy)).catalog, models, await $.clock.now())
  if (catalog !== null) {
    await update($, guard, s => ({ ...s, catalog }))
  }
}

/** Notes the main conversation's model (a resolved id), and says so when it runs on a blocked version. */
async function checkMainModel($: EngineInterface, legacy: LegacyOptions, model: string): Promise<void> {
  await update($, guard, s => ({ ...s, mainModel: model }))
  if (parseModelId(model) === null) {
    // `default`, `opusplan` or an alias: the resolved id comes with the first request.
    return
  }
  await noteSeen($, legacy, [model])
  const state = await read($, guard)
  if (!isAllowedModel(state.policy, state.catalog, model)) {
    $.ui.toast(mainModelWarningOf(model))
  }
}

/** The model list from Anthropic, merged into the shared one; a model new to it gets a toast. */
async function refreshList($: EngineInterface, legacy: LegacyOptions, force: boolean): Promise<string> {
  const state = await ensureReady($, legacy)
  const { catalog, added, message } = await refreshModels(storeOf($), state.catalog, await $.clock.now(), force, () => loginOf($))
  await update($, guard, s => ({ ...s, catalog }))
  const { policy } = await read($, guard)
  for (const entry of added) {
    $.ui.toast(newModelText(policy, entry))
  }
  return message
}

/** One `/models` text form, answered in text; null opens the pane. */
async function runCommand($: EngineInterface, legacy: LegacyOptions, args: string): Promise<string | null> {
  const { catalog } = await read($, guard)
  const command = parseCommand(args)
  const edit = editOf(command, catalog)
  if (edit !== null) {
    if (!edit.ok) return edit.error
    return (await changePolicy($, legacy, edit.value.change)).isRefused ? KEEP_ONE : `${edit.value.done}\n${textOf(await read($, guard))}`
  }
  switch (command.kind) {
    case 'open':
      return null
    case 'add':
    case 'remove': {
      const result = await editModels(storeOf($), command.kind, command.id, await $.clock.now())
      await update($, guard, s => ({ ...s, catalog: result.catalog }))
      return result.message
    }
    case 'refresh':
      return refreshList($, legacy, true)
    case 'repo':
    case 'global':
      return switchList($, legacy, command.kind)
    default:
      return fixedAnswerOf(command) ?? textOf(await read($, guard))
  }
}

async function showStatus($: EngineInterface): Promise<void> {
  const state = await read($, guard)
  $.ui.status(state.recent.length > 0 ? `model-guard: ${summaryOf(state)}` : undefined)
}

const legacyOf = (raw: Readonly<Record<string, unknown>>): LegacyOptions => ({ defaultAllowed: raw.defaultAllowed, fallback: raw.fallback, mode: raw.mode })

export const register: Register = (on, rawOptions) => {
  const legacy = legacyOf(rawOptions)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'models',
      description: 'Choose which model versions this session may use (model-guard)',
      argumentHint: '[allow|block <model> | new <family> allow|block | refresh | repo | global | help]',
    })
    await ensureReady($, legacy)
    await checkMainModel($, legacy, await $.session.model())
    // After the session is up, not in its way: the list is a day fresh at most.
    $.clock.after(0, () => {
      void refreshList($, legacy, false).catch(error => $.ui.status(`model-guard: model list not refreshed (${messageOf(error)})`))
    })
    return next(e)
  })

  // /clear resets $.state: read the lists again.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await ensureReady($, legacy)
    return result
  }).catch(letThrough)

  // Another instance may have changed the lists: every turn starts from the store.
  on('turn.start', async ($, e, next) => {
    await ensureReady($, legacy, true)
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await checkMainModel($, legacy, e.to_model)
    return result
  }).catch(letThrough)

  on('command.run', { command: 'models' }, async ($, e) => {
    // Fresh from the store: another window may have changed the lists since this session's last turn.
    await ensureReady($, legacy, true)
    const answer = await runCommand($, legacy, e.args ?? '')
    if (answer !== null) {
      return { text: answer }
    }
    try {
      // Where nothing draws (cloud, -p) the text answer below is the view.
      await $.ui.open({ id: PANE, title: 'Models', rows: 18 })
    } catch {
      // fall through to the text answer
    }
    return { text: textOf(await read($, guard)) }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork) {
      return next(e)
    }
    const state = await ensureReady($, legacy)
    const decision = spawnDecision(state.policy, state.catalog, { model: e.model, parentModel: e.parentModel, isWorkflow: e.workflow !== undefined })
    if (decision.kind === 'deny' || decision.kind === 'swap') {
      const at = await $.clock.now()
      const to = decision.kind === 'swap' ? decision.to.key : undefined
      await update($, guard, s => withEvent(s, { at, kind: decision.kind, what: e.description, from: decision.from, to }))
      $.ui.toast(spawnToastOf(e.description, decision.from, to))
      await showStatus($)
    }
    if (decision.kind === 'deny') {
      return { deny: decision.reason }
    }
    const result = await next(decision.kind === 'pass' ? e : { ...e, model: decision.model })
    if ('model' in result && typeof result.model === 'string') {
      const model = result.model
      await update($, guard, s => withUse(s, keyOf(model)))
      await noteSeen($, legacy, [model])
    }
    await showStatus($)
    return result
  }).catch(letThrough)

  on('turn.step', async function* ($, e, next) {
    const state = await ensureReady($, legacy)
    const loop = e.agentId
    if (loop === undefined) {
      // The main conversation: never changed; its resolved model is checked once per switch.
      if (state.mainModel !== e.model) {
        await checkMainModel($, legacy, e.model)
      }
      return yield* next(e)
    }
    const swap = stepSwap(state.policy, state.catalog, e.model)
    if (swap === null) {
      return yield* next(e)
    }
    if (!state.swappedLoops.includes(loop)) {
      const at = await $.clock.now()
      const from = keyOf(e.model)
      await update($, guard, s => ({ ...withEvent(s, { at, kind: 'swap', what: `agent ${loop.slice(0, 8)}`, from, to: swap.to.key }), swappedLoops: [...s.swappedLoops, loop].slice(-50) }))
      $.ui.toast(`model-guard: a subagent's ${labelOf(from)} requests now go to ${labelOf(swap.to.key)}`)
      await showStatus($)
    }
    return yield* next({ ...e, model: swap.model })
  }).catch(async function* ($, e, next) {
    $.ui.status(LET_THROUGH)
    return yield* next(e)
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const state = await ensureReady($, legacy)
    // The engine runs scriptPath over script; a named or resumed run is caught per agent (spawn, turn.step).
    let script = e.script ?? ''
    if (typeof e.scriptPath === 'string') {
      try {
        script = await $.fs.read(e.scriptPath)
      } catch (error) {
        $.ui.status(`model-guard: workflow script unreadable (${messageOf(error)}); its agents are checked as they start`)
      }
    }
    const refusal = workflowRefusal(state.policy, state.catalog, script)
    if (refusal === null) {
      return next(e)
    }
    const at = await $.clock.now()
    for (const m of refusal.banned) {
      await update($, guard, s => withEvent(s, { at, kind: 'deny', what: 'Workflow', from: nameOf(m) }))
    }
    await showStatus($)
    return { deny: refusal.reason }
  }).catch(letThrough)

  on('classic.PreModelSwitch', async ($, e, next) => {
    const result = await next(e)
    const state = await ensureReady($, legacy)
    if (isAllowedModel(state.policy, state.catalog, e.to_model)) {
      return result
    }
    const at = await $.clock.now()
    await update($, guard, s => withEvent(s, { at, kind: 'deny', what: '/model', from: keyOf(e.to_model) }))
    await showStatus($)
    return { ...result, permissionDecision: 'deny' as const, permissionDecisionReason: switchRefusal(state.policy, state.catalog, e.to_model) }
  }).catch(letThrough)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const state = await read($, guard)
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    const local = (change: (s: GuardState) => GuardState) => act($, update($, guard, change).then(() => null))
    return drawModels(
      t,
      state,
      {
        toggleVersion: key => act($, changeFromPane($, legacy, (p, c) => toggledVersion(p, c, key))),
        toggleFamily: family => act($, changeFromPane($, legacy, (p, c) => toggledFamily(p, c, family))),
        toggleExpanded: () => local(s => ({ ...s, expanded: !s.expanded })),
        showView: view => local(s => ({ ...s, view })),
        cycleFallback: () => act($, changeFromPane($, legacy, cycledFallback, 'No allowed model to fall back to yet.')),
        cycleMode: () => act($, changeFromPane($, legacy, p => ({ ...p, mode: p.mode === 'deny' ? ('swap' as const) : ('deny' as const) }))),
        // Called directly: $.command.run would skip this plugin's own command hook.
        refresh: () => act($, refreshList($, legacy, true)),
        toggleRepo: () => act($, switchList($, legacy, state.source === 'repo' ? 'global' : 'repo')),
        close: () => act($, $.ui.close({ id: PANE }).then(() => null)),
      },
      await $.clock.now(),
      columns,
    )
  })
}
