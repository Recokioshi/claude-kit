import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'

import { engineOf, ONLY_OPUS_48, run, seedList, seedPolicy, spawnOf, spawnWith, stepOn } from './harness'

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
    await stepOn($, 'claude-opus-5-5', 'agent-explore')
    await stepOn($, 'claude-opus-5-5')
    expect(steps).toEqual(['claude-opus-4-8', 'claude-opus-4-8', 'claude-opus-5-5'])
    expect(toasts.filter(t => t.includes('opus 5.5 requests now go to opus 4.8')).length).toBe(1)
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

describe('enforcement: the paths around a spawn', () => {
  const ready = (on: On, mode: 'deny' | 'swap' = 'deny', files?: Record<string, string>) => {
    const engine = engineOf(on, { files })
    seedList(engine.store)
    seedPolicy(engine.store, { ...ONLY_OPUS_48, mode })
    return engine
  }

  test('a fork runs on its parent\'s model, untouched', async ($, on) => {
    const { spawned } = ready(on)
    const r = await $.agent.spawn(spawnWith({ model: 'claude-opus-5', fork: true }))
    expect('deny' in r).toBe(false)
    expect(spawned).toEqual(['claude-opus-5'])
  })

  test('a workflow\'s agent is refused or let through, never rewritten (the engine takes only a deny there)', async ($, on) => {
    const { spawned, toasts } = ready(on, 'swap')
    const workflow = { runId: 'wf_1' }
    await $.agent.spawn(spawnWith({ model: 'claude-opus-5', workflow }))
    await $.agent.spawn(spawnWith({ model: 'opus', workflow }))
    expect(spawned).toEqual(['claude-opus-5', 'opus'])
    expect(toasts.filter(t => t.includes('→'))).toEqual([])
  })

  test('a workflow\'s agent on a blocked version is refused in deny mode', async ($, on) => {
    const { spawned } = ready(on)
    const r = await $.agent.spawn(spawnWith({ model: 'claude-opus-5', workflow: { runId: 'wf_1' } }))
    expect('deny' in r && r.deny).toContain('opus 5 is blocked')
    expect(spawned).toEqual([])
  })

  test('swap mode says what it did', async ($, on) => {
    const { toasts } = ready(on, 'swap')
    await $.agent.spawn(spawnOf('claude-opus-5', 'lint fixes'))
    expect(toasts.at(-1)).toBe('model-guard: lint fixes: opus 5 → opus 4.8')
  })

  test('a workflow is read from its scriptPath, which the engine runs over script', async ($, on) => {
    ready(on, 'deny', { '/tmp/wf.js': "agent('x', { model: 'claude-opus-5' })" })
    const r = await $.tool.call({ tool: 'Workflow', script: "agent('x', { model: 'opus' })", scriptPath: '/tmp/wf.js' } as never)
    expect('deny' in r && r.deny).toContain('asks for claude-opus-5')
  })

  test('an unreadable scriptPath falls back to the script, and says so', async ($, on) => {
    const { statuses } = ready(on)
    const r = await $.tool.call({ tool: 'Workflow', script: "agent('x', { model: 'opus' })", scriptPath: '/tmp/missing.js' } as never)
    expect('deny' in r).toBe(false)
    expect(statuses.some(s => s?.includes('workflow script unreadable'))).toBe(true)
  })

  test('a rewrite speaks to the parent\'s provider when the list has that spelling', async ($, on) => {
    const { spawned, store } = ready(on)
    const { catalog } = Hooks.mergeCatalog(Hooks.parseCatalog(store.get('catalog')), [{ id: 'us.anthropic.claude-opus-4-8-v1:0', source: 'seen' }], 1)
    store.set('catalog', catalog)
    await $.agent.spawn(spawnWith({ model: 'opus', parentModel: 'us.anthropic.claude-opus-5-5-v1:0' }))
    await $.agent.spawn(spawnOf('opus'))
    expect(spawned).toEqual(['us.anthropic.claude-opus-4-8-v1:0', 'claude-opus-4-8'])
  })

  test('a 1M suffix rides to a version of the same family only', async ($, on) => {
    const { steps, store } = engineOf(on)
    seedList(store, ['claude-opus-5', 'claude-sonnet-5-5'])
    seedPolicy(store, { versions: { 'opus-5': 'block' } })
    await run($)
    await stepOn($, 'claude-opus-5[1m]', 'agent-1')
    expect(steps).toEqual(['claude-sonnet-5-5'])
  })

  test('/model to a blocked version names the allowed one to pick', async ($, on) => {
    ready(on)
    const r = await $.classic.PreModelSwitch({ from_model: 'claude-opus-4-8', to_model: 'claude-opus-5', requested_model: null, source: 'command', context_tokens: 0 } as never)
    expect((r as { permissionDecisionReason?: string }).permissionDecisionReason).toBe('opus 5 is blocked. opus 4.8 (claude-opus-4-8) is allowed; change it in /models.')
  })
})

describe('enforcement: a check that fails', () => {
  test('a spawn whose check throws is let through, and the status line says so', async ($, on) => {
    const { spawned, statuses, store } = engineOf(on)
    seedList(store)
    seedPolicy(store, ONLY_OPUS_48)
    // No parent model: the alias rewrite cannot pick a spelling, and the check throws.
    await $.agent.spawn(spawnWith({ model: 'opus', parentModel: undefined }))
    expect(spawned).toEqual(['opus'])
    expect(statuses.some(s => s?.includes('a check failed and was let through'))).toBe(true)
  })

  test('a request whose check throws goes on, and the status line says so', async ($, on) => {
    const { steps, statuses, store } = engineOf(on)
    seedList(store)
    await run($)
    await stepOn($, undefined as never)
    expect(steps).toEqual([undefined])
    expect(statuses.some(s => s?.includes('a check failed and was let through'))).toBe(true)
  })
})
