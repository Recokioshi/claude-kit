/**
 * The guard's session state and its transitions. Pure: no `$`.
 *
 * `policy` and `catalog` are this session's copies of what the store holds
 * (shared by every local Claude Code process); the rest is the session's own.
 */
import { EMPTY_CATALOG, familiesOf } from './catalog'
import type { Catalog, CatalogEntry } from './catalog'
import { aliasOf, familyOfKey, keyOf, KNOWN_FAMILIES } from './ids'
import { allowedEntries, decisionFor, DEFAULT_POLICY, fallbackEntry, withFamily, withUnnamed, withVersion } from './policy'
import type { Policy } from './policy'

export type Stats = { uses: number; swapped: number; denied: number }

export type GuardEvent = {
  at: number
  /** `~` a request was swapped, `✗` a spawn or switch was refused. */
  kind: 'swap' | 'deny'
  /** What it concerned: an agent's description, `Workflow`, `/model`. */
  what: string
  /** The version key (or family alias) asked for. */
  from: string
  /** The version key it went to. */
  to?: string
}

export type GuardState = {
  /** 3: the 0.3 shape. A state left by an older build (hot reload) is seeded again. */
  shape: 3
  isReady: boolean
  policy: Policy
  /** Which list `policy` is: the global one, or this repo's override. */
  source: 'global' | 'repo'
  repoRoot: string | null
  repoName: string | null
  catalog: Catalog
  /** Per version key. */
  stats: Record<string, Stats>
  recent: GuardEvent[]
  /** Agent loops already swapped, so each is reported once. */
  swappedLoops: string[]
  /** The pane: older versions shown, and which view. */
  expanded: boolean
  view: 'versions' | 'families'
}

export const EMPTY_STATE: GuardState = {
  shape: 3,
  isReady: false,
  policy: DEFAULT_POLICY,
  source: 'global',
  repoRoot: null,
  repoName: null,
  catalog: EMPTY_CATALOG,
  stats: {},
  recent: [],
  swappedLoops: [],
  expanded: false,
  view: 'versions',
}

/** A state this build can use: seeded, and of the 0.3 shape. */
export function isCurrent(state: unknown): state is GuardState {
  const s = state as Partial<GuardState> | null
  return s !== null && typeof s === 'object' && s.shape === 3 && s.isReady === true
}

const ZERO: Stats = { uses: 0, swapped: 0, denied: 0 }

export function statOf(state: Pick<GuardState, 'stats'>, key: string): Stats {
  return state.stats[key] ?? ZERO
}

export function withEvent(state: GuardState, event: GuardEvent): GuardState {
  const from = { ...statOf(state, event.from) }
  if (event.kind === 'swap') {
    from.swapped += 1
  } else {
    from.denied += 1
  }
  return { ...state, stats: { ...state.stats, [event.from]: from }, recent: [event, ...state.recent].slice(0, 10) }
}

export function withUse(state: GuardState, key: string): GuardState {
  const s = statOf(state, key)
  return { ...state, stats: { ...state.stats, [key]: { ...s, uses: s.uses + 1 } } }
}

/** A version's family: from the list when it is there, else read from the key. */
function familyOfEntryKey(catalog: Catalog, key: string): string {
  return catalog.entries.find(e => e.key === key)?.family ?? familyOfKey(key) ?? 'other'
}

/** Flips one version between allowed and blocked; the same object when that would block the last allowed one. */
export function toggledVersion(policy: Policy, catalog: Catalog, key: string): Policy {
  const on = decisionFor(policy, key, familyOfEntryKey(catalog, key)) === 'allow'
  return withVersion(policy, catalog, key, on ? 'block' : 'allow')
}

/** The families the pane offers a default for (known ones first); `other` stands for every family not named. */
export function familyRowsOf(catalog: Catalog): string[] {
  const named = [...new Set([...KNOWN_FAMILIES, ...familiesOf(catalog)])].filter(f => f !== 'other')
  return [...named, 'other']
}

