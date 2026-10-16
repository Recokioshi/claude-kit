/**
 * The Overview's main-thread entry: the session's own companion, drawn by the
 * same code as a subagent's (the model is the creature, the effort its
 * accessory), working while a turn runs, resting between turns, done when the
 * run is; beside it which creature that is and how many subagents run right now.
 */
import type { RenderNode } from 'claude-code'

import { companionArt, companionKey, companionWidth, GAP, margin } from './agents'
import type { Mark } from './agents'
import type { Pose } from './companions'
import { accessoryName, COMPANION_ROWS, creatureName } from './companions'
import { effortOf, familyOf, rosterOf } from './crew'
import type { Frame } from './frame'
import type { ViewData } from './view-types'

/** The main thread's Raster key: no agent id collides with it (theirs are the engine's). */
export const MAIN_COMPANION = companionKey('main')

/** The main thread's pose: done with the run, working in a turn, resting between turns. */
export function mainPose(data: ViewData): Pose {
  if (data.doc.meta.status === 'done') return 'done'
  return data.isMainWorking ? 'working' : 'resting'
}

/** Drawn once the main thread made a request (its model is known) and the frame has room for the margin line. */
const isShown = (f: Frame, data: ViewData) => data.run.main.requests > 0 && (!f.mono || f.ruled)

/** Rows the block takes on the terminal: the companion's height. */
export const leadRows = (f: Frame, data: ViewData) => (isShown(f, data) ? COMPANION_ROWS : 0)

/** `2 agents running · 13 in all`, or that none is (the Agents tab's word). */
export function crewLine(data: ViewData): string {
  const roster = rosterOf(data.facts.agents)
  if (roster.length === 0) return 'no subagents yet'
  const running = roster.filter(a => a.status === 'running').length
  const now = running === 0 ? 'no agents running' : `${running} ${running === 1 ? 'agent' : 'agents'} running`
  return `${now} · ${roster.length} in all`
}

export function leadBlock(f: Frame, data: ViewData): RenderNode[] {
  if (!isShown(f, data)) return []
  const { t, mono, tones } = f
  const { Box, Text } = t
  const m = data.run.main
  const family = familyOf(m.model ?? '')
  const effort = effortOf(m.effort)
  const pose = mainPose(data)
  const state = pose === 'working' ? 'working' : pose === 'done' ? 'finished' : 'waiting for you'
  const mark: Mark | null = pose === 'working' ? { glyph: tones.pen, tone: tones.ink, bold: true } : pose === 'done' ? { glyph: '✓', tone: 'success' } : null
  // The header already names the model and effort: this line says which creature stands for them.
  const who = [creatureName(family), accessoryName(effort)].filter(Boolean).join(' with ')
  return [
    <Box key="lead" flexDirection="row">
      {margin(t, 'lead-m', mark, COMPANION_ROWS, mono)}
      <Box flexShrink={0} width={companionWidth(mono)}>{companionArt(t, { key: MAIN_COMPANION, family, effort, pose, status: state }, data.now, mono)}</Box>
      <Box width={GAP} flexShrink={0} />
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row">
          <Text bold>Main thread</Text>
          <Box flexGrow={1} />
          <Text color={pose === 'working' ? tones.ink : undefined} dimColor={pose !== 'working'}>{` ${state}`}</Text>
        </Box>
        {who ? <Text dimColor wrap="truncate-end">{who}</Text> : null}
        <Text wrap="truncate-end">{crewLine(data)}</Text>
      </Box>
    </Box>,
  ]
}
