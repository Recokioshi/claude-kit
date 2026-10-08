import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_CATALOG, mergeCatalog } from '../hooks/catalog'
import type { Catalog, CatalogEntry } from '../hooks/catalog'
import {
  allowedEntries,
  concreteFor,
  decisionFor,
  DEFAULT_POLICY,
  fallbackEntry,
  isAllowedModel,
  isRuled,
  migratePolicy,
  parsePolicy,
  swapTarget,
  withFamily,
  withFamilyList,
  withVersion,
} from '../hooks/policy'
import type { Policy } from '../hooks/policy'

const catalogOf = (ids: readonly string[], lines: Record<string, string> = {}): Catalog =>
  mergeCatalog(EMPTY_CATALOG, ids.map(id => ({ id, source: 'api' as const, ...(lines[id] ? { line: lines[id] } : {}) })), 1000).catalog

/** The real Models API list. */
const FULL = catalogOf([
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
])

const OPUS = catalogOf(['claude-opus-5', 'claude-opus-4-8'])
const policyOf = (over: Partial<Policy>): Policy => ({ ...DEFAULT_POLICY, ...over })
const keys = (entries: readonly CatalogEntry[]) => entries.map(e => e.key)

describe('decisionFor', () => {
  test('a version rule beats its family default, both ways', () => {
    const policy = policyOf({ families: { opus: 'block', sonnet: 'allow' }, versions: { 'opus-4.8': 'allow', 'sonnet-5': 'block' } })
    expect(decisionFor(policy, 'opus-4.8', 'opus')).toBe('allow')
    expect(decisionFor(policy, 'sonnet-5', 'sonnet')).toBe('block')
  })
  test('a new version with no rule inherits its family default', () => {
    const policy = policyOf({ families: { opus: 'block' }, versions: { 'opus-4.8': 'allow' } })
    expect(decisionFor(policy, 'opus-5.6', 'opus')).toBe('block')
    expect(decisionFor(policyOf({ families: { opus: 'allow' }, versions: { 'opus-5': 'block' } }), 'opus-5.6', 'opus')).toBe('allow')
  })
  test('a family with no default follows unnamedFamilies', () => {
    expect(decisionFor(DEFAULT_POLICY, 'nova-1', 'nova')).toBe('allow')
    expect(decisionFor(policyOf({ families: { opus: 'allow' }, unnamedFamilies: 'block' }), 'nova-1', 'nova')).toBe('block')
  })
  test('object prototype names are not rules', () => {
    const policy = policyOf({ unnamedFamilies: 'block' })
    expect(decisionFor(policy, 'constructor', 'toString')).toBe('block')
    expect(isRuled(policy, 'constructor')).toBe(false)
  })
})

describe('isRuled and allowedEntries', () => {
  test('only versions with their own rule are ruled', () => {
    const policy = policyOf({ families: { opus: 'block' }, versions: { 'opus-4.8': 'allow' } })
    expect(isRuled(policy, 'opus-4.8')).toBe(true)
    expect(isRuled(policy, 'opus-5')).toBe(false)
  })
  test('allowed entries, newest first, for a family or all', () => {
    const policy = policyOf({ families: { sonnet: 'block', haiku: 'block', fable: 'block' }, versions: { 'opus-5.5': 'block' } })
    expect(keys(allowedEntries(policy, FULL, 'opus'))).toEqual(['opus-5', 'opus-4.8', 'opus-4.7', 'opus-4.6', 'opus-4.5'])
    expect(keys(allowedEntries(policy, FULL))).toEqual(['opus-5', 'opus-4.8', 'opus-4.7', 'opus-4.6', 'opus-4.5'])
    expect(allowedEntries(policy, FULL, 'sonnet')).toEqual([])
  })
})

