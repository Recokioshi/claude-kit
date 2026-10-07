import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'
import type { Facts, OpContext, Worklog } from '../hooks'

export const SAMPLE = `---
worklog: 1
title: Team billing
plan: plans/2026-09-27-team-billing-plan.md
branch: claude/team-billing-gmozin
gate: npm run dod
status: active
started: 2026-09-28T14:11Z
updated: 2026-09-28T16:40Z
---

Goal: everything in the plan except the marketing site, tested and reviewed.

## Rules
- Phase branch claude/fc-<id> cut from the integration branch; merged back --no-ff.
- No pushes, no PRs, no production deploy. Never git stash.

## Attention
- [?] D1 Bill per seat or per workspace? — options: per seat / per workspace
- [!] A4 Payment sandbox key missing in .env.local

## Phase A · API
- [x] A1 Drop the legacy plan column from the schema · 3f2a1bc
- [x] A2 Migrate subscriptions · 9e1d0aa — 2 review rounds
- [~] A3 Seat count follows team membership @impl-a3
- [!] A4 Billing behind BILLING_ENFORCED
- [-] A5 Legacy cleanup — not needed: no prod data

## Phase B · UI
- [ ] B1 Hide the billing tab for non-admins
- [ ] B2 "Billing" shows the current plan

## Notes
- Deploy follow-up for the user: set BILLING_ENFORCED on prod after review.

## Log
- 16:40 A2 done: backfill runs in one migration; dod ✓
- 16:05 Ruling: kept old subscription rows — reversible — cost if wrong: one cleanup migration
- 15:02 started phase A on claude/fc-a
`

const parsed = () => {
  const r = Hooks.parseWorklog(SAMPLE)
  if (!r.doc) throw new Error('sample did not parse')
  return r.doc
}

describe('WL1 parse and write', () => {
  test('the spec example parses with no errors', () => {
    const r = Hooks.parseWorklog(SAMPLE)
    expect(r.errors).toEqual([])
    expect(r.doc?.phases.map(p => p.key)).toEqual(['A', 'B'])
    const a3 = r.doc?.phases[0]?.steps[2]
    expect(a3).toEqual({ id: 'A3', title: 'Seat count follows team membership', status: 'doing', owner: 'impl-a3', sha: undefined, note: undefined })
    expect(r.doc?.phases[0]?.steps[1]?.note).toBe('2 review rounds')
    expect(r.doc?.attention).toHaveLength(2)
    expect(r.doc?.attention[0]).toEqual({ kind: 'decision', id: 'D1', text: 'Bill per seat or per workspace?', options: ['per seat', 'per workspace'] })
  })
  test('writing and reading back gives the same worklog', () => {
    const doc = parsed()
    expect(Hooks.parseWorklog(Hooks.serializeWorklog(doc)).doc).toEqual(doc)
  })
  test('numeric phases and numeric ids', () => {
    const r = Hooks.parseWorklog('---\nworklog: 1\ntitle: v2\nstatus: active\n---\n## Phase 6 · Baseline\n- [x] 6.1 G1 approve run 1\n- [ ] 6.2 run 1 = baseline\n')
    expect(r.errors).toEqual([])
    expect(r.doc?.phases[0]?.steps.map(s => s.id)).toEqual(['6.1', '6.2'])
  })
  test('errors name the line and say what is expected', () => {
    const bad = SAMPLE.replace('- [ ] B1 Hide', '* B1 Hide').replace('## Notes', '## Random').replace('- [x] A2', '- [x] A1')
    const errors = Hooks.parseWorklog(bad).errors.map(e => `${e.line}: ${e.message}`)
    expect(errors.some(e => /^30: steps are/.test(e))).toBe(true)
    expect(errors.some(e => /unknown section "Random"/.test(e))).toBe(true)
    expect(errors.some(e => /step A1 appears twice/.test(e))).toBe(true)
  })
  test('front matter is required', () => {
    expect(Hooks.parseWorklog('# Notes\n- [ ] A1 x').errors[0]?.message).toContain('front matter')
  })
  test('counts and the current phase', () => {
    const doc = parsed()
    expect(Hooks.counts(doc)).toEqual({ done: 2, total: 6 })
    expect(Hooks.currentPhase(doc)?.key).toBe('A')
  })
})

