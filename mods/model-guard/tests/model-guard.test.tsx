import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'
import type { Policy } from '../hooks/policy'

/** The real Models API ids (2026-10-08), newest first per family. */
const API_IDS = [
  'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5',
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929',
]

function engineOf(on: On) {
  const spawned: (string | undefined)[] = []
  const steps: string[] = []
  const toasts: string[] = []
  /** The shared store file, as every Claude Code process on the machine sees it. */
  const store = new Map<string, unknown>()
  mock.clock(on)
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.cwd', () => ({ value: '/Users/me/dev/web-app' }))
  on('session.repo', () => ({ value: { root: '/Users/me/dev/web-app', remote: null, internal: false, name: null } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: null }))
  on('command.register', () => ({ value: { command: 'models' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.spawn', ($, e) => {
    spawned.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `agent-${spawned.length}` }
  })
  on('turn.step', async function* ($, e) {
    steps.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null } as never
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: 'ran' as never }))
  return { spawned, steps, toasts, store }
}

type Store = Map<string, unknown>

/** The Models API list in the store, as a refresh in some instance left it. */
function seedList(store: Store, ids: readonly string[] = API_IDS) {
  const { catalog } = Hooks.mergeCatalog(Hooks.EMPTY_CATALOG, ids.map(id => ({ id, source: 'api' as const })), 0)
  store.set('catalog', { ...catalog, fetchedAt: 0 })
}

/** A list some instance saved (or this one, before the test looks). */
function seedPolicy(store: Store, policy: Partial<Policy>, key = 'policy:global') {
  store.set(key, { ...Hooks.DEFAULT_POLICY, ...policy })
}

const policyIn = (store: Store, key = 'policy:global') => store.get(key) as Policy

const spawnOf = (model?: string, description = 'A3 soft landing') =>
  ({ prompt: 'do it', description, subagentType: 'general-purpose', model, parentModel: 'claude-opus-5-5', background: true, fork: false }) as never

const run = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, args = '') =>
  engine.command.run({ command: 'models', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)

async function stepOn($: { turn: { step: (input: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, model: string, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3, agentId } as never)
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

const turnOf = ($: { turn: { start: (input: never) => Promise<unknown> } }) => $.turn.start({ text: 'next', turnId: 't2' } as never)

/** Opus 5.5 and 5 blocked: "allow 4.8, block 5" with the newer 5.5 blocked too. */
const ONLY_OPUS_48 = { versions: { 'opus-5.5': 'block' as const, 'opus-5': 'block' as const } }

describe('lists: migration and sharing', () => {
  test('0.2 settings seed the global list once: families off stay blocked', { options: { defaultAllowed: 'opus,fable' } }, async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    const text = (await run($)).text ?? ''
    expect(text).toContain('the global list')
    expect(text).toContain('blocked: sonnet (all), haiku (all), other families')
    const stored = policyIn(store)
    expect(stored.families).toEqual({ opus: 'allow', sonnet: 'block', haiku: 'block', fable: 'allow' })
    expect(stored.unnamedFamilies).toBe('block')
  })

  test('a 0.2 repo record becomes that repo\'s own list, written back in the new shape', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    store.set('repo:/Users/me/dev/web-app', { allowed: ['opus', 'sonnet'], fallback: 'sonnet', mode: 'swap' })
    expect((await run($)).text).toContain("web-app's own list")
    const stored = policyIn(store, 'repo:/Users/me/dev/web-app')
    expect(stored.families.haiku).toBe('block')
    expect(stored.fallback).toBe('sonnet')
    expect(stored.mode).toBe('swap')
  })

  test('a change made by another instance applies from this session\'s next turn', async ($, on) => {
    const { spawned, store } = engineOf(on)
    seedList(store)
    await run($)
    expect('deny' in (await $.agent.spawn(spawnOf('claude-opus-5')))).toBe(false)
    seedPolicy(store, ONLY_OPUS_48)
    await turnOf($)
    const r = await $.agent.spawn(spawnOf('claude-opus-5'))
    expect('deny' in r && r.deny).toContain('opus 5 is blocked')
    expect(spawned).toEqual(['claude-opus-5'])
  })

  test('/models repo copies the list for this repo; changes go there; /models global drops it', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'repo')).text).toContain('web-app now has its own list')
    await run($, 'sonnet')
    const repo = policyIn(store, 'repo:/Users/me/dev/web-app')
    const global = policyIn(store)
    expect(repo.families.opus).toBe('block')
    expect(global.families.opus).not.toBe('block')
    expect((await run($, 'global')).text).toContain('web-app uses the global list again')
    expect(store.get('repo:/Users/me/dev/web-app')).toBeUndefined()
  })
})