describe('isAllowedModel', () => {
  const policy = policyOf({ versions: { 'opus-5': 'block' } })
  test('every spelling of a blocked version is blocked', () => {
    for (const id of ['claude-opus-5', 'claude-opus-5-20260901', 'claude-opus-5[1m]', 'CLAUDE-OPUS-5', 'us.anthropic.claude-opus-5-20260901-v1:0', 'claude-opus-5@20260901']) {
      expect({ id, allowed: isAllowedModel(policy, OPUS, id) }).toEqual({ id, allowed: false })
    }
    expect(isAllowedModel(policy, OPUS, 'us.anthropic.claude-opus-4-8-20260301-v1:0')).toBe(true)
  })
  test('inherited always runs', () => {
    const none = policyOf({ unnamedFamilies: 'block', families: { opus: 'block' } })
    expect(isAllowedModel(none, OPUS, undefined)).toBe(true)
    expect(isAllowedModel(none, OPUS, null)).toBe(true)
    expect(isAllowedModel(none, OPUS, 'inherit')).toBe(true)
  })
  test('an alias runs while its family has an allowed version', () => {
    expect(isAllowedModel(policy, OPUS, 'opus')).toBe(true)
    expect(isAllowedModel(policyOf({ families: { opus: 'block' } }), OPUS, 'opus[1m]')).toBe(false)
  })
  test('an alias of a family with no versions listed follows the family default', () => {
    expect(isAllowedModel(policyOf({ families: { haiku: 'block' } }), OPUS, 'haiku')).toBe(false)
    expect(isAllowedModel(DEFAULT_POLICY, OPUS, 'haiku')).toBe(true)
  })
  test('an id the API placed in a family by its line follows that family', () => {
    const catalog = catalogOf(['claude-nova-orbit'], { 'claude-nova-orbit': 'nova' })
    expect(isAllowedModel(policyOf({ families: { nova: 'block' } }), catalog, 'claude-nova-orbit')).toBe(false)
    expect(isAllowedModel(policyOf({ families: { nova: 'block' } }), EMPTY_CATALOG, 'claude-nova-orbit')).toBe(true)
    expect(isAllowedModel(policyOf({ families: { nova: 'block' } }), catalog, 'nova')).toBe(false)
  })
})

describe('concreteFor', () => {
  const blocked5 = policyOf({ versions: { 'opus-5': 'block' } })
  test('an alias goes to the newest allowed version when its family has a blocked one', () => {
    expect(concreteFor(blocked5, OPUS, 'opus')).toBe('claude-opus-4-8')
    expect(concreteFor(blocked5, OPUS, 'Opus')).toBe('claude-opus-4-8')
  })
  test('the context suffix rides along', () => {
    expect(concreteFor(blocked5, OPUS, 'opus[1m]')).toBe('claude-opus-4-8[1m]')
  })
  test('an alias is left alone when nothing in its family is blocked', () => {
    expect(concreteFor(DEFAULT_POLICY, OPUS, 'opus')).toBe('opus')
    expect(concreteFor(blocked5, OPUS, 'sonnet[1m]')).toBe('sonnet[1m]')
  })
  test('an alias with nothing allowed, or an empty family whose default blocks, has no answer', () => {
    expect(concreteFor(policyOf({ families: { opus: 'block' } }), OPUS, 'opus')).toBeNull()
    expect(concreteFor(policyOf({ families: { haiku: 'block' } }), OPUS, 'haiku')).toBeNull()
  })
  test('a full id is itself when allowed, else nothing; inherited is itself', () => {
    expect(concreteFor(blocked5, OPUS, 'claude-opus-4-8[1m]')).toBe('claude-opus-4-8[1m]')
    expect(concreteFor(blocked5, OPUS, 'claude-opus-5-20260901')).toBeNull()
    expect(concreteFor(blocked5, OPUS, 'inherit')).toBe('inherit')
    expect(concreteFor(blocked5, OPUS, '')).toBe('')
  })
})