const ctx = (over: Partial<OpContext> = {}): OpContext => ({ now: 10_000_000, clock: '17:00', stamp: '2026-09-28T17:00Z', gates: [], startedAt: { A3: 9_000_000 }, ...over })
const run = (at: number, ok: boolean | null, background?: boolean) => ({ at, ok, command: 'npm run dod', ...(background ? { background } : {}) })

describe('worklog tool operations', () => {
  test('start builds ids from phase keys and never overwrites an active worklog', () => {
    const r = Hooks.applyOp(null, { op: 'start', title: 'Tier restructure', gate: 'npm run dod', phases: [{ title: 'API', steps: ['Drop tier', 'Migrate'] }, { key: '2', title: 'UI', steps: ['B9 Explicit id', 'Paywall'] }] }, ctx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.doc.phases.map(p => p.steps.map(s => s.id))).toEqual([['A1', 'A2'], ['B9', '2.2']])
      expect(Hooks.applyOp(r.doc, { op: 'start', title: 'x', phases: [{ title: 'y', steps: ['z'] }] }, ctx()).ok).toBe(false)
    }
  })
  test('done needs a green gate after the step started', () => {
    const doc = parsed()
    const early = Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done', commit: 'abc1234' }, ctx({ gates: [run(8_000_000, true)] }))
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.error).toContain('npm run dod')
    const green = Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done', commit: 'abc1234def' }, ctx({ gates: [run(9_500_000, true)] }))
    expect(green.ok).toBe(true)
    if (green.ok) {
      expect(green.doc.phases[0]?.steps[2]).toEqual({ id: 'A3', title: 'Seat count follows team membership', status: 'done', sha: 'abc1234def', owner: undefined, note: undefined })
      expect(green.doc.log[0]).toBe('17:00 A3 done · abc1234')
      expect(green.message).toContain('next: B1 Hide the billing tab')
    }
  })
  test('force with a reason is allowed and logged as a Ruling', () => {
    const r = Hooks.applyOp(parsed(), { op: 'step', id: 'A3', status: 'done', force: true, reason: 'docs-only change' }, ctx())
    expect(r.ok && r.doc.log[0]).toContain('Ruling: A3 done without a green gate — docs-only change')
  })
  test('the latest finished run decides: a green run followed by a red one is not green', () => {
    const doc = parsed()
    const red = Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done' }, ctx({ gates: [run(9_500_000, true), run(9_600_000, false)] }))
    expect(red.ok).toBe(false)
    if (!red.ok) expect(red.error).toContain('its last run failed')
    // a run still going does not hide the green one before it
    expect(Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done' }, ctx({ gates: [run(9_500_000, true), run(9_700_000, null, true)] })).ok).toBe(true)
  })
  test('a background gate (no result yet) counts only on the model\'s claim, started after the step, under 30 min old', () => {
    const doc = parsed()
    const bg = ctx({ gates: [run(9_500_000, null, true)] })
    const unclaimed = Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done' }, bg)
    expect(unclaimed.ok).toBe(false)
    if (!unclaimed.ok) expect(unclaimed.error).toContain('gateOk: true')
    const claimed = Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done', gateOk: true }, bg)
    expect(claimed.ok && claimed.doc.log[0]).toContain("gate green on the model's word")
    expect(Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done', gateOk: true }, ctx({ gates: [run(8_500_000, null, true)] })).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'A3', status: 'done', gateOk: true }, ctx({ gates: [run(9_500_000, null, true)], now: 9_500_000 + 31 * 60_000 })).ok).toBe(false)
  })
  test('a step done straight from todo counts from the last step marked done, not any old run', () => {
    const doc = parsed()
    const S = Date.parse('2026-09-28T14:11Z') // the sample's `started`
    const at = (min: number) => ctx({ now: S + 180 * 60_000, gates: [run(S + min * 60_000, true)], lastDoneAt: S + 120 * 60_000 })
    const old = Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'done' }, at(100))
    expect(old.ok).toBe(false)
    if (!old.ok) expect(old.error).toContain('no green run seen since the step started')
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'done' }, at(150)).ok).toBe(true)
    // with no step done yet, from the worklog's start
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'done' }, ctx({ now: S + 60_000, gates: [run(S - 60_000, true)] })).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'done' }, ctx({ now: S + 120_000, gates: [run(S + 60_000, true)] })).ok).toBe(true)
  })
  test('owner, commit and step titles that would break the WL1 line are refused', () => {
    const doc = parsed()
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'doing', owner: 'impl b1 — x' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'doing', owner: 'impl-b1.2' }, ctx()).ok).toBe(true)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'doing', commit: 'HEAD~1' }, ctx()).ok).toBe(false)
    const upper = Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'doing', commit: 'ABC1234' }, ctx())
    expect(upper.ok && upper.doc.phases[1]?.steps[0]?.sha).toBe('abc1234')
    expect(Hooks.applyOp(doc, { op: 'add', phase: 'B', title: 'Paywall — copy later' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'add', phase: 'B', title: 'Ask design @maria' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(null, { op: 'start', title: 'x', phases: [{ title: 'y', steps: ['A1 Fix it — soon'] }] }, ctx()).ok).toBe(false)
    const added = Hooks.applyOp(doc, { op: 'add', phase: 'B', title: 'Email a@b.c about it' }, ctx())
    expect(added.ok).toBe(true)
    if (added.ok) expect(Hooks.parseWorklog(Hooks.serializeWorklog(added.doc)).doc).toEqual(added.doc)
  })
  test('illegal transitions and the doing limit are refused', () => {
    const doc = parsed()
    expect(Hooks.applyOp(doc, { op: 'step', id: 'A1', status: 'todo' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'A1', status: 'doing' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'B1', status: 'skipped' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(doc, { op: 'step', id: 'Z9', status: 'doing' }, ctx()).ok).toBe(false)
    let d: Worklog = doc
    for (const id of ['B1', 'B2']) {
      const r = Hooks.applyOp(d, { op: 'step', id, status: 'doing' }, ctx())
      if (r.ok) d = r.doc
    }
    const r = Hooks.applyOp(d, { op: 'add', phase: 'B', title: 'Extra' }, ctx())
    if (r.ok) d = r.doc
    expect(Hooks.applyOp(d, { op: 'step', id: 'B3', status: 'doing' }, ctx()).ok).toBe(false)
  })
  test('decision ids are never reused: past the highest waiting or asked in the log', () => {
    const doc = { ...parsed(), log: ['16:50 asked D3: Ship on Friday?', ...parsed().log] }
    const r = Hooks.applyOp(doc, { op: 'attention', kind: 'decision', text: 'Rename the tier' }, ctx())
    expect(r.ok && r.doc.attention.map(a => a.id)).toEqual(['D1', 'A4', 'D4'])
  })
  test('decisions get ids; blockers move steps; resolve clears them', () => {
    let d = parsed()
    const asked = Hooks.applyOp(d, { op: 'attention', kind: 'decision', text: 'Use opus-high for reviews', options: ['yes', 'no'] }, ctx())
    expect(asked.ok && asked.doc.attention.find(a => a.id === 'D2')?.text).toBe('Use opus-high for reviews?')
    const resolved = Hooks.applyOp(d, { op: 'resolve', ref: 'A4', answer: 'key added' }, ctx())
    expect(resolved.ok && resolved.doc.phases[0]?.steps[3]?.status).toBe('todo')
    const blocked = Hooks.applyOp(d, { op: 'step', id: 'B1', status: 'blocked', note: 'needs design' }, ctx())
    if (blocked.ok) d = blocked.doc
    expect(d.attention.some(a => a.kind === 'blocker' && a.id === 'B1')).toBe(true)
  })
  test('titles over the limit are refused, notes are clipped', () => {
    expect(Hooks.applyOp(parsed(), { op: 'add', phase: 'B', title: 'x'.repeat(120) }, ctx()).ok).toBe(false)
    const r = Hooks.applyOp(parsed(), { op: 'step', id: 'B1', status: 'doing', note: 'y'.repeat(300) }, ctx())
    expect(r.ok && (r.doc.phases[1]?.steps[0]?.note?.length ?? 0)).toBe(120)
  })
  test('finish refuses todo/doing steps and waiting decisions unless forced with a reason', () => {
    const doc = parsed()
    const refused = Hooks.applyOp(doc, { op: 'finish' }, ctx())
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('A3, A4, B1, B2, D1 still open')
    expect(Hooks.applyOp(doc, { op: 'finish', force: true }, ctx()).ok).toBe(false)
    const forced = Hooks.applyOp(doc, { op: 'finish', force: true, reason: 'B moves to the next task' }, ctx())
    expect(forced.ok && forced.doc.log[1]).toBe('17:00 Ruling: finished with A3, A4, B1, B2, D1 open — B moves to the next task')
    // a settled worklog finishes without force; only a decision waiting still blocks it
    const settled = { ...doc, attention: [], phases: doc.phases.map(p => ({ ...p, steps: p.steps.map(s => ({ ...s, status: 'done' as const })) })) }
    expect(Hooks.applyOp(settled, { op: 'finish' }, ctx()).ok).toBe(true)
    expect(Hooks.applyOp({ ...settled, attention: [{ kind: 'decision' as const, id: 'D2', text: 'x?' }] }, { op: 'finish' }, ctx()).ok).toBe(false)
  })
  test('start with replace pauses the active worklog instead of leaving it active', () => {
    const r = Hooks.applyOp(parsed(), { op: 'start', title: 'Next task', replace: true, phases: [{ title: 'y', steps: ['z'] }] }, ctx())
    expect(r.ok && r.replaced?.meta.status).toBe('paused')
    expect(r.ok && r.replaced?.log[0]).toBe('17:00 paused: replaced by "Next task"')
    expect(r.ok && r.doc.meta.status).toBe('active')
  })
})

