/**
 * One run's statistics (one worklog, start to finish): the main thread's and
 * the subagents' requests, tokens by kind, estimated cost, working time and
 * tool calls, the crew by creature, and what git shows once it is finished.
 * Kept across sessions in the plugin store; never written into the worklog.
 * Pure: the hooks module feeds events in and stores what comes out.
 */
import { costOf } from './cost'
import type { Usage } from './cost'
import type { Effort, Family } from './crew'
import type { Worklog } from './worklog'

export type UsageTotals = { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; workingMs: number; tools: number }
export type GitStats = { at: number; commits: number; merges: number; branches: number; filesAdded: number; filesEdited: number; filesRemoved: number; linesAdded: number; linesRemoved: number }
export type RunStats = {
  path: string | null
  base?: string
  main: UsageTotals & { model?: string; effort?: string; turns: number }
  agents: UsageTotals & { count: number; failed: number; crew: Record<string, number> }
  /** null: computed, and git could not tell. Absent: not computed yet. */
  git?: GitStats | null
}

const TOTALS: UsageTotals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, workingMs: 0, tools: 0 }

export const emptyRun = (path: string | null): RunStats => ({ path, main: { ...TOTALS, turns: 0 }, agents: { ...TOTALS, count: 0, failed: 0, crew: {} } })

/** The store key of a run: one per worklog file. */
export const runKey = (path: string) => `run:${path}`

function added<T extends UsageTotals>(t: T, model: string, u: Usage): T {
  return {
    ...t,
    requests: t.requests + 1,
    input: t.input + (u.input_tokens || 0),
    output: t.output + (u.output_tokens || 0),
    cacheRead: t.cacheRead + (u.cache_read_input_tokens || 0),
    cacheWrite: t.cacheWrite + (u.cache_creation_input_tokens || 0),
    costUsd: t.costUsd + costOf(model, u),
  }
}

/** A model request of the main thread: its totals, and the model and effort it last ran with. */
export function withMainRequest(r: RunStats, model: string, effort: string | number | undefined, u: Usage): RunStats {
  const level = typeof effort === 'string' ? effort : undefined
  return { ...r, main: { ...added(r.main, model, u), model: model || r.main.model, ...(level ? { effort: level } : {}) } }
}

export function withAgentRequest(r: RunStats, model: string, u: Usage): RunStats {
  return { ...r, agents: added(r.agents, model, u) }
}

/** A subagent started: one more in the crew count. */
export const withAgentSpawn = (r: RunStats): RunStats => ({ ...r, agents: { ...r.agents, count: r.agents.count + 1 } })

/** A subagent's first request tells its creature and accessory: one more in the lineup. */
export function withCrewMember(r: RunStats, family: Family, effort: Effort): RunStats {
  const key = `${family}/${effort}`
  return { ...r, agents: { ...r.agents, crew: { ...r.agents.crew, [key]: (r.agents.crew[key] ?? 0) + 1 } } }
}

/** A turn of the main thread ended after `ms` of work. */
export const withMainTurn = (r: RunStats, ms: number): RunStats => ({ ...r, main: { ...r.main, turns: r.main.turns + 1, workingMs: r.main.workingMs + Math.max(0, ms) } })

/** A run of a subagent's loop ended after `ms`; `failed` when it ended in an error. */
export const withAgentRun = (r: RunStats, ms: number, failed: boolean): RunStats =>
  ({ ...r, agents: { ...r.agents, workingMs: r.agents.workingMs + Math.max(0, ms), failed: r.agents.failed + (failed ? 1 : 0) } })

export const withToolCall = (r: RunStats, isMain: boolean): RunStats =>
  (isMain ? { ...r, main: { ...r.main, tools: r.main.tools + 1 } } : { ...r, agents: { ...r.agents, tools: r.agents.tools + 1 } })

/** Both blocks added up: what the run used in all. */
export function totalOf(r: RunStats): UsageTotals {
  const a = r.main
  const b = r.agents
  return { requests: a.requests + b.requests, input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, costUsd: a.costUsd + b.costUsd, workingMs: a.workingMs + b.workingMs, tools: a.tools + b.tools }
}

export const tokensIn = (t: UsageTotals) => t.input + t.output + t.cacheRead + t.cacheWrite

/** The crew's lineup: each creature-and-accessory pair with how many ran, the most frequent first. */
export function lineupOf(r: RunStats): { family: Family; effort: Effort; count: number }[] {
  const families: readonly Family[] = ['fable', 'opus', 'sonnet', 'haiku', 'other']
  const efforts: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'none']
  return Object.entries(r.agents.crew)
    .flatMap(([key, count]) => {
      const [f, e] = key.split('/')
      const family = families.find(x => x === f)
      const effort = efforts.find(x => x === e)
      return family && effort && count > 0 ? [{ family, effort, count }] : []
    })
    .sort((x, y) => y.count - x.count || families.indexOf(x.family) - families.indexOf(y.family))
}

