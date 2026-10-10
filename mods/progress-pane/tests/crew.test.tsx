import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'
import { SAMPLE } from './logic.test'

const ROOT = '/Users/me/dev/web-app'
const TOOL = 'mcp__progress-pane__worklog'
const OPUS = 'claude-opus-5-5'
const USAGE = { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 4_000 }

const spawnOf = (id: string, description: string, at = 0) => ({ id, description, step: null, subagentType: 'general-purpose', model: OPUS, at })

describe('prices and names', () => {
  test('cost follows the model table: Opus 5.5, Fable 5.1, Haiku 5.5, and older Opus', () => {
    // 2k in × $4 + 1k out × $20 + 10k read × $0.20 + 4k write × $5, per million
    expect(Math.abs(Hooks.costOf(OPUS, USAGE) - (2_000 * 4 + 1_000 * 20 + 10_000 * 0.2 + 4_000 * 5) / 1e6) < 1e-12).toBe(true)
    expect(Hooks.priceOf('claude-fable-5-1')).toEqual([10, 50, 0.25, 12.5])
    expect(Hooks.priceOf('claude-haiku-5-5')[0]).toBe(0.1)
    expect(Hooks.priceOf('claude-opus-4-8')).toEqual([5, 25, 0.5, 6.25])
    expect(Hooks.priceOf('something-else')).toEqual(Hooks.priceOf(OPUS))
  })

  test('windows, tokens and the short forms', () => {
    expect(Hooks.windowOf('claude-haiku-4-5')).toBe(200_000)
    expect(Hooks.windowOf(OPUS)).toBe(1_000_000)
    expect(Hooks.windowOf('claude-opus-4-6')).toBe(1_000_000)
    expect(Hooks.windowOf('claude-sonnet-4-5')).toBe(200_000)
    expect(Hooks.windowOf('claude-sonnet-4-20250514')).toBe(200_000)
    expect(Hooks.tokensOf(USAGE)).toBe(17_000)
    expect(Hooks.fmtTokens(412_300)).toBe('412k')
    expect(Hooks.fmtTokens(1_340_000)).toBe('1.3M')
    expect(Hooks.fmtCost(0.4234)).toBe('$0.42')
    expect(Hooks.modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(Hooks.modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
    expect(Hooks.modelName('claude-sonnet-5')).toBe('Sonnet 5')
    expect(Hooks.familyOf('haiku')).toBe('haiku')
    expect(Hooks.familyOf('gpt-x')).toBe('other')
  })

  test('effort: the named levels only; a number has no agreed level', () => {
    expect(Hooks.effortOf('xhigh')).toBe('xhigh')
    expect(Hooks.effortOf(7)).toBe('none')
    expect(Hooks.effortOf(undefined)).toBe('none')
  })

  test('Notebook tones follow the theme setting, with a mid-tone and no highlighter when it is unknown', () => {
    expect(Hooks.tonesOf('light-daltonized', undefined)).toEqual({ ink: '#2d55c4', highlighter: '#fff2a8', pen: '✎' })
    expect(Hooks.tonesOf('dark', '●')).toEqual({ ink: '#8db4f0', highlighter: '#3a3418', pen: '●' })
    expect(Hooks.tonesOf(undefined, undefined)).toEqual(Hooks.DEFAULT_TONES)
  })
})

describe('an agent row', () => {
  test('a row left by 0.2 in the session state reads with the new fields filled in', () => {
    const old = { id: 'a', description: 'A3 impl', step: 'A3', model: OPUS, startedAt: 0, status: 'running', tools: 3 } as unknown as Hooks.AgentRow
    const a = Hooks.normalizeAgent(old)
    expect(a).toMatchObject({ log: [], requests: 0, tokens: 0, costUsd: 0, round: 1, contextMax: 1_000_000, tools: 3 })
    expect(Hooks.poseOf(a, 1_000)).toBe('working')
    expect(Hooks.withTool(a, 'Edit x.ts', 5, false).log).toHaveLength(1)
  })

  test('a finished agent that works again was resumed: running, no end time', () => {
    const done = Hooks.withEnd(Hooks.newAgent([], spawnOf('a', 'x')), 'failed', 10, 'aborted')
    expect(done.endReason).toBe('aborted')
    const again = Hooks.withResume(done)
    expect(again.status).toBe('running')
    expect(again.endedAt).toBeUndefined()
    expect(again.endReason).toBeUndefined()
  })

  test('a second agent with the same description is round 2', () => {
    const first = Hooks.newAgent([], spawnOf('a', 'B3 review'))
    expect(first.round).toBe(1)
    expect(Hooks.newAgent([first], spawnOf('b', 'b3  Review')).round).toBe(2)
  })

  test('keeps every running agent and the newest finished ones', () => {
    let rows: Hooks.AgentRow[] = [Hooks.newAgent([], spawnOf('live', 'still going'))]
    for (let i = 0; i < 20; i++) rows = Hooks.addAgent(rows, Hooks.withEnd(Hooks.newAgent(rows, spawnOf(`x${i}`, `task ${i}`)), 'done', i))
    expect(rows.some(a => a.id === 'live')).toBe(true)
    expect(rows.filter(a => a.status === 'done')).toHaveLength(Hooks.FINISHED_CAP)
    expect(rows.some(a => a.id === 'x19')).toBe(true)
  })

  test('each request adds tokens and cost, sets the context fill, the model and the effort', () => {
    const a = Hooks.withUsage(Hooks.withUsage(Hooks.newAgent([], spawnOf('a', 'x')), OPUS, 'high', USAGE), OPUS, undefined, USAGE)
    expect(a.requests).toBe(2)
    expect(a.tokens).toBe(34_000)
    expect(a.contextTokens).toBe(17_000)
    expect(a.effort).toBe('high')
    expect(Math.abs(a.costUsd - 2 * Hooks.costOf(OPUS, USAGE)) < 1e-12).toBe(true)
    expect(Hooks.contextPercent(a)).toBe(2)
  })

  test('progress is clamped to its total and its note goes to the log', () => {
    const a = Hooks.withProgress(Hooks.newAgent([], spawnOf('a', 'x')), { done: 9, total: 4, note: 'writing tests' }, 5)
    expect(a.progress).toEqual({ done: 4, total: 4, note: 'writing tests', at: 5 })
    expect(a.log.at(-1)).toEqual({ at: 5, text: '4/4 writing tests', kind: 'note' })
    expect(Hooks.progressOf(a)).toBe(1)
    expect(Hooks.progressOf(Hooks.newAgent([], spawnOf('b', 'y')))).toBeNull()
  })

  test('the log keeps the newest lines; a quiet running agent rests', () => {
    let a = Hooks.newAgent([], spawnOf('a', 'x'))
    for (let i = 0; i < Hooks.LOG_CAP + 5; i++) a = Hooks.withTool(a, `Edit f${i}.ts`, i * 1000, i === 3)
    expect(a.log).toHaveLength(Hooks.LOG_CAP)
    expect(a.lastTool).toBe(`Edit f${Hooks.LOG_CAP + 4}.ts`)
    const last = a.log.at(-1)?.at ?? 0
    expect(Hooks.poseOf(a, last + 1_000)).toBe('working')
    expect(Hooks.poseOf(a, last + Hooks.RESTING_AFTER_MS + 1)).toBe('resting')
    expect(Hooks.poseOf(Hooks.withEnd(a, 'failed', last), last)).toBe('failed')
  })

  test('totals: count, running, tokens, cost and the span from first start to last end', () => {
    const a = Hooks.withEnd(Hooks.withUsage(Hooks.newAgent([], spawnOf('a', 'x', 0)), OPUS, 'low', USAGE), 'done', 60_000)
    const b = Hooks.newAgent([a], spawnOf('b', 'y', 30_000))
    const t = Hooks.totalsOf([a, b], 120_000)
    expect(t).toMatchObject({ count: 2, running: 1, done: 1, tokens: 17_000, spanMs: 120_000 })
    expect(Hooks.rosterOf([a, b]).map(r => r.id)).toEqual(['b', 'a'])
  })
})

/** An engine with one active worklog; records every blit. */
export function engineOf(on: On, modelOf: (description: string) => string = () => OPUS) {
  const path = `${ROOT}/plans/a-worklog.md`
  const blits: { key: string; cells: string }[] = []
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 61_000, window: 100_000, percent: 61 }, rateLimits: [], cost: { usd: 4.1 } } as never }))
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] as never }))
  on('fs.list', ($, e) => (String((e as { path?: string }).path) === `${ROOT}/plans` ? { value: [{ name: 'a-worklog.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] as never } : { deny: 'no such folder' }))
  on('fs.read', ($, e) => (String((e as { path?: string }).path) === path ? { value: SAMPLE as never } : { deny: 'missing' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('process.run', ($, e) => ({ value: { exitCode: e.argv.includes('--show-current') ? 0 : 1, stdout: e.argv.includes('--show-current') ? 'feature/seat-limits\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.register', () => ({ value: { tool: TOOL } }) as never)
  on('command.register', () => ({ value: { command: 'progress' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.blit', ($, e) => {
    const { key, cells } = e as unknown as { key: string; cells: string }
    blits.push({ key, cells })
    return { value: {} } as never
  })
  let spawned = 0
  on('agent.spawn', ($, e) => ({ model: modelOf(e.description), agentId: e.description.startsWith('B5') ? 'agent-2' : spawned++ === 0 ? 'agent-1' : `agent-${spawned + 1}` }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: { ...USAGE, model: e.model || OPUS } } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('tool.call', () => ({ result: 'ok' as never }))
  return { blits, clock }
}

export type Engine = { session: { start: (i: never) => Promise<unknown> }; agent: { spawn: (i: never) => Promise<unknown> }; turn: { step: (i: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } }; tool: { call: (i: never) => Promise<{ deny?: string; result?: unknown }> }; command: { run: (i: never) => Promise<{ text?: string }> } }

async function crewOf($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'x', description: 'B3 seat limits', subagentType: 'general-purpose', model: 'opus', parentModel: OPUS, background: true, fork: false } as never)
  const stream = $.turn.step({ turnId: 't', index: 0, model: OPUS, effort: 'xhigh', messageCount: 3, agentId: 'agent-1' } as never)
  for await (const _ of stream) void _
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/seats.ts`, old_string: 'a', new_string: 'b', agentId: 'agent-1' } as never)
}

export const paneOf = ($: { ui: { mount: (i: never) => Promise<{ find: (q: unknown) => Promise<unknown>; findAll: (q: unknown) => Promise<unknown[]>; drawn: () => Promise<unknown>; press: (q: unknown) => Promise<unknown> }> } }, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'progress-pane', surface, component: 'Pane', requestId: 'progress', props: { bodyColumns: 72, placement: 'dock', scroll: { bodyRows: 40 } } } as never)

describe('the crew, as the mod sees it', () => {
  test('a request adds the model, effort, tokens and cost; a tool call goes to the agent\'s log', async ($, on) => {
    engineOf(on)
    await crewOf($ as unknown as Engine)
    const text = (await $.command.run({ command: 'progress', args: 'agents', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)) as { text?: string }
    expect(text.text).toBe('')
    const pane = await paneOf($ as never)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('B3 seat limits')
    expect(drawn).toContain('Opus 5.5 · xhigh')
    expect(drawn).toContain('17k tokens')
    expect(drawn).toContain('Edit seats.ts')
  })

  test('a subagent reports its own progress; the lead cannot, and a subagent still cannot write the worklog', async ($, on) => {
    engineOf(on)
    await crewOf($ as unknown as Engine)
    const ok = await $.tool.call({ tool: TOOL, op: 'progress', done: 2, total: 5, note: 'guard wired', agentId: 'agent-1' } as never)
    expect(String(ok.result)).toBe('OK progress 2/5')
    const lead = await $.tool.call({ tool: TOOL, op: 'progress', done: 1 } as never)
    expect((lead as { text?: string }).text ?? lead.deny ?? '').toContain('the lead uses op step')
    const write = await $.tool.call({ tool: TOOL, op: 'step', id: 'A3', status: 'done', agentId: 'agent-1' } as never)
    expect((write as { text?: string }).text ?? write.deny ?? '').toContain('op "progress"')
    await $.command.run({ command: 'progress', args: 'agents', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    const drawn = JSON.stringify(await (await paneOf($ as never)).drawn())
    expect(drawn).toContain('"■■"')
    expect(drawn).toContain('"□□□"')
    expect(drawn).toContain('2/5 guard wired')
  })

  test('the terminal draws each companion as a Raster and the timer moves the working ones on, in place', async ($, on) => {
    const { blits, clock } = engineOf(on)
    await crewOf($ as unknown as Engine)
    await $.command.run({ command: 'progress', args: 'agents', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    const pane = await paneOf($ as never)
    expect(JSON.stringify(await pane.drawn())).toContain('"Raster"')
    await clock.advance(1_000)
    expect(blits.some(b => b.key === 'companion-agent-1' && b.cells.length > 0)).toBe(true)
  })

  test('desktop draws the companion as an Svg with an alt; an agent page shows its figures and log', async ($, on) => {
    engineOf(on)
    await crewOf($ as unknown as Engine)
    await $.command.run({ command: 'progress', args: 'agents', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    const desk = await paneOf($ as never, 'desktop')
    const drawn = JSON.stringify(await desk.drawn())
    expect(drawn).toContain('"Svg"')
    expect(drawn).not.toContain('"Raster"')
    await desk.press({ key: 'open-agent-agent-1' })
    const page = JSON.stringify(await (await paneOf($ as never)).drawn())
    expect(page).toContain('DETAILS')
    expect(page).toContain('17k over 1 request')
    expect(page).toContain('Edit seats.ts')
  })

  test('an agent\'s turn ending marks it done or failed, with the turn\'s own usage when no request was seen', async ($, on) => {
    engineOf(on)
    const e = $ as unknown as Engine & { turn: { complete: (i: never) => Promise<unknown> } }
    await crewOf(e)
    await e.agent.spawn({ prompt: 'x', description: 'B4 copy', subagentType: 'general-purpose', model: 'haiku', parentModel: OPUS, background: true, fork: false } as never)
    await e.turn.complete({ turnId: 'agent-1', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 5, isAborted: false } as never)
    await e.turn.complete({ turnId: 't3', agentId: 'agent-3', reason: 'error', answer: '', durationMs: 5, isAborted: false, usage: { ...USAGE, model: 'claude-haiku-5-5' } } as never)
    await $.command.run({ command: 'progress', args: 'agents', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    const drawn = JSON.stringify(await (await paneOf($ as never)).drawn())
    expect(drawn).toContain('1 failed')
    expect(drawn).toContain('stopped with an error')
    expect(drawn).toContain('took ')
    expect(drawn).toContain('Haiku 5.5')
  })

  test('the branch comes from git, for SIGNALS', async ($, on) => {
    const { clock } = engineOf(on)
    await crewOf($ as unknown as Engine)
    await clock.settle()
    await $.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
    expect(JSON.stringify(await (await paneOf($ as never)).drawn())).toContain('feature/seat-limits')
  })
})

