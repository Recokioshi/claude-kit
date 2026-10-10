/** Mirrors hooks/worklog.ts and hooks/observe.ts (a state contract imports nothing). */
export type WlStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'skipped'
export type WlStep = { id: string; title: string; status: WlStatus; sha?: string; owner?: string; note?: string }
export type WlPhase = { key: string; title: string; steps: WlStep[] }
export type WlDetail = { why?: string; blocks?: string; recommend?: string }
export type WlAttention =
  | ({ kind: 'decision'; id: string; text: string; options?: string[] } & WlDetail)
  | ({ kind: 'blocker'; id: string; text: string } & WlDetail)
export type WlDoc = {
  meta: { worklog: 1; title: string; status: 'active' | 'paused' | 'done'; plan?: string; branch?: string; gate?: string; started?: string; updated?: string }
  goal?: string
  rules: string[]
  attention: WlAttention[]
  phases: WlPhase[]
  notes: string[]
  log: string[]
}
export type WlState = { path: string | null; doc: WlDoc | null; errors: { line: number; message: string }[]; mtimeMs: number; startedAt: Record<string, number>; doneAt: Record<string, number> }

/** One line of a subagent's own log: a tool call it made, or a progress note. */
export type PpAgentLog = { at: number; text: string; kind: 'tool' | 'note'; isError?: boolean }
/** What a subagent said about its own progress (worklog op `progress`). */
export type PpAgentProgress = { done: number; total?: number; note?: string; at: number }
export type PpAgent = {
  id: string
  description: string
  /** The worklog step its description starts with, if any. */
  step: string | null
  /** The agent type it was spawned as (`general-purpose`, `Explore`, a plugin's). */
  subagentType?: string
  model: string
  /** As the engine sent it on the agent's last model request: low … max, or a number. */
  effort?: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'failed'
  tools: number
  lastTool?: string
  /** Model requests made, and their summed tokens (input, output and cache). */
  requests: number
  tokens: number
  /** The last request's context fill, and the model's window. */
  contextTokens: number
  contextMax: number
  /** Estimated from tokens and a per-model price table; not a bill. */
  costUsd: number
  /** 1 for a first run; n when n agents had this description. */
  round: number
  progress?: PpAgentProgress
  /** Newest last, capped. */
  log: PpAgentLog[]
  /** Set on a failed run: interrupted (Esc, a stop) or an error. */
  endReason?: 'aborted' | 'error'
}

export type PpFacts = {
  gates: { at: number; ok: boolean | null; durationMs?: number; command: string; background?: boolean }[]
  commits: { at: number; sha: string; subject: string; stepAt: string | null; docsOnly?: boolean }[]
  agents: PpAgent[]
  /** The checkout's branch, from git (the worklog's `branch` is what was planned). */
  branch?: string
  servers: { label: string; pattern: string; startedAt: number }[]
  callsSinceChange: number
  worklogChangedAt: number
  context?: { percent: number; cost?: number }
  told: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'progress-pane': {
      worklog: WlState
      facts: PpFacts
      inbox: { answered: { id: string; question: string; answer: string; at: number; isDelivered: boolean }[]; isTurnRunning: boolean }
      view: { tab: 'overview' | 'plan' | 'log' | 'step' | 'needs' | 'agents' | 'agent'; step?: string; agent?: string; back?: 'overview' | 'plan' | 'agents'; expanded: Record<string, boolean>; isBandHidden: boolean }
    }
  }
}