describe('swapTarget and fallbackEntry', () => {
  test('the same family first', () => {
    const policy = policyOf({ versions: { 'opus-5.5': 'block' }, fallback: 'sonnet' })
    expect(swapTarget(policy, FULL, 'opus')?.key).toBe('opus-5')
  })
  test('then the fallback, as a version or as a family', () => {
    const noHaiku = { families: { haiku: 'block' as const } }
    expect(swapTarget(policyOf({ ...noHaiku, fallback: 'sonnet-4.6' }), FULL, 'haiku')?.key).toBe('sonnet-4.6')
    expect(swapTarget(policyOf({ ...noHaiku, fallback: 'fable' }), FULL, 'haiku')?.key).toBe('fable-5.1')
  })
  test('then by preference: opus, fable, sonnet, haiku', () => {
    const policy = policyOf({ families: { haiku: 'block', opus: 'block' }, fallback: 'sonnet-4.6', versions: { 'sonnet-4.6': 'block' } })
    expect(swapTarget(policy, FULL, 'haiku')?.key).toBe('fable-5.1')
    expect(swapTarget(policyOf({ families: { haiku: 'block', opus: 'block', fable: 'block' }, fallback: null }), FULL, 'haiku')?.key).toBe('sonnet-5.5')
  })
  test('then the newest allowed of any family, else nothing', () => {
    const catalog = catalogOf(['claude-haiku-5-5', 'claude-nova-2', 'claude-nova-1'])
    expect(swapTarget(policyOf({ families: { haiku: 'block' } }), catalog, 'haiku')?.key).toBe('nova-2')
    expect(swapTarget(policyOf({ families: { haiku: 'block' }, unnamedFamilies: 'block' }), catalog, 'haiku')).toBeNull()
  })
  test('fallbackEntry resolves the fallback only when it is allowed', () => {
    expect(fallbackEntry(policyOf({ fallback: 'opus-4.8' }), FULL)?.key).toBe('opus-4.8')
    expect(fallbackEntry(policyOf({ fallback: 'claude-opus-4-8' }), FULL)?.key).toBe('opus-4.8')
    expect(fallbackEntry(policyOf({ fallback: 'sonnet' }), FULL)?.key).toBe('sonnet-5.5')
    expect(fallbackEntry(policyOf({ fallback: 'opus-4.8', versions: { 'opus-4.8': 'block' } }), FULL)?.key).toBe('opus-5.5')
    expect(fallbackEntry(policyOf({ fallback: 'opus', families: { opus: 'block' } }), FULL)?.key).toBe('fable-5.1')
  })
})

describe('withVersion and withFamily', () => {
  test('set a rule', () => {
    expect(withVersion(DEFAULT_POLICY, OPUS, 'opus-5', 'block').versions).toEqual({ 'opus-5': 'block' })
    expect(withVersion(DEFAULT_POLICY, OPUS, 'claude-opus-4-8', 'allow').versions).toEqual({ 'opus-4.8': 'allow' })
    expect(withFamily(DEFAULT_POLICY, OPUS, 'Sonnet', 'block').families).toEqual({ sonnet: 'block' })
  })
  test('refuse to block the last allowed version', () => {
    const one = withVersion(DEFAULT_POLICY, OPUS, 'opus-5', 'block')
    expect(withVersion(one, OPUS, 'opus-4.8', 'block')).toBe(one)
    expect(withFamily(one, OPUS, 'opus', 'block')).toBe(one)
    const familyOff = policyOf({ families: { opus: 'block' }, versions: { 'opus-4.8': 'allow' } })
    expect(withVersion(familyOff, OPUS, 'opus-4.8', 'block')).toBe(familyOff)
  })
  test('allowing, and an empty list, are never refused', () => {
    const none = policyOf({ families: { opus: 'block' } })
    expect(withVersion(none, OPUS, 'opus-5', 'allow')).not.toBe(none)
    expect(withFamily(DEFAULT_POLICY, EMPTY_CATALOG, 'opus', 'block').families).toEqual({ opus: 'block' })
  })
  test('inputs are not mutated', () => {
    const policy = policyOf({ versions: { 'opus-5': 'block' } })
    withVersion(policy, OPUS, 'opus-4.7', 'block')
    withFamily(policy, OPUS, 'sonnet', 'block')
    expect(policy.versions).toEqual({ 'opus-5': 'block' })
    expect(policy.families).toEqual({})
  })
})

