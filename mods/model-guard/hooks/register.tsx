/**
 * model-guard: choose the models allowed in this session.
 *
 * agent.spawn: a subagent asked for on a disallowed model is refused (or
 * swapped, by mode) before it starts.
 * turn.step: every subagent/workflow request still on a disallowed model
 * (an agent type that pins one, an engine fork) is swapped to the fallback.
 * tool.call Workflow: a script naming a disallowed model is refused.
 * classic.PreModelSwitch: /model to a disallowed model is refused.
 * /models: a pane to toggle families, pick the fallback and the mode, and
 * save the choice as this repo's default.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  cycledFallback,
  EMPTY_STATE,
  FAMILIES,
  fallbackOf,
  familyOf,
  idFor,
  isAllowed,
  parseFamilies,
  summaryOf,
  toggled,
  withEvent,
  withUse,
  workflowModels,
} from './families'
import type { Family, GuardState, Mode } from './families'
import { drawModels, textOf } from './view'

const PANE = 'models'
const guard = atom({ plugin: 'model-guard', key: 'guard' } as const, EMPTY_STATE)

type Options = { defaults: Family[]; fallback: Family; mode: Mode }

function optionsOf(raw: Readonly<Record<string, unknown>>): Options {
  const defaults = parseFamilies(String(raw.defaultAllowed ?? FAMILIES.join(',')))
  const [fallback] = parseFamilies(String(raw.fallback ?? 'opus'))
  return {
    defaults: defaults.length > 0 ? defaults : [...FAMILIES],
    fallback: fallback ?? 'opus',
    mode: raw.mode === 'swap' ? 'swap' : 'deny',
  }
}

const storeKeyOf = (root: string) => `repo:${root}`

/** Seeds the session's list from the repo's saved default, else the config. */
async function ensureReady($: EngineInterface, options: Options): Promise<GuardState> {
  const state = await read($, guard)
  if (state.isReady) {
    return state
  }
  let root: string | null = null
  try {
    root = (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
    root = null
  }
  let saved: Family[] | null = null
  let savedFallback: Family | undefined
  let savedMode: Mode | undefined
  if (root !== null) {
    try {
      // Saved as { allowed, fallback, mode }; a plain list in the first version.
      const value = await $.store.get(storeKeyOf(root))
      const record = Array.isArray(value) ? { allowed: value } : (value ?? {}) as { allowed?: unknown; fallback?: unknown; mode?: unknown }
      saved = Array.isArray(record.allowed) ? parseFamilies(record.allowed.map(String)) : null
      savedFallback = parseFamilies(String(record.fallback ?? ''))[0]
      savedMode = record.mode === 'swap' || record.mode === 'deny' ? record.mode : undefined
    } catch {
      saved = null
    }
  }
  const allowed = saved !== null && saved.length > 0 ? saved : options.defaults
  const seeded: GuardState = {
    ...EMPTY_STATE,
    isReady: true,
    allowed,
    mode: savedMode ?? options.mode,
    fallback: savedFallback ?? options.fallback,
    source: saved !== null && saved.length > 0 ? 'repo' : 'config',
    repoName: root === null ? null : (root.split('/').filter(Boolean).pop() ?? null),
    repoDefault: saved,
  }
  await update($, guard, s => (s.isReady ? s : { ...seeded, fallback: fallbackOf(seeded) ?? seeded.fallback }))
  return read($, guard)
}

/** Saves the session's choice (models, fallback, mode) as this repo's default. */
async function saveForRepo($: EngineInterface): Promise<string> {
  const state = await read($, guard)
  const root = (await $.session.repo())?.root ?? (await $.session.cwd())
  await $.store.set(storeKeyOf(root), { allowed: state.allowed, fallback: state.fallback, mode: state.mode })
  await update($, guard, s => ({ ...s, source: 'repo' as const, repoDefault: s.allowed }))
  return `Saved ${state.allowed.join(', ')} as the default for ${state.repoName ?? root}.`
}

/**
 * Saves the session's choice for every repo without its own: the plugin's
 * settings rows (settings.json pluginConfigs), the ones /plugin configure edits.
 */
async function saveAsDefault($: EngineInterface): Promise<string> {
  const state = await read($, guard)
  const rows: { key: string; value: string }[] = [{ key: 'model-guard.defaultAllowed', value: state.allowed.join(',') }, { key: 'model-guard.mode', value: state.mode }]
  if (state.fallback && ['opus', 'sonnet', 'fable', 'haiku'].includes(state.fallback)) rows.push({ key: 'model-guard.fallback', value: state.fallback })
  const refused: string[] = []
  for (const row of rows) {
    try {
      const set = await $.config.set(row)
      if (set.deny !== undefined) refused.push(`${row.key}: ${set.deny}`)
    } catch (error) {
      refused.push(`${row.key}: ${String(error)}`)
    }
  }
  if (refused.length) return `Not saved as the global default: ${refused.join('; ')}`
  return `Saved ${state.allowed.join(', ')} (fallback ${state.fallback ?? 'none'}, explicit asks: ${state.mode}) as the default for every repo without its own saved choice. Repos saved with /models save keep theirs.`
}

/** Back to the repo's saved choice, else the global default. */
async function resetChoice($: EngineInterface, options: Options): Promise<string> {
  const before = await read($, guard)
  await update($, guard, s => ({ ...s, isReady: false }))
  const seeded = await ensureReady($, options)
  // Only the choice goes back; what happened this session (the counts, the log) stays.
  await update($, guard, () => ({ ...before, allowed: seeded.allowed, fallback: seeded.fallback, mode: seeded.mode, source: seeded.source, repoDefault: seeded.repoDefault, isReady: true }))
  return textOf(await read($, guard))
}

async function showStatus($: EngineInterface): Promise<void> {
  const state = await read($, guard)
  const hasNews = state.recent.length > 0
  $.ui.status(hasNews ? `model-guard: ${summaryOf(state)}` : undefined)
}

export const register: Register = (on, rawOptions) => {
  const options = optionsOf(rawOptions)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'models',
      description: 'Choose which models this session may use (model-guard)',
      argumentHint: '[opus,sonnet,fable,… | save | default | reset]',
    })
    await ensureReady($, options)
    return next(e)
  })

  // /clear resets $.state: seed again from the repo default.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await ensureReady($, options)
    return result
  })

  on('command.run', { command: 'models' }, async ($, e) => {
    await ensureReady($, options)
    const arg = (e.args ?? '').trim().toLowerCase()

    if (arg === 'save') return { text: await saveForRepo($) }
    if (arg === 'default') return { text: await saveAsDefault($) }
    if (arg === 'reset') return { text: await resetChoice($, options) }
    if (arg !== '') {
      const chosen = parseFamilies(arg)
      if (chosen.length === 0) {
        return { text: `No model family in "${arg}". Use any of: opus, sonnet, haiku, fable, other.` }
      }
      await update($, guard, s => ({ ...s, allowed: chosen, source: 'session' as const, fallback: fallbackOf({ allowed: chosen, fallback: s.fallback }) ?? s.fallback }))
      return { text: textOf(await read($, guard)) }
    }

    try {
      // Where nothing draws (cloud, VS Code, -p) the text answer below is the view.
      await $.ui.open({ id: PANE, title: 'Models', rows: 12 })
    } catch {
      // fall through to the text answer
    }
    return { text: textOf(await read($, guard)) }
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork) {
      return next(e)
    }
    const state = await ensureReady($, options)
    const asked = e.model
    let spawn = e

    if (asked !== undefined && !isAllowed(state, asked)) {
      const from = familyOf(asked)
      const to = fallbackOf(state)
      const at = await $.clock.now()
      if (state.mode === 'deny' || to === null) {
        await update($, guard, s => withEvent(s, { at, kind: 'deny', what: e.description, from }))
        $.ui.toast(`model-guard: refused a ${from} subagent (${e.description})`)
        await showStatus($)
        return {
          deny: `model-guard: ${from} is not allowed in this session (allowed: ${state.allowed.join(', ')}). Spawn the agent again with model "${to ?? state.allowed[0]}".`,
        }
      }
      await update($, guard, s => withEvent(s, { at, kind: 'swap', what: e.description, from, to }))
      $.ui.toast(`model-guard: ${e.description}: ${from} → ${to}`)
      spawn = { ...e, model: to }
    }

    const result = await next(spawn)
    if ('model' in result && typeof result.model === 'string') {
      const model = result.model
      await update($, guard, s => withUse(s, model))
    }
    await showStatus($)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const state = await read($, guard)
    if (!state.isReady || e.agentId === undefined || isAllowed(state, e.model)) {
      return yield* next(e)
    }
    const to = fallbackOf(state)
    const target = to === null ? null : idFor(to, state.seen)
    if (to === null || target === null) {
      return yield* next(e)
    }
    const loop = e.agentId
    if (!state.swappedLoops.includes(loop)) {
      const at = await $.clock.now()
      const from = familyOf(e.model)
      await update($, guard, s => ({ ...withEvent(s, { at, kind: 'swap', what: `agent ${loop.slice(0, 8)}`, from, to }), swappedLoops: [...s.swappedLoops, loop].slice(-50) }))
      $.ui.toast(`model-guard: a subagent's ${from} requests now go to ${to}`)
      await showStatus($)
    }
    return yield* next({ ...e, model: target })
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const state = await ensureReady($, options)
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
    const banned = [...new Set(workflowModels(script).filter(m => !isAllowed(state, m)))]
    if (banned.length === 0) {
      return next(e)
    }
    const at = await $.clock.now()
    for (const m of banned) {
      await update($, guard, s => withEvent(s, { at, kind: 'deny', what: 'Workflow', from: familyOf(m) }))
    }
    await showStatus($)
    return {
      deny: `model-guard: this workflow asks for ${banned.join(', ')}, which this session does not allow (allowed: ${state.allowed.join(', ')}). Use "${fallbackOf(state) ?? state.allowed[0]}" instead.`,
    }
  })

  on('classic.PreModelSwitch', async ($, e, next) => {
    const result = await next(e)
    const state = await ensureReady($, options)
    if (isAllowed(state, e.to_model)) {
      return result
    }
    const at = await $.clock.now()
    await update($, guard, s => withEvent(s, { at, kind: 'deny', what: '/model', from: familyOf(e.to_model) }))
    await showStatus($)
    return {
      ...result,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: `${familyOf(e.to_model)} is turned off for this session. Turn it on in /models first.`,
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
        toggle: family => void update($, guard, s => toggled(s, family)),
        cycleFallback: () => void update($, guard, s => cycledFallback(s)),
        cycleMode: () => void update($, guard, s => ({ ...s, mode: s.mode === 'deny' ? ('swap' as const) : ('deny' as const) })),
        // Called directly: $.command.run would skip this plugin's own command hook.
        save: () => void saveForRepo($).then(text => $.ui.toast(text)),
        reset: () => void resetChoice($, options).then(() => $.ui.toast('Back to the saved choice.')),
        saveDefault: () => void saveAsDefault($).then(text => $.ui.toast(text)),
        close: () => void $.ui.close({ id: PANE }),
      },
      now,
      columns,
    )
  })
}