/** A family's default for versions with no rule of their own (`other`: every family not named). */
export function familyDefaultOf(policy: Policy, family: string): 'allow' | 'block' {
  return family === 'other' ? policy.unnamedFamilies : (policy.families[family] ?? policy.unnamedFamilies)
}

/** Flips a family's default; the same object when that would block the last allowed model. */
export function toggledFamily(policy: Policy, catalog: Catalog, family: string): Policy {
  const next = familyDefaultOf(policy, family) === 'allow' ? 'block' : 'allow'
  return family === 'other' ? withUnnamed(policy, catalog, next) : withFamily(policy, catalog, family, next)
}

/** Steps the fallback to the newest allowed version of the next family that has one. */
export function cycledFallback(policy: Policy, catalog: Catalog): Policy {
  const options = familiesOf(catalog)
    .map(f => allowedEntries(policy, catalog, f)[0])
    .filter((e): e is CatalogEntry => e !== undefined)
  const current = fallbackEntry(policy, catalog)
  const i = current === null ? -1 : options.findIndex(e => e.key === current.key)
  const next = options[(i + 1) % Math.max(1, options.length)]
  return next === undefined ? policy : { ...policy, fallback: next.key }
}

/** 'opus-4.8' → 'opus 4.8'; an id or alias without a version stays as it is. */
export function labelOf(key: string): string {
  const m = /^([a-z]+)-(\d+(?:\.\d+)*)$/.exec(key)
  return m === null ? key : `${m[1]} ${m[2]}`
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

/** What is blocked, in words: versions, whole families, families not named. */
export function blockedOf(policy: Policy): string[] {
  const versions = Object.entries(policy.versions).filter(([, d]) => d === 'block').map(([k]) => labelOf(k))
  const families = Object.entries(policy.families).filter(([, d]) => d === 'block').map(([f]) => `${f} (all)`)
  const unnamed = policy.unnamedFamilies === 'block' ? ['other families'] : []
  return [...versions, ...families, ...unnamed]
}

/** The one-line summary used by the status line and the text answer. */
export function summaryOf(state: GuardState): string {
  const all = Object.values(state.stats)
  const swaps = all.reduce((n, s) => n + s.swapped, 0)
  const denials = all.reduce((n, s) => n + s.denied, 0)
  const blocked = blockedOf(state.policy)
  const parts = [blocked.length === 0 ? 'nothing blocked' : `blocked: ${blocked.join(', ')}`]
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
  if (h < 48) return `${h}h${m % 60 ? `${m % 60}m` : ''}`
  return `${Math.floor(h / 24)}d`
}

/** What a request names, for messages and stats: `opus` for an alias, `opus-5` for an id. */
export function nameOf(model: string): string {
  return aliasOf(model)?.family ?? keyOf(model)
}

/** The refusal Claude reads: what is blocked, and what to ask for instead. */
export function refusalOf(policy: Policy, asked: string, target: string | null): string {
  const instead = target === null ? 'No allowed model is known yet; ask the user to open /models.' : `Spawn the agent again with model "${target}".`
  return `model-guard: ${labelOf(nameOf(asked))} is blocked in this session (blocked: ${blockedOf(policy).join(', ') || 'nothing else'}). ${instead}`
}

/** The toast for a model the list did not have before. */
export function newModelText(policy: Policy, entry: CatalogEntry): string {
  const on = decisionFor(policy, entry.key, entry.family) === 'allow'
  return `model-guard: new model ${entry.displayName ?? labelOf(entry.key)} (${entry.ids[0] ?? entry.key}), ${on ? 'allowed' : 'blocked'}. /models to change.`
}

/** Why a 0.2-style family list can't be used (an unknown word, or nothing), else null. */
export function familyListProblem(words: readonly string[], catalog: Catalog): string | null {
  const known = new Set<string>([...KNOWN_FAMILIES, ...familiesOf(catalog), 'other'])
  const unknown = words.filter(w => !known.has(w))
  if (words.length > 0 && unknown.length === 0) {
    return null
  }
  return `No model family in "${unknown.join(' ') || words.join(' ')}". Use any of: ${[...known].join(', ')}.`
}
