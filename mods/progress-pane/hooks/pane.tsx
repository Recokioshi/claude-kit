/**
 * The pane: Overview / Plan / Log / Agents, one step's or one agent's page,
 * and Needs you, every row through the Notebook frame; the footer's tabs
 * carry the current one as a highlighter chip. Pure: element table + data in.
 */
import type { ElementTable, RenderNode } from 'claude-code'

import { agentPage, agentsBlock } from './agents'
import { allSteps } from './worklog'
import { frameOf, framed, rule } from './frame'
import type { Frame } from './frame'
import { header, looseRows, needsBlock, needsRows, planBlock, sections, signalRows, signalsBlock } from './overview'
import { fullPlan, ledger, needsDetail, stepDetail } from './pages'
import { needsOf } from './text'
import type { Back, PaneActions, PaneView, ViewData } from './view-types'

/** Most log lines the Log tab draws (the pane's body scrolls). */
const LOG_MAX = 300
/** From this width an inline pane lays the Overview out in two columns. */
/** Each half must be wide enough (48) to keep its ruled margin. */
const TWO_COLUMNS = 98

type TabSpec = { key: string; hotkey: string; label: string; isCurrent: boolean; onPress: () => void; count?: number }

/** One footer tab: the engine's `1: ` prefix, then the label; the current one a highlighter chip, or `[brackets]` without one. */
function tabButton(f: Frame, s: TabSpec): RenderNode {
  const { Text, Button } = f.t
  const hl = f.tones.highlighter
  const name = s.count === undefined ? s.label : `${s.label} ${s.count}`
  const count = s.count === undefined ? null : <Text color="warning">{String(s.count)}</Text>
  if (s.isCurrent && hl) {
    return (
      <Button key={s.key} plain hotkey={s.hotkey} label={name} onPress={s.onPress}>
        <Text backgroundColor={hl}>{` ${s.label}${count ? ' ' : ''}`}{count}{' '}</Text>
      </Button>
    )
  }
  const [open, close] = s.isCurrent ? ['[', ']'] : ['', '']
  if (!count) return <Button key={s.key} plain hotkey={s.hotkey} label={`${open}${name}${close}`} onPress={s.onPress} />
  return <Button key={s.key} plain hotkey={s.hotkey} label={`${open}${name}${close}`} onPress={s.onPress}>{`${open}${s.label} `}{count}{close || null}</Button>
}

function footer(f: Frame, data: ViewData, ui: PaneView, actions: PaneActions): RenderNode {
  const { Box, Button } = f.t
  const tab = ui.tab
  const needs = needsOf(data).length
  const tabs: TabSpec[] = [
    { key: 'tab-overview', hotkey: '1', label: 'Overview', isCurrent: tab === 'overview', onPress: () => actions.tab('overview') },
    { key: 'tab-plan', hotkey: '2', label: 'Plan', isCurrent: tab === 'plan', onPress: () => actions.tab('plan') },
    { key: 'tab-log', hotkey: '3', label: 'Log', isCurrent: tab === 'log', onPress: () => actions.tab('log') },
    ...(data.facts.agents.length > 0 || tab === 'agents' ? [{ key: 'tab-agents', hotkey: '4', label: 'Agents', isCurrent: tab === 'agents', onPress: () => actions.tab('agents') }] : []),
    ...(needs > 0 || tab === 'needs' ? [{ key: 'tab-needs', hotkey: 'n', label: 'Needs you', isCurrent: tab === 'needs', onPress: actions.openNeeds, count: needs }] : []),
  ]
  // Every tab is `k: label`; on a narrow terminal the gaps close to 1 and "Needs you" becomes "Needs".
  const cells = (gap: number, list: TabSpec[]) => [...list.map(s => 3 + s.label.length + (s.count === undefined ? 0 : String(s.count).length + 1) + (s.isCurrent ? 2 : 0)), 7, 8].reduce((n, w) => n + w + gap, -gap)
  const room = f.width - 5
  const gap = !f.mono || cells(2, tabs) <= room ? 2 : 1
  const shown = f.mono && cells(gap, tabs) > room ? tabs.map(s => (s.key === 'tab-needs' ? { ...s, label: 'Needs' } : s)) : tabs
  const row = framed(f, 'footer', (
    <Box flexDirection="row" gap={gap} flexWrap={f.mono ? 'nowrap' : 'wrap'}>
      {shown.map(s => tabButton(f, s))}
      <Button key="file" plain hotkey="o" label="File" onPress={actions.file} />
      <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
    </Box>
  ))
  return f.mono ? row : <Box key="footer-gap" marginTop={1}>{row}</Box>
}

