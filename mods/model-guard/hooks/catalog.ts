/**
 * The model list: one entry per version, merged from the Models API, models
 * seen in the session, and ids the user added. Pure: no `$`.
 */
import { aliasOf, compareVersions, familyOfId, familyRank, isInherited, keyOf, parseModelId, splitSuffix } from './ids'

export type CatalogSource = 'api' | 'seen' | 'added' | 'seed'
const SOURCES: readonly CatalogSource[] = ['api', 'seen', 'added', 'seed']

export type CatalogEntry = {
  key: string
  family: string
  version: string
  /** Every spelling seen, suffix-free; ids[0] is the one to send. */
  ids: string[]
  displayName?: string
  createdAt?: string
  sources: CatalogSource[]
  firstSeenAt: number
}

export type Catalog = { entries: CatalogEntry[]; fetchedAt: number | null; lastError: string | null }

const emptyCatalog = (): Catalog => ({ entries: [], fetchedAt: null, lastError: null })

export const EMPTY_CATALOG: Catalog = emptyCatalog()

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** `line` is the family as the API names it ('haiku'); it names the family of an id that does not parse. */
export type ApiModel = { id: string; displayName?: string; createdAt?: string; line?: string }

export type ModelsPage = { models: ApiModel[]; hasMore: boolean; lastId: string | null }

export type Incoming = { id: string; source: CatalogSource; displayName?: string; createdAt?: string; line?: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFilled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isSource = (v: unknown): v is CatalogSource => SOURCES.some(s => s === v)

/** `{ displayName, createdAt }`, each key present only when its value is a string. */
const meta = (displayName: unknown, createdAt: unknown) => ({
  ...(typeof displayName === 'string' ? { displayName } : {}),
  ...(typeof createdAt === 'string' ? { createdAt } : {}),
})

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** Anthropic GET /v1/models body → page. External input: hand-narrowed; any bad shape → { ok:false, error } (never a partial list). */
export function parseModelsResponse(text: string): Result<ModelsPage> {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail('the answer is not JSON')
  }
  if (!isRecord(body)) return fail('the answer is not an object')
  if (!Array.isArray(body.data)) return fail('the answer has no data list')
  if (typeof body.has_more !== 'boolean') return fail('the answer has no has_more flag')
  const lastId = isFilled(body.last_id) ? body.last_id : null
  if (body.has_more && lastId === null) return fail('the answer has more pages but no last_id')
  const models: ApiModel[] = []
  for (const [i, item] of body.data.entries()) {
    if (!isRecord(item) || !isFilled(item.id)) return fail(`model ${i + 1} has no id`)
    const line = isFilled(item.line) ? { line: item.line } : {}
    models.push({ id: item.id, ...meta(item.display_name, item.created_at), ...line })
  }
  return { ok: true, value: { models, hasMore: body.has_more, lastId } }
}

const sameId = (a: string) => (b: string) => a.toLowerCase() === b.toLowerCase()
const familyName = (v: unknown): string | undefined => (isFilled(v) ? v.trim().toLowerCase() : undefined)

/**
 * Key, family and version read from an id. An id that does not parse is its own key, version '';
 * its family is a known family word inside it, else `named` (the API's line, or the stored family), else 'other'.
 */
function identityOf(id: string, named: string | undefined): Pick<CatalogEntry, 'key' | 'family' | 'version'> {
  const parsed = parseModelId(id)
  if (parsed !== null) return { key: parsed.key, family: parsed.family, version: parsed.version }
  const guessed = familyOfId(id)
  return { key: keyOf(id), family: guessed !== 'other' ? guessed : (named ?? 'other'), version: '' }
}

/** One sighting folded into its entry (or a new one). */
function sighted(current: CatalogEntry | undefined, item: Incoming, base: string, now: number): CatalogEntry {
  const line = familyName(item.line)
  const isApi = item.source === 'api'
  if (current === undefined) {
    return {
      ...identityOf(base, line),
      ids: [base],
      ...meta(item.displayName, item.createdAt),
      sources: [item.source],
      firstSeenAt: now,
    }
  }
  const known = current.ids.some(sameId(base))
  const ids = isApi ? [base, ...current.ids.filter(id => !sameId(base)(id))] : known ? current.ids : [...current.ids, base]
  const displayName = isApi ? (item.displayName ?? current.displayName) : (current.displayName ?? item.displayName)
  const createdAt = isApi ? (item.createdAt ?? current.createdAt) : (current.createdAt ?? item.createdAt)
  return {
    ...current,
    family: identityOf(base, line ?? current.family).family,
    ids,
    ...meta(displayName, createdAt),
    sources: current.sources.includes(item.source) ? current.sources : [...current.sources, item.source],
  }
}

/** Claude Code's own model aliases that name no one version. */
const HOST_ALIASES: readonly string[] = ['default', 'opusplan']

/** Not a version: nothing, `inherit`, a family alias ('opus', 'opus[1m]') or a host alias ('opusplan'). */
function isVersionless(base: string, families: readonly string[]): boolean {
  return base === '' || isInherited(base) || aliasOf(base, families) !== null || HOST_ALIASES.includes(base.toLowerCase())
}

