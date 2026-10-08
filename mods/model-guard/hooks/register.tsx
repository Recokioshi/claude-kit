/**
 * model-guard: choose the model versions this session may use.
 *
 * The lists (the rules and the model list) live in the plugin store, shared
 * by every local Claude Code process: desktop, terminals, VS Code. Each
 * session reads them at start, at every turn and when /models opens.
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

import { familiesOf, mergeCatalog, parseCatalog } from './catalog'
import type { Catalog, Incoming } from './catalog'
import { aliasOf, familyOfId, isInherited, keyOf, KNOWN_FAMILIES, splitSuffix } from './ids'
import { concreteFor, isAllowedModel, migratePolicy, parsePolicy, swapTarget, withFamilyList } from './policy'
import type { LegacyOptions, Policy } from './policy'
import { blockedOf, cycledFallback, EMPTY_STATE, isCurrent, labelOf, summaryOf, toggledVersion, withEvent, withUse, workflowModels } from './state'
import type { GuardState } from './state'
import { drawModels, textOf } from './view'

const PANE = 'models'
const GLOBAL = 'policy:global'
const CATALOG = 'catalog'
const guard = atom({ plugin: 'model-guard', key: 'guard' } as const, EMPTY_STATE)

const repoKeyOf = (root: string) => `repo:${root}`

/** What a request names, for messages and stats: `opus` for an alias, `opus-5` for an id. */
function nameOf(model: string): string {
  return aliasOf(model)?.family ?? keyOf(model)
}

/**
 * Reads the lists from the store into the session. A global list that does
 * not exist yet is seeded from the 0.2 settings rows; a 0.2 repo record is
 * migrated and written back.
 */
