import { describe, expect, test } from 'claude-code/testing'

import { engineOf, pageOf, API_IDS, seedList, seedPolicy, policyIn, run } from './harness'

type Drawing = {
  press: (q: { key: string }) => Promise<void>
  find: (q: { key: string }) => Promise<{ text?: string } | undefined>
  unmount: () => Promise<void>
}

const mount = ($: { ui: { mount: (input: never) => Promise<unknown> } }, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' = 'terminal', columns = 60) =>
  $.ui.mount({ plugin: 'model-guard', surface, component: 'Pane', requestId: 'models', props: { bodyColumns: columns } } as never) as Promise<Drawing>

describe('/models pane', () => {

  test('the newest version of each family and every ruled one are on show; the rest are behind "more"', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    seedPolicy(store, { versions: { 'opus-5': 'block' } })
    await run($)
    const ui = await mount($)
    for (const key of ['opus-5.5', 'opus-5', 'sonnet-5.5', 'haiku-5.5', 'fable-5.1']) {
      expect(await ui.find({ key: `toggle-${key}` })).toBeDefined()
    }
    expect(await ui.find({ key: 'toggle-opus-4.8' })).toBeUndefined()
    expect((await ui.find({ key: 'more' }))?.text).toContain('9 older versions')
    await ui.press({ key: 'more' })
    expect(await ui.find({ key: 'toggle-opus-4.8' })).toBeDefined()
  })

  test('a toggle saves at once to the global list; the last allowed model can\'t be blocked', async ($, on) => {
    const { toasts, store } = engineOf(on)
    seedList(store, ['claude-opus-5', 'claude-opus-4-8'])
    await run($)
    const ui = await mount($)
    await ui.press({ key: 'toggle-opus-5' })
    expect((policyIn(store)).versions['opus-5']).toBe('block')
    await ui.press({ key: 'more' })
    await ui.press({ key: 'toggle-opus-4.8' })
    expect((policyIn(store)).versions['opus-4.8']).toBeUndefined()
    expect(toasts.at(-1)).toContain('Something must stay allowed')
  })

  test('fallback, mode and the repo list from the pane, on every surface', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'toggle-opus-5.5' })).toBeDefined()
      expect(await ui.find({ key: 'close' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await mount($)
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: opus 5.5')
    await ui.press({ key: 'fallback' })
    expect((await ui.find({ key: 'fallback' }))?.text).toContain('fallback: sonnet 5.5')
    await ui.press({ key: 'mode' })
    expect((policyIn(store)).mode).toBe('swap')
    await ui.press({ key: 'repo' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('web-app list')
    await ui.press({ key: 'repo' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('global')
  })

  test('the 0.2 family list form still works, and unknown words are explained', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    expect((await run($, 'opus, sonnet')).text).toContain('blocked: haiku (all), fable (all), other families')
    expect((await run($, 'gpt')).text).toContain('No model family in "gpt"')
  })
})

describe('/models pane: new versions and the list', () => {
  test('the new-versions view flips a family\'s default and the one for families not named', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    const ui = await mount($)
    await ui.press({ key: 'new-versions' })
    expect((await ui.find({ key: 'head' }))?.text).toContain('new versions')
    expect(await ui.find({ key: 'toggle-opus-5.5' })).toBeUndefined()
    await ui.press({ key: 'family-haiku' })
    expect(policyIn(store).families.haiku).toBe('block')
    await ui.press({ key: 'family-other' })
    expect(policyIn(store).unnamedFamilies).toBe('block')
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'toggle-opus-5.5' })).toBeDefined()
    expect((await ui.find({ key: 'main-family-haiku' }))?.text).toContain('new versions: blocked')
  })

  test('the list line says where the list came from, and why a refresh failed', async ($, on) => {
    const { store, clock } = engineOf(on, { login: true, api: [{ status: 503, text: '' }] })
    seedList(store)
    await clock.advance(3 * 60 * 60_000)
    await run($)
    const ui = await mount($)
    expect((await ui.find({ key: 'list-status' }))?.text).toContain('list: Anthropic, updated 3h ago')
    await ui.press({ key: 'refresh' })
    expect((await ui.find({ key: 'list-status' }))?.text).toContain('list not refreshed: the Models API answered 503')
  })

  test('refresh from the pane fetches now', async ($, on) => {
    const { store, fetched, toasts } = engineOf(on, { login: true, api: [{ status: 200, text: pageOf(API_IDS) }] })
    store.set('catalog', { entries: [], fetchedAt: null, lastError: null })
    await run($)
    const ui = await mount($)
    expect((await ui.find({ key: 'list-status' }))?.text).toContain('list: models seen in use')
    await ui.press({ key: 'refresh' })
    expect(fetched.length).toBe(1)
    expect(toasts.at(-1)).toContain('Model list updated: 14 models')
    expect(await ui.find({ key: 'toggle-haiku-5.5' })).toBeDefined()
  })

  test('a narrow pane drops the ids; the phone gets every control', async ($, on) => {
    const { store } = engineOf(on)
    seedList(store)
    await run($)
    const narrow = await mount($, 'mobile', 36)
    expect((await narrow.find({ key: 'row-opus-5.5' }))?.text).not.toContain('claude-opus-5-5')
    for (const key of ['more', 'new-versions', 'fallback', 'mode', 'refresh', 'repo', 'close']) {
      expect(await narrow.find({ key })).toBeDefined()
    }
    await narrow.unmount()
    const wide = await mount($, 'terminal', 80)
    expect((await wide.find({ key: 'row-opus-5.5' }))?.text).toContain('claude-opus-5-5')
  })
})

describe('/models pane: when saving fails', () => {
  test('a press whose save fails says so, and nothing claims success', async ($, on) => {
    const { store, failing, toasts } = engineOf(on)
    seedList(store)
    await run($)
    const ui = await mount($)
    failing.set = true
    await ui.press({ key: 'toggle-opus-5.5' })
    expect(toasts.at(-1)).toContain('model-guard: not saved')
    expect(policyIn(store).versions['opus-5.5']).toBeUndefined()
  })
})
