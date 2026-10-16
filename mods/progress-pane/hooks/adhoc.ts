/**
 * A session without a worklog: the band and pane still show what the mod
 * observes (model, effort, tokens, context, agents, gate, git), with no plan.
 * The stand-in worklog below exists only inside the view data: it is never
 * written to the worklog state, so the system-prompt contract and the drift
 * notices to Claude stay off for plain sessions. Pure.
 */
import type { ViewData } from './view-types'
import type { Worklog } from './worklog'

/** An empty, active worklog: no phases, nothing asked. Drawings read it as "no plan". */
export const ADHOC_DOC: Worklog = { meta: { worklog: 1, title: 'Session', status: 'active' }, rules: [], attention: [], phases: [], notes: [], log: [] }

/** Nothing to show yet (a fresh session): the band stays away instead of drawing an empty line. */
export function isQuiet(data: ViewData): boolean {
  const { facts, run } = data
  return data.isAdhoc === true && run.main.requests === 0 && facts.agents.length === 0 && facts.gates.length === 0 && facts.commits.length === 0 && facts.servers.length === 0
}
