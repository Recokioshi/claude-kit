import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'

function engineOf(on: On) {
  const spawned: (string | undefined)[] = []
  const steps: string[] = []
  const toasts: string[] = []
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/Users/me/dev/web-app' }))
  on('session.repo', () => ({ value: { root: '/Users/me/dev/web-app', remote: null, internal: false, name: null } }))
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
  on('tool.call', () => ({ result: 'ran' as never }))
  return { spawned, steps, toasts }
}

/** The restrictive choice the enforcement tests run under: only opus and fable on. */
const OPUS_FABLE = { options: { defaultAllowed: 'opus,fable' } }

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

describe('families', () => {
  test('familyOf reads ids and aliases', () => {
    expect(Hooks.familyOf('claude-opus-5-5')).toBe('opus')
    expect(Hooks.familyOf('haiku')).toBe('haiku')
    expect(Hooks.familyOf('claude-fable-5-1')).toBe('fable')
    expect(Hooks.familyOf('gpt-6.1-sol')).toBe('other')
  })
  test('the list is never left empty', () => {
    const one = { ...Hooks.EMPTY_STATE, allowed: ['opus' as const] }
    expect(Hooks.toggled(one, 'opus').allowed).toEqual(['opus'])
  })
  test('turning off the fallback moves it to the best allowed family', () => {
    const s = { ...Hooks.EMPTY_STATE, allowed: ['opus' as const, 'sonnet' as const], fallback: 'opus' as const }
    expect(Hooks.toggled(s, 'opus').fallback).toBe('sonnet')
  })
  test('workflow scripts are scanned for model names', () => {
    expect(Hooks.workflowModels(`agent(p, { model: 'haiku' }); agent(q, {model:"claude-opus-5-5"})`)).toEqual(['haiku', 'claude-opus-5-5'])
  })
})

describe('enforcement (opus + fable allowed, explicit asks refused)', () => {
  test('a subagent asked for on haiku is refused with the model to use', OPUS_FABLE, async ($, on) => {
    const { spawned } = engineOf(on)
    const r = await $.agent.spawn(spawnOf('haiku'))
    expect('deny' in r && r.deny).toContain('Spawn the agent again with model "opus"')
    expect(spawned).toEqual([])
  })

  test('opus and inherited spawns go through and are counted', OPUS_FABLE, async ($, on) => {
    const { spawned } = engineOf(on)
    await $.agent.spawn(spawnOf('opus'))
    await $.agent.spawn(spawnOf(undefined))
    expect(spawned).toEqual(['opus', undefined])
    expect((await run($)).text).toContain('Models allowed in this session: opus, fable')
  })

  test('an inherit spawn, step or workflow agent counts as the parent model, never as a disallowed one', OPUS_FABLE, async ($, on) => {
    const { spawned, steps } = engineOf(on)
    const r = await $.agent.spawn(spawnOf('inherit'))
    expect('deny' in r).toBe(false)
    expect(spawned).toEqual(['inherit'])
    await stepOn($, 'inherit', 'agent-x')
    expect(steps).toEqual(['inherit'])
    const w = await $.tool.call({ tool: 'Workflow', script: "agent('x', { model: 'inherit' })" } as never)
    expect('deny' in w).toBe(false)
    expect(Hooks.isAllowed({ allowed: ['opus'] }, 'inherit')).toBe(true)
    expect(Hooks.isAllowed({ allowed: ['opus'] }, 'other-model')).toBe(false)
  })

  test('swap mode runs the asked agent on the fallback', { options: { defaultAllowed: 'opus,fable', mode: 'swap' } }, async ($, on) => {
    const { spawned } = engineOf(on)
    await $.agent.spawn(spawnOf('sonnet'))
    expect(spawned).toEqual(['opus'])
  })

  test('a subagent request still on haiku is swapped; the main loop is left alone', OPUS_FABLE, async ($, on) => {
    const { steps } = engineOf(on)
    await run($)
    await stepOn($, 'claude-haiku-4-5-20251001', 'agent-explore')
    await stepOn($, 'claude-haiku-4-5-20251001')
    expect(steps).toEqual(['claude-opus-5-5', 'claude-haiku-4-5-20251001'])
  })

  test('a workflow naming a disallowed model is refused before it starts', OPUS_FABLE, async ($, on) => {
    engineOf(on)
    const r = await $.tool.call({ tool: 'Workflow', script: "export const meta = {}; agent('x', { model: 'sonnet' })" } as never)
    expect('deny' in r && r.deny).toContain('asks for sonnet')
  })

  test('/model to a disallowed family is refused', OPUS_FABLE, async ($, on) => {
    engineOf(on)
    on('classic.PreModelSwitch', () => ({}))
    const r = await $.classic.PreModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-haiku-4-5-20251001', requested_model: 'haiku', source: 'command', context_tokens: 0 } as never)
    expect((r as { permissionDecision?: string }).permissionDecision).toBe('deny')
  })
})

