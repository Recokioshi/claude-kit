import { describe, expect, test } from 'claude-code/testing'

import { aliasOf, compareVersions, familyOfId, familyOfKey, familyRank, isInherited, keyOf, parseModelId, splitSuffix } from '../hooks/ids'

/** Every spelling of a version, and the key it must share. */
const KEYS: [string, string][] = [
  ['claude-opus-5', 'opus-5'],
  ['claude-opus-5-20260901', 'opus-5'],
  ['claude-opus-5[1m]', 'opus-5'],
  ['CLAUDE-OPUS-5', 'opus-5'],
  ['us.anthropic.claude-opus-4-8-20260301-v1:0', 'opus-4.8'],
  ['claude-opus-4-8@20260301', 'opus-4.8'],
  ['claude-opus-4-8', 'opus-4.8'],
  ['claude-haiku-4-5-20251001', 'haiku-4.5'],
  ['claude-3-5-sonnet-20241022', 'sonnet-3.5'],
  ['claude-3-5-sonnet-latest', 'sonnet-3.5'],
  ['claude-nova-1', 'nova-1'],
  ['claude-opus-5-0', 'opus-5'],
  ['claude-opus-4-0', 'opus-4'],
  ['claude-opus-4-0-20250514', 'opus-4'],
  ['claude-3-5-sonnet-v2@20241022', 'sonnet-3.5'],
  ['anthropic/claude-opus-4.5', 'opus-4.5'],
  ['claude-opus-4.8', 'opus-4.8'],
  ['arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-4-8-20260301-v1:0', 'opus-4.8'],
]

const UNPARSABLE = ['gpt-6.1-sol', 'opus', 'inherit', '']

describe('parseModelId', () => {
  test('every spelling of a version maps to one key', () => {
    for (const [id, key] of KEYS) {
      expect({ id, key: parseModelId(id)?.key }).toEqual({ id, key })
    }
  })
  test('family and version are read from the id, in both orders', () => {
    expect(parseModelId('claude-opus-4-8-20260301')).toEqual({ family: 'opus', version: '4.8', key: 'opus-4.8' })
    expect(parseModelId('claude-3-5-sonnet-20241022')).toEqual({ family: 'sonnet', version: '3.5', key: 'sonnet-3.5' })
    expect(parseModelId('claude-nova-1')).toEqual({ family: 'nova', version: '1', key: 'nova-1' })
  })
  test('other provider prefixes and Bedrock suffixes are dropped', () => {
    expect(parseModelId('eu.anthropic.claude-sonnet-5-5-v2')?.key).toBe('sonnet-5.5')
    expect(parseModelId('global.anthropic.claude-haiku-5-5-v1:0')?.key).toBe('haiku-5.5')
    expect(parseModelId('anthropic.claude-fable-5-1-20260101-v1:0')?.key).toBe('fable-5.1')
    expect(parseModelId('  claude-opus-5-5[1m]  ')?.key).toBe('opus-5.5')
  })
  test('anything else does not parse', () => {
    for (const id of [...UNPARSABLE, 'claude-nova-orbit', 'claude-2', 'opusplan', 'default']) {
      expect({ id, parsed: parseModelId(id) }).toEqual({ id, parsed: null })
    }
  })
  test('trailing zero parts are dropped, one part kept', () => {
    expect(parseModelId('claude-opus-5-0-0')).toEqual({ family: 'opus', version: '5', key: 'opus-5' })
    expect(parseModelId('claude-opus-0')?.key).toBe('opus-0')
    expect(parseModelId('claude-opus-4-10')?.key).toBe('opus-4.10')
  })
})

