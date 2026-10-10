/**
 * What the mod sees for itself, without asking the model: gate runs, commits,
 * agents, dev servers left running. Plus the drift rules that compare those
 * facts with the worklog. Pure.
 */
import { allSteps } from './worklog'
import type { Worklog } from './worklog'

/** `ok` null: no result yet (still running, or `background`: the mod never sees one). */
export type GateRun = { at: number; ok: boolean | null; durationMs?: number; command: string; background?: boolean }
export type Commit = { at: number; sha: string; subject: string; stepAt: string | null; docsOnly?: boolean }
/** One line of a subagent's own log: a tool call it made, or a progress note. */
export type AgentLog = { at: number; text: string; kind: 'tool' | 'note'; isError?: boolean }
/** What a subagent said about its own progress (worklog op `progress`). */
export type AgentProgress = { done: number; total?: number; note?: string; at: number }
export type AgentRow = {
  id: string
  description: string
  step: string | null
  subagentType?: string
  model: string
  effort?: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'failed'
  tools: number
  lastTool?: string
  requests: number
  tokens: number
  contextTokens: number
  contextMax: number
  costUsd: number
  round: number
  progress?: AgentProgress
  log: AgentLog[]
  /** Set on a failed run: interrupted (Esc, a stop) or an error. */
  endReason?: 'aborted' | 'error'
}
export type Server = { label: string; pattern: string; startedAt: number }

export type Facts = {
  gates: GateRun[]
  commits: Commit[]
  agents: AgentRow[]
  /** The checkout's branch, from git. */
  branch?: string
  servers: Server[]
  /** Tool calls on the main loop since the worklog last changed. */
  callsSinceChange: number
  worklogChangedAt: number
  context?: { percent: number; cost?: number }
  /** When each drift rule was last told to Claude. */
  told: Record<string, number>
}

export const EMPTY_FACTS: Facts = { gates: [], commits: [], agents: [], servers: [], callsSinceChange: 0, worklogChangedAt: 0, told: {} }

/** Where a simple command starts: the line start or after `;` `&&` `||` `|` `(`, past `VAR=x` and `time`. */
const CMD_START = String.raw`(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*(?:(?:time|exec|command)\s+)?`
const PY_RUN = String.raw`(?:(?:uv|poetry|pipenv|hatch) run\s+)?`
const DEFAULT_GATES = [String.raw`npm run (?:dod|test|check)\b`, String.raw`pnpm (?:run )?(?:dod|test)\b`, String.raw`yarn (?:dod|test)\b`, String.raw`${PY_RUN}(?:\S*/)?pytest\b`, String.raw`${PY_RUN}\S*python\S* -m (?:pytest|unittest)\b`, String.raw`cargo test\b`, String.raw`go test\b`]

/** Quoted text is an argument, never a command: `echo "npm run dod"` runs no gate. */
const unquoted = (text: string) => text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
const escapeRe = (text: string) => text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

/**
 * Whether a Bash command runs the quality gate (the worklog's `gate`, or a common test runner)
 * as the program of a simple command. `isPiped`: a pipe, `;` or `||` follows it, so the
 * exit status is not the gate's and its output has to be read.
 */
export function gateRunOf(command: string, gate: string | undefined): { isPiped: boolean } | null {
  const bare = unquoted(command)
  const sources = gate ? [`${escapeRe(unquoted(gate))}(?=$|[\\s;&|)<>])`] : DEFAULT_GATES
  for (const source of sources) {
    const m = new RegExp(`${CMD_START}(?:${source})`).exec(bare)
    if (m) return { isPiped: /[|;\n]/.test(bare.slice(m.index + m[0].length)) }
  }
  return null
}

export const isGateCommand = (command: string, gate: string | undefined): boolean => gateRunOf(command, gate) !== null

const FAILURE_MARKERS = [/\bfail(?:ed|ing|ures?)\b/i, /\bFAIL\b/, /\(fail\)/, /[✗✖✘]/, /\berror TS\d+/, /npm ERR!|\bELIFECYCLE\b|ERR_PNPM/, /\b[1-9]\d* (?:fail|errors?)\b/]

/** Whether a gate's output shows a failure (read when a pipe hides its exit status). "0 failed" is none. */
export function outputShowsFailure(text: string): boolean {
  const t = text.replace(/\b0 (?:fail(?:ed|ing|ures?)?|errors?)\b/gi, '')
  return FAILURE_MARKERS.some(re => re.test(t))
}

/** A background gate run with no result is ignored after this long. */
export const GATE_STALE_MS = 30 * 60_000

export const isStaleGate = (g: GateRun, now: number) => g.ok === null && now - g.at >= GATE_STALE_MS

/** A commit that only touches docs (Markdown, docs/, plans/) needs no step. */
export function isDocsOnly(paths: string[]): boolean {
  return paths.length > 0 && paths.every(p => /\.md$/i.test(p) || /^(?:docs|plans)\//.test(p))
}

/** `[branch 3f2a1bc] fix(auth): x` from git commit's output. */
export function commitFromOutput(text: string): { sha: string; subject: string } | null {
  const m = /\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)/.exec(text)
  return m ? { sha: (m[1] ?? '').slice(0, 7), subject: (m[2] ?? '').trim() } : null
}

export function isCommitCommand(command: string): boolean {
  return /\bgit\b[^;&|]*\bcommit\b/.test(command) && !/--dry-run/.test(command)
}