describe('observation', () => {
  test('gate commands', () => {
    expect(Hooks.isGateCommand('npm run dod 2>&1 | tail -30', 'npm run dod')).toBe(true)
    expect(Hooks.isGateCommand('.venv/bin/python -m pytest -q', undefined)).toBe(true)
    expect(Hooks.isGateCommand('npm run lint', 'npm run dod')).toBe(false)
  })
  test('the gate counts only as the program of a simple command, not as an argument', () => {
    for (const cmd of ['cd app && npm run dod', 'CI=1 npm run dod', 'npm run lint; npm run dod', '(cd app && npm run dod)', 'time npm run dod -- --silent']) {
      expect(Hooks.isGateCommand(cmd, 'npm run dod')).toBe(true)
    }
    for (const cmd of ['echo npm run dod', 'grep "npm run dod" README.md', 'echo "x; npm run dod"', "git commit -m 'npm run dod passes'", 'npm run dodo', 'cat package.json | grep npm run dod']) {
      expect(Hooks.isGateCommand(cmd, 'npm run dod')).toBe(false)
    }
    expect(Hooks.isGateCommand('uv run pytest -q', undefined)).toBe(true)
    expect(Hooks.isGateCommand('cat pytest.ini', undefined)).toBe(false)
    expect(Hooks.isGateCommand('echo go test', undefined)).toBe(false)
  })
  test('a piped gate is read from its output: the exit status is the last program\'s', () => {
    expect(Hooks.gateRunOf('npm run dod 2>&1 | tail -30', 'npm run dod')).toEqual({ isPiped: true })
    expect(Hooks.gateRunOf('npm run dod || true', 'npm run dod')).toEqual({ isPiped: true })
    expect(Hooks.gateRunOf('cd app && npm run dod && git commit -m x', 'npm run dod')).toEqual({ isPiped: false })
    for (const out of ['Tests:       1 failed, 61 passed, 62 total', 'src/a.ts(3,1): error TS2304: x', '  3 failing', '✗ lint', 'FAIL src/a.test.ts', ' 61 pass\n 1 fail']) {
      expect(Hooks.outputShowsFailure(out)).toBe(true)
    }
    for (const out of ['Tests:       62 passed, 62 total', ' 62 pass\n 0 fail', '0 errors, 0 warnings', '']) {
      expect(Hooks.outputShowsFailure(out)).toBe(false)
    }
  })
  test('commit output and step links', () => {
    expect(Hooks.commitFromOutput('[claude/fc-a3 4e9d692] docs(media): changelog\n 2 files changed')).toEqual({ sha: '4e9d692', subject: 'docs(media): changelog' })
    expect(Hooks.commitFromOutput('[main (root-commit) abc1234] init')).toEqual({ sha: 'abc1234', subject: 'init' })
    expect(Hooks.stepOfDescription('A3 seat count', parsed())).toBe('A3')
    expect(Hooks.stepOfDescription('a3 review', parsed())).toBe('A3')
    expect(Hooks.stepOfDescription('Explore the codebase', parsed())).toBe(null)
  })
  test('dev servers started in the background', () => {
    expect(Hooks.serverOf('nohup npx expo start --dev-client -c --port 8081 > m.log 2>&1 &', false)?.label).toBe('expo :8081')
    expect(Hooks.serverOf('npx convex dev', true)?.label).toBe('convex dev')
    expect(Hooks.serverOf('npx convex dev --once', true)).toBe(null)
    expect(Hooks.serverOf('npx expo start', false)).toBe(null)
  })
})

