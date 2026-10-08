/**
 * model-guard: choose the model versions this session may use.
 *
 * The rules and the model list live in the plugin store, shared by every
 * local Claude Code process, and are read at start, at every turn and when
 * /models opens. Spawns, subagent requests, workflows and /model are checked
 * per version; the main conversation's own model is never changed. Every `$`
 * call is in this file (the loader follows `$` only within one file); the
 * logic is in the pure modules next to it, reached through plain functions.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalog } from './catalog'
import { editOf, fixedAnswerOf, parseCommand } from './commands'
import { spawnDecision, stepSwap, workflowRefusal } from './decide'
import { aliasOf, keyOf, parseModelId } from './ids'
import { addSeen, API_VERSION, changeList, editModels, GLOBAL_KEY, messageOf, readLists, refreshModels, repoKeyOf } from './lists'
import type { FetchPort, StorePort } from './lists'
import { isAllowedModel, migratePolicy } from './policy'
import type { LegacyOptions, Policy } from './policy'
import { cycledFallback, EMPTY_STATE, isCurrent, labelOf, nameOf, newModelText, summaryOf, toggledFamily, toggledVersion, withEvent, withUse } from './state'
import type { GuardState } from './state'
import { drawModels, textOf } from './view'

const PANE = 'models'
const KEEP_ONE = 'Something must stay allowed: allow another model first.'
const guard = atom({ plugin: 'model-guard', key: 'guard' } as const, EMPTY_STATE)

/** The store as plain functions, for lists.ts. */
function storeOf($: EngineInterface): StorePort {
  return { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), delete: key => $.store.delete(key) }
}

/** A Models API fetch carrying the session's own login; null without one (Bedrock, Vertex, a gateway). */
async function loginOf($: EngineInterface): Promise<FetchPort | null> {
  const auth = await $.session.authorize()
  return auth === null ? null : url => $.http.fetch(url, { auth: auth.handle, headers: { 'anthropic-version': API_VERSION } })
}