/**
 * Decisions asked: the highest id among open decisions and `asked D<n>` log
 * lines (ids are never reused); resolved: those no longer open. Step ids like
 * `D2` (a phase keyed D) never count. The log is capped, so both are floors.
 */
export function decisionsOf(doc: Worklog): { asked: number; resolved: number } {
  const open = doc.attention.filter(a => a.kind === 'decision')
  const ids = [...open.map(a => Number(/^D(\d+)$/.exec(a.id)?.[1] ?? 0)), ...doc.log.map(l => Number(/\basked D(\d+)\b/.exec(l)?.[1] ?? 0))]
  const asked = Math.max(0, ...ids)
  return { asked, resolved: Math.max(0, asked - open.length) }
}

/** Rulings in the log (`16:05 Ruling: …`); the log is capped, so a floor. */
export const rulingsOf = (doc: Worklog): number => doc.log.filter(l => /^(?:\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2} Ruling:/.test(l)).length

// ---- reading what the store gave back (unknown until narrowed) ----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

function totalsFrom(v: unknown): UsageTotals {
  const o = isRecord(v) ? v : {}
  return { requests: num(o.requests), input: num(o.input), output: num(o.output), cacheRead: num(o.cacheRead), cacheWrite: num(o.cacheWrite), costUsd: num(o.costUsd), workingMs: num(o.workingMs), tools: num(o.tools) }
}

function gitFrom(v: unknown): GitStats | null | undefined {
  if (v === null) return null
  if (!isRecord(v)) return undefined
  return { at: num(v.at), commits: num(v.commits), merges: num(v.merges), branches: num(v.branches), filesAdded: num(v.filesAdded), filesEdited: num(v.filesEdited), filesRemoved: num(v.filesRemoved), linesAdded: num(v.linesAdded), linesRemoved: num(v.linesRemoved) }
}

/** A stored run, narrowed field by field; anything missing or malformed reads as zero. */
export function parseRun(v: unknown, path: string): RunStats {
  if (!isRecord(v)) return emptyRun(path)
  const main = isRecord(v.main) ? v.main : {}
  const agents = isRecord(v.agents) ? v.agents : {}
  const crewIn = isRecord(agents.crew) ? agents.crew : {}
  const crew = Object.fromEntries(Object.entries(crewIn).filter(([k, n]) => /^[a-z]+\/[a-z]+$/.test(k) && num(n) > 0).map(([k, n]) => [k, num(n)]))
  const model = str(main.model)
  const effort = str(main.effort)
  const base = str(v.base)
  const git = gitFrom(v.git)
  return {
    path,
    ...(base ? { base } : {}),
    main: { ...totalsFrom(main), turns: num(main.turns), ...(model ? { model } : {}), ...(effort ? { effort } : {}) },
    agents: { ...totalsFrom(agents), count: num(agents.count), failed: num(agents.failed), crew },
    ...(git !== undefined ? { git } : {}),
  }
}

// ---- git output, as the hooks module runs it ----

/** `git diff --name-status -M base..head`: files added, edited (renames and copies too) and removed. */
export function parseNameStatus(text: string): { filesAdded: number; filesEdited: number; filesRemoved: number } {
  let filesAdded = 0
  let filesEdited = 0
  let filesRemoved = 0
  for (const line of text.split('\n')) {
    const code = line.trim().charAt(0)
    if (code === 'A') filesAdded += 1
    else if (code === 'D') filesRemoved += 1
    else if (code === 'M' || code === 'R' || code === 'C' || code === 'T') filesEdited += 1
  }
  return { filesAdded, filesEdited, filesRemoved }
}

/** `git diff --shortstat`: " 12 files changed, 2340 insertions(+), 610 deletions(-)". */
export function parseShortstat(text: string): { linesAdded: number; linesRemoved: number } {
  return { linesAdded: Number(/(\d+) insertions?\(\+\)/.exec(text)?.[1] ?? 0), linesRemoved: Number(/(\d+) deletions?\(-\)/.exec(text)?.[1] ?? 0) }
}

/** `git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/heads`: branches with a commit since `sinceMs`. */
export function branchesSince(text: string, sinceMs: number): number {
  return text.split('\n').filter(line => {
    const at = Number(line.trim().split(/\s+/).pop())
    return Number.isFinite(at) && at * 1000 >= sinceMs
  }).length
}

export const countOf = (text: string): number => Number(text.trim()) || 0

/** "2,340": thousands with a comma, for the summary. */
export const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
