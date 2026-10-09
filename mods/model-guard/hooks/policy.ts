/**
 * The rules: a default per family, a rule per version that wins over it, and
 * where a blocked request goes. Pure: no `$`.
 */
import { compareEntries, EMPTY_CATALOG, entriesOf, familiesOf } from './catalog'
import type { Catalog, CatalogEntry } from './catalog'
import { aliasOf, familyOfId, familyOfKey, isInherited, keyOf, KNOWN_FAMILIES } from './ids'

export type Decision = 'allow' | 'block'
export type Mode = 'deny' | 'swap'

export type Policy = {
  /** Default for versions with no rule of their own. */
  families: Record<string, Decision>
  /** Default for a family not in `families`. */
  unnamedFamilies: Decision
  /** Version key → rule; wins over the family default. */
  versions: Record<string, Decision>
  /** A version key ('opus-4.8') or a family ('opus' = its newest allowed version). */
  fallback: string | null
  mode: Mode
}

const defaultPolicy = (): Policy => ({ families: {}, unnamedFamilies: 'allow', versions: {}, fallback: 'opus', mode: 'deny' })

export const DEFAULT_POLICY: Policy = defaultPolicy()

/** Where a swap goes when neither the family nor the fallback has an allowed version: the one family order left in code. */
const PREFERENCE = ['opus', 'fable', 'sonnet', 'haiku'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isDecision = (v: unknown): v is Decision => v === 'allow' || v === 'block'
const isMode = (v: unknown): v is Mode => v === 'deny' || v === 'swap'
const own = (record: Record<string, Decision>, key: string): Decision | undefined => (Object.hasOwn(record, key) ? record[key] : undefined)

const familyDefault = (policy: Policy, family: string): Decision => own(policy.families, family) ?? policy.unnamedFamilies

/** Version rule → family default → unnamedFamilies. */
export function decisionFor(policy: Policy, key: string, family: string): Decision {
  return own(policy.versions, key) ?? familyDefault(policy, family)
}

/** Whether this version has a rule of its own. */
export function isRuled(policy: Policy, key: string): boolean {
  return Object.hasOwn(policy.versions, key)
}

const allows = (policy: Policy) => (entry: CatalogEntry) => decisionFor(policy, entry.key, entry.family) === 'allow'

/** The allowed entries, newest first; one family's when `family` is given. */
export function allowedEntries(policy: Policy, catalog: Catalog, family?: string): CatalogEntry[] {
  const entries = family === undefined ? [...catalog.entries].sort(compareEntries) : entriesOf(catalog, family)
  return entries.filter(allows(policy))
}

/** A family word: a known family or any family in the list ('other' is not one). */
const aliasIn = (catalog: Catalog, model: string) => aliasOf(model, familiesOf(catalog).filter(f => f !== 'other'))

/** A full id's family: its entry's (which the API's `line` may have named), else read from the id. */
function familyIn(catalog: Catalog, id: string): string {
  const key = keyOf(id)
  return catalog.entries.find(e => e.key === key)?.family ?? familyOfId(id)
}

/** May a request on `model` run? inherited → true; alias → the family has an allowed entry, or (no entries of that family) its family default; id → decisionFor(keyOf, its family). */
export function isAllowedModel(policy: Policy, catalog: Catalog, model: string | null | undefined): boolean {
  if (model === null || model === undefined || isInherited(model)) return true
  const alias = aliasIn(catalog, model)
  if (alias === null) return decisionFor(policy, keyOf(model), familyIn(catalog, model)) === 'allow'
  if (entriesOf(catalog, alias.family).length === 0) return familyDefault(policy, alias.family) === 'allow'
  return allowedEntries(policy, catalog, alias.family).length > 0
}

/**
 * What to send for `asked`, or null when nothing in its family may run.
 * inherited → asked. Alias: if no entry of the family is blocked → asked unchanged (the host picks
 * its newest); else the newest allowed entry's ids[0] + the alias suffix (`opus[1m]` →
 * `claude-opus-4-8[1m]`); none allowed → null; no entries of the family → asked if the family
 * default allows, else null. Full id: allowed → asked, else null.
 */
export function concreteFor(policy: Policy, catalog: Catalog, asked: string): string | null {
  if (isInherited(asked)) return asked
  const alias = aliasIn(catalog, asked)
  if (alias === null) return isAllowedModel(policy, catalog, asked) ? asked : null
  const entries = entriesOf(catalog, alias.family)
  if (entries.length === 0) return familyDefault(policy, alias.family) === 'allow' ? asked : null
  if (!mayPickBlocked(policy, catalog, alias.family, entries)) return asked
  const id = entries.find(allows(policy))?.ids[0]
  return id === undefined ? null : `${id}${alias.suffix}`
}

/** Could the host's own newest for this family be blocked? A blocked entry, a blocking family default, or a block rule on any of its versions (listed or not). */
function mayPickBlocked(policy: Policy, catalog: Catalog, family: string, entries: readonly CatalogEntry[]): boolean {
  if (familyDefault(policy, family) === 'block' || !entries.every(allows(policy))) return true
  const familyOfRule = (key: string) => catalog.entries.find(e => e.key === key)?.family ?? familyOfKey(key)
  return Object.entries(policy.versions).some(([key, decision]) => decision === 'block' && familyOfRule(key) === family)
}

/** Newest allowed by PREFERENCE (opus, fable, sonnet, haiku). */
function preferred(policy: Policy, catalog: Catalog): CatalogEntry | null {
  for (const family of PREFERENCE) {
    const entry = allowedEntries(policy, catalog, family)[0]
    if (entry !== undefined) return entry
  }
  return null
}

/** policy.fallback as an entry: the version it names if listed, else the newest allowed of its family ('sonnet-4.9' or 'sonnet'); null when blocked or absent. */
function namedFallback(policy: Policy, catalog: Catalog): CatalogEntry | null {
  const fallback = policy.fallback?.trim() ?? ''
  if (fallback === '') return null
  const key = keyOf(fallback)
  const exact = catalog.entries.find(e => e.key === key)
  if (exact === undefined) return allowedEntries(policy, catalog, familyOfKey(key) ?? key)[0] ?? null
  return allows(policy)(exact) ? exact : null
}

/** policy.fallback resolved (key or family), if allowed; else by PREFERENCE. */
export function fallbackEntry(policy: Policy, catalog: Catalog): CatalogEntry | null {
  return namedFallback(policy, catalog) ?? preferred(policy, catalog)
}

/** The version a blocked request goes to: newest allowed in the same family → the fallback → newest allowed by PREFERENCE (opus, fable, sonnet, haiku) → newest allowed of any family → null. */
export function swapTarget(policy: Policy, catalog: Catalog, family: string): CatalogEntry | null {
  return allowedEntries(policy, catalog, family)[0] ?? fallbackEntry(policy, catalog) ?? allowedEntries(policy, catalog)[0] ?? null
}

/** `next`, unless it blocks something and leaves no entry of a non-empty list allowed (something must run). Allowing is never refused. */
function guarded(policy: Policy, catalog: Catalog, blocks: boolean, next: Policy): Policy {
  return blocks && catalog.entries.length > 0 && allowedEntries(next, catalog).length === 0 ? policy : next
}

/** Version rule set; refuses (returns the same object) when it would leave no catalog entry allowed. */
export function withVersion(policy: Policy, catalog: Catalog, key: string, decision: Decision): Policy {
  return guarded(policy, catalog, decision === 'block', { ...policy, versions: { ...policy.versions, [keyOf(key)]: decision } })
}

/** Family default set; same refusal rule as withVersion. */
export function withFamily(policy: Policy, catalog: Catalog, family: string, decision: Decision): Policy {
  return guarded(policy, catalog, decision === 'block', { ...policy, families: { ...policy.families, [family.trim().toLowerCase()]: decision } })
}

/** The default for families not in `families`; same refusal rule as withVersion. */
export function withUnnamed(policy: Policy, catalog: Catalog, decision: Decision): Policy {
  return guarded(policy, catalog, decision === 'block', { ...policy, unnamedFamilies: decision })
}

/** `/models opus,sonnet`: listed families allow, every other known family (KNOWN_FAMILIES + catalog families) block, unnamedFamilies = listed includes 'other' ? allow : block. Version rules kept. Same refusal rule as withVersion. */
export function withFamilyList(policy: Policy, catalog: Catalog, listed: readonly string[]): Policy {
  const on = new Set(listed.map(f => f.trim().toLowerCase()).filter(f => f !== ''))
  const known = new Set([...KNOWN_FAMILIES, ...familiesOf(catalog), ...Object.keys(policy.families), ...on])
  known.delete('other')
  const families = Object.fromEntries([...known].map((f): [string, Decision] => [f, on.has(f) ? 'allow' : 'block']))
  return guarded(policy, catalog, true, { ...policy, families, unnamedFamilies: on.has('other') ? 'allow' : 'block' })
}

/** The allow/block rules of a stored record, keys normalised by `norm`; anything else dropped. */
function rulesOf(raw: Record<string, unknown>, norm: (key: string) => string): Record<string, Decision> {
  const rules: [string, Decision][] = []
  for (const [key, value] of Object.entries(raw)) {
    const name = norm(key)
    if (isDecision(value) && name !== '') rules.push([name, value])
  }
  return Object.fromEntries(rules)
}

/**
 * A stored 0.3 record (it has `families` and `versions` objects), read leniently so one bad field never
 * loses the rules: a bad `unnamedFamilies`/`mode`/`fallback` takes its default, a bad rule is dropped. Anything else → null.
 */
export function parsePolicy(raw: unknown): Policy | null {
  if (!isRecord(raw) || !isRecord(raw.families) || !isRecord(raw.versions)) return null
  const { unnamedFamilies, fallback, mode } = raw
  const defaults = defaultPolicy()
  return {
    families: rulesOf(raw.families, f => f.trim().toLowerCase()),
    unnamedFamilies: isDecision(unnamedFamilies) ? unnamedFamilies : defaults.unnamedFamilies,
    versions: rulesOf(raw.versions, keyOf),
    fallback: typeof fallback === 'string' || fallback === null ? fallback : defaults.fallback,
    mode: isMode(mode) ? mode : defaults.mode,
  }
}

export type LegacyOptions = { defaultAllowed?: unknown; fallback?: unknown; mode?: unknown }

/** The 0.2 family words. */
const LEGACY_FAMILIES: readonly string[] = [...KNOWN_FAMILIES, 'other']

/** A 0.2 family list ('opus,fable' or ['opus', 'fable']) → its family words; null when it names none. */
function legacyList(raw: unknown): string[] | null {
  const words = typeof raw === 'string' ? raw.split(/[\s,;]+/) : Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : []
  const list = words.map(w => w.trim().toLowerCase()).filter(w => LEGACY_FAMILIES.includes(w))
  return list.length > 0 ? list : null
}

/** A 0.2 fallback: one of its family words ('other' included, resolved as a family), else undefined. */
function legacyFallback(raw: unknown): string | undefined {
  const word = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return LEGACY_FAMILIES.includes(word) ? word : undefined
}

/**
 * Any stored value → Policy. A 0.3 record → parsePolicy. A 0.2 record `{ allowed: string[], fallback?, mode? }`
 * or a plain string array → withFamilyList over DEFAULT_POLICY (families from the 0.2 list:
 * opus/sonnet/haiku/fable/other), fallback family kept as-is, mode kept. Nothing stored → the
 * legacy options (comma string `defaultAllowed`, `fallback`, `mode`) the same way; nothing at all → DEFAULT_POLICY.
 * As in 0.2, a field the stored record lacks comes from the options.
 */
export function migratePolicy(stored: unknown, legacy: LegacyOptions): Policy {
  const current = parsePolicy(stored)
  if (current !== null) return current
  const record: Record<string, unknown> = Array.isArray(stored) ? { allowed: stored } : isRecord(stored) ? stored : {}
  const list = legacyList(record.allowed) ?? legacyList(legacy.defaultAllowed)
  const base = list === null ? defaultPolicy() : withFamilyList(defaultPolicy(), EMPTY_CATALOG, list)
  const mode = isMode(record.mode) ? record.mode : isMode(legacy.mode) ? legacy.mode : base.mode
  return { ...base, fallback: legacyFallback(record.fallback) ?? legacyFallback(legacy.fallback) ?? base.fallback, mode }
}
