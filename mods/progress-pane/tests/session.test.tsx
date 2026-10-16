import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'
import type { ViewData } from '../hooks'
import { begin, engineOf, step } from './run.test'
import type { E } from './run.test'
import { notebookData } from './logic.test'

const OPUS = 'claude-opus-5-5'
const MIN = 60_000
const USAGE = { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 4_000 }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 120 } as never

/** A session with no worklog, as the drawings are handed it: an empty stand-in, the session's totals, no plan. */
function sessionData(over: Partial<ViewData> = {}): ViewData {
  const base = notebookData()
  return {
    ...base,
    doc: Hooks.ADHOC_DOC,
    path: '',
    isAdhoc: true,
    drift: [],
    run: Hooks.withMainRequest(Hooks.emptyRun(null), OPUS, 'xhigh', USAGE),
    ...over,
  }
}

const left = (d: ViewData, cols: number) => Hooks.bandSegments(d, cols).left.map(s => s.text).join('')

describe('a session band, with no worklog', () => {
  test('model, effort, tokens, context, agents, gate, last commit and time, with no plan count', () => {
    expect(left(sessionData(), 100)).toBe('✎ Opus 5.5 · xhigh · 17k tokens · ctx 61% · 2 agents · gate ✓ 4m · 9e1d0aa 2m · 3h12m')
  })

  test('as the terminal narrows: time, tokens, git, agents, gate and effort go; model and context stay', () => {
    expect(left(sessionData(), 70)).toBe('✎ Opus 5.5 · xhigh · ctx 61% · 2 agents · gate ✓ 4m · 9e1d0aa 2m')
    expect(left(sessionData(), 60)).toBe('✎ Opus 5.5 · xhigh · ctx 61% · 2 agents · gate ✓ 4m')
    const narrow = left(sessionData(), 30)
    expect(narrow).toBe('✎ Opus 5.5 · ctx 61%')
    expect(narrow.length + 3).toBeLessThanOrEqual(30)
  })

  test('context turns to a warning from 80%; a red gate is the health glyph', () => {
    const hot = sessionData({ facts: { ...notebookData().facts, context: { percent: 83 } } })
    expect(Hooks.bandSegments(hot, 100).left.find(s => s.key === 'ctx')).toMatchObject({ tone: 'warning' })
    const red = sessionData({ drift: [{ rule: 'D6', text: 'gate failed 1m ago', at: 1 }] })
    expect(Hooks.bandSegments(red, 100).left[0]).toMatchObject({ text: '✗ ', tone: 'error' })
  })

  test('only a red gate is drift; a commit is never unlinked from a step that does not exist', () => {
    const f = { ...Hooks.EMPTY_FACTS, commits: [{ at: 1, sha: 'abc1234', subject: 'x', stepAt: null }], gates: [{ at: 2, ok: false, command: 'npm test' }] }
    expect(Hooks.redGateOf(f, 3 * MIN)).toMatchObject({ rule: 'D6' })
    expect(Hooks.redGateOf({ ...f, gates: [{ at: 2, ok: true, command: 'npm test' }] }, 3 * MIN)).toBeNull()
  })

  test('a fresh session is quiet; a request, an agent, a gate or a commit is not', () => {
    const fresh = sessionData({ run: Hooks.emptyRun(null), facts: Hooks.EMPTY_FACTS })
    expect(Hooks.isQuiet(fresh)).toBe(true)
    expect(Hooks.isQuiet(sessionData({ facts: Hooks.EMPTY_FACTS }))).toBe(false)
    expect(Hooks.isQuiet(sessionData({ run: Hooks.emptyRun(null), facts: { ...Hooks.EMPTY_FACTS, gates: [{ at: 1, ok: true, command: 'npm test' }] } }))).toBe(false)
    expect(Hooks.isQuiet(notebookData())).toBe(false)
  })

  test('/progress text: the main thread and the agents, no plan', () => {
    const text = Hooks.textOf(sessionData())
    expect(text).toContain('**Session**')
    expect(text).toContain('- Opus 5.5 · xhigh · ctx 61%')
    expect(text).toContain('main 17k tokens')
    expect(text).toContain('**Agents**')
    expect(text).not.toContain('**Plan**')
  })
})

describe('a session with no worklog, in the engine', () => {
  test('a fresh session draws no band; after a request the band says what runs', async ($, on) => {
    engineOf(on, { status: 'none' })
    const e = $ as unknown as E
    await begin(e)
    const before = JSON.stringify(await (await e.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS } as never)).drawn())
    expect(before).not.toContain('Opus')
    await step(e)
    await e.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 5_000, isAborted: false } as never)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const drawn = JSON.stringify(await (await e.ui.mount({ plugin: 'progress-pane', surface, component: 'AbovePrompt', props: BAND_PROPS } as never)).drawn())
      for (const part of ['Opus 5.5', 'xhigh', '17k tokens', 'ctx 61%']) expect(drawn).toContain(part)
      expect(drawn).not.toContain('0/0')
    }
  })

  test('the band stays off after /progress band off', async ($, on) => {
    engineOf(on, { status: 'none' })
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    await e.command.run({ command: 'progress', args: 'band off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    const drawn = JSON.stringify(await (await e.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS } as never)).drawn())
    expect(drawn).not.toContain('Opus')
  })

  test('nothing is written for the session: no worklog contract in the prompt, no run in the store', async ($, on) => {
    const { store } = engineOf(on, { status: 'none' })
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    await e.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 5_000, isAborted: false } as never)
    expect([...store.keys()]).toEqual([])
    const composed = await (e as unknown as { prompt: { compose: (i: never) => Promise<{ sections: { id: string }[] }> } }).prompt.compose({} as never)
    expect(composed.sections.map(s => s.id)).not.toContain('progress-pane')
  })

  test('the pane is the Overview and the Agents tab: no plan, log, needs or file; the agents are listed', async ($, on) => {
    engineOf(on, { status: 'none' })
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    await e.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 125_000, isAborted: false } as never)
    await e.agent.spawn({ prompt: 'x', description: 'review the diff', subagentType: 'general-purpose', model: 'haiku', parentModel: OPUS, background: true, fork: false } as never)
    const p = await e.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    expect(p.text).toBe('')
    const pane = await e.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { bodyColumns: 74, placement: 'dock', scroll: { bodyRows: 40 } } } as never)
    const drawn = JSON.stringify(await pane.drawn())
    for (const part of ['Session', 'Opus 5.5 · xhigh · ', '17k tokens', 'AGENTS', 'review the diff', 'SIGNALS', 'tab-overview', 'tab-agents']) expect(drawn).toContain(part)
    for (const part of ['tab-plan', 'tab-log', 'tab-needs', '"key":"file"', 'PLAN']) expect(drawn).not.toContain(part)
  })

  test('/progress plan and a step id fall back to the session overview', async ($, on) => {
    engineOf(on, { status: 'none' })
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    for (const args of ['plan', 'B3']) {
      await e.command.run({ command: 'progress', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
      const pane = await e.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { bodyColumns: 74, placement: 'dock', scroll: { bodyRows: 40 } } } as never)
      const drawn = JSON.stringify(await pane.drawn())
      expect(drawn).toContain('SIGNALS')
      expect(drawn).not.toContain('PLAN ')
      await pane.unmount()
    }
  })
})