describe('drift', () => {
  const facts = (over: Partial<Facts> = {}): Facts => ({ ...Hooks.EMPTY_FACTS, ...over })
  const NOW = 100 * 60_000
  test('a red gate, an unlinked commit, a stale worklog', () => {
    const d = Hooks.driftOf(parsed(), facts({
      gates: [{ at: NOW - 60_000, ok: false, command: 'npm run dod' }],
      commits: [{ at: NOW - 120_000, sha: 'deadbee', subject: 'x', stepAt: null }],
      worklogChangedAt: NOW - 30 * 60_000,
      callsSinceChange: 20,
    }), {}, NOW)
    expect(d.map(x => x.rule).sort()).toEqual(['D1', 'D2', 'D6'])
  })
  test('a docs-only commit, or one within 15 min of a step marked done, is not unlinked', () => {
    const doc = parsed()
    const commit = (at: number, docsOnly?: boolean) => facts({ commits: [{ at, sha: 'deadbee', subject: 'x', stepAt: null, ...(docsOnly ? { docsOnly } : {}) }] })
    expect(Hooks.driftOf(doc, commit(NOW - 120_000, true), {}, NOW).some(x => x.rule === 'D1')).toBe(false)
    expect(Hooks.driftOf(doc, commit(NOW - 120_000), {}, NOW, { A2: NOW - 10 * 60_000 }).some(x => x.rule === 'D1')).toBe(false)
    expect(Hooks.driftOf(doc, commit(NOW - 120_000), {}, NOW, { A2: NOW - 30 * 60_000 }).some(x => x.rule === 'D1')).toBe(true)
    // only a step that is still done links it
    expect(Hooks.driftOf(doc, commit(NOW - 120_000), {}, NOW, { B1: NOW - 5 * 60_000 }).some(x => x.rule === 'D1')).toBe(true)
    expect(Hooks.isDocsOnly(['docs/architecture.md', 'plans/2026-x-worklog.md', 'README.md', 'docs/img/a.png'])).toBe(true)
    expect(Hooks.isDocsOnly(['README.md', 'src/app.ts'])).toBe(false)
    expect(Hooks.isDocsOnly([])).toBe(false)
  })
  test('the worklog is not stale while a step started under an hour ago is doing', () => {
    const stale = facts({ worklogChangedAt: NOW - 30 * 60_000, callsSinceChange: 20 })
    expect(Hooks.driftOf(parsed(), stale, { A3: NOW - 40 * 60_000 }, NOW).some(x => x.rule === 'D2')).toBe(false)
    expect(Hooks.driftOf(parsed(), stale, { A3: NOW - 70 * 60_000 }, NOW).some(x => x.rule === 'D2')).toBe(true)
  })
  test('a step marked done by hand without a green gate', () => {
    const doc = parsed()
    const d = Hooks.driftOf(doc, facts({ gates: [{ at: NOW - 50 * 60_000, ok: true, command: 'npm run dod' }] }), { A2: NOW - 40 * 60_000 }, NOW)
    expect(d.find(x => x.rule === 'D3')?.step).toBe('A2')
  })
  test('a finished agent whose step is still doing', () => {
    const d = Hooks.driftOf(parsed(), facts({ agents: [{ id: 'x', description: 'A3 impl', step: 'A3', model: 'claude-opus-5-5', startedAt: 0, endedAt: NOW - 6 * 60_000, status: 'done', tools: 9 }] }), {}, NOW)
    expect(d.find(x => x.rule === 'D4')?.text).toContain('A3: its agent finished 6m ago')
  })
  test('each rule is told to Claude at most every 10 minutes; a red gate never (it sees it)', () => {
    const drift = [{ rule: 'D1' as const, text: 'x', at: 0 }, { rule: 'D6' as const, text: 'y', at: 0 }]
    expect(Hooks.dueNotices(drift, {}, NOW).map(d => d.rule)).toEqual(['D1'])
    expect(Hooks.dueNotices(drift, { D1: NOW - 5 * 60_000 }, NOW)).toEqual([])
  })
})