/**
 * Folds sightings into the list, one entry per version key. Ids are stored suffix-free; an `api`
 * id becomes the one to send. `added` = entries new to the list. `fetchedAt`/`lastError` are the caller's.
 */
export function mergeCatalog(catalog: Catalog, incoming: readonly Incoming[], now: number): { catalog: Catalog; added: CatalogEntry[] } {
  const before = new Set(catalog.entries.map(e => e.key))
  const entries = [...catalog.entries]
  const at = new Map(entries.map((e, i) => [e.key, i]))
  const families = familiesOf(catalog).filter(f => f !== 'other')
  for (const item of incoming) {
    const base = splitSuffix(item.id).base
    if (isVersionless(base, families)) continue
    const key = keyOf(base)
    const i = at.get(key)
    const entry = sighted(i === undefined ? undefined : entries[i], item, base, now)
    if (i === undefined) {
      at.set(key, entries.length)
      entries.push(entry)
    } else {
      entries[i] = entry
    }
  }
  return { catalog: { ...catalog, entries }, added: entries.filter(e => !before.has(e.key)) }
}

/** `/models remove <id>`: drops the `added` source from that version; the entry goes when no source is left. */
export function removeAdded(catalog: Catalog, id: string): Catalog {
  const key = keyOf(id)
  const entry = catalog.entries.find(e => e.key === key)
  if (entry === undefined || !entry.sources.includes('added')) return catalog
  const sources = entry.sources.filter(s => s !== 'added')
  const entries = sources.length === 0 ? catalog.entries.filter(e => e !== entry) : catalog.entries.map(e => (e === entry ? { ...e, sources } : e))
  return { ...catalog, entries }
}

/** A stored entry; key, family and version are read again from ids[0], so older keys are brought up to date. */
function entryOf(raw: unknown): CatalogEntry | null {
  if (!isRecord(raw)) return null
  const { family, ids, sources, firstSeenAt } = raw
  if (!Array.isArray(ids) || !ids.every(isFilled)) return null
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every(isSource)) return null
  if (typeof firstSeenAt !== 'number' || !Number.isFinite(firstSeenAt)) return null
  const [first] = ids
  if (first === undefined) return null
  return { ...identityOf(first, familyName(family)), ids: [...ids], ...meta(raw.displayName, raw.createdAt), sources: [...sources], firstSeenAt }
}

/** Two stored entries of one version as one: the API's spelling first, every id and source once, the earliest sighting. */
function joined(a: CatalogEntry, b: CatalogEntry): CatalogEntry {
  const [first, second] = b.sources.includes('api') && !a.sources.includes('api') ? [b, a] : [a, b]
  return {
    ...first,
    ids: [...first.ids, ...second.ids.filter(id => !first.ids.some(sameId(id)))],
    ...meta(first.displayName ?? second.displayName, first.createdAt ?? second.createdAt),
    sources: [...a.sources, ...b.sources.filter(s => !a.sources.includes(s))],
    firstSeenAt: Math.min(a.firstSeenAt, b.firstSeenAt),
  }
}

/** Narrows a stored value; garbage → an empty list; malformed entries dropped, entries of one version joined. */
export function parseCatalog(raw: unknown): Catalog {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return emptyCatalog()
  const entries: CatalogEntry[] = []
  const at = new Map<string, number>()
  for (const item of raw.entries) {
    const entry = entryOf(item)
    if (entry === null) continue
    const i = at.get(entry.key)
    const kept = i === undefined ? undefined : entries[i]
    if (i === undefined || kept === undefined) {
      at.set(entry.key, entries.length)
      entries.push(entry)
    } else {
      entries[i] = joined(kept, entry)
    }
  }
  const fetchedAt = typeof raw.fetchedAt === 'number' && Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : null
  const lastError = typeof raw.lastError === 'string' ? raw.lastError : null
  return { entries, fetchedAt, lastError }
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Newest first: compareVersions desc, then createdAt desc. */
export function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  return compareVersions(b.version, a.version) || byText(b.createdAt ?? '', a.createdAt ?? '')
}

/** Families present, display order: KNOWN_FAMILIES first, then others alphabetical, 'other' last. */
export function familiesOf(catalog: Catalog): string[] {
  return [...new Set(catalog.entries.map(e => e.family))].sort((a, b) => familyRank(a) - familyRank(b) || byText(a, b))
}

/** One family's entries, newest first. */
export function entriesOf(catalog: Catalog, family: string): CatalogEntry[] {
  return catalog.entries.filter(e => e.family === family).sort(compareEntries)
}

/** The newest entry of each family, in display order. */
export function newestPerFamily(catalog: Catalog): CatalogEntry[] {
  return familiesOf(catalog).flatMap(f => entriesOf(catalog, f).slice(0, 1))
}

/** main = newest per family + every entry `isRuled` says has its own rule; more = the rest. Both grouped by family (display order), newest first inside. */
export function splitForView(catalog: Catalog, isRuled: (entry: CatalogEntry) => boolean): { main: CatalogEntry[]; more: CatalogEntry[] } {
  const main: CatalogEntry[] = []
  const more: CatalogEntry[] = []
  for (const family of familiesOf(catalog)) {
    entriesOf(catalog, family).forEach((entry, i) => (i === 0 || isRuled(entry) ? main : more).push(entry))
  }
  return { main, more }
}
