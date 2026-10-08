import { describe, expect, test } from 'claude-code/testing'

import {
  compareEntries,
  EMPTY_CATALOG,
  entriesOf,
  familiesOf,
  mergeCatalog,
  newestPerFamily,
  parseCatalog,
  parseModelsResponse,
  removeAdded,
  splitForView,
} from '../hooks/catalog'
import type { Catalog, CatalogEntry, Incoming } from '../hooks/catalog'

/** The ids the real Models API answered with, newest release first. */
const API_IDS = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
]

const lineOf = (id: string) => /^claude-([a-z]+)/.exec(id)?.[1] ?? 'other'

/** A /v1/models body in the API's own shape, extra fields included. */
function apiBody(ids: readonly string[], extra: Record<string, unknown> = {}) {
  const data = ids.map((id, i) => ({
    type: 'model',
    id,
    display_name: `Claude ${id}`,
    created_at: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
    line: lineOf(id),
    lifecycle: 'active',
    deprecated_at: null,
    retires_at: null,
    capabilities: { vision: true, context: { max: 1000000 } },
  }))
  return JSON.stringify({ data, has_more: false, first_id: ids[0] ?? null, last_id: ids.at(-1) ?? null, ...extra })
}

const fromApi = (ids: readonly string[]): Incoming[] => ids.map(id => ({ id, source: 'api', line: lineOf(id) }))
const filled = (now = 1000) => mergeCatalog(EMPTY_CATALOG, fromApi(API_IDS), now).catalog
const keys = (entries: readonly CatalogEntry[]) => entries.map(e => e.key)
const entry = (catalog: Catalog, key: string) => catalog.entries.find(e => e.key === key)

describe('parseModelsResponse', () => {
  test('reads a real page: ids, names, dates and line; other fields ignored', () => {
    const page = parseModelsResponse(apiBody(API_IDS))
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.models.map(m => m.id)).toEqual(API_IDS)
    expect(page.value.models[0]).toEqual({ id: 'claude-haiku-5-5', displayName: 'Claude claude-haiku-5-5', createdAt: '2026-01-01T00:00:00Z', line: 'haiku' })
    expect(page.value.hasMore).toBe(false)
    expect(page.value.lastId).toBe('claude-sonnet-4-5-20250929')
  })
  test('a further page is announced by has_more and last_id', () => {
    const page = parseModelsResponse(apiBody(['claude-opus-5'], { has_more: true }))
    expect(page).toEqual({ ok: true, value: expect.objectContaining({ hasMore: true, lastId: 'claude-opus-5' }) })
  })
  test('optional fields are kept only when they are strings', () => {
    const page = parseModelsResponse(JSON.stringify({ data: [{ id: 'claude-opus-5', display_name: 5, created_at: null, line: '' }], has_more: false, last_id: null }))
    expect(page).toEqual({ ok: true, value: { models: [{ id: 'claude-opus-5' }], hasMore: false, lastId: null } })
  })
  test('any bad shape is an error, never a partial list', () => {
    const bad = [
      'not json <html>',
      '[]',
      'null',
      JSON.stringify({ data: 'x', has_more: false }),
      JSON.stringify({ has_more: false }),
      JSON.stringify({ data: [], has_more: 'no' }),
      JSON.stringify({ data: [{ id: 'claude-opus-5' }, { id: '' }], has_more: false }),
      JSON.stringify({ data: [{ id: 'claude-opus-5' }, 'claude-opus-4-8'], has_more: false }),
      JSON.stringify({ data: [{ display_name: 'Claude' }], has_more: false }),
      JSON.stringify({ data: [], has_more: true, last_id: null }),
    ]
    for (const text of bad) {
      const page = parseModelsResponse(text)
      expect({ text, ok: page.ok }).toEqual({ text, ok: false })
      if (!page.ok) expect(page.error.length).toBeGreaterThan(0)
    }
  })
})