describe('band layout', () => {
  const data = () => ({
    doc: parsed(),
    path: 'plans/x-worklog.md',
    facts: { ...Hooks.EMPTY_FACTS, gates: [{ at: 0, ok: true, command: 'npm run dod', durationMs: 52_000 }], commits: [{ at: 0, sha: '9e1d0aa', subject: 'x', stepAt: 'A2' }], agents: [{ id: 'a', description: 'A3 impl', step: 'A3', model: 'claude-opus-5-5', startedAt: 0, status: 'running' as const, tools: 3 }] },
    drift: [],
    now: 4 * 60_000,
    startedMs: 0,
    startedAt: {},
    doneAt: {},
    answered: [],
  })
  const text = (cols: number) => {
    const { left, right } = Hooks.bandSegments(data(), cols)
    return { left: left.map(s => s.text).join(''), right: right.map(s => s.text).join('') }
  }
  test('wide: everything, attention pinned right', () => {
    const t = text(140)
    expect(t.left).toContain('2/6 ━━━')
    expect(t.left).toContain('A3 Seat count follows team membership')
    expect(t.left).toContain('1 agent')
    expect(t.left).toContain('gate ✓ 4m')
    expect(t.left).toContain('9e1d0aa')
    expect(t.right).toBe('? 1  ! 1')
  })
  test('narrow: the bar and git go first, counters and the step stay', () => {
    const t = text(60)
    expect(t.left).not.toContain('━')
    expect(t.left).not.toContain('9e1d0aa')
    expect(t.left).toContain('2/6')
    expect(t.left).toContain('A3')
    expect(t.left.length + t.right.length).toBeLessThanOrEqual(60)
  })
  test('very narrow: the step title is truncated, never dropped', () => {
    const t = text(40)
    expect(t.left).toContain('A3')
    expect(t.left.length + t.right.length).toBeLessThanOrEqual(40)
    expect(t.right).toBe('? 1  ! 1')
  })
  test('the PLAN rule clips its phase chips so the row never passes the width', () => {
    const chips = Array.from({ length: 12 }, (_, i) => `○${'ABCDEFGHIJKL'[i]}`).join(' ')
    for (const cols of [20, 30, 47, 80]) {
      const { line, tail } = Hooks.ruleParts('PLAN', cols, chips)
      expect('PLAN '.length + line.length + (tail ? 1 + tail.length : 0)).toBeLessThanOrEqual(cols)
    }
    expect(Hooks.ruleParts('PLAN', 80, chips).tail).toBe(chips)
  })
  test('health: needs-you shows "!", a red gate "✗"', () => {
    expect(Hooks.healthOf(data()).glyph).toBe('!')
    expect(Hooks.healthOf({ ...data(), drift: [{ rule: 'D6', text: 'gate failed', at: 0 }] }).glyph).toBe('✗')
  })
})

