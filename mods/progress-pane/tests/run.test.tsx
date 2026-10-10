import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'
import { SAMPLE } from './logic.test'

const ROOT = '/Users/me/dev/web-app'
const PATH = `${ROOT}/plans/a-worklog.md`
const TOOL = 'mcp__progress-pane__worklog'
const OPUS = 'claude-opus-5-5'
const USAGE = { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 4_000 }

describe('run totals', () => {
  test('main and crew requests add up by kind, with cost and the model and effort main last ran with', () => {
    let r = Hooks.emptyRun('p')
    r = Hooks.withMainRequest(r, OPUS, 'xhigh', USAGE)
    r = Hooks.withMainRequest(r, OPUS, undefined, USAGE)
    r = Hooks.withAgentRequest(Hooks.withAgentSpawn(r), 'claude-haiku-5-5', USAGE)
    r = Hooks.withMainTurn(Hooks.withAgentRun(r, 60_000, true), 120_000)
    r = Hooks.withToolCall(Hooks.withToolCall(r, true), false)
    expect(r.main).toMatchObject({ requests: 2, input: 4_000, output: 2_000, cacheRead: 20_000, cacheWrite: 8_000, model: OPUS, effort: 'xhigh', turns: 1, workingMs: 120_000, tools: 1 })
    expect(r.agents).toMatchObject({ count: 1, requests: 1, failed: 1, workingMs: 60_000, tools: 1 })
    const t = Hooks.totalOf(r)
    expect(t.requests).toBe(3)
    expect(Hooks.tokensIn(t)).toBe(51_000)
    expect(Math.abs(t.costUsd - (2 * Hooks.costOf(OPUS, USAGE) + Hooks.costOf('claude-haiku-5-5', USAGE))) < 1e-12).toBe(true)
  })

  test('the lineup: each creature and accessory with how many ran, most first', () => {
    let r = Hooks.emptyRun('p')
    for (const [f, e] of [['opus', 'xhigh'], ['haiku', 'low'], ['opus', 'xhigh'], ['sonnet', 'medium']] as const) r = Hooks.withCrewMember(r, f, e)
    expect(Hooks.lineupOf(r)).toEqual([{ family: 'opus', effort: 'xhigh', count: 2 }, { family: 'sonnet', effort: 'medium', count: 1 }, { family: 'haiku', effort: 'low', count: 1 }])
  })

  test('decisions are the highest id asked; rulings are counted from the log', () => {
    const doc = Hooks.parseWorklog(SAMPLE).doc
    if (!doc) throw new Error('sample did not parse')
    const withLog = { ...doc, log: ['17:10 D3 resolved: per seat', '17:00 asked D3: x', '16:05 Ruling: kept old rows — reversible', ...doc.log] }
    // SAMPLE's D1 is still open: three asked, two resolved.
    expect(Hooks.decisionsOf(withLog)).toEqual({ asked: 3, resolved: 2 })
    expect(Hooks.rulingsOf(withLog)).toBe(2)
  })

  test('steps of a phase keyed D are not decisions', () => {
    const doc = Hooks.parseWorklog(SAMPLE.replace('## Phase B · UI', '## Phase D · Docs').replace('B1 Hide', 'D1 Hide').replace('B2 "Billing"', 'D2 "Billing"')).doc
    if (!doc) throw new Error('sample did not parse')
    const log = { ...doc, attention: [], log: ['18:00 D2 done: docs written', '17:50 D1 resolved: kept', '17:40 asked D1: which wording?'] }
    expect(Hooks.decisionsOf(log)).toEqual({ asked: 1, resolved: 1 })
  })

  test('a stored run is read field by field; garbage reads as zero, never as a crash', () => {
    expect(Hooks.parseRun(null, 'p')).toEqual(Hooks.emptyRun('p'))
    const r = Hooks.parseRun({ base: 'abc1234', main: { requests: 3, input: 'x', costUsd: -1, model: OPUS }, agents: { count: 2, crew: { 'opus/high': 2, 'bad key': 9, 'owl/x': -1 } }, git: null }, 'p')
    expect(r.main).toMatchObject({ requests: 3, input: 0, costUsd: 0, model: OPUS })
    expect(r.agents.crew).toEqual({ 'opus/high': 2 })
    expect(r.base).toBe('abc1234')
    expect(r.git).toBeNull()
    expect(Hooks.parseRun({}, 'p').git).toBeUndefined()
  })

  test('git outputs: name-status, shortstat, branches since the start, counts', () => {
    expect(Hooks.parseNameStatus('A\tsrc/a.ts\nM\tsrc/b.ts\nR087\told.ts\tnew.ts\nD\tsrc/c.ts\nA\tsrc/d.ts\n')).toEqual({ filesAdded: 2, filesEdited: 2, filesRemoved: 1 })
    expect(Hooks.parseShortstat(' 12 files changed, 2340 insertions(+), 610 deletions(-)\n')).toEqual({ linesAdded: 2340, linesRemoved: 610 })
    expect(Hooks.parseShortstat(' 1 file changed, 1 insertion(+)\n')).toEqual({ linesAdded: 1, linesRemoved: 0 })
    expect(Hooks.branchesSince('main 1000\nclaude/tb-a 5000\nclaude/tb-b 6000\n', 4_000_000)).toBe(2)
    expect(Hooks.countOf('14\n')).toBe(14)
    expect(Hooks.grouped(1234567)).toBe('1,234,567')
  })
})

