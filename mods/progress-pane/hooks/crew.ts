/**
 * The crew: every subagent the session started, as the mod saw it. Rows are
 * built on spawn and updated from each model request (tokens, cost, effort),
 * each tool call (its log) and the agent's own progress reports. Pure.
 */
import { costOf, tokensOf, windowOf } from './cost'
import type { Usage } from './cost'
import type { AgentLog, AgentRow } from './observe'

/** Log lines kept per agent, and agents kept once finished. */
export const LOG_CAP = 60
export const FINISHED_CAP = 12

export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'none'

/** The model family from an id or alias (`claude-opus-5-5`, `sonnet`). */
export function familyOf(model: string): Family {
  const m = model.toLowerCase()
  if (/fable|mythos/.test(m)) return 'fable'
  if (/opus/.test(m)) return 'opus'
  if (/sonnet/.test(m)) return 'sonnet'
  if (/haiku/.test(m)) return 'haiku'
  return 'other'
}

/** "Opus 5.5" from `claude-opus-5-5`; the id itself when it is no Claude id. */
export function modelName(model: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(model)
  if (!m) return model.replace(/^claude-/, '').replace(/\[.*\]$/, '') || 'unknown'
  const family = (m[1] ?? '').toLowerCase()
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2] ?? ''}${m[3] ? `.${m[3]}` : ''}`
}

/**
 * The engine's effort as a level. A number (a model's own scale) has no
 * agreed mapping to the named levels, so it reads as none rather than a guess.
 */
export function effortOf(effort: string | number | undefined): Effort {
  return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max' ? effort : 'none'
}

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export type Spawn = { id: string; description: string; step: string | null; subagentType: string; model: string; at: number }

/** A new row; `round` counts earlier agents with the same description (a retry, a second review). */
export function newAgent(rows: readonly AgentRow[], s: Spawn): AgentRow {
  const round = 1 + (s.description ? rows.filter(a => a.id !== s.id && norm(a.description) === norm(s.description)).length : 0)
  return { id: s.id, description: s.description, step: s.step, subagentType: s.subagentType, model: s.model, startedAt: s.at, status: 'running', tools: 0, requests: 0, tokens: 0, contextTokens: 0, contextMax: windowOf(s.model), costUsd: 0, round, log: [] }
}

/** Adds a row, keeping every running agent and the newest finished ones. */
export function addAgent(rows: readonly AgentRow[], row: AgentRow): AgentRow[] {
  const all = [...rows.filter(a => a.id !== row.id), row]
  const finished = all.filter(a => a.status !== 'running').slice(-FINISHED_CAP)
  return all.filter(a => a.status === 'running' || finished.includes(a))
}

/** One model request of the agent: its model and effort as sent, its tokens and cost. */
export function withUsage(a: AgentRow, model: string, effort: string | number | undefined, u: Usage): AgentRow {
  const level = effortOf(effort)
  return {
    ...a,
    model: model || a.model,
    ...(level !== 'none' ? { effort: level } : {}),
    requests: a.requests + 1,
    tokens: a.tokens + tokensOf(u),
    contextTokens: tokensOf(u),
    contextMax: windowOf(model || a.model),
    costUsd: a.costUsd + costOf(model || a.model, u),
  }
}

/**
 * A row as this version expects it. Rows written by an earlier version
 * survive a reload in the session's state without the newer fields; reading
 * one through this keeps a missing log or figure from breaking a drawing.
 */
export function normalizeAgent(a: AgentRow): AgentRow {
  const loose = a as Partial<AgentRow> & Pick<AgentRow, 'id' | 'description' | 'model' | 'startedAt' | 'status'>
  return {
    ...loose,
    step: loose.step ?? null,
    tools: loose.tools ?? 0,
    requests: loose.requests ?? 0,
    tokens: loose.tokens ?? 0,
    contextTokens: loose.contextTokens ?? 0,
    contextMax: loose.contextMax ?? windowOf(a.model),
    costUsd: loose.costUsd ?? 0,
    round: loose.round ?? 1,
    log: Array.isArray(loose.log) ? loose.log : [],
  }
}

/** A finished agent that makes a request or a tool call again was resumed: it is running. */
export function withResume(a: AgentRow): AgentRow {
  if (a.status === 'running') return a
  const { endedAt: _ended, endReason: _reason, ...rest } = a
  void _ended
  void _reason
  return { ...rest, status: 'running' }
}

export function withLog(a: AgentRow, line: AgentLog): AgentRow {
  return { ...a, log: [...a.log, line].slice(-LOG_CAP) }
}

/** A tool call the agent made: its count, its last tool, a log line. */
export function withTool(a: AgentRow, label: string, at: number, isError: boolean): AgentRow {
  return withLog({ ...a, tools: a.tools + 1, lastTool: label }, { at, text: label, kind: 'tool', ...(isError ? { isError } : {}) })
}

/** The agent's own report: `done` of `total` steps, what it is on now. Notes go to its log. */
export function withProgress(a: AgentRow, p: { done?: number; total?: number; note?: string }, at: number): AgentRow {
  const total = p.total !== undefined ? Math.max(1, Math.round(p.total)) : a.progress?.total
  const done = Math.max(0, Math.round(p.done ?? a.progress?.done ?? 0))
  const note = p.note?.trim().slice(0, 80) || undefined
  const next: AgentRow = { ...a, progress: { done: total ? Math.min(total, done) : done, ...(total ? { total } : {}), ...(note ? { note } : {}), at } }
  return note ? withLog(next, { at, text: total ? `${Math.min(total, done)}/${total} ${note}` : note, kind: 'note' }) : next
}

/** The run ended: `aborted` (Esc, a stop) is a failure without an error. */
export function withEnd(a: AgentRow, status: 'done' | 'failed', at: number, endReason?: 'aborted' | 'error'): AgentRow {
  return { ...a, status, endedAt: at, ...(status === 'failed' && endReason ? { endReason } : {}) }
}

/**
 * How far the agent is, 0..1: its own report when it gave one, full once
 * done, else null (the row then shows its context fill instead, in pencil).
 */
export function progressOf(a: AgentRow): number | null {
  if (a.status === 'done') return 1
  if (a.progress?.total) return Math.min(1, a.progress.done / a.progress.total)
  return null
}

export const contextPercent = (a: AgentRow): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

export const elapsedMs = (a: AgentRow, now: number): number => (a.endedAt ?? Math.max(now, a.startedAt)) - a.startedAt

export type CrewTotals = { count: number; running: number; done: number; failed: number; tokens: number; costUsd: number; spanMs: number }

export function totalsOf(rows: readonly AgentRow[], now: number): CrewTotals {
  const start = rows.length ? Math.min(...rows.map(a => a.startedAt)) : 0
  const end = rows.length ? Math.max(...rows.map(a => a.endedAt ?? Math.max(now, a.startedAt))) : 0
  return {
    count: rows.length,
    running: rows.filter(a => a.status === 'running').length,
    done: rows.filter(a => a.status === 'done').length,
    failed: rows.filter(a => a.status === 'failed').length,
    tokens: rows.reduce((n, a) => n + a.tokens, 0),
    costUsd: rows.reduce((n, a) => n + a.costUsd, 0),
    spanMs: end - start,
  }
}

/** The roster's order: running first (oldest first), then finished (newest first). */
export function rosterOf(rows: readonly AgentRow[]): AgentRow[] {
  return [...rows.filter(a => a.status === 'running'), ...rows.filter(a => a.status !== 'running').reverse()]
}

/** A running agent quiet this long (a long tool call, a slow request) rests instead of working. */
export const RESTING_AFTER_MS = 45_000

/** The companion's pose: finished, failed, working, or resting while the agent waits. */
export function poseOf(a: AgentRow, now: number): 'working' | 'resting' | 'done' | 'failed' {
  if (a.status !== 'running') return a.status
  const last = Math.max(a.log[a.log.length - 1]?.at ?? a.startedAt, a.progress?.at ?? 0)
  return now - last > RESTING_AFTER_MS ? 'resting' : 'working'
}
