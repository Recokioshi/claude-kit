/**
 * Model families and the guard's state transitions. Pure: no `$`.
 */

export const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'other'] as const
export type Family = (typeof FAMILIES)[number]

export type Mode = 'deny' | 'swap'

export type FamilyStats = { uses: number; swapped: number; denied: number }

export type GuardEvent = {
  at: number
  /** `~` a request was swapped, `✗` a spawn or switch was refused. */
  kind: 'swap' | 'deny'
  /** What it concerned: an agent's description, `Workflow`, `/model`. */
  what: string
  from: Family
  to?: Family
}

export type GuardState = {
  isReady: boolean
  allowed: Family[]
  fallback: Family
  mode: Mode
  /** Where `allowed` came from. */
  source: 'config' | 'repo' | 'session'
  repoName: string | null
  repoDefault: Family[] | null
  stats: Record<Family, FamilyStats>
  /** The last full id seen per family, for display and as a swap target. */
  seen: Partial<Record<Family, string>>
  recent: GuardEvent[]
  /** Agent loops already swapped, so each is reported once. */
  swappedLoops: string[]
}

/** The ids a swap targets until the session shows a newer one. */
export const DEFAULT_IDS: Record<Exclude<Family, 'other'>, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5-20251001',
  fable: 'claude-fable-5-1',
}

/** Fallback preference when the chosen fallback is itself turned off. */
const PREFERENCE: Family[] = ['opus', 'fable', 'sonnet', 'haiku', 'other']

export function familyOf(model: string | null | undefined): Family {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('fable')) return 'fable'
  return 'other'
}

/** "opus, fable" → ['opus', 'fable']; unknown words dropped; order kept canonical. */
export function parseFamilies(text: string | readonly string[]): Family[] {
  const words = (Array.isArray(text) ? text : String(text).split(/[\s,;]+/)).map(w => String(w).trim().toLowerCase())
  return FAMILIES.filter(f => words.includes(f))
}

const zeroStats = (): Record<Family, FamilyStats> => ({
  opus: { uses: 0, swapped: 0, denied: 0 },
  sonnet: { uses: 0, swapped: 0, denied: 0 },
  haiku: { uses: 0, swapped: 0, denied: 0 },
  fable: { uses: 0, swapped: 0, denied: 0 },
  other: { uses: 0, swapped: 0, denied: 0 },
})

export const EMPTY_STATE: GuardState = {
  isReady: false,
  allowed: [...FAMILIES],
  fallback: 'opus',
  mode: 'deny',
  source: 'config',
  repoName: null,
  repoDefault: null,
  stats: zeroStats(),
  seen: {},
  recent: [],
  swappedLoops: [],
}

/** The family a disallowed request is moved to: the chosen fallback if allowed, else the best allowed one. */
export function fallbackOf(state: Pick<GuardState, 'allowed' | 'fallback'>): Family | null {
  if (state.allowed.includes(state.fallback)) {
    return state.fallback
  }
  return PREFERENCE.find(f => state.allowed.includes(f)) ?? null
}

/** The full id to send for a family. */
export function idFor(family: Family, seen: GuardState['seen']): string | null {
  if (family === 'other') {
    return seen.other ?? null
  }
  return seen[family] ?? DEFAULT_IDS[family]
}

/** No model, or `inherit`: the request runs on the parent's model, which is the user's own choice. */
export function isInherited(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase()
  return m === '' || m === 'inherit'
}

export function isAllowed(state: Pick<GuardState, 'allowed'>, model: string | null | undefined): boolean {
  return isInherited(model) || state.allowed.includes(familyOf(model))
}

/** Toggles one family; refuses to leave the list empty (something must run). */
export function toggled(state: GuardState, family: Family): GuardState {
  const on = state.allowed.includes(family)
  if (on && state.allowed.length === 1) {
    return state
  }
  const allowed = on ? state.allowed.filter(f => f !== family) : FAMILIES.filter(f => f === family || state.allowed.includes(f))
  const next = { ...state, allowed, source: 'session' as const }
  return { ...next, fallback: fallbackOf(next) ?? state.fallback }
}

/** Steps the fallback to the next allowed family. */
export function cycledFallback(state: GuardState): GuardState {
  const options: Family[] = state.allowed.filter(f => f !== 'other')
  if (options.length === 0) {
    return state
  }
  const i = options.indexOf(state.fallback)
  return { ...state, fallback: options[(i + 1) % options.length] ?? options[0] ?? state.fallback }
}

export function withEvent(state: GuardState, event: GuardEvent): GuardState {
  const stats = { ...state.stats }
  const from = { ...stats[event.from] }
  if (event.kind === 'swap') {
    from.swapped += 1
  } else {
    from.denied += 1
  }
  stats[event.from] = from
  return { ...state, stats, recent: [event, ...state.recent].slice(0, 10) }
}

export function withUse(state: GuardState, model: string): GuardState {
  const family = familyOf(model)
  const stats = { ...state.stats, [family]: { ...state.stats[family], uses: state.stats[family].uses + 1 } }
  const seen = /^claude-|^[a-z]+-\d/.test(model) ? { ...state.seen, [family]: model } : state.seen
  return { ...state, stats, seen }
}

/** Model names a Workflow script asks for (`model: 'haiku'`, `model: "claude-…"`). */
export function workflowModels(script: string): string[] {
  const found: string[] = []
  const re = /\bmodel\s*:\s*['"`]([^'"`]+)['"`]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(script)) !== null) {
    if (m[1] !== undefined) {
      found.push(m[1])
    }
  }
  return found
}

/** The one-line summary used by the status line and the text answer. */
export function summaryOf(state: GuardState): string {
  const swaps = FAMILIES.reduce((n, f) => n + state.stats[f].swapped, 0)
  const denials = FAMILIES.reduce((n, f) => n + state.stats[f].denied, 0)
  const parts = [`allowed: ${state.allowed.join(', ')}`]
  if (swaps > 0) parts.push(`${swaps} swapped`)
  if (denials > 0) parts.push(`${denials} refused`)
  return parts.join(' · ')
}

/** "12m", "3h", "now". */
export function ageOf(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? `${m % 60}m` : ''}`
}