describe('/models', () => {
  test('the pane\'s Save button really saves: models and fallback come back after a change', OPUS_FABLE, async ($, on) => {
    engineOf(on)
    await run($)
    const ui = await $.ui.mount({ plugin: 'model-guard', surface: 'desktop', component: 'Pane', requestId: 'models', props: { bodyColumns: 48 } as never })
    await ui.press({ key: 'toggle-sonnet' })
    await ui.press({ key: 'fallback' })
    await ui.press({ key: 'save' })
    await run($, 'fable')
    await ui.press({ key: 'reset' })
    const text = (await run($, '')).text ?? ''
    expect(text).toContain('opus, sonnet, fable')
    expect(text).toContain('sonnet')
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: sonnet')
  })
  test('default saves the choice for every repo, through the settings rows /plugin configure edits', async ($, on) => {
    engineOf(on)
    const written: Record<string, unknown> = {}
    on('config.set', ($, e) => { written[e.key] = e.value; return { value: e.value } })
    await run($, 'opus,sonnet,fable')
    const r = await run($, 'default')
    expect(r.text).toContain('as the global default for every repo without its own saved choice')
    expect(written['model-guard.defaultAllowed']).toBe('opus,sonnet,fable')
    expect(written['model-guard.mode']).toBe('deny')
    expect(written['model-guard.fallback']).toBe('opus')
  })
  test('the pane\'s global save writes the settings rows and the header then reads "global default"', async ($, on) => {
    const { toasts } = engineOf(on)
    const written: Record<string, unknown> = {}
    on('config.set', ($, e) => { written[e.key] = e.value; return { value: e.value } })
    await run($)
    const ui = await $.ui.mount({ plugin: 'model-guard', surface: 'desktop', component: 'Pane', requestId: 'models', props: { bodyColumns: 48 } as never })
    await ui.press({ key: 'toggle-haiku' })
    await ui.press({ key: 'mode' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('changed this session')
    await ui.press({ key: 'default' })
    expect(written['model-guard.defaultAllowed']).toBe('opus,sonnet,fable,other')
    expect(written['model-guard.mode']).toBe('swap')
    expect((await ui.find({ key: 'head' }))?.text).toContain('global default')
    expect(toasts.at(-1)).toContain('as the global default')
    expect(toasts.at(-1)).not.toContain('keeps its own saved choice')
  })
  test('a repo with its own saved choice keeps it after a global save, and the toast says so', async ($, on) => {
    const { toasts } = engineOf(on)
    on('config.set', ($, e) => ({ value: e.value }))
    await run($, 'opus')
    await run($, 'save')
    const ui = await $.ui.mount({ plugin: 'model-guard', surface: 'terminal', component: 'Pane', requestId: 'models', props: { bodyColumns: 48 } as never })
    await ui.press({ key: 'toggle-sonnet' })
    await ui.press({ key: 'default' })
    expect(toasts.at(-1)).toContain('web-app keeps its own saved choice')
    expect((await ui.find({ key: 'head' }))?.text).toContain('changed this session')
    await ui.press({ key: 'reset' })
    expect((await run($, '')).text).toContain('allowed in this session: opus (')
  })
  test('a refused settings row is reported and nothing claims success', async ($, on) => {
    engineOf(on)
    on('config.set', ($, e) => (e.key === 'model-guard.mode' ? { deny: 'managed by policy' } : { value: e.value }))
    const r = await run($, 'default')
    expect(r.text).toContain('Not saved as the global default: model-guard.mode: managed by policy')
  })
  test('a list sets the session, save keeps it for the repo, reset returns to it', async ($, on) => {
    engineOf(on)
    expect((await run($)).text).toContain('allowed in this session: opus, sonnet, haiku, fable, other (')
    expect((await run($, 'sonnet, opus')).text).toContain('allowed in this session: opus, sonnet')
    expect((await run($, 'save')).text).toContain('Saved opus, sonnet as the default for web-app')
    await run($, 'fable')
    expect((await run($, 'reset')).text).toContain('allowed in this session: opus, sonnet')
  })

  test('unknown words are explained', async ($, on) => {
    engineOf(on)
    expect((await run($, 'gpt')).text).toContain('No model family')
  })

  test('the pane toggles families and cycles the fallback on every surface', OPUS_FABLE, async ($, on) => {
    engineOf(on)
    await run($)
    for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
      const ui = await $.ui.mount({ plugin: 'model-guard', surface, component: 'Pane', requestId: 'models', props: { bodyColumns: 48 } as never })
      expect(await ui.find({ key: 'toggle-haiku' })).toBeDefined()
      expect(await ui.find({ key: 'close' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'model-guard', surface: 'terminal', component: 'Pane', requestId: 'models', props: { bodyColumns: 48 } as never })
    await ui.press({ key: 'toggle-sonnet' })
    expect((await run($, '')).text).toContain('opus, sonnet, fable')
    await ui.press({ key: 'fallback' })
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: sonnet')
    await ui.press({ key: 'toggle-sonnet' })
    await ui.press({ key: 'toggle-fable' })
    await ui.press({ key: 'toggle-opus' })
    expect((await run($, '')).text).toContain('allowed in this session: opus (')
  })
})
