import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SAMPLE } from './logic.test'

const ROOT = '/Users/me/dev/web-app'
const TOOL = 'mcp__progress-pane__worklog'

type Fs = Map<string, { text: string; mtimeMs: number }>

/** An engine with an in-memory repo; Bash answers per command, `$.process.run` per argv. */
function engineOf(on: On, files: Record<string, string> = {}, bash: (command: string) => { ok: boolean; text?: string } = () => ({ ok: true }), proc: (argv: readonly string[]) => { exitCode: number; stdout: string } = () => ({ exitCode: 1, stdout: '' })) {
  const fs: Fs = new Map(Object.entries(files).map(([p, text]) => [p, { text, mtimeMs: 1 }]))
  let tick = 10
  const ran: string[] = []
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 61_000, window: 100_000, percent: 61 }, rateLimits: [], cost: { usd: 4.1 } } as never }))
  on('fs.list', ($, e) => {
    const dir = String((e as { path?: string }).path ?? '')
    const entries = [...fs.entries()].filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
    if (entries.length === 0) return { deny: 'no such folder' }
    return { value: entries.map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })) as never }
  })
  on('fs.read', ($, e) => {
    const f = fs.get(String((e as { path?: string }).path ?? ''))
    return f ? { value: f.text as never } : { deny: 'missing' }
  })
  on('fs.stat', ($, e) => {
    const f = fs.get(String((e as { path?: string }).path ?? ''))
    return f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } as never } : { deny: 'missing' }
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    tick += 1
    fs.set(path, { text, mtimeMs: tick })
    return { value: undefined } as never
  })
  on('process.run', ($, e) => ({ value: { ...proc(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.register', () => ({ value: { tool: TOOL } }) as never)
  on('command.register', () => ({ value: { command: 'progress' } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('prompt.fill', () => ({ value: { isFilled: true } }) as never)
  on('agent.spawn', ($, e) => ({ model: e.model ?? e.parentModel, agentId: 'agent-1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
  // What the engine draws when a hook yields the band with next(e).
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      const command = String((e as { command?: string }).command ?? '')
      ran.push(command)
      const r = bash(command)
      return r.ok ? { result: { stdout: r.text ?? '', stderr: '', interrupted: false } as never, text: r.text ?? '' } : { isError: true as const, result: 'failed' as never, text: r.text ?? 'exit 1' }
    }
    if (e.tool === 'Edit') {
      const { file_path, new_string } = e as unknown as { file_path: string; new_string: string }
      tick += 1
      fs.set(file_path, { text: new_string, mtimeMs: tick })
      return { result: 'edited' as never }
    }
    return { result: 'ok' as never }
  })
  /** A hand edit made outside any tool call (another editor, a script). */
  const handEdit = (path: string, change: (text: string) => string) => {
    tick += 1
    fs.set(path, { text: change(fs.get(path)?.text ?? ''), mtimeMs: tick })
  }
  return { fs, ran, clock, handEdit }
}

const start = (engine: { session: { start: (input: never) => Promise<unknown> } }) =>
  engine.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
const tool = (engine: { tool: { call: (input: never) => Promise<{ deny?: string; result?: unknown }> } }, input: Record<string, unknown>) =>
  engine.tool.call({ tool: TOOL, ...input } as never)
const progress = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, args = '') =>
  engine.command.run({ command: 'progress', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)

const PLAN = { op: 'start', title: 'Tier restructure', branch: 'claude/tiers', gate: 'npm run dod', phases: [{ title: 'API', steps: ['Drop tier', 'Migrate'] }, { title: 'UI', steps: ['Paywall copy'] }] }

describe('the worklog tool', () => {
  test('start writes plans/<date>-<slug>-worklog.md and returns the next steps', async ($, on) => {
    const { fs } = engineOf(on)
    await start($)
    const r = await tool($, PLAN)
    expect(String(r.result)).toContain('next: A1 Drop tier; A2 Migrate')
    const path = [...fs.keys()].find(p => p.endsWith('-tier-restructure-worklog.md'))
    expect(path).toContain(`${ROOT}/plans/`)
    expect(fs.get(path ?? '')?.text).toContain('## Phase A · API\n- [ ] A1 Drop tier')
  })

  test('done is refused until the gate passes after the step started', async ($, on) => {
    engineOf(on, {}, cmd => (cmd.includes('dod') ? { ok: true } : { ok: true }))
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    const early = await tool($, { op: 'step', id: 'A1', status: 'done', commit: 'abc1234' })
    expect(early.deny).toContain('not done until `npm run dod` passes')
    await $.tool.call({ tool: 'Bash', command: 'npm run dod 2>&1 | tail -20' } as never)
    const done = await tool($, { op: 'step', id: 'A1', status: 'done', commit: 'abc1234' })
    expect(String(done.result)).toContain('OK A1 → done')
  })

  test('a red gate keeps it refused', async ($, on) => {
    engineOf(on, {}, cmd => ({ ok: !cmd.includes('dod') }))
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    await $.tool.call({ tool: 'Bash', command: 'npm run dod' } as never)
    expect((await tool($, { op: 'step', id: 'A1', status: 'done' })).deny).toBeDefined()
  })

  test('a piped gate whose output shows a failure keeps done refused (the pipe hides the exit status)', async ($, on) => {
    engineOf(on, {}, cmd => (cmd.includes('dod') ? { ok: true, text: 'Tests:       1 failed, 61 passed, 62 total' } : { ok: true }))
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    await $.tool.call({ tool: 'Bash', command: 'npm run dod 2>&1 | tail -20' } as never)
    expect((await tool($, { op: 'step', id: 'A1', status: 'done' })).deny).toContain('its last run failed')
  })

  test('a gate named in an argument is not a gate run', async ($, on) => {
    engineOf(on)
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    await $.tool.call({ tool: 'Bash', command: 'echo "remember: npm run dod" && grep -rn "npm run dod" docs' } as never)
    expect((await tool($, { op: 'step', id: 'A1', status: 'done' })).deny).toContain('no green run seen')
  })

  test('a background gate counts on the model\'s claim only, and not after 30 min', async ($, on) => {
    const { fs, clock } = engineOf(on)
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    await $.tool.call({ tool: 'Bash', command: 'npm run dod', run_in_background: true } as never)
    expect((await tool($, { op: 'step', id: 'A1', status: 'done' })).deny).toContain('gateOk: true')
    await tool($, { op: 'step', id: 'A2', status: 'doing' })
    expect(String((await tool($, { op: 'step', id: 'A1', status: 'done', gateOk: true })).result)).toContain('OK A1 → done (background gate taken on your word')
    const path = [...fs.keys()].find(p => p.endsWith('-worklog.md')) ?? ''
    expect(fs.get(path)?.text).toContain("A1 done (gate green on the model's word: background run)")
    await clock.advance(31 * 60_000)
    expect((await tool($, { op: 'step', id: 'A2', status: 'done', gateOk: true })).deny).toContain('not done until')
  })

  test('two tool calls at once both land; a hand edit on disk is not overwritten', async ($, on) => {
    const { fs, handEdit } = engineOf(on)
    await start($)
    await tool($, PLAN)
    const path = [...fs.keys()].find(p => p.endsWith('-worklog.md')) ?? ''
    await Promise.all([tool($, { op: 'step', id: 'A1', status: 'doing' }), tool($, { op: 'step', id: 'B1', status: 'doing' }), tool($, { op: 'log', text: 'Ruling: x' })])
    let text = fs.get(path)?.text ?? ''
    expect(text).toContain('- [~] A1 Drop tier')
    expect(text).toContain('- [~] B1 Paywall copy')
    expect(text).toContain('Ruling: x')
    handEdit(path, t => t.replace('- [ ] A2 Migrate', '- [ ] A2 Migrate the rows'))
    await tool($, { op: 'step', id: 'A2', status: 'doing' })
    text = fs.get(path)?.text ?? ''
    expect(text).toContain('- [~] A2 Migrate the rows')
  })

  test('start with replace keeps the old worklog, paused', async ($, on) => {
    const { fs } = engineOf(on)
    await start($)
    await tool($, PLAN)
    const old = [...fs.keys()].find(p => p.endsWith('-worklog.md')) ?? ''
    expect(String((await tool($, { ...PLAN, replace: true })).result)).toContain('the old one is paused')
    expect(fs.get(old)?.text).toContain('status: paused')
    const fresh = [...fs.keys()].filter(p => p.endsWith('-worklog.md') && p !== old)
    expect(fresh).toHaveLength(1)
    expect(fs.get(fresh[0] ?? '')?.text).toContain('status: active')
  })

  test('subagents may read but not write', async ($, on) => {
    engineOf(on)
    await start($)
    await tool($, PLAN)
    expect((await tool($, { op: 'step', id: 'A1', status: 'doing', agentId: 'agent-1' })).deny).toContain('Only the lead agent')
    expect(String((await tool($, { op: 'show', agentId: 'agent-1' })).result)).toContain('0/3 done')
  })
})

describe('watching the session', () => {
  test('a worklog written by hand mid-session shows up without a restart', async ($, on) => {
    const { handEdit } = engineOf(on)
    await start($)
    expect((await progress($, 'text')).text).toContain('No active worklog')
    handEdit(`${ROOT}/plans/2026-10-05-hand-worklog.md`, () => SAMPLE)
    expect((await progress($, 'text')).text).toContain('A3 Seat count follows team membership')
  })

  test('an active worklog in plans/ is found at start; the band and the pane draw it', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/2026-09-28-team-billing-worklog.md`]: SAMPLE, [`${ROOT}/plans/old-worklog.md`]: SAMPLE.replace('status: active', 'status: done') })
    await start($)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const band = await $.ui.mount({ plugin: 'progress-pane', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 120 } as never })
      const drawn = JSON.stringify(await band.drawn())
      expect(drawn).toContain('2/6')
      expect(drawn).toContain('A3 Seat count follows team membership')
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'progress-pane', surface, component: 'Pane', requestId: 'progress', props: { bodyColumns: 48, placement: 'dock', scroll: { bodyRows: 20 } } as never })
      expect(await pane.find({ text: /NEEDS YOU/ })).toBeDefined()
      expect(await pane.find({ key: 'tab-log' })).toBeDefined()
      await pane.unmount()
    }
  })

  test('the pane switches to the log; the inline wide layout uses two columns', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { bodyColumns: 48, placement: 'dock', scroll: { bodyRows: 20 } } as never })
    await pane.press({ key: 'tab-log' })
    expect(await pane.find({ text: /Ruling: kept old subscription rows/ })).toBeDefined()
    await pane.press({ key: 'tab-overview' })
    await pane.unmount()
    const wide = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { bodyColumns: 110, placement: 'inline', scroll: { bodyRows: 12 } } as never })
    expect(await wide.find({ key: 'cols' })).toBeDefined()
  })

  test('a broken hand edit is reported back to Claude on the same result', async ($, on) => {
    const path = `${ROOT}/plans/a-worklog.md`
    engineOf(on, { [path]: SAMPLE })
    await start($)
    const r = await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'x', new_string: SAMPLE.replace('- [ ] B1', '* B1') } as never)
    const context = (r as { context?: string[] }).context ?? []
    expect(context.join(' ')).toContain('no longer follows WL1 (line 30')
  })

  test('agents link to steps by their description and fold into the step row', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    await $.agent.spawn({ prompt: 'x', description: 'A3 seat count', subagentType: 'general-purpose', model: 'opus', parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: { bodyColumns: 60, placement: 'dock', scroll: { bodyRows: 20 } } as never })
    const row = await pane.find({ text: /seat count.*opus/i })
    expect(row).toBeDefined()
  })

  test('commits and leftover dev servers are seen without the model saying so', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE }, cmd => (cmd.startsWith('git commit') ? { ok: true, text: '[claude/fc-a3 4e9d692] feat(a3): seat count\n 2 files changed' } : { ok: true }))
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat(a3): seat count"' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npx expo start --dev-client', run_in_background: true } as never)
    const text = (await progress($, 'text')).text ?? ''
    expect(text).toContain('last commit 4e9d692')
    expect(text).toContain('expo :8081 left running')
  })

  test('a docs-only commit needs no step; a code commit with no step doing is drift', async ($, on) => {
    const idle = SAMPLE.replace('- [~] A3', '- [ ] A3')
    const files = (argv: readonly string[]) => ({ exitCode: 0, stdout: argv.includes('4e9d692') ? '\ndocs/architecture.md\nplans/x-worklog.md\n' : 'src/app.ts\n' })
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: idle }, cmd => ({ ok: true, text: cmd.includes('docs') ? '[main 4e9d692] docs: notes' : '[main 1234567] feat: x' }), files)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "docs: notes"' } as never)
    expect((await progress($, 'text')).text).not.toContain('not linked')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' } as never)
    expect((await progress($, 'text')).text).toContain('commit 1234567 not linked to a step')
  })

  test('the contract joins the system prompt only while a worklog is active', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
    const mine = composed.sections.find(s => s.id === 'progress-pane')
    expect(mine?.text).toContain('Active worklog: plans/a-worklog.md')
    expect(mine?.scope).toBe('session')
  })

  test('/progress text is the long form; band off hides the band', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    const text = (await progress($, 'text')).text ?? ''
    expect(text).toContain('**Team billing** · 2/6 done')
    expect(text).toContain('**Needs you**')
    await progress($, 'band off')
    const band = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120 } as never })
    expect(JSON.stringify(await band.drawn())).not.toContain('2/6')
  })

  test('without a worklog nothing draws and /progress says how to start', async ($, on) => {
    engineOf(on)
    await start($)
    expect((await progress($)).text).toContain('/kickoff starts one')
  })
})

describe('clicking through', () => {
  const PANE_PROPS = { bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never
  const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 120 } as never

  test('the band\'s step opens its details; prev, next and back move through the plan', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const band = await $.ui.mount({ plugin: 'progress-pane', surface, component: 'AbovePrompt', props: BAND_PROPS })
      await band.press({ key: 'band-step' })
      await band.unmount()
      const pane = await $.ui.mount({ plugin: 'progress-pane', surface, component: 'Pane', requestId: 'progress', props: PANE_PROPS })
      expect(await pane.find({ text: /DETAILS/ })).toBeDefined()
      expect(await pane.find({ text: /A3 Seat count follows team membership/ })).toBeDefined()
      expect(await pane.find({ text: /step 3 of 7/ })).toBeDefined()
      await pane.press({ key: 'step-next' })
      expect(await pane.find({ text: /A4 Billing behind BILLING_ENFORCED/ })).toBeDefined()
      await pane.press({ key: 'step-prev' })
      await pane.press({ key: 'step-prev' })
      // A2: its commit, its note and the log lines that name it.
      expect(await pane.find({ text: /9e1d0aa/ })).toBeDefined()
      expect(await pane.find({ text: /2 review rounds/ })).toBeDefined()
      expect(await pane.find({ text: /backfill runs in one migration/ })).toBeDefined()
      await pane.press({ key: 'step-back' })
      expect(await pane.find({ key: 'phase-A' })).toBeDefined()
      await pane.unmount()
    }
  })

  test('the band\'s count opens the whole plan; phase headers fold and unfold', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    const band = await $.ui.mount({ plugin: 'progress-pane', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await band.press({ key: 'band-plan' })
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'desktop', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    // The current phase is open; the next one is folded until pressed.
    expect(await pane.find({ key: 'open-A3' })).toBeDefined()
    expect(await pane.find({ key: 'open-B1' })).toBeUndefined()
    await pane.press({ key: 'phase-B' })
    await pane.press({ key: 'phase-A' })
    expect(await pane.find({ key: 'open-B1' })).toBeDefined()
    expect(await pane.find({ key: 'open-A3' })).toBeUndefined()
    await pane.press({ key: 'open-B1' })
    expect(await pane.find({ text: /B1 Hide the billing tab for non-admins/ })).toBeDefined()
    expect(await pane.find({ text: /not started/ })).toBeDefined()
    await pane.press({ key: 'step-back' })
    expect(await pane.find({ key: 'phase-B' })).toBeDefined()
  })

  test('/progress plan and /progress <step> open those views; overview steps open too', async ($, on) => {
    engineOf(on, { [`${ROOT}/plans/a-worklog.md`]: SAMPLE })
    await start($)
    await progress($, 'a2')
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    expect(await pane.find({ text: /A2 Migrate subscriptions/ })).toBeDefined()
    await pane.press({ key: 'step-back' })
    await pane.press({ key: 'tab-overview' })
    await pane.press({ key: 'open-A3' })
    expect(await pane.find({ text: /DETAILS/ })).toBeDefined()
    await pane.press({ key: 'step-back' })
    expect(await pane.find({ key: 'tab-plan' })).toBeDefined()
    await progress($, 'plan')
    expect(await pane.find({ key: 'phase-A' })).toBeDefined()
  })
})

describe('answering from the pane', () => {
  const PANE_PROPS = { bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never
  const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 120 } as never
  const ASK = SAMPLE.replace('— options: per seat / per workspace', '— options: per seat / per workspace\n  why: B2 copy names the billing unit in 4 screens\n  blocks: B2\n  recommend: per seat')
  const FILE = `${ROOT}/plans/a-worklog.md`

  test('the band\'s ? opens the question with its context; an option answers it mid-turn', async ($, on) => {
    const { fs } = engineOf(on, { [FILE]: ASK })
    const sent: string[] = []
    on('prompt.submit', ($, e) => { sent.push(e.text); return { text: e.text } })
    on('turn.start', ($, e) => ({ turnId: e.turnId ?? 't1' }) as never)
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    const band = await $.ui.mount({ plugin: 'progress-pane', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await band.press({ key: 'band-needs-q' })
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'desktop', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    expect(await pane.find({ text: /B2 copy names the billing unit in 4 screens/ })).toBeDefined()
    expect(await pane.find({ text: /blocks B2/ })).toBeDefined()
    expect(await pane.find({ key: 'opt-D1-0' })).toBeDefined()
    await pane.press({ key: 'opt-D1-0' })
    // Resolved in the file at once…
    const text = fs.get(FILE)?.text ?? ''
    expect(text).not.toContain('[?] D1')
    expect(text).toContain('D1 resolved: per seat (answered in the progress pane)')
    // …and on Claude's next tool result, not as a new turn.
    const next = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` } as never) as { context?: string[] }
    expect((next.context ?? []).join('\n')).toContain('The user answered D1')
    expect(sent).toEqual([])
    expect(await pane.find({ text: /Claude has it/ })).toBeDefined()
  })

  test('with no turn running, a typed answer is sent as a message', async ($, on) => {
    engineOf(on, { [FILE]: ASK })
    const sent: string[] = []
    on('prompt.submit', ($, e) => { sent.push(e.text); return { text: e.text } })
    await start($)
    await progress($)
    const pane = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    await pane.press({ key: 'tab-needs' })
    await pane.input({ key: 'ans-A4', text: 'Added the key to .env.local, carry on' })
    expect(sent.join('\n')).toContain('The user answered A4')
    expect(sent.join('\n')).toContain('Added the key to .env.local, carry on')
  })

  test('on desktop the sections are labels, not rows of ─ that wrap', async ($, on) => {
    engineOf(on, { [FILE]: ASK })
    await start($)
    await progress($)
    const desk = await $.ui.mount({ plugin: 'progress-pane', surface: 'desktop', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    // The meter stays (10 cells); a section rule would be a much longer run.
    expect(JSON.stringify(await desk.drawn())).not.toContain('─'.repeat(12))
    const term = await $.ui.mount({ plugin: 'progress-pane', surface: 'terminal', component: 'Pane', requestId: 'progress', props: PANE_PROPS })
    expect(JSON.stringify(await term.drawn())).toContain('─'.repeat(12))
  })
})
