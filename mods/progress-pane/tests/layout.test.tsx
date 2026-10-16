import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

import Hooks from '../hooks'
import type { PaneActions, PaneView, ViewData } from '../hooks'
import { notebookData } from './logic.test'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: Array<Drawn | string> }
/** A drawn element's text, as the terminal lays it out: strings in order, a plain Button's hotkey as `1: `. */
function rowText(node: Drawn | string): string {
  if (typeof node === 'string') return node
  const inner = (node.children ?? []).map(rowText).join('')
  if (node.type !== 'Button') return inner
  const hotkey = node.props?.plain && typeof node.props.hotkey === 'string' ? `${node.props.hotkey}: ` : ''
  return `${hotkey}${node.children?.length ? inner : String(node.props?.label ?? '')}`
}
const NO_ACTIONS: PaneActions = { tab: () => {}, file: () => {}, close: () => {}, openStep: () => {}, openAgent: () => {}, togglePhase: () => {}, back: () => {}, move: () => {}, openNeeds: () => {}, answer: () => {}, replyInChat: () => {} }

/** The pane drawn straight from `data` on a surface (one mount per test), as rows of text. */
async function pageRows($: Parameters<TestBody>[0], on: On, data: ViewData, opts: { surface?: 'terminal' | 'desktop'; columns?: number; rows?: number; ui?: Partial<PaneView> } = {}) {
  const surface = opts.surface ?? 'terminal'
  const ui: PaneView = { tab: 'overview', expanded: {}, ...opts.ui }
  on('ui.render', { component: 'Pane', requestId: 'notebook' }, ($$, e) => Hooks.drawPane($$.ui.resolve(e), data, ui, NO_ACTIONS, opts.columns ?? 74, opts.rows ?? 24, false, surface === 'terminal'))
  const pane = await $.ui.mount({ plugin: 'progress-pane', surface, component: 'Pane', requestId: 'notebook', props: { bodyColumns: opts.columns ?? 74, placement: 'dock', scroll: { bodyRows: opts.rows ?? 24 } } as never })
  const tree = await pane.drawn() as Drawn
  return { rows: (tree.children ?? []).map(rowText), tree, pane }
}

const OPUS = 'claude-opus-5-5'
const USAGE = { input_tokens: 2_000, output_tokens: 1_000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 4_000 }

/** Every node of a drawn tree with its ancestors' types. */
function nodesOf(node: Drawn | string, above: string[] = []): Array<{ node: Drawn; above: string[] }> {
  if (typeof node === 'string') return []
  const here = { node, above }
  return [here, ...(node.children ?? []).flatMap(c => nodesOf(c, [...above, node.type ?? '']))]
}
const textOf = (n: Drawn | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''))

/** The notebook sample with the main thread past its first request. */
function withMain(over: Partial<ViewData> = {}): ViewData {
  return notebookData({ run: Hooks.withMainRequest(Hooks.emptyRun('plans/x-worklog.md'), OPUS, 'high', USAGE), ...over })
}

/** The menu row comes before every section and nowhere after. */
function expectMenuOnTop(rows: string[]) {
  const menu = rows.findIndex(r => r.includes('1: ') && r.includes('x: Close'))
  const firstSection = rows.findIndex(r => /│ [A-Z~][A-Z ]+ ┄/.test(r))
  expect(menu).toBeGreaterThan(0)
  expect(menu).toBeLessThan(firstSection)
  expect(rows.slice(menu + 1).some(r => r.includes('x: Close'))).toBe(false)
}

describe('the menu sits under the header on every tab', () => {
  for (const tab of ['overview', 'plan', 'log', 'agents'] as const) {
    test(tab, async ($, on) => expectMenuOnTop((await pageRows($, on, notebookData(), { ui: { tab } })).rows))
  }
  test('a finished run', async ($, on) => {
    const d = notebookData()
    expectMenuOnTop((await pageRows($, on, { ...d, doc: { ...d.doc, meta: { ...d.doc.meta, status: 'done' } } })).rows)
  })
  test('a session with no worklog', async ($, on) => {
    expectMenuOnTop((await pageRows($, on, { ...notebookData(), doc: Hooks.ADHOC_DOC, isAdhoc: true })).rows)
  })
})