describe('questions with their context', () => {
  test('why, blocks and recommend round-trip under a decision and a blocker', () => {
    const text = SAMPLE.replace('- [!] A4 Payment sandbox key missing in .env.local', '- [!] A4 Payment sandbox key missing in .env.local\n  why: billing cannot be tested without it')
      .replace('— options: per seat / per workspace', '— options: per seat / per workspace\n  why: B2 copy names the billing unit in 4 screens\n  blocks: B2\n  recommend: per seat')
    const r = Hooks.parseWorklog(text)
    expect(r.errors).toEqual([])
    expect(r.doc?.attention[0]).toMatchObject({ id: 'D1', why: 'B2 copy names the billing unit in 4 screens', blocks: 'B2', recommend: 'per seat' })
    expect(r.doc?.attention[1]).toMatchObject({ id: 'A4', why: 'billing cannot be tested without it' })
    const again = Hooks.parseWorklog(Hooks.serializeWorklog(r.doc as Worklog))
    expect(again.doc?.attention).toEqual(r.doc?.attention)
  })
  test('the attention op keeps the context, checks blocks and recommend, drops a repeated id', () => {
    const ok = Hooks.applyOp(parsed(), { op: 'attention', kind: 'decision', text: 'D2: Run P1 tracks in parallel?', options: ['parallel', 'one at a time'], why: 'a hook refuses agent writes to sibling worktrees', blocks: 'B1', recommend: 'one at a time' }, ctx())
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.doc.attention.find(a => a.id === 'D2')).toMatchObject({ text: 'Run P1 tracks in parallel?', blocks: 'B1', recommend: 'one at a time' })
    expect(Hooks.applyOp(parsed(), { op: 'attention', kind: 'decision', text: 'x?', options: ['a', 'b'], recommend: 'c' }, ctx()).ok).toBe(false)
    expect(Hooks.applyOp(parsed(), { op: 'attention', kind: 'decision', text: 'x?', blocks: 'Z9' }, ctx()).ok).toBe(false)
  })
})

describe('elapsed time', () => {
  const at = (iso: string) => Date.parse(iso)
  const base = () => ({ path: 'p', facts: Hooks.EMPTY_FACTS, drift: [], startedAt: {}, doneAt: {}, answered: [] })
  test('a running task counts to now; a finished one stops at its last update, not when it is opened again', () => {
    const doc = parsed()
    const started = at('2026-09-28T14:11Z')
    const running = { ...base(), doc, startedMs: started, now: started + 95 * 60_000 }
    expect(Hooks.elapsedOf(running)).toBe('1h35m')
    const finished = { ...doc, meta: { ...doc.meta, status: 'done' as const, updated: '2026-09-28T16:11Z' } }
    expect(Hooks.elapsedOf({ ...base(), doc: finished, startedMs: started, now: started + 6 * 60 * 60_000 })).toBe('took 2h')
    const paused = { ...doc, meta: { ...doc.meta, status: 'paused' as const, updated: '2026-09-28T15:41Z' } }
    expect(Hooks.elapsedOf({ ...base(), doc: paused, startedMs: started, now: started + 9 * 60 * 60_000 })).toBe('took 1h30m')
  })
})