describe('mergeCatalog', () => {
  test('the first API fill adds one entry per version, every one new', () => {
    const { catalog, added } = mergeCatalog(EMPTY_CATALOG, fromApi(API_IDS), 1000)
    expect(catalog.entries).toHaveLength(API_IDS.length)
    expect(added).toHaveLength(API_IDS.length)
    expect(entry(catalog, 'opus-4.5')).toEqual({
      key: 'opus-4.5',
      family: 'opus',
      version: '4.5',
      ids: ['claude-opus-4-5-20251101'],
      sources: ['api'],
      firstSeenAt: 1000,
    })
  })
  test('another spelling of a known version joins its entry and adds nothing', () => {
    const { catalog, added } = mergeCatalog(filled(), [{ id: 'us.anthropic.claude-opus-4-8-20260301-v1:0', source: 'seen' }, { id: 'claude-opus-4-8[1m]', source: 'seen' }], 2000)
    expect(added).toEqual([])
    expect(entry(catalog, 'opus-4.8')).toEqual({
      key: 'opus-4.8',
      family: 'opus',
      version: '4.8',
      ids: ['claude-opus-4-8', 'us.anthropic.claude-opus-4-8-20260301-v1:0'],
      sources: ['api', 'seen'],
      firstSeenAt: 1000,
    })
  })
  test('an API id becomes the one to send; API names overwrite; first sighting kept', () => {
    const seen = mergeCatalog(EMPTY_CATALOG, [{ id: 'claude-opus-5-20260901[1m]', source: 'seen', displayName: 'old name' }], 1000).catalog
    const { catalog, added } = mergeCatalog(seen, [{ id: 'claude-opus-5', source: 'api', displayName: 'Claude Opus 5', createdAt: '2026-09-01' }], 2000)
    expect(added).toEqual([])
    expect(entry(catalog, 'opus-5')).toEqual({
      key: 'opus-5',
      family: 'opus',
      version: '5',
      ids: ['claude-opus-5', 'claude-opus-5-20260901'],
      displayName: 'Claude Opus 5',
      createdAt: '2026-09-01',
      sources: ['seen', 'api'],
      firstSeenAt: 1000,
    })
  })
  test('a non-API sighting only fills names that are missing', () => {
    const named = mergeCatalog(EMPTY_CATALOG, [{ id: 'claude-opus-5', source: 'api', displayName: 'Claude Opus 5' }], 1000).catalog
    const { catalog } = mergeCatalog(named, [{ id: 'claude-opus-5', source: 'seen', displayName: 'mine', createdAt: '2026-09-01' }], 2000)
    expect(entry(catalog, 'opus-5')).toMatchObject({ displayName: 'Claude Opus 5', createdAt: '2026-09-01' })
  })
  test('one version twice in one call is one entry, added once; spellings differing only in case are one', () => {
    const { catalog, added } = mergeCatalog(EMPTY_CATALOG, [
      { id: 'claude-opus-4-5-20251101', source: 'seen' },
      { id: 'CLAUDE-OPUS-4-5-20251101', source: 'added' },
      { id: 'claude-opus-4-5', source: 'seen' },
    ], 1000)
    expect(keys(added)).toEqual(['opus-4.5'])
    expect(catalog.entries).toEqual([{ key: 'opus-4.5', family: 'opus', version: '4.5', ids: ['claude-opus-4-5-20251101', 'claude-opus-4-5'], sources: ['seen', 'added'], firstSeenAt: 1000 }])
  })
  test('an unparsable id is its own entry in other, unless the API names its line', () => {
    const { catalog } = mergeCatalog(EMPTY_CATALOG, [{ id: 'GPT-6.1-Sol[1m]', source: 'seen' }], 1000)
    expect(catalog.entries).toEqual([{ key: 'gpt-6.1-sol', family: 'other', version: '', ids: ['GPT-6.1-Sol'], sources: ['seen'], firstSeenAt: 1000 }])
    const page = parseModelsResponse(JSON.stringify({ data: [{ id: 'claude-nova-orbit', line: 'Nova' }], has_more: false, last_id: 'claude-nova-orbit' }))
    if (!page.ok) throw new Error(page.error)
    const incoming = page.value.models.map(m => ({ ...m, source: 'api' as const }))
    expect(mergeCatalog(EMPTY_CATALOG, incoming, 1000).catalog.entries[0]).toMatchObject({ key: 'claude-nova-orbit', family: 'nova', version: '' })
  })
  test('a seen unparsable entry moves to its family when the API brings the line; a parsed family wins over line', () => {
    const seen = mergeCatalog(EMPTY_CATALOG, [{ id: 'claude-nova-orbit', source: 'seen' }], 1000).catalog
    expect(seen.entries[0]?.family).toBe('other')
    const after = mergeCatalog(seen, [{ id: 'claude-nova-orbit', source: 'api', line: 'nova' }], 2000).catalog
    expect(after.entries[0]?.family).toBe('nova')
    expect(mergeCatalog(EMPTY_CATALOG, [{ id: 'claude-opus-5', source: 'api', line: 'sonnet' }], 1).catalog.entries[0]?.family).toBe('opus')
  })
  test('a trailing .0 spelling is the same version', () => {
    const { catalog, added } = mergeCatalog(EMPTY_CATALOG, [{ id: 'claude-opus-5', source: 'api' }, { id: 'claude-opus-5-0', source: 'seen' }], 1000)
    expect(keys(added)).toEqual(['opus-5'])
    expect(catalog.entries[0]?.ids).toEqual(['claude-opus-5', 'claude-opus-5-0'])
  })
  test('nothing, inherit, family aliases and host aliases are not versions', () => {
    const { catalog, added } = mergeCatalog(filled(), [
      { id: '', source: 'seen' },
      { id: 'inherit', source: 'seen' },
      { id: 'opus[1m]', source: 'seen' },
      { id: 'Sonnet', source: 'seen' },
      { id: 'default', source: 'seen' },
      { id: 'opusplan', source: 'seen' },
    ], 2000)
    expect(added).toEqual([])
    expect(catalog.entries).toHaveLength(API_IDS.length)
  })
  test('inputs are not mutated; fetchedAt and lastError are left alone', () => {
    const start: Catalog = { ...filled(), fetchedAt: 500, lastError: 'offline' }
    const snapshot = JSON.stringify(start)
    const incoming: Incoming[] = [{ id: 'claude-opus-5[1m]', source: 'added' }, { id: 'claude-nova-1', source: 'seen' }]
    const { catalog, added } = mergeCatalog(start, incoming, 2000)
    expect(JSON.stringify(start)).toBe(snapshot)
    expect(incoming[0]?.id).toBe('claude-opus-5[1m]')
    expect(catalog.fetchedAt).toBe(500)
    expect(catalog.lastError).toBe('offline')
    expect(keys(added)).toEqual(['nova-1'])
    expect(entry(catalog, 'opus-5')?.sources).toEqual(['api', 'added'])
  })
})