async function loadLists($: EngineInterface, legacy: LegacyOptions): Promise<GuardState> {
  let root: string | null = null
  try {
    root = (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
    root = null
  }
  let global = parsePolicy(await $.store.get(GLOBAL))
  if (global === null) {
    global = migratePolicy(undefined, legacy)
    await $.store.set(GLOBAL, global)
  }
  let repo: Policy | null = null
  if (root !== null) {
    const stored = await $.store.get(repoKeyOf(root))
    if (stored !== undefined && stored !== null) {
      repo = parsePolicy(stored)
      if (repo === null) {
        repo = migratePolicy(stored, legacy)
        await $.store.set(repoKeyOf(root), repo)
      }
    }
  }
  const catalog = parseCatalog(await $.store.get(CATALOG))
  const repoName = root === null ? null : (root.split('/').filter(Boolean).pop() ?? null)
  await update($, guard, s => ({
    ...(isCurrent(s) ? s : EMPTY_STATE),
    isReady: true,
    policy: repo ?? global,
    source: repo === null ? ('global' as const) : ('repo' as const),
    repoRoot: root,
    repoName,
    catalog,
  }))
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Applies one change to the active list (this repo's override, else the
 * global one): read again from the store, since another process may have
 * changed it, changed, and written back.
 */
async function changePolicy($: EngineInterface, change: (policy: Policy, catalog: Catalog) => Policy): Promise<{ isChanged: boolean }> {
  const state = await read($, guard)
  const key = state.source === 'repo' && state.repoRoot !== null ? repoKeyOf(state.repoRoot) : GLOBAL
  const current = parsePolicy(await $.store.get(key)) ?? state.policy
  const next = change(current, state.catalog)
  const isChanged = next !== current
  if (isChanged) {
    await $.store.set(key, next)
  }
  await update($, guard, s => ({ ...s, policy: next }))
  return { isChanged }
}

const KEEP_ONE = 'Something must stay allowed: allow another model first.'

/** A pane change; a refused one (it would block the last allowed model) says why. */
async function changeFromPane($: EngineInterface, change: (policy: Policy, catalog: Catalog) => Policy): Promise<void> {
  const { isChanged } = await changePolicy($, change)
  if (!isChanged) {
    $.ui.toast(`model-guard: ${KEEP_ONE}`)
  }
}

/** The pane's repo button: a list of its own, or back to the global one. */
async function toggleRepoList($: EngineInterface, legacy: LegacyOptions): Promise<void> {
  const state = await read($, guard)
  $.ui.toast(state.source === 'repo' ? await useGlobalList($, legacy) : await useRepoList($))
}

/** `/models opus,sonnet` (the 0.2 form): listed families allow, the others block. */
async function setFamilyList($: EngineInterface, words: string[]): Promise<string> {
  const state = await read($, guard)
  const known = new Set<string>([...KNOWN_FAMILIES, ...familiesOf(state.catalog), 'other'])
  const unknown = words.filter(w => !known.has(w))
  if (words.length === 0 || unknown.length > 0) {
    return `No model family in "${unknown.join(' ') || words.join(' ')}". Use any of: ${[...known].join(', ')}.`
  }
  const { isChanged } = await changePolicy($, (p, c) => withFamilyList(p, c, words))
  return isChanged ? textOf(await read($, guard)) : KEEP_ONE
}

/** Gives this repo a list of its own, a copy of the one in force. */
async function useRepoList($: EngineInterface): Promise<string> {
  const state = await read($, guard)
  if (state.repoRoot === null) {
    return 'This session has no folder to keep a list for.'
  }
  if (state.source === 'repo') {
    return `${state.repoName ?? 'This repo'} already has its own list. /models global goes back to the global one.`
  }
  await $.store.set(repoKeyOf(state.repoRoot), state.policy)
  await update($, guard, s => ({ ...s, source: 'repo' as const }))
  return `${state.repoName ?? 'This repo'} now has its own list, a copy of the global one. /models global goes back.`
}

/** Drops this repo's own list; the global one applies again. */
async function useGlobalList($: EngineInterface, legacy: LegacyOptions): Promise<string> {
  const state = await read($, guard)
  if (state.source !== 'repo' || state.repoRoot === null) {
    return 'This repo already uses the global list.'
  }
  await $.store.delete(repoKeyOf(state.repoRoot))
  await loadLists($, legacy)
  return `${state.repoName ?? 'This repo'} uses the global list again.`
}

/** Adds model ids the session saw running to the shared list (only the new ones cost a write). */
async function noteSeen($: EngineInterface, models: readonly (string | null | undefined)[]): Promise<void> {
  const state = await read($, guard)
  const fresh = models.filter((m): m is string => typeof m === 'string' && !isInherited(m) && aliasOf(m) === null).filter(m => {
    const base = splitSuffix(m).base
    return !state.catalog.entries.some(e => e.ids.includes(base))
  })
  if (fresh.length === 0) {
    return
  }
  const now = await $.clock.now()
  const incoming: Incoming[] = fresh.map(id => ({ id, source: 'seen' }))
  const { catalog } = mergeCatalog(parseCatalog(await $.store.get(CATALOG)), incoming, now)
  await $.store.set(CATALOG, catalog)
  await update($, guard, s => ({ ...s, catalog }))
}

async function showStatus($: EngineInterface): Promise<void> {
  const state = await read($, guard)
  $.ui.status(state.recent.length > 0 ? `model-guard: ${summaryOf(state)}` : undefined)
}

/** The refusal Claude reads: what is blocked and what to ask for instead. */
function refusalOf(state: GuardState, asked: string, target: string | null): string {
  const blocked = blockedOf(state.policy)
  const instead = target === null ? 'No allowed model is known yet; ask the user to open /models.' : `Spawn the agent again with model "${target}".`
  return `model-guard: ${labelOf(nameOf(asked))} is blocked in this session (blocked: ${blocked.join(', ') || 'nothing else'}). ${instead}`
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

  on('command.run', { command: 'models' }, async ($, e) => {
    await ensureReady($, legacy)
    const arg = (e.args ?? '').trim().toLowerCase()
    // B4 replaces this with the full command set.
    if (arg === 'save' || arg === 'repo') return { text: await useRepoList($) }
    if (arg === 'reset' || arg === 'global') return { text: await useGlobalList($, legacy) }
    if (arg !== '') {
      return { text: await setFamilyList($, arg.split(/[\s,;]+/).filter(Boolean)) }
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
    const asked = e.model
    let spawn = e

    if (asked !== undefined && !isInherited(asked)) {
      const concrete = concreteFor(state.policy, state.catalog, asked)
      if (concrete === null) {
        const target = swapTarget(state.policy, state.catalog, aliasOf(asked)?.family ?? familyOfId(asked))
        const to = target?.ids[0] ?? null
        const at = await $.clock.now()
        const from = nameOf(asked)
        if (state.policy.mode === 'deny' || to === null) {
          await update($, guard, s => withEvent(s, { at, kind: 'deny', what: e.description, from }))
          $.ui.toast(`model-guard: refused a ${labelOf(from)} subagent (${e.description})`)
          await showStatus($)
          return { deny: refusalOf(state, asked, to) }
        }
        await update($, guard, s => withEvent(s, { at, kind: 'swap', what: e.description, from, to: target?.key }))
        $.ui.toast(`model-guard: ${e.description}: ${labelOf(from)} → ${labelOf(target?.key ?? to)}`)
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
    if (target === null || target.ids[0] === undefined) {
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
    return yield* next({ ...e, model: target.ids[0] + splitSuffix(e.model).suffix })
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const state = await ensureReady($, legacy)
    const input = e as unknown as { script?: string; scriptPath?: string }
    let script = input.script ?? ''
    if (script === '' && typeof input.scriptPath === 'string') {
      try {
        const read = await $.fs.read(input.scriptPath)
        script = typeof read === 'string' ? read : ''
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
    return {
      ...result,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: `${labelOf(from)} is blocked. Allow it in /models first.`,
    }
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