describe('phase titles', () => {
  test('on desktop the Plan keeps them bold Text outside the fold Button, which carries ▾/▸ and the count', async ($, on) => {
    const { tree, pane } = await pageRows($, on, notebookData(), { surface: 'desktop', ui: { tab: 'plan' } })
    const titles = nodesOf(tree).filter(({ node }) => node.type === 'Text' && node.props?.bold === true && /^[ABC] (API|UI|Docs)$/.test(textOf(node)))
    expect(titles.map(t => textOf(t.node))).toEqual(['A API', 'B UI', 'C Docs'])
    for (const t of titles) expect(t.above).not.toContain('Button')
    // B is the current phase, open; A is done and folded.
    expect(await pane.find({ key: 'phase-B' })).toMatchObject({ props: { label: '▾ 2/6' } })
    expect(await pane.find({ key: 'phase-A' })).toMatchObject({ props: { label: '▸ 5/5' } })
  })

  test('on the terminal the title stays the fold Button, bold inside', async ($, on) => {
    const { tree } = await pageRows($, on, notebookData(), { ui: { tab: 'plan' } })
    const b = nodesOf(tree).find(({ node }) => node.type === 'Button' && node.props?.label === 'B UI')
    expect(b).toBeDefined()
    expect(JSON.stringify(b?.node)).toContain('"bold":true')
  })
})

describe('the Agents tab', () => {
  test('on the terminal a hairline with a blank row each side parts two entries', async ($, on) => {
    const { rows } = await pageRows($, on, notebookData(), { ui: { tab: 'agents' } })
    const lines = rows.map((r, i) => [r, i] as const).filter(([r]) => r.includes('─'.repeat(20)))
    expect(lines).toHaveLength(1)
    const at = lines[0]?.[1] ?? 0
    expect(rows[at]).toBe(`   │ ${'─'.repeat(74 - 2 - 5 - 1)}`)
    expect(rows[at - 1]?.trimEnd()).toBe('   │')
    expect(rows[at + 1]?.trimEnd()).toBe('   │')
  })

  test('on desktop each pair of entries is parted by air and a one-pixel Svg rule', async ($, on) => {
    const { tree } = await pageRows($, on, notebookData(), { surface: 'desktop', ui: { tab: 'agents' } })
    const rules = nodesOf(tree).filter(({ node }) => node.type === 'Svg' && node.props?.alt === '')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.node.props?.height).toBe(1)
    const gap = nodesOf(tree).find(({ node }) => node.type === 'Box' && node.props?.key === 'ag-sep-1')
    expect(gap?.node.props?.marginY).toBe(1)
  })
})

describe('the main thread on the Overview', () => {
  test('its companion sits above the plan, working while a turn runs, with how many agents run now', async ($, on) => {
    const { rows, tree } = await pageRows($, on, withMain({ isMainWorking: true }))
    const lead = rows.findIndex(r => r.includes('Main thread'))
    expect(lead).toBeGreaterThan(rows.findIndex(r => r.includes('x: Close')))
    expect(lead).toBeLessThan(rows.findIndex(r => r.includes('PLAN ┄')))
    expect(rows[lead]).toContain('working')
    // The header names the model; the entry names the creature that stands for it.
    expect(rows[lead]).toContain(`${Hooks.creatureName('opus')} with ${Hooks.accessoryName('high')}`)
    expect(rows[lead]).toContain('2 agents running · 2 in all')
    // The same drawing as a subagent's: a Raster the timer can blit to.
    expect(nodesOf(tree).some(({ node }) => node.type === 'Raster' && node.props?.key === 'companion-main')).toBe(true)
  })

  /** The sample with both agents finished and the main thread between turns. */
  const idle = () => {
    const d = withMain()
    return { ...d, facts: { ...d.facts, agents: d.facts.agents.map(a => Hooks.withEnd(a, 'done', d.now)) } }
  }

  test('between turns it waits, and says no agent is running', async ($, on) => {
    const lead = (await pageRows($, on, idle())).rows.find(r => r.includes('Main thread')) ?? ''
    expect(lead).toContain('waiting for you')
    expect(lead).toContain('no agents running · 2 in all')
  })

  test('on desktop it is the same creature as an Svg, its alt saying what it does', async ($, on) => {
    const { tree } = await pageRows($, on, idle(), { surface: 'desktop' })
    expect(nodesOf(tree).some(({ node }) => node.type === 'Svg' && String(node.props?.alt).endsWith('waiting for you'))).toBe(true)
  })

  test('not drawn before the main thread made a request', async ($, on) => {
    expect((await pageRows($, on, notebookData())).rows.some(r => r.includes('Main thread'))).toBe(false)
  })

  test('not drawn below 48 columns, where the page drops its margin line', async ($, on) => {
    expect((await pageRows($, on, withMain(), { columns: 46 })).rows.some(r => r.includes('Main thread'))).toBe(false)
  })

  test('the plan folds to make room for it, the doing step still in view', async ($, on) => {
    const { rows } = await pageRows($, on, withMain({ drift: [] }), { rows: 24 })
    // Without the companion all six steps of B fit 24 rows (the gallery mock); with it some fold.
    expect(rows.filter(r => /▏ B\d/.test(r)).length).toBeLessThan(6)
    expect(rows.some(r => r.includes('▏ B3 Seat limit checks'))).toBe(true)
    expect(rows.some(r => /▏ (✓ \d+ done above|\+\d+ more)/.test(r))).toBe(true)
  })
})