const BACK_LABEL: Record<Back, string> = { overview: 'Overview', plan: 'Plan', agents: 'Agents' }

/** A page's controls on top (the page below may scroll): back, previous / next, Close. */
function nav(f: Frame, prefix: 'step' | 'agent', back: Back, actions: PaneActions): RenderNode {
  const { Box, Button } = f.t
  return framed(f, `${prefix}-nav`, (
    <Box flexDirection="row" gap={2} flexGrow={1}>
      <Button key={`${prefix}-back`} plain hotkey="b" label={`← ${BACK_LABEL[back]}`} onPress={actions.back} />
      <Button key={`${prefix}-prev`} plain hotkey="k" label="Prev" onPress={() => actions.move(-1)} />
      <Button key={`${prefix}-next`} plain hotkey="j" label="Next" onPress={() => actions.move(1)} />
      <Box flexGrow={1} />
      <Button key="close" plain hotkey="x" label="Close" role="dismiss" onPress={actions.close} />
    </Box>
  ))
}

function overview(f: Frame, data: ViewData, ui: PaneView, actions: PaneActions, columns: number, rows: number, isInline: boolean): RenderNode[] {
  const { t, width, mono, tones } = f
  const { Box } = t
  const top = header(f, data)
  const bottom = [footer(f, data, ui, actions)]
  if (isInline && width >= TWO_COLUMNS) {
    // The left column keeps the ruled margin; the right one is glyph + space only.
    const half = Math.floor(width / 2) - 1
    const left = frameOf(t, tones, half, mono, true)
    const right = frameOf(t, tones, half, mono, false)
    const stepRows = Math.max(3, rows - 2 - 1 - 2 - 2 - looseRows(data))
    return sections(f, [
      top,
      [
        <Box key="cols" flexDirection="row" gap={2} marginTop={mono ? 0 : 1}>
          <Box flexDirection="column" width={half}>{planBlock(left, data, stepRows, actions)}</Box>
          <Box flexDirection="column" width={half}>{sections(right, [needsBlock(right, data, 3, actions), signalsBlock(right, data)])}</Box>
        </Box>,
      ],
      bottom,
    ])
  }
  const max = columns < 60 ? 2 : 3
  const needs = needsRows(data, max)
  // Blank rows survive a short pane; the steps fold into `+N more` instead.
  const blanks = needs > 0 ? 4 : 3
  const stepRows = Math.max(3, rows - 2 - 1 - blanks - needs - 2 - signalRows(data) - looseRows(data))
  return sections(f, [top, needsBlock(f, data, max, actions), planBlock(f, data, stepRows, actions), signalsBlock(f, data), bottom])
}

function body(f: Frame, data: ViewData, ui: PaneView, actions: PaneActions, columns: number, rows: number, isInline: boolean): RenderNode[] {
  const { t, width, mono } = f
  const page = (content: ReadonlyArray<RenderNode | null | undefined>) => sections(f, [header(f, data), [footer(f, data, ui, actions)], content])
  switch (ui.tab) {
    case 'step': {
      const step = allSteps(data.doc).find(s => s.id === ui.step)
      if (step) return sections(f, [[nav(f, 'step', ui.back ?? 'overview', actions)], stepDetail(f, data, step)])
      return overview(f, data, ui, actions, columns, rows, isInline)
    }
    case 'agent':
      return sections(f, [[nav(f, 'agent', ui.back ?? 'agents', actions)], agentPage(t, data, ui.agent ?? '', width, mono)])
    case 'agents':
      return page(agentsBlock(t, data, ui, actions, width, mono))
    case 'needs':
      return page(needsDetail(f, data, actions))
    case 'plan':
      return page(fullPlan(f, data, ui, actions))
    case 'log':
      return sections(f, [header(f, data), ledgerSection(f, data), [footer(f, data, ui, actions)]])
    case 'overview':
      return overview(f, data, ui, actions, columns, rows, isInline)
    default: {
      const never: never = ui.tab
      return [String(never)]
    }
  }
}

function ledgerSection(f: Frame, data: ViewData): RenderNode[] {
  return [rule(f, 'log-head', 'LOG', data.tones.ink), ...ledger(f, data.doc.log.slice(0, LOG_MAX))]
}

export function drawPane(t: ElementTable, data: ViewData, ui: PaneView, actions: PaneActions, columns: number, rows: number, isInline: boolean, mono = true) {
  const { Box } = t
  const f = frameOf(t, data.tones, Math.max(30, columns - 2), mono)
  return <Box flexDirection="column" paddingX={1}>{body(f, data, ui, actions, columns, rows, isInline)}</Box>
}
