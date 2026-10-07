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

export type PpFacts = {
  gates: { at: number; ok: boolean | null; durationMs?: number; command: string; background?: boolean }[]
  commits: { at: number; sha: string; subject: string; stepAt: string | null; docsOnly?: boolean }[]
  agents: { id: string; description: string; step: string | null; model: string; startedAt: number; endedAt?: number; status: 'running' | 'done' | 'failed'; tools: number; lastTool?: string }[]
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
      view: { tab: 'overview' | 'plan' | 'log' | 'step' | 'needs'; step?: string; back?: 'overview' | 'plan'; expanded: Record<string, boolean>; isBandHidden: boolean }
    }
  }
}
