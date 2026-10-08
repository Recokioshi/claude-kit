import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { engineOf, seedList, seedPolicy, spawnOf, run, stepOn, ONLY_OPUS_48 } from './harness'

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