describe('removeAdded', () => {
  const added = mergeCatalog(filled(), [{ id: 'claude-nova-1', source: 'added' }, { id: 'claude-opus-5', source: 'added' }], 2000).catalog
  test('an entry only the user added goes, by any spelling', () => {
    expect(entry(removeAdded(added, 'claude-nova-1-20260101[1m]'), 'nova-1')).toBeUndefined()
  })
  test('an entry with other sources stays, without added', () => {
    expect(entry(removeAdded(added, 'claude-opus-5'), 'opus-5')?.sources).toEqual(['api'])
  })
  test('an id that was not added leaves the list as it is', () => {
    const catalog = filled()
    expect(removeAdded(catalog, 'claude-opus-4-8')).toBe(catalog)
    expect(removeAdded(catalog, 'claude-nope-9')).toBe(catalog)
  })
})

describe('parseCatalog', () => {
  test('a stored list comes back as it was', () => {
    const catalog = { ...mergeCatalog(filled(), [{ id: 'gpt-6.1-sol', source: 'added' }], 2000).catalog, fetchedAt: 1234, lastError: 'HTTP 500' }
    expect(parseCatalog(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog)
  })
  test('garbage is an empty list, a fresh one each time', () => {
    for (const raw of [undefined, null, 'x', 42, [], { entries: 'x' }]) {
      const catalog = parseCatalog(raw)
      expect(catalog).toEqual(EMPTY_CATALOG)
      expect(catalog).not.toBe(EMPTY_CATALOG)
      catalog.entries.push(...filled().entries)
    }
    expect(EMPTY_CATALOG.entries).toEqual([])
  })
  test('malformed entries are dropped', () => {
    const good = { key: 'opus-5', family: 'opus', version: '5', ids: ['claude-opus-5'], sources: ['api'], firstSeenAt: 1, displayName: 7 }
    const raw = {
      entries: [
        good,
        { ...good, ids: [] },
        { ...good, ids: [3] },
        { ...good, ids: 'claude-opus-5' },
        { ...good, sources: ['api', 'stolen'] },
        { ...good, sources: [] },
        { ...good, firstSeenAt: 'yesterday' },
        'claude-opus-4-8',
      ],
      fetchedAt: 'soon',
      lastError: 404,
    }
    expect(parseCatalog(raw)).toEqual({
      entries: [{ key: 'opus-5', family: 'opus', version: '5', ids: ['claude-opus-5'], sources: ['api'], firstSeenAt: 1 }],
      fetchedAt: null,
      lastError: null,
    })
  })
})

describe('parseCatalog brings stored keys up to date', () => {
  const stored = (over: Record<string, unknown>) => ({ key: 'x', family: 'x', version: 'x', ids: ['claude-opus-5'], sources: ['seen'], firstSeenAt: 1, ...over })
  test('key, family and version are read again from ids[0]', () => {
    const catalog = parseCatalog({ entries: [stored({ key: 'opus-5.0', family: 'opus', version: '5.0', ids: ['claude-opus-5-0'] })] })
    expect(catalog.entries).toEqual([{ key: 'opus-5', family: 'opus', version: '5', ids: ['claude-opus-5-0'], sources: ['seen'], firstSeenAt: 1 }])
  })
  test('entries that turn out to be one version are joined: API spelling first, earliest sighting', () => {
    const catalog = parseCatalog({
      entries: [
        stored({ key: 'opus-5.0', ids: ['claude-opus-5-0'], sources: ['seen', 'added'], firstSeenAt: 5 }),
        stored({ key: 'opus-5', ids: ['claude-opus-5', 'CLAUDE-OPUS-5-0'], sources: ['api'], firstSeenAt: 9, displayName: 'Claude Opus 5' }),
      ],
    })
    expect(catalog.entries).toEqual([
      { key: 'opus-5', family: 'opus', version: '5', ids: ['claude-opus-5', 'CLAUDE-OPUS-5-0'], displayName: 'Claude Opus 5', sources: ['seen', 'added', 'api'], firstSeenAt: 5 },
    ])
  })
  test('the stored family is kept only for an id that does not parse and names no known family', () => {
    const familyOf = (over: Record<string, unknown>) => parseCatalog({ entries: [stored(over)] }).entries[0]?.family
    expect(familyOf({ family: 'Nova', ids: ['claude-nova-orbit'] })).toBe('nova')
    expect(familyOf({ family: 'nova', ids: ['claude-opus-5'] })).toBe('opus')
    expect(familyOf({ family: 'nova', ids: ['opus-preview-x'] })).toBe('opus')
    expect(familyOf({ family: 7, ids: ['gpt-6.1-sol'] })).toBe('other')
  })
})

describe('ordering and the view', () => {
  const catalog = mergeCatalog(filled(), [{ id: 'claude-nova-1', source: 'seen' }, { id: 'gpt-6.1-sol', source: 'added' }], 2000).catalog
  test('families in display order: known first, then others alphabetically, other last', () => {
    const more = mergeCatalog(catalog, [{ id: 'claude-aurora-1', source: 'seen' }], 3000).catalog
    expect(familiesOf(more)).toEqual(['opus', 'sonnet', 'haiku', 'fable', 'aurora', 'nova', 'other'])
  })
  test('a family newest first, by version', () => {
    expect(keys(entriesOf(catalog, 'opus'))).toEqual(['opus-5.5', 'opus-5', 'opus-4.8', 'opus-4.7', 'opus-4.6', 'opus-4.5'])
    expect(entriesOf(catalog, 'nope')).toEqual([])
  })
  test('createdAt only breaks a version tie', () => {
    const at = (key: string, version: string, createdAt?: string): CatalogEntry => ({ key, family: 'other', version, ids: [key], sources: ['seen'], firstSeenAt: 0, ...(createdAt ? { createdAt } : {}) })
    const list = [at('a', '', '2026-01-01'), at('b', '', '2026-03-01'), at('c', ''), at('d', '1', '2020-01-01')]
    expect(keys([...list].sort(compareEntries))).toEqual(['d', 'b', 'a', 'c'])
  })
  test('the newest of each family', () => {
    expect(keys(newestPerFamily(catalog))).toEqual(['opus-5.5', 'sonnet-5.5', 'haiku-5.5', 'fable-5.1', 'nova-1', 'gpt-6.1-sol'])
  })
  test('main holds the newest per family and every ruled version; more holds the rest, grouped and newest first', () => {
    const ruled = new Set(['opus-4.7', 'opus-5.5', 'haiku-4.5'])
    const { main, more } = splitForView(catalog, e => ruled.has(e.key))
    expect(keys(main)).toEqual(['opus-5.5', 'opus-4.7', 'sonnet-5.5', 'haiku-5.5', 'haiku-4.5', 'fable-5.1', 'nova-1', 'gpt-6.1-sol'])
    expect(keys(more)).toEqual(['opus-5', 'opus-4.8', 'opus-4.6', 'opus-4.5', 'sonnet-5', 'sonnet-4.6', 'sonnet-4.5', 'fable-5'])
  })
})
