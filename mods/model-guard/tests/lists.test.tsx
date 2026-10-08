import { describe, expect, test } from 'claude-code/testing'

import { engineOf, seedList, seedPolicy, policyIn, spawnOf, run, turnOf, ONLY_OPUS_48 } from './harness'

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