describe('withFamilyList', () => {
  test('listed families allow, every other known family blocks, other decides unnamed families', () => {
    const catalog = catalogOf(['claude-opus-5', 'claude-nova-1'])
    const policy = withFamilyList(policyOf({ versions: { 'opus-5': 'block' } }), catalog, ['Opus', 'sonnet'])
    expect(policy.families).toEqual({ opus: 'allow', sonnet: 'allow', haiku: 'block', fable: 'block', nova: 'block' })
    expect(policy.unnamedFamilies).toBe('block')
    expect(policy.versions).toEqual({ 'opus-5': 'block' })
    expect(withFamilyList(DEFAULT_POLICY, EMPTY_CATALOG, ['opus', 'other']).unnamedFamilies).toBe('allow')
  })
})

describe('parsePolicy', () => {
  test('a stored 0.3 record comes back', () => {
    const policy = policyOf({ families: { opus: 'allow', haiku: 'block' }, versions: { 'opus-5': 'block' }, fallback: 'opus-4.8', mode: 'swap' })
    expect(parsePolicy(JSON.parse(JSON.stringify(policy)))).toEqual(policy)
    expect(parsePolicy({ ...policy, fallback: null })).toEqual({ ...policy, fallback: null })
  })
  test('garbage is rejected', () => {
    const good = { families: {}, unnamedFamilies: 'allow', versions: {}, fallback: 'opus', mode: 'deny' }
    const bad: unknown[] = [
      null,
      'opus',
      ['opus'],
      { allowed: ['opus'] },
      { ...good, unnamedFamilies: 'maybe' },
      { ...good, families: { opus: true } },
      { ...good, families: ['opus'] },
      { ...good, versions: { 'opus-5': 'deny' } },
      { ...good, versions: null },
      { ...good, fallback: 5 },
      { ...good, mode: 'ask' },
    ]
    for (const raw of bad) {
      expect({ raw, parsed: parsePolicy(raw) }).toEqual({ raw, parsed: null })
    }
  })
})

describe('migratePolicy', () => {
  const opusFable = { opus: 'allow', sonnet: 'block', haiku: 'block', fable: 'allow' }
  test('a 0.3 record is kept as it is', () => {
    const policy = policyOf({ versions: { 'opus-5': 'block' }, mode: 'swap' })
    expect(migratePolicy(policy, { defaultAllowed: 'haiku' })).toEqual(policy)
  })
  test('a 0.2 record: its families, fallback and mode', () => {
    expect(migratePolicy({ allowed: ['opus', 'fable'], fallback: 'fable', mode: 'swap' }, {})).toEqual({
      families: opusFable,
      unnamedFamilies: 'block',
      versions: {},
      fallback: 'fable',
      mode: 'swap',
    })
  })
  test('a 0.2 record without fallback or mode takes them from the options, as 0.2 did', () => {
    const policy = migratePolicy({ allowed: ['opus', 'other'] }, { fallback: 'sonnet', mode: 'swap' })
    expect(policy).toMatchObject({ unnamedFamilies: 'allow', fallback: 'sonnet', mode: 'swap' })
  })
  test('the first version\'s plain array', () => {
    expect(migratePolicy(['opus', 'fable'], {})).toEqual({ ...DEFAULT_POLICY, families: opusFable, unnamedFamilies: 'block' })
  })
  test('nothing stored: the legacy option strings', () => {
    expect(migratePolicy(undefined, { defaultAllowed: 'opus,fable', fallback: 'Fable', mode: 'swap' })).toEqual({
      families: opusFable,
      unnamedFamilies: 'block',
      versions: {},
      fallback: 'fable',
      mode: 'swap',
    })
  })
  test('all five families allow everything', () => {
    const policy = migratePolicy(null, { defaultAllowed: 'opus,sonnet,haiku,fable,other' })
    expect(policy.unnamedFamilies).toBe('allow')
    expect(Object.values(policy.families).every(d => d === 'allow')).toBe(true)
  })
  test('nothing at all, or nothing usable, is the default policy', () => {
    expect(migratePolicy(undefined, {})).toEqual(DEFAULT_POLICY)
    expect(migratePolicy(42, { defaultAllowed: 'gpt', fallback: 'gpt', mode: 'ask' })).toEqual(DEFAULT_POLICY)
    expect(migratePolicy({ allowed: [] }, {})).toEqual(DEFAULT_POLICY)
  })
})