/** The session's folder: its repo root, else its working directory. */
async function rootOf($: EngineInterface): Promise<string | null> {
  try {
    return (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
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

/** The session's lists, read once; a store that can't be read leaves the 0.2 settings in force. */
async function ensureReady($: EngineInterface, legacy: LegacyOptions): Promise<GuardState> {
  const state = await read($, guard)
  if (isCurrent(state)) {
    return state
  }
  try {
    return await loadLists($, legacy)
  } catch (error) {
    $.ui.status(`model-guard: saved lists unreadable (${messageOf(error)}); using the settings`)
    await update($, guard, () => ({ ...EMPTY_STATE, isReady: true, policy: migratePolicy(undefined, legacy) }))
    return read($, guard)
  }
}

/** One change to the list in force (this repo's own, else the global one). */
async function changePolicy($: EngineInterface, change: (policy: Policy, catalog: Catalog) => Policy): Promise<{ isChanged: boolean }> {
  const state = await read($, guard)
  const key = state.source === 'repo' && state.repoRoot !== null ? repoKeyOf(state.repoRoot) : GLOBAL_KEY
  const { policy, isChanged } = await changeList(storeOf($), key, state.policy, p => change(p, state.catalog))
  await update($, guard, s => ({ ...s, policy }))
  return { isChanged }
}

/** A pane change; a refused one (it would block the last allowed model) says why. */
async function changeFromPane($: EngineInterface, change: (policy: Policy, catalog: Catalog) => Policy): Promise<void> {
  if (!(await changePolicy($, change)).isChanged) {
    $.ui.toast(`model-guard: ${KEEP_ONE}`)
  }
}

/** Gives this repo a list of its own (a copy of the one in force), or drops it. */
async function switchList($: EngineInterface, legacy: LegacyOptions, to: 'repo' | 'global'): Promise<string> {
  const state = await read($, guard)
  const name = state.repoName ?? 'This repo'
  if (state.repoRoot === null) return 'This session has no folder to keep a list for.'
  if (state.source === to) return to === 'repo' ? `${name} already has its own list. /models global goes back.` : 'This repo already uses the global list.'
  if (to === 'repo') {
    await $.store.set(repoKeyOf(state.repoRoot), state.policy)
    await update($, guard, s => ({ ...s, source: 'repo' as const }))
    return `${name} now has its own list, a copy of the global one. /models global goes back.`
  }
  await $.store.delete(repoKeyOf(state.repoRoot))
  await loadLists($, legacy)
  return `${name} uses the global list again.`
}

/** Adds model ids the session saw running to the shared list (a write only when one is new). */
async function noteSeen($: EngineInterface, models: readonly (string | null | undefined)[]): Promise<void> {
  const catalog = await addSeen(storeOf($), (await read($, guard)).catalog, models, await $.clock.now())
  if (catalog !== null) {
    await update($, guard, s => ({ ...s, catalog }))
  }
}

/** Notes the main conversation's model, and says so when it runs on a blocked version. */
async function checkMainModel($: EngineInterface, model: string | null | undefined): Promise<void> {
  if (typeof model !== 'string' || (parseModelId(model) === null && aliasOf(model) === null)) {
    return
  }
  await noteSeen($, [model])
  const state = await read($, guard)
  if (!isAllowedModel(state.policy, state.catalog, model)) {
    $.ui.toast(`model-guard: this conversation runs on ${labelOf(nameOf(model))}, which is blocked here. Subagents won't use it; /model switches.`)
  }
}

/** The model list from Anthropic, merged into the shared one; a model new to it gets a toast. */
async function refreshList($: EngineInterface, force: boolean): Promise<string> {
  const { catalog, added, message } = await refreshModels(storeOf($), (await read($, guard)).catalog, await $.clock.now(), force, () => loginOf($))
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
    return (await changePolicy($, edit.value.change)).isChanged ? `${edit.value.done}\n${textOf(await read($, guard))}` : KEEP_ONE
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
      return refreshList($, true)
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
    await checkMainModel($, await $.session.model())
    // After the session is up, not in its way: the list is a day fresh at most.
    $.clock.after(0, () => {
      void refreshList($, false).catch(error => $.ui.status(`model-guard: model list not refreshed (${messageOf(error)})`))
    })
    return next(e)
  })

  // /clear resets $.state: read the lists again.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await ensureReady($, legacy)
    return result
  })

  // Another instance may have changed the lists: every turn starts from the store.
  on('turn.start', async ($, e, next) => {
    try {
      await loadLists($, legacy)
    } catch (error) {
      $.ui.status(`model-guard: saved lists unreadable (${messageOf(error)}); using this session's copy`)
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await checkMainModel($, e.to_model)
    return result
  })

  on('command.run', { command: 'models' }, async ($, e) => {
    await ensureReady($, legacy)
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
    const decision = spawnDecision(state.policy, state.catalog, e.model)
    if (decision.kind === 'deny' || decision.kind === 'swap') {
      const at = await $.clock.now()
      const { from } = decision
      const to = decision.kind === 'swap' ? decision.to.key : undefined
      await update($, guard, s => withEvent(s, { at, kind: decision.kind, what: e.description, from, to }))
      $.ui.toast(to === undefined ? `model-guard: refused a ${labelOf(from)} subagent (${e.description})` : `model-guard: ${e.description}: ${labelOf(from)} → ${labelOf(to)}`)
      await showStatus($)
    }
    if (decision.kind === 'deny') {
      return { deny: decision.reason }
    }
    const result = await next(decision.kind === 'pass' ? e : { ...e, model: decision.model })
    if ('model' in result && typeof result.model === 'string') {
      const model = result.model
      await update($, guard, s => withUse(s, keyOf(model)))
      await noteSeen($, [model])
    }
    await showStatus($)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const state = await read($, guard)
    const loop = e.agentId
    const swap = !isCurrent(state) || loop === undefined ? null : stepSwap(state.policy, state.catalog, e.model)
    if (swap === null || loop === undefined) {
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
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const state = await ensureReady($, legacy)
    const input = e as unknown as { script?: string; scriptPath?: string }
    let script = input.script ?? ''
    if (script === '' && typeof input.scriptPath === 'string') {
      try {
        const text = await $.fs.read(input.scriptPath)
        script = typeof text === 'string' ? text : ''
      } catch {
        script = ''
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
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    const result = await next(e)
    const state = await ensureReady($, legacy)
    if (isAllowedModel(state.policy, state.catalog, e.to_model)) {
      return result
    }
    const at = await $.clock.now()
    const from = keyOf(e.to_model)
    await update($, guard, s => withEvent(s, { at, kind: 'deny', what: '/model', from }))
    await showStatus($)
    return { ...result, permissionDecision: 'deny' as const, permissionDecisionReason: `${labelOf(from)} is blocked. Allow it in /models first.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const state = await read($, guard)
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    return drawModels(
      t,
      state,
      {
        toggleVersion: key => void changeFromPane($, (p, c) => toggledVersion(p, c, key)),
        toggleFamily: family => void changeFromPane($, (p, c) => toggledFamily(p, c, family)),
        toggleExpanded: () => void update($, guard, s => ({ ...s, expanded: !s.expanded })),
        showView: view => void update($, guard, s => ({ ...s, view })),
        cycleFallback: () => void changeFromPane($, cycledFallback),
        cycleMode: () => void changeFromPane($, p => ({ ...p, mode: p.mode === 'deny' ? ('swap' as const) : ('deny' as const) })),
        refresh: () => void refreshList($, true).then(text => $.ui.toast(`model-guard: ${text}`)),
        // Called directly: $.command.run would skip this plugin's own command hook.
        toggleRepo: () => void switchList($, legacy, state.source === 'repo' ? 'global' : 'repo').then(text => $.ui.toast(text)),
        close: () => void $.ui.close({ id: PANE }),
      },
      await $.clock.now(),
      columns,
    )
  })
}
