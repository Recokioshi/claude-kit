import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'
import { API_IDS, pageOf, engineOf, seedList, seedPolicy, spawnOf, run, ONLY_OPUS_48 } from './harness'
import type { Store } from './harness'

describe('the model list from Anthropic', () => {
  const start = ($: { session: { start: (input: never) => Promise<unknown> } }) =>
    $.session.start({ cwd: '/Users/me/dev/web-app', surface: 'terminal', isInteractive: true } as never)
  const listIn = (store: Store) => Hooks.parseCatalog(store.get('catalog'))

  test('a session start fetches the list through the session\'s own login; the first fill announces nothing', async ($, on) => {
    const { store, fetched, toasts, clock } = engineOf(on, { login: true })
    store.set('catalog', { entries: [], fetchedAt: null, lastError: null })
    await start($)
    await clock.settle()
    expect(fetched).toEqual([{ url: 'https://api.anthropic.com/v1/models?limit=1000', auth: 'h-1' }])
    const list = listIn(store)
    expect(list.entries.map(e => e.key)).toContain('haiku-5.5')
    expect(list.fetchedAt).not.toBeNull()
    expect(toasts.filter(t => t.includes('new model'))).toEqual([])
  })

  test('a later fill announces each new model once, with what the rules say about it', async ($, on) => {
    const { store, toasts, clock } = engineOf(on, { login: true, api: [{ status: 200, text: pageOf([...API_IDS, 'claude-opus-5-6']) }] })
    seedList(store)
    seedPolicy(store, { families: { opus: 'block' }, versions: { 'opus-4.8': 'allow' } })
    await clock.advance(25 * 60 * 60_000)
    await start($)
    await clock.settle()
    expect(toasts.filter(t => t.includes('new model'))).toEqual(['model-guard: new model claude-opus-5-6 (claude-opus-5-6), blocked. /models to change.'])
  })

  test('the list is fetched at most once a day, and /models refresh fetches now', async ($, on) => {
    const { store, fetched, clock } = engineOf(on, { login: true })
    store.set('catalog', { ...listIn(new Map()), fetchedAt: 0 })
    await clock.advance(60 * 60_000)
    await start($)
    await clock.settle()
    expect(fetched).toEqual([])
    expect((await run($, 'refresh')).text).toContain('Model list updated: 14 models')
    expect(fetched.length).toBe(1)
  })

  test('every page is read: has_more goes on after the last id', async ($, on) => {
    const { fetched } = engineOf(on, { login: true, api: [{ status: 200, text: pageOf(API_IDS.slice(0, 7), true) }, { status: 200, text: pageOf(API_IDS.slice(7)) }] })
    expect((await run($, 'refresh')).text).toContain('14 models')
    expect(fetched.map(f => f.url)).toEqual(['https://api.anthropic.com/v1/models?limit=1000', 'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-fable-5'])
  })

  test('a refused or unreadable answer keeps the list and says why', async ($, on) => {
    const { store } = engineOf(on, { login: true, api: [{ status: 401, text: '{"type":"error"}' }] })
    seedList(store)
    expect((await run($, 'refresh')).text).toContain('Model list not updated: the Models API answered 401')
    const list = listIn(store)
    expect(list.entries.length).toBe(14)
    expect(list.lastError).toBe('the Models API answered 401')
  })

  test('with no Anthropic login nothing is fetched and the list keeps the models seen in use', async ($, on) => {
    const { store, fetched, clock } = engineOf(on, { login: false, mainModel: 'claude-sonnet-5-5' })
    await start($)
    await clock.settle()
    expect(fetched).toEqual([])
    const list = listIn(store)
    expect(list.entries.map(e => e.key)).toEqual(['sonnet-5.5'])
    expect(list.lastError).toContain('no Anthropic login')
  })

  test('models seen running join the list: the main model and what subagents ran on', async ($, on) => {
    const { store } = engineOf(on)
    await start($)
    await $.agent.spawn(spawnOf('claude-haiku-5-5'))
    expect(listIn(store).entries.map(e => e.key).sort()).toEqual(['haiku-5.5', 'opus-5.5'])
    expect(listIn(store).entries.every(e => e.sources.includes('seen'))).toBe(true)
  })

  test('the main conversation on a blocked version is left alone, with a toast at start and after /model', async ($, on) => {
    const { store, toasts } = engineOf(on, { mainModel: 'claude-opus-5' })
    seedList(store)
    seedPolicy(store, ONLY_OPUS_48)
    await start($)
    expect(toasts.at(-1)).toContain('this conversation runs on opus 5, which is blocked here')
    await $.classic.PostModelSwitch({ from_model: 'claude-opus-4-8', to_model: 'claude-opus-5-5', requested_model: null, source: 'auto', context_tokens: 0 } as never)
    expect(toasts.at(-1)).toContain('runs on opus 5.5, which is blocked here')
  })
})