/** An engine with the SAMPLE worklog (active or finished), a store in memory and git answering per argv. */
export function engineOf(on: On, opts: { status?: 'active' | 'done'; stored?: unknown } = {}) {
  const text = opts.status === 'done' ? SAMPLE.replace('status: active', 'status: done') : SAMPLE
  const store = new Map<string, unknown>(opts.stored ? [[`run:${PATH}`, opts.stored]] : [])
  const clock = mock.clock(on)
  const GIT: [RegExp, string][] = [
    [/branch --show-current/, 'claude/team-billing\n'],
    [/rev-parse --verify --quiet claude\/team-billing-gmozin$/, 'f00d\n'],
    [/rev-list --count --no-merges/, '14\n'],
    [/rev-list --count --merges/, '3\n'],
    [/diff --name-status/, 'A\ta.ts\nA\tb.ts\nM\tc.ts\nD\td.ts\n'],
    [/diff --shortstat/, ' 4 files changed, 2340 insertions(+), 610 deletions(-)\n'],
    [/for-each-ref/, 'master 1\nclaude/tb-a 9999999999\nclaude/tb-b 9999999999\n'],
    [/rev-parse HEAD/, 'abc1234\n'],
    [/rev-list --reverse --since=/, 'aaa1111\nbbb2222\n'],
    [/rev-parse --verify --quiet aaa1111\^/, 'parent0\n'],
  ]
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 61_000, window: 100_000, percent: 61 }, rateLimits: [], cost: { usd: 4.1 } } as never }))
  on('config.list', () => ({ value: [] as never }))
  on('store.get', ($, e) => ({ value: store.get(String((e as { key?: string }).key)) as never }))
  on('store.set', ($, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined } as never
  })
  on('fs.list', ($, e) => (String((e as { path?: string }).path) === `${ROOT}/plans` ? { value: [{ name: 'a-worklog.md', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] as never } : { deny: 'no such folder' }))
  on('fs.read', ($, e) => (String((e as { path?: string }).path) === PATH ? { value: text as never } : { deny: 'missing' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as never }))
  on('process.run', ($, e) => {
    const line = e.argv.join(' ')
    const hit = e.argv[0] === 'git' ? GIT.find(([re]) => re.test(line)) : undefined
    return { value: { exitCode: hit ? 0 : 1, stdout: hit?.[1] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', () => ({ value: { tool: TOOL } }) as never)
  on('command.register', () => ({ value: { command: 'progress' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: { ...USAGE, model: e.model || OPUS } } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('tool.call', () => ({ result: 'ok' as never }))
  return { store, clock }
}

export type E = {
  session: { start: (i: never) => Promise<unknown> }
  turn: { step: (i: never) => AsyncGenerator<unknown, unknown>; complete: (i: never) => Promise<unknown> }
  agent: { spawn: (i: never) => Promise<unknown> }
  command: { run: (i: never) => Promise<{ text?: string }> }
  ui: { mount: (i: never) => Promise<{ drawn: () => Promise<unknown> }> }
}

export const begin = (e: E) => e.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
export const step = async (e: E, agentId?: string, model = OPUS, effort = 'xhigh') => {
  for await (const _ of e.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 3, ...(agentId ? { agentId } : {}) } as never)) void _
}
/** A finished worklog is not picked up by itself (only an active one is): open it by path, as a person would. */
export const useDone = (e: E) => e.command.run({ command: 'progress', args: 'use plans/a-worklog.md', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
export const pane = async (e: E, surface: 'terminal' | 'desktop' = 'terminal') => {
  await e.command.run({ command: 'progress', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)
  return e.ui.mount({ plugin: 'progress-pane', surface, component: 'Pane', requestId: 'progress', props: { bodyColumns: 74, placement: 'dock', scroll: { bodyRows: 40 } } } as never)
}

describe('the main thread and the finished run, as drawn', () => {
  test('under the branch: the main thread\'s model, effort, tokens, cost and time worked; the totals reach the store at the turn\'s end', async ($, on) => {
    const { store } = engineOf(on)
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    await step(e)
    await e.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 125_000, isAborted: false } as never)
    const drawn = JSON.stringify(await (await pane(e)).drawn())
    expect(drawn).toContain('Opus 5.5 · xhigh · ')
    expect(drawn).toContain('34k tokens')
    expect(drawn).toContain('2m working')
    const saved = Hooks.parseRun(store.get(`run:${PATH}`), PATH)
    expect(saved.main).toMatchObject({ requests: 2, turns: 1, workingMs: 125_000 })
  })

  test('a run saved by an earlier session is picked up again', async ($, on) => {
    engineOf(on, { stored: { main: { requests: 40, input: 1_000_000, output: 200_000, cacheRead: 0, cacheWrite: 0, costUsd: 9, workingMs: 3_600_000, model: OPUS, effort: 'high' } } })
    const e = $ as unknown as E
    await begin(e)
    const drawn = JSON.stringify(await (await pane(e)).drawn())
    for (const part of ['Opus 5.5 · high · ', '1.2M tokens', ' · ≈$9.00', ' · 1h working']) expect(drawn).toContain(part)
  })

  test('a finished run gets the summary card: time worked, plan, crew, cost, tokens, git; then the plan recap', async ($, on) => {
    let r = Hooks.emptyRun(PATH)
    r = Hooks.withMainTurn(Hooks.withMainRequest(r, OPUS, 'xhigh', USAGE), 2 * 3_600_000)
    r = Hooks.withCrewMember(Hooks.withAgentRequest(Hooks.withAgentSpawn(r), 'claude-haiku-5-5', USAGE), 'haiku', 'low')
    r = Hooks.withAgentRun(r, 30 * 60_000, false)
    const { clock } = engineOf(on, { status: 'done', stored: r })
    const e = $ as unknown as E
    await begin(e)
    await useDone(e)
    await clock.settle()
    const view = await pane(e)
    const drawn = JSON.stringify(await view.drawn())
    expect(drawn).toContain('Finished · ')
    expect(drawn).toContain('2h30m')
    expect(drawn).toContain('main 2h + crew 30m')
    expect(drawn).toContain('1 subagent')
    expect(drawn).toContain('2 steps done')
    expect(drawn).toContain(' · 1 skipped · 4 left open · 2 phases')
    expect(drawn).toContain('cache read 20k')
    expect(drawn).toContain('14 commits')
    expect(drawn).toContain(' · 3 merges · 2 branches')
    expect(drawn).toContain('+2,340')
    expect(drawn).toContain('"round"')
    expect(drawn).toContain('"Raster"')
    expect(drawn).toContain('PLAN')
    // SAMPLE was finished with D1 and a blocker still open: they stay above the card.
    expect(drawn).toContain('NEEDS YOU')
  })

  test('on desktop the summary is labelled rows with the crew as Svgs; no border', async ($, on) => {
    const r = Hooks.withCrewMember(Hooks.withAgentSpawn(Hooks.withMainRequest(Hooks.emptyRun(PATH), OPUS, 'high', USAGE)), 'opus', 'high')
    const { clock } = engineOf(on, { status: 'done', stored: r })
    const e = $ as unknown as E
    await begin(e)
    await useDone(e)
    await clock.settle()
    const drawn = JSON.stringify(await (await pane(e, 'desktop')).drawn())
    expect(drawn).toContain('SUMMARY')
    expect(drawn).toContain('"Svg"')
    expect(drawn).not.toContain('"round"')
  })

  test('nothing is added once the worklog is no longer active', async ($, on) => {
    const { store } = engineOf(on, { status: 'done' })
    const e = $ as unknown as E
    await begin(e)
    await step(e)
    await e.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 5_000, isAborted: false } as never)
    expect(Hooks.parseRun(store.get(`run:${PATH}`), PATH).main.requests).toBe(0)
  })
})