describe('enforcement per version (opus 5.5 and 5 blocked, 4.8 allowed)', () => {
  const ready = (on: On) => {
    const engine = engineOf(on)
    seedList(engine.store)
    seedPolicy(engine.store, ONLY_OPUS_48)
    return engine
  }

  test('an opus alias is pointed at the newest allowed opus before it starts', async ($, on) => {
    const { spawned } = ready(on)
    await $.agent.spawn(spawnOf('opus'))
    await $.agent.spawn(spawnOf('opus[1m]'))
    expect(spawned).toEqual(['claude-opus-4-8', 'claude-opus-4-8[1m]'])
  })

  test('an alias whose family blocks nothing is left to the host', async ($, on) => {
    const { spawned } = ready(on)
    await $.agent.spawn(spawnOf('sonnet'))
    await $.agent.spawn(spawnOf(undefined))
    await $.agent.spawn(spawnOf('inherit'))
    expect(spawned).toEqual(['sonnet', undefined, 'inherit'])
  })

  test('every spelling of a blocked version is refused, with the model to use', async ($, on) => {
    const { spawned } = ready(on)
    for (const id of ['claude-opus-5', 'claude-opus-5-20260901', 'claude-opus-5[1m]', 'us.anthropic.claude-opus-5-v1:0']) {
      const r = await $.agent.spawn(spawnOf(id))
      expect('deny' in r && r.deny).toContain('Spawn the agent again with model "claude-opus-4-8"')
    }
    expect(spawned).toEqual([])
  })

  test('swap mode runs a blocked version on the newest allowed one of its family', async ($, on) => {
    const { spawned, store } = engineOf(on)
    seedList(store)
    seedPolicy(store, { ...ONLY_OPUS_48, mode: 'swap' })
    await $.agent.spawn(spawnOf('claude-opus-5-5'))
    expect(spawned).toEqual(['claude-opus-4-8'])
  })

  test('a subagent request still on a blocked version is swapped in its family; the main loop is left alone', async ($, on) => {
    const { steps, toasts } = ready(on)
    await run($)
    await stepOn($, 'claude-opus-5-5', 'agent-explore')
    await stepOn($, 'claude-opus-5-5')
    expect(steps).toEqual(['claude-opus-4-8', 'claude-opus-5-5'])
    expect(toasts.some(t => t.includes('opus 5.5 requests now go to opus 4.8'))).toBe(true)
  })

  test('a workflow naming a blocked version is refused; an alias with an allowed version passes', async ($, on) => {
    ready(on)
    const r = await $.tool.call({ tool: 'Workflow', script: "agent('x', { model: 'claude-opus-5' })" } as never)
    expect('deny' in r && r.deny).toContain('asks for claude-opus-5')
    const ok = await $.tool.call({ tool: 'Workflow', script: "agent('x', { model: 'opus' })" } as never)
    expect('deny' in ok).toBe(false)
  })

  test('/model to a blocked version is refused, to an allowed one goes through', async ($, on) => {
    ready(on)
    on('classic.PreModelSwitch', () => ({}))
    const switchTo = (to: string) => $.classic.PreModelSwitch({ from_model: 'claude-opus-4-8', to_model: to, requested_model: null, source: 'command', context_tokens: 0 } as never)
    expect(((await switchTo('claude-opus-5')) as { permissionDecision?: string }).permissionDecision).toBe('deny')
    expect(((await switchTo('claude-sonnet-5-5')) as { permissionDecision?: string }).permissionDecision).toBeUndefined()
  })

  test('spawns are counted per version', async ($, on) => {
    ready(on)
    await $.agent.spawn(spawnOf('opus'))
    await $.agent.spawn(spawnOf('opus'))
    expect((await run($)).text).toContain('4.8 ✓')
  })
})

describe('/models pane', () => {
  const mount = ($: { ui: { mount: (input: never) => Promise<unknown> } }, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' = 'terminal') =>
    $.ui.mount({ plugin: 'model-guard', surface, component: 'Pane', requestId: 'models', props: { bodyColumns: 60 } } as never) as Promise<{
      press: (q: { key: string }) => Promise<void>
      find: (q: { key: string }) => Promise<{ text?: string } | undefined>
      unmount: () => Promise<void>
    }>

  test('the newest version of each family and every ruled one are on show; the rest are behind "more"', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    seedPolicy(store, { versions: { 'opus-5': 'block' } })
    await run($)
    const ui = await mount($)
    for (const key of ['opus-5.5', 'opus-5', 'sonnet-5.5', 'haiku-5.5', 'fable-5.1']) {
      expect(await ui.find({ key: `toggle-${key}` })).toBeDefined()
    }
    expect(await ui.find({ key: 'toggle-opus-4.8' })).toBeUndefined()
    expect((await ui.find({ key: 'more' }))?.text).toContain('9 older versions')
    await ui.press({ key: 'more' })
    expect(await ui.find({ key: 'toggle-opus-4.8' })).toBeDefined()
  })

  test('a toggle saves at once to the global list; the last allowed model can\'t be blocked', async ($, on) => {
    const { toasts, store } = engineOf(on)
    seedList(store, ['claude-opus-5', 'claude-opus-4-8'])
    await run($)
    const ui = await mount($)
    await ui.press({ key: 'toggle-opus-5' })
    expect((policyIn(store)).versions['opus-5']).toBe('block')
    await ui.press({ key: 'more' })
    await ui.press({ key: 'toggle-opus-4.8' })
    expect((policyIn(store)).versions['opus-4.8']).toBeUndefined()
    expect(toasts.at(-1)).toContain('Something must stay allowed')
  })

  test('fallback, mode and the repo list from the pane, on every surface', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'toggle-opus-5.5' })).toBeDefined()
      expect(await ui.find({ key: 'close' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await mount($)
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: opus 5.5')
    await ui.press({ key: 'fallback' })
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: sonnet 5.5')
    await ui.press({ key: 'mode' })
    expect((policyIn(store)).mode).toBe('swap')
    await ui.press({ key: 'repo' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('web-app list')
    await ui.press({ key: 'repo' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('global')
  })

  test('the 0.2 family list form still works, and unknown words are explained', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'opus, sonnet')).text).toContain('blocked: haiku (all), fable (all), other families')
    expect((await run($, 'gpt')).text).toContain('No model family in "gpt"')
  })
})