describe('keyOf and familyOfId', () => {
  test('a parsed id gives its key and family', () => {
    expect(keyOf('us.anthropic.claude-opus-4-8-20260301-v1:0')).toBe('opus-4.8')
    expect(familyOfId('claude-haiku-4-5-20251001')).toBe('haiku')
    expect(familyOfId('claude-nova-1')).toBe('nova')
  })
  test('an unparsable id takes a known family word inside it, else other', () => {
    expect(familyOfId('opusplan')).toBe('opus')
    expect(familyOfId('Opus[1m]')).toBe('opus')
    expect(familyOfId('claude-sonnet-latest-preview')).toBe('sonnet')
    for (const id of ['gpt-6.1-sol', 'default', 'inherit', '', 'claude-nova-orbit']) {
      expect({ id, family: familyOfId(id) }).toEqual({ id, family: 'other' })
    }
  })
  test('a rule key names its family; an unparsable-id key does not', () => {
    expect(familyOfKey('opus-4.8')).toBe('opus')
    expect(familyOfKey('nova-1')).toBe('nova')
    expect(familyOfKey('gpt-6.1-sol')).toBeNull()
    expect(familyOfKey('claude-nova-orbit')).toBeNull()
    expect(familyOfKey('opus')).toBeNull()
  })
  test('an unparsable id is its own key: suffix-free, lowercased, trimmed', () => {
    expect(keyOf(' GPT-6.1-Sol[1m] ')).toBe('gpt-6.1-sol')
    expect(keyOf('claude-nova-orbit')).toBe('claude-nova-orbit')
  })
  test('a key is its own key, trailing zero parts dropped', () => {
    expect(keyOf('opus-4.8')).toBe('opus-4.8')
    expect(keyOf('opus-5.0')).toBe('opus-5')
    expect(keyOf('Nova-1')).toBe('nova-1')
  })
})

describe('splitSuffix', () => {
  test('splits a trailing context suffix and keeps case', () => {
    expect(splitSuffix('claude-opus-5[1m]')).toEqual({ base: 'claude-opus-5', suffix: '[1m]' })
    expect(splitSuffix(' Opus[1M] ')).toEqual({ base: 'Opus', suffix: '[1M]' })
    expect(splitSuffix('claude-opus-5')).toEqual({ base: 'claude-opus-5', suffix: '' })
  })
})

describe('isInherited', () => {
  test('no model or inherit is the parent model', () => {
    expect(isInherited(undefined)).toBe(true)
    expect(isInherited(null)).toBe(true)
    expect(isInherited('')).toBe(true)
    expect(isInherited(' Inherit ')).toBe(true)
    expect(isInherited('opus')).toBe(false)
  })
})

describe('aliasOf', () => {
  test('a known family word is an alias, any case, suffix kept', () => {
    expect(aliasOf('opus')).toEqual({ family: 'opus', suffix: '' })
    expect(aliasOf('Opus')).toEqual({ family: 'opus', suffix: '' })
    expect(aliasOf('opus[1m]')).toEqual({ family: 'opus', suffix: '[1m]' })
  })
  test('another family is an alias only when the caller knows it', () => {
    expect(aliasOf('nova')).toBeNull()
    expect(aliasOf('nova', ['nova'])).toEqual({ family: 'nova', suffix: '' })
  })
  test('a full id, inherit or nothing is not an alias', () => {
    expect(aliasOf('claude-opus-5')).toBeNull()
    expect(aliasOf('inherit')).toBeNull()
    expect(aliasOf('')).toBeNull()
  })
})

describe('compareVersions', () => {
  test('numeric per part, missing parts are zero', () => {
    expect(compareVersions('4.8', '5')).toBeLessThan(0)
    expect(compareVersions('5', '5.5')).toBeLessThan(0)
    expect(compareVersions('5.5', '4.8')).toBeGreaterThan(0)
    expect(compareVersions('5', '5.0')).toBe(0)
    expect(compareVersions('4.10', '4.9')).toBeGreaterThan(0)
    expect(compareVersions('', '1')).toBeLessThan(0)
    expect(compareVersions('', '')).toBe(0)
  })
  test('sorts a list oldest to newest', () => {
    expect(['5.5', '4.10', '5', '3.5', '4.9'].sort(compareVersions)).toEqual(['3.5', '4.9', '4.10', '5', '5.5'])
  })
})

describe('familyRank', () => {
  test('known families in order, then the rest, other last', () => {
    expect(['other', 'nova', 'haiku', 'opus', 'fable', 'sonnet'].sort((a, b) => familyRank(a) - familyRank(b))).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'fable',
      'nova',
      'other',
    ])
  })
})
