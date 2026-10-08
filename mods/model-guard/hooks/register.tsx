/**
 * model-guard: choose the model versions this session may use.
 *
 * The lists (the rules and the model list) live in the plugin store, shared
 * by every local Claude Code process: desktop, terminals, VS Code. Each
 * session reads them at start, at every turn and when /models opens; the
 * model list refreshes from Anthropic's Models API once a day.
 *
 * agent.spawn: a subagent asked for on a blocked version is refused (or
 * swapped, by mode); an alias (`opus`) is pointed at the newest allowed
 * version of its family before it starts.
 * turn.step: every subagent/workflow request still on a blocked version is
 * swapped (same family first, then the fallback).
 * tool.call Workflow: a script naming a blocked version is refused.
 * classic.PreModelSwitch: /model to a blocked version is refused.
 * The main conversation's own model is never changed; a toast says when it
 * runs on a blocked version.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Catalog, Incoming, Result } from './catalog'
import { aliasOf, familyOfId, isInherited, keyOf, parseModelId, splitSuffix } from './ids'
import { addSeen, API_VERSION, changeList, fetchModels, GLOBAL_KEY, isStale, messageOf, readLists, repoKeyOf, saveFetched } from './lists'
import type { StorePort } from './lists'
import { concreteFor, isAllowedModel, migratePolicy, swapTarget, withFamilyList } from './policy'
import type { LegacyOptions, Policy } from './policy'
import {
  blockedOf,
  cycledFallback,
  EMPTY_STATE,
  familyListProblem,
  isCurrent,
  labelOf,
  nameOf,
  newModelText,
  refusalOf,
  summaryOf,
  toggledVersion,
  withEvent,
  withUse,
  workflowModels,
} from './state'
import type { GuardState } from './state'
import { drawModels, textOf } from './view'

const PANE = 'models'
const KEEP_ONE = 'Something must stay allowed: allow another model first.'
const NO_LOGIN = 'no Anthropic login in this session (Bedrock, Vertex or a gateway); the list holds the models seen in use'
const guard = atom({ plugin: 'model-guard', key: 'guard' } as const, EMPTY_STATE)

/** The store as plain functions, for lists.ts. */
function storeOf($: EngineInterface): StorePort {
  return { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), delete: key => $.store.delete(key) }
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
  const { isChanged } = await changePolicy($, change)
  if (!isChanged) {
    $.ui.toast(`model-guard: ${KEEP_ONE}`)
  }
}

/** `/models opus,sonnet` (the 0.2 form): listed families allow, the others block. */
async function setFamilyList($: EngineInterface, words: string[]): Promise<string> {
  const problem = familyListProblem(words, (await read($, guard)).catalog)
  if (problem !== null) {
    return problem
  }
  const { isChanged } = await changePolicy($, (p, c) => withFamilyList(p, c, words))
  return isChanged ? textOf(await read($, guard)) : KEEP_ONE
}

/** Gives this repo a list of its own, a copy of the one in force. */
async function useRepoList($: EngineInterface): Promise<string> {
  const state = await read($, guard)
  const name = state.repoName ?? 'This repo'
  if (state.repoRoot === null) return 'This session has no folder to keep a list for.'
  if (state.source === 'repo') return `${name} already has its own list. /models global goes back to the global one.`
  await $.store.set(repoKeyOf(state.repoRoot), state.policy)
  await update($, guard, s => ({ ...s, source: 'repo' as const }))
  return `${name} now has its own list, a copy of the global one. /models global goes back.`
}

/** Drops this repo's own list; the global one applies again. */
async function useGlobalList($: EngineInterface, legacy: LegacyOptions): Promise<string> {
  const state = await read($, guard)
  if (state.source !== 'repo' || state.repoRoot === null) return 'This repo already uses the global list.'
  await $.store.delete(repoKeyOf(state.repoRoot))
  await loadLists($, legacy)
  return `${state.repoName ?? 'This repo'} uses the global list again.`
}

