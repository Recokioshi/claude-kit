import { describe, expect, test } from 'claude-code/testing'

import { engineOf, ONLY_OPUS_48, policyIn, run, seedList, seedPolicy, spawnOf, turnOf } from './harness'

describe('lists: migration and sharing', () => {
  test('0.2 settings seed the global list once: families off stay blocked', { options: { defaultAllowed: 'opus,fable' } }, async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    const text = (await run($)).text ?? ''
    expect(text).toContain('the global list')
    expect(text).toContain('blocked: sonnet (all), haiku (all), other families')
    const stored = policyIn(store)
    expect(stored.families).toEqual({ opus: 'allow', sonnet: 'block', haiku: 'block', fable: 'allow' })
    expect(stored.unnamedFamilies).toBe('block')
  })

  test('a 0.2 repo record becomes that repo\'s own list, written back in the new shape', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    store.set('repo:/Users/me/dev/web-app', { allowed: ['opus', 'sonnet'], fallback: 'sonnet', mode: 'swap' })
    expect((await run($)).text).toContain("web-app's own list")
    const stored = policyIn(store, 'repo:/Users/me/dev/web-app')
    expect(stored.families.haiku).toBe('block')
    expect(stored.fallback).toBe('sonnet')
    expect(stored.mode).toBe('swap')
  })

  test('a change made by another instance applies from this session\'s next turn', async ($, on) => {
    const { spawned, store } = engineOf(on)
    seedList(store)
    await run($)
    expect('deny' in (await $.agent.spawn(spawnOf('claude-opus-5')))).toBe(false)
    seedPolicy(store, ONLY_OPUS_48)
    await turnOf($)
    const r = await $.agent.spawn(spawnOf('claude-opus-5'))
    expect('deny' in r && r.deny).toContain('opus 5 is blocked')
    expect(spawned).toEqual(['claude-opus-5'])
  })

  test('/models repo copies the list for this repo; changes go there; /models global drops it', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'repo')).text).toContain('web-app now has its own list')
    await run($, 'sonnet')
    const repo = policyIn(store, 'repo:/Users/me/dev/web-app')
    const global = policyIn(store)
    expect(repo.families.opus).toBe('block')
    expect(global.families.opus).not.toBe('block')
    expect((await run($, 'global')).text).toContain('web-app uses the global list again')
    expect(store.get('repo:/Users/me/dev/web-app')).toBeUndefined()
  })
})

describe('lists: another window changed them', () => {
  test('a pane edit keeps what another window saved in between (read, changed, written back)', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    seedPolicy(store, { versions: { 'sonnet-5.5': 'block' } })
    expect((await run($, 'block opus 5')).text).toContain('Blocked opus 5.')
    expect(policyIn(store).versions).toEqual({ 'sonnet-5.5': 'block', 'opus-5': 'block' })
  })

  test('a repo list another window dropped is not brought back by this session\'s next edit', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($, 'repo')
    store.delete('repo:/Users/me/dev/web-app')
    await run($, 'block opus 5')
    expect(store.get('repo:/Users/me/dev/web-app')).toBeUndefined()
    expect(policyIn(store).versions['opus-5']).toBe('block')
  })

  test('/models repo copies the stored global list, and keeps a repo list another window made first', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    seedPolicy(store, { versions: { 'haiku-5.5': 'block' } })
    await run($, 'repo')
    expect(policyIn(store, 'repo:/Users/me/dev/web-app').versions['haiku-5.5']).toBe('block')
    await run($, 'global')
    seedPolicy(store, { mode: 'swap' }, 'repo:/Users/me/dev/web-app')
    expect((await run($, 'repo')).text).toContain('web-app already has its own list')
    expect(policyIn(store, 'repo:/Users/me/dev/web-app').mode).toBe('swap')
  })

  test('/models shows another window\'s change at once, without waiting for a turn', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    seedPolicy(store, { versions: { 'opus-5': 'block' } })
    expect((await run($)).text).toContain('blocked: opus 5')
  })

  test('a store that can\'t be read leaves the 0.2 settings in force, and says so', { options: { defaultAllowed: 'opus' } }, async ($, on) => {
    const { failing, statuses, spawned } = engineOf(on)
    failing.get = true
    const r = await $.agent.spawn(spawnOf('sonnet'))
    expect('deny' in r && r.deny).toContain('sonnet is blocked')
    expect(spawned).toEqual([])
    expect(statuses.some(s => s?.includes('saved lists unreadable') && s.includes('using the settings'))).toBe(true)
  })
})

describe('lists: rows, so two windows never overwrite each other', () => {
  test('an edit writes only the row it changes', async ($, on) => {
    const { store, writes } = engineOf(on)
    seedList(store)
    await run($)
    writes.length = 0
    await run($, 'block opus 5')
    expect(writes).toEqual(['policy:global|version|opus-5'])
    await run($, 'new haiku block')
    await run($, 'mode swap')
    expect(writes).toEqual(['policy:global|version|opus-5', 'policy:global|family|haiku', 'policy:global|mode'])
  })

  test('another window\'s row written between this session\'s read and its write survives', async ($, on) => {
    const { store, race } = engineOf(on)
    seedList(store)
    await run($)
    race.beforeSet = key => {
      if (key === 'policy:global|version|opus-5') store.set('policy:global|version|haiku-4.5', 'block')
    }
    await run($, 'block opus 5')
    expect(policyIn(store).versions).toEqual({ 'opus-5': 'block', 'haiku-4.5': 'block' })
  })

  test('a dropped repo list takes its rows along; a new copy starts clean from the global list', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($, 'repo')
    await run($, 'block sonnet 5')
    expect(store.has('repo:/Users/me/dev/web-app|version|sonnet-5')).toBe(true)
    await run($, 'global')
    expect([...store.keys()].some(k => k.startsWith('repo:/Users/me/dev/web-app'))).toBe(false)
    store.set('repo:/Users/me/dev/web-app|version|opus-5', 'block')
    await run($, 'repo')
    expect(policyIn(store, 'repo:/Users/me/dev/web-app').versions).toEqual({})
  })
})
