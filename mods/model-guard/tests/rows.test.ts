import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'

const BASE = { ...Hooks.DEFAULT_POLICY, versions: { 'opus-5': 'block' as const } }

describe('withRows', () => {
  test('rows lay over the base: versions, families, the unnamed default, fallback and mode', () => {
    const policy = Hooks.withRows(BASE, 'policy:global', [
      ['policy:global|version|opus-5', 'allow'],
      ['policy:global|version|claude-sonnet-5', 'block'],
      ['policy:global|family|haiku', 'block'],
      ['policy:global|unnamed', 'block'],
      ['policy:global|fallback', 'sonnet-5.5'],
      ['policy:global|mode', 'swap'],
    ])
    expect(policy).toEqual({ families: { haiku: 'block' }, unnamedFamilies: 'block', versions: { 'opus-5': 'allow', 'sonnet-5': 'block' }, fallback: 'sonnet-5.5', mode: 'swap' })
  })

  test('a row of another list, or one that does not read as a rule, is ignored', () => {
    const policy = Hooks.withRows(BASE, 'policy:global', [
      ['repo:/a|version|opus-5', 'allow'],
      ['policy:global|version|opus-5', 'maybe'],
      ['policy:global|mode', 'ask'],
      ['policy:global|version|', 'block'],
    ])
    expect(policy).toEqual(BASE)
  })
})

describe('changedRows', () => {
  test('only what differs, one key per row', () => {
    const after = { ...BASE, versions: { 'opus-5': 'block' as const, 'opus-4.8': 'allow' as const }, mode: 'swap' as const }
    expect(Hooks.changedRows('policy:global', BASE, after)).toEqual([
      ['policy:global|version|opus-4.8', 'allow'],
      ['policy:global|mode', 'swap'],
    ])
  })

  test('a rule named like an object prototype member is still a row', () => {
    const after = { ...BASE, families: { constructor: 'block' as const } }
    expect(Hooks.changedRows('policy:global', BASE, after)).toEqual([['policy:global|family|constructor', 'block']])
  })
})