/** The step id an agent's description starts with ("A3 soft landing" → A3). */
export function stepOfDescription(description: string, doc: Worklog | null): string | null {
  const m = /^\s*([A-Za-z]{0,4}\d+(?:\.\d+)?[a-z]?)\b/.exec(description)
  if (!m || !doc) return null
  const id = (m[1] ?? '').toLowerCase()
  return allSteps(doc).find(s => s.id.toLowerCase() === id)?.id ?? null
}

const SERVERS: { label: string; re: RegExp; pattern: string }[] = [
  { label: 'expo :8081', re: /\bexpo start\b/, pattern: 'expo start' },
  { label: 'convex dev', re: /\bconvex dev\b(?!.*--once)/, pattern: 'convex dev' },
  { label: 'metro', re: /\breact-native start\b/, pattern: 'react-native start' },
  { label: 'vite', re: /\bvite\b(?!\s+build)/, pattern: 'vite' },
  { label: 'next dev', re: /\bnext dev\b/, pattern: 'next dev' },
  { label: 'astro dev', re: /\bastro dev\b/, pattern: 'astro dev' },
  { label: 'emulator', re: /\bemulator -avd\b/, pattern: 'qemu-system' },
]

/** A long-running dev process a command starts in the background. */
export function serverOf(command: string, isBackground: boolean): { label: string; pattern: string } | null {
  if (!isBackground && !/(^|[^&])&\s*$|\bnohup\b/.test(command)) return null
  const hit = SERVERS.find(s => s.re.test(command))
  return hit ? { label: hit.label, pattern: hit.pattern } : null
}

/** A short "Edit tiers.ts" for the agent row. */
export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? input.file_path.split('/').pop() : undefined
  if (file) return `${tool} ${file}`
  if (tool === 'Bash' && typeof input.command === 'string') return `$ ${input.command.trim().split(/\s+/).slice(0, 3).join(' ')}`
  return tool.replace(/^mcp__[^_]+__/, '')
}

export type Drift = { rule: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6'; text: string; step?: string; at: number }

/** Where what Claude declared and what the mod saw disagree. */
export function driftOf(doc: Worklog | null, facts: Facts, startedAt: Record<string, number>, now: number, doneAt: Record<string, number> = {}): Drift[] {
  if (!doc || doc.meta.status !== 'active') return []
  const out: Drift[] = []
  const steps = allSteps(doc)
  const doing = steps.filter(s => s.status === 'doing')

  const lastGate = facts.gates[facts.gates.length - 1]
  if (lastGate && lastGate.ok === false) {
    out.push({ rule: 'D6', text: `gate failed ${ago(now - lastGate.at)} ago`, at: lastGate.at })
  }

  // Linked: made while a step was doing, named by a step's sha, or within 15 min of a step marked done. Docs-only needs no step.
  const isLinked = (c: Facts['commits'][number]) =>
    c.stepAt !== null || c.docsOnly === true || steps.some(s => (s.sha && c.sha.startsWith(s.sha.slice(0, 7))) || (s.status === 'done' && Math.abs(c.at - (doneAt[s.id] ?? -Infinity)) <= 15 * 60_000))
  const unlinked = [...facts.commits].reverse().find(c => now - c.at < 60 * 60_000 && !isLinked(c))
  if (unlinked) out.push({ rule: 'D1', text: `commit ${unlinked.sha} not linked to a step`, at: unlinked.at })

  // Not stale while a step started under an hour ago is still doing.
  const isFresh = doing.some(s => startedAt[s.id] !== undefined && now - (startedAt[s.id] ?? 0) < 60 * 60_000)
  if (!isFresh && facts.worklogChangedAt > 0 && now - facts.worklogChangedAt > 20 * 60_000 && facts.callsSinceChange >= 15) {
    out.push({ rule: 'D2', text: `worklog not updated for ${ago(now - facts.worklogChangedAt)}`, at: facts.worklogChangedAt })
  }

  const passes = facts.gates.filter(g => g.ok === true).map(g => g.at)
  for (const s of steps) {
    const start = startedAt[s.id]
    if (s.status === 'done' && start !== undefined && doc.meta.gate && facts.gates.length > 0 && !passes.some(p => p >= start)) {
      out.push({ rule: 'D3', text: `${s.id} marked done without a green gate`, step: s.id, at: start })
    }
  }

  for (const a of facts.agents) {
    if (a.status !== 'running' && a.step && a.endedAt && now - a.endedAt > 5 * 60_000 && doing.some(s => s.id === a.step)) {
      out.push({ rule: 'D4', text: `${a.step}: its agent finished ${ago(now - a.endedAt)} ago, step still doing`, step: a.step, at: a.endedAt })
    }
  }

  if (doing.length > 3) out.push({ rule: 'D5', text: `${doing.length} steps doing at once`, at: now })
  return out
}

/** "just now", "4m ago": how long since, for a sentence. */
export const since = (ms: number): string => (ago(ms) === 'now' ? 'just now' : `${ago(ms)} ago`)

/** "under 1m", "4m": a duration, for "took …" and "running …". */
export const lasted = (ms: number): string => (ago(ms) === 'now' ? 'under 1m' : ago(ms))

/** "now", "4m", "3h12m". */
export function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? `${m % 60}m` : ''}`
}

/** Which drift notes Claude should read now: each rule at most every 10 minutes. */
export function dueNotices(drift: Drift[], told: Record<string, number>, now: number): Drift[] {
  return drift.filter(d => d.rule !== 'D6' && now - (told[d.rule] ?? 0) >= 10 * 60_000)
}
