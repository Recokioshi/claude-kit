/**
 * The lists in the plugin store, shared by every local Claude Code process
 * (desktop, terminals, VS Code): the global rules, a repo's own rules, and
 * the model list. Reached through plain functions the hooks module hands in;
 * `$` itself never crosses into this file (the loader follows it only within
 * one file).
 */
import { mergeCatalog, parseCatalog, parseModelsResponse, removeAdded } from './catalog'
import type { Catalog, CatalogEntry, Incoming, Result } from './catalog'
import { aliasOf, isInherited, splitSuffix } from './ids'
import { migratePolicy, parsePolicy } from './policy'
import type { LegacyOptions, Policy } from './policy'

export type StorePort = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

/** One GET through the session's own login. */
export type FetchPort = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

export const GLOBAL_KEY = 'policy:global'
export const CATALOG_KEY = 'catalog'
export const repoKeyOf = (root: string) => `repo:${root}`

export const MODELS_URL = 'https://api.anthropic.com/v1/models'
export const API_VERSION = '2023-06-01'
export const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 1000
const MAX_PAGES = 5

export type Lists = { policy: Policy; source: 'global' | 'repo'; catalog: Catalog }

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The lists in force for a folder. A global list that does not exist yet is
 * seeded from the 0.2 settings rows; a 0.2 repo record is migrated. Both are
 * written back, so every instance reads the same thing.
 */
export async function readLists(store: StorePort, root: string | null, legacy: LegacyOptions): Promise<Lists> {
  let global = parsePolicy(await store.get(GLOBAL_KEY))
  if (global === null) {
    global = migratePolicy(undefined, legacy)
    await store.set(GLOBAL_KEY, global)
  }
  let repo: Policy | null = null
  const stored = root === null ? undefined : await store.get(repoKeyOf(root))
  if (root !== null && stored !== undefined && stored !== null) {
    repo = parsePolicy(stored)
    if (repo === null) {
      repo = migratePolicy(stored, legacy)
      await store.set(repoKeyOf(root), repo)
    }
  }
  const catalog = parseCatalog(await store.get(CATALOG_KEY))
  return repo === null ? { policy: global, source: 'global', catalog } : { policy: repo, source: 'repo', catalog }
}

/** One change to a stored list, read again first: another process may have changed it since. */
export async function changeList(store: StorePort, key: string, current: Policy, change: (policy: Policy) => Policy): Promise<{ policy: Policy; isChanged: boolean }> {
  const stored = parsePolicy(await store.get(key)) ?? current
  const policy = change(stored)
  const isChanged = policy !== stored
  if (isChanged) {
    await store.set(key, policy)
  }
  return { policy, isChanged }
}

/** Folds sightings into the stored list (read again first) and writes it back. */
async function mergeStored(store: StorePort, incoming: readonly Incoming[], now: number): Promise<{ catalog: Catalog; added: CatalogEntry[] }> {
  const merged = mergeCatalog(parseCatalog(await store.get(CATALOG_KEY)), incoming, now)
  await store.set(CATALOG_KEY, merged.catalog)
  return merged
}

/** Model ids the session saw running, added to the list; null when none was new (no write). */
export async function addSeen(store: StorePort, known: Catalog, models: readonly (string | null | undefined)[], now: number): Promise<Catalog | null> {
  const fresh = models
    .filter((m): m is string => typeof m === 'string' && !isInherited(m) && aliasOf(m) === null)
    .filter(m => !known.entries.some(e => e.ids.includes(splitSuffix(m).base)))
  if (fresh.length === 0) {
    return null
  }
  return (await mergeStored(store, fresh.map(id => ({ id, source: 'seen' as const })), now)).catalog
}

/** A model id the user names (`/models add`): kept even if no source lists it. */
export async function addModel(store: StorePort, id: string, now: number): Promise<{ catalog: Catalog; added: CatalogEntry[] }> {
  return mergeStored(store, [{ id, source: 'added' }], now)
}

/** Takes back a `/models add`; a model another source lists stays. */
export async function removeModel(store: StorePort, id: string): Promise<Catalog> {
  const catalog = removeAdded(parseCatalog(await store.get(CATALOG_KEY)), id)
  await store.set(CATALOG_KEY, catalog)
  return catalog
}

export const isStale = (catalog: Catalog, now: number) => catalog.fetchedAt === null || now - catalog.fetchedAt >= REFRESH_EVERY_MS

/** Every page of `GET /v1/models`; any failed or unreadable page fails the whole answer (never a partial list). */
export async function fetchModels(fetchPage: FetchPort): Promise<Result<Incoming[]>> {
  const models: Incoming[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${MODELS_URL}?limit=${PAGE_SIZE}${after === null ? '' : `&after_id=${encodeURIComponent(after)}`}`
    let response: Awaited<ReturnType<FetchPort>>
    try {
      response = await fetchPage(url)
    } catch (error) {
      return { ok: false, error: `the Models API could not be reached (${messageOf(error)})` }
    }
    if (!response.ok) {
      return { ok: false, error: `the Models API answered ${response.status}` }
    }
    const parsed = parseModelsResponse(response.text)
    if (!parsed.ok) {
      return { ok: false, error: `the Models API answer was not understood (${parsed.error})` }
    }
    models.push(...parsed.value.models.map(m => ({ ...m, source: 'api' as const })))
    if (!parsed.value.hasMore || parsed.value.lastId === null) {
      return { ok: true, value: models }
    }
    after = parsed.value.lastId
  }
  return { ok: false, error: `the Models API kept paging past ${MAX_PAGES * PAGE_SIZE} models` }
}

/**
 * A fetch's outcome into the stored list: merged with the time on success,
 * the reason on failure (the list itself kept). `added` is reported only when
 * the list already had an API fill, so the first one announces nothing.
 */
export async function saveFetched(store: StorePort, result: Result<Incoming[]>, now: number): Promise<{ catalog: Catalog; added: CatalogEntry[] }> {
  const stored = parseCatalog(await store.get(CATALOG_KEY))
  if (!result.ok) {
    const catalog = { ...stored, lastError: result.error }
    await store.set(CATALOG_KEY, catalog)
    return { catalog, added: [] }
  }
  const merged = mergeCatalog(stored, result.value, now)
  const catalog = { ...merged.catalog, fetchedAt: now, lastError: null }
  await store.set(CATALOG_KEY, catalog)
  return { catalog, added: stored.fetchedAt === null ? [] : merged.added }
}