/** The pane's repo button: a list of its own, or back to the global one. */
async function toggleRepoList($: EngineInterface, legacy: LegacyOptions): Promise<void> {
  const state = await read($, guard)
  $.ui.toast(state.source === 'repo' ? await useGlobalList($, legacy) : await useRepoList($))
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

/**
 * Loads the model list from Anthropic through the session's own login and
 * merges it into the shared list; a model new to the list gets a toast.
 */
async function refreshList($: EngineInterface, force: boolean): Promise<string> {
  const now = await $.clock.now()
  const before = await read($, guard)
  if (!force && !isStale(before.catalog, now)) {
    return `The model list is up to date (${before.catalog.entries.length} models).`
  }
  let result: Result<Incoming[]>
  try {
    const auth = await $.session.authorize()
    result = auth === null ? { ok: false, error: NO_LOGIN } : await fetchModels(url => $.http.fetch(url, { auth: auth.handle, headers: { 'anthropic-version': API_VERSION } }))
  } catch (error) {
    result = { ok: false, error: `the Models API could not be reached (${messageOf(error)})` }
  }
  const { catalog, added } = await saveFetched(storeOf($), result, now)
  await update($, guard, s => ({ ...s, catalog }))
  const { policy } = await read($, guard)
  for (const entry of added) {
    $.ui.toast(newModelText(policy, entry))
  }
  return result.ok ? `Model list updated: ${catalog.entries.length} models${added.length > 0 ? `, ${added.length} new` : ''}.` : `Model list not updated: ${result.error}.`
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
      argumentHint: '[allow|block <model> | new <family> allow|block | refresh | repo | global]',
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
    const arg = (e.args ?? '').trim().toLowerCase()
    // B4 replaces this with the full command set.
    if (arg === 'save' || arg === 'repo') return { text: await useRepoList($) }
    if (arg === 'reset' || arg === 'global') return { text: await useGlobalList($, legacy) }
    if (arg === 'refresh') return { text: await refreshList($, true) }
    if (arg !== '') return { text: await setFamilyList($, arg.split(/[\s,;]+/).filter(Boolean)) }
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
    const asked = e.model
    let spawn = e

    if (asked !== undefined && !isInherited(asked)) {
      const concrete = concreteFor(state.policy, state.catalog, asked)
      if (concrete === null) {
        const target = swapTarget(state.policy, state.catalog, aliasOf(asked)?.family ?? familyOfId(asked))
        const to = target?.ids[0] ?? null
        const at = await $.clock.now()
        const from = nameOf(asked)
        if (state.policy.mode === 'deny' || target === null || to === null) {
          await update($, guard, s => withEvent(s, { at, kind: 'deny', what: e.description, from }))
          $.ui.toast(`model-guard: refused a ${labelOf(from)} subagent (${e.description})`)
          await showStatus($)
          return { deny: refusalOf(state.policy, asked, to) }
        }
        await update($, guard, s => withEvent(s, { at, kind: 'swap', what: e.description, from, to: target.key }))
        $.ui.toast(`model-guard: ${e.description}: ${labelOf(from)} → ${labelOf(target.key)}`)
        spawn = { ...e, model: to + splitSuffix(asked).suffix }
      } else if (concrete !== asked) {
        // An alias whose family has a blocked version: the newest allowed one, not the host's newest.
        spawn = { ...e, model: concrete }
      }
    }

    const result = await next(spawn)
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
    if (!isCurrent(state) || e.agentId === undefined || isAllowedModel(state.policy, state.catalog, e.model)) {
      return yield* next(e)
    }
    const target = swapTarget(state.policy, state.catalog, familyOfId(e.model))
    const to = target?.ids[0]
    if (target === null || to === undefined) {
      return yield* next(e)
    }
    const loop = e.agentId
    if (!state.swappedLoops.includes(loop)) {
      const at = await $.clock.now()
      const from = keyOf(e.model)
      await update($, guard, s => ({ ...withEvent(s, { at, kind: 'swap', what: `agent ${loop.slice(0, 8)}`, from, to: target.key }), swappedLoops: [...s.swappedLoops, loop].slice(-50) }))
      $.ui.toast(`model-guard: a subagent's ${labelOf(from)} requests now go to ${labelOf(target.key)}`)
      await showStatus($)
    }
    return yield* next({ ...e, model: to + splitSuffix(e.model).suffix })
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
    const banned = [...new Set(workflowModels(script).filter(m => !isAllowedModel(state.policy, state.catalog, m)))]
    if (banned.length === 0) {
      return next(e)
    }
    const at = await $.clock.now()
    for (const m of banned) {
      await update($, guard, s => withEvent(s, { at, kind: 'deny', what: 'Workflow', from: nameOf(m) }))
    }
    await showStatus($)
    const target = swapTarget(state.policy, state.catalog, familyOfId(banned[0] ?? ''))
    return {
      deny: `model-guard: this workflow asks for ${banned.join(', ')}, which this session blocks (blocked: ${blockedOf(state.policy).join(', ')}). Use "${target?.ids[0] ?? 'inherit'}" instead.`,
    }
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
    const now = await $.clock.now()
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    return drawModels(
      t,
      state,
      {
        toggleVersion: key => void changeFromPane($, (p, c) => toggledVersion(p, c, key)),
        toggleExpanded: () => void update($, guard, s => ({ ...s, expanded: !s.expanded })),
        cycleFallback: () => void changeFromPane($, cycledFallback),
        cycleMode: () => void changeFromPane($, p => ({ ...p, mode: p.mode === 'deny' ? ('swap' as const) : ('deny' as const) })),
        // Called directly: $.command.run would skip this plugin's own command hook.
        toggleRepo: () => void toggleRepoList($, legacy),
        close: () => void $.ui.close({ id: PANE }),
      },
      now,
      columns,
    )
  })
}
