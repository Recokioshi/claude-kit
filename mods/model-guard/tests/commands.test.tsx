import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'
import { API_IDS, engineOf, policyIn, run, seedList, seedPolicy } from './harness'

const LIST = Hooks.mergeCatalog(Hooks.EMPTY_CATALOG, API_IDS.map(id => ({ id, source: 'api' as const })), 0).catalog

describe('parseCommand and versionOf', () => {
  test('every text form reads into one command', () => {
    expect(Hooks.parseCommand('')).toEqual({ kind: 'open' })
    expect(Hooks.parseCommand('block opus 5')).toEqual({ kind: 'rule', decision: 'block', target: 'opus 5' })
    expect(Hooks.parseCommand(' Allow  claude-opus-4-8 ')).toEqual({ kind: 'rule', decision: 'allow', target: 'claude-opus-4-8' })
    expect(Hooks.parseCommand('new haiku block')).toEqual({ kind: 'family', family: 'haiku', decision: 'block' })
    expect(Hooks.parseCommand('add claude-opus-5-6')).toEqual({ kind: 'add', id: 'claude-opus-5-6' })
    expect(Hooks.parseCommand('fallback opus 4.8')).toEqual({ kind: 'fallback', target: 'opus 4.8' })
    expect(Hooks.parseCommand('mode swap')).toEqual({ kind: 'mode', mode: 'swap' })
    expect(Hooks.parseCommand('save')).toEqual({ kind: 'repo' })
    expect(Hooks.parseCommand('reset')).toEqual({ kind: 'global' })
    expect(Hooks.parseCommand('opus, sonnet')).toEqual({ kind: 'families', words: ['opus', 'sonnet'] })
  })

  test('an incomplete form explains itself', () => {
    expect(Hooks.parseCommand('block').kind).toBe('help')
    expect(Hooks.parseCommand('new haiku').kind).toBe('help')
    expect(Hooks.parseCommand('mode ask').kind).toBe('help')
    expect(Hooks.parseCommand('add a b').kind).toBe('help')
  })

  test('a version can be named the way people say it', () => {
    for (const said of ['opus 4.8', 'opus-4.8', 'opus4.8', 'opus 4-8', 'claude-opus-4-8', 'Opus 4.8']) {
      expect(Hooks.versionOf(said, LIST)).toEqual({ ok: true, value: { key: 'opus-4.8', isListed: true } })
    }
    expect(Hooks.versionOf('opus 6', LIST)).toEqual({ ok: true, value: { key: 'opus-6', isListed: false } })
    const family = Hooks.versionOf('opus', LIST)
    expect(family.ok).toBe(false)
    expect(!family.ok && family.error).toContain('/models new opus allow|block')
  })
})

describe('/models text forms', () => {
  test('allow and block one version, saved to the global list', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'block opus 5')).text).toContain('Blocked opus 5.')
    expect(policyIn(store).versions['opus-5']).toBe('block')
    expect((await run($, 'allow claude-opus-5')).text).toContain('Allowed opus 5.')
    expect(policyIn(store).versions['opus-5']).toBe('allow')
  })

  test('a rule for a version the list does not have yet is kept, and says so', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'block opus 6')).text).toContain('It is not in the model list yet; the rule applies once it is.')
    expect(policyIn(store).versions['opus-6']).toBe('block')
  })

  test('a whole family is not a version', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'block opus')).text).toContain('"opus" is a whole family')
    expect(policyIn(store).versions).toEqual({})
  })

  test('new versions of a family, and of families not named', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'new haiku block')).text).toContain('New haiku versions without a rule of their own: blocked.')
    expect(policyIn(store).families.haiku).toBe('block')
    await run($, 'new other block')
    expect(policyIn(store).unnamedFamilies).toBe('block')
  })

  test('the last allowed model can\'t be blocked from text either', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store, ['claude-opus-5'])
    expect((await run($, 'block opus 5')).text).toBe('Something must stay allowed: allow another model first.')
    expect(policyIn(store).versions['opus-5']).toBeUndefined()
  })

  test('add and remove a model the list does not show', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'add claude-opus-5-6')).text).toBe('Added claude-opus-5-6 to the model list.')
    expect((await run($, 'add claude-opus-5-6')).text).toBe('claude-opus-5-6 is already in the model list.')
    expect(Hooks.parseCatalog(store.get('catalog')).entries.some(e => e.key === 'opus-5.6')).toBe(true)
    await run($, 'remove claude-opus-5-6')
    expect(Hooks.parseCatalog(store.get('catalog')).entries.some(e => e.key === 'opus-5.6')).toBe(false)
  })

  test('fallback and mode', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'fallback sonnet 5.5')).text).toContain('Fallback: sonnet 5.5.')
    expect(policyIn(store).fallback).toBe('sonnet-5.5')
    await run($, 'fallback haiku')
    expect(policyIn(store).fallback).toBe('haiku')
    expect((await run($, 'mode swap')).text).toContain('now swapped')
    expect(policyIn(store).mode).toBe('swap')
  })

  test('a repo\'s own list takes the changes while it exists', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    seedPolicy(store, {})
    await run($, 'repo')
    await run($, 'block sonnet 5.5')
    expect(policyIn(store, 'repo:/Users/me/dev/web-app').versions['sonnet-5.5']).toBe('block')
    expect(policyIn(store).versions['sonnet-5.5']).toBeUndefined()
  })

  test('help, the 0.2 "default", and the text answer', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'help')).text).toContain('/models allow|block <model>')
    expect((await run($, 'default')).text).toContain('Lists are global now')
    const text = (await run($)).text ?? ''
    expect(text).toContain('opus    5.5 ✓, 5 ✓, 4.8 ✓')
    expect(text).toContain('/models allow|block <model>')
  })
})
