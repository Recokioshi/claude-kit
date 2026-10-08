import { describe, expect, test } from 'claude-code/testing'

import { engineOf, seedList, seedPolicy, policyIn, run } from './harness'

describe('/models pane', () => {
  const mount = ($: { ui: { mount: (input: never) => Promise<unknown> } }, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' = 'terminal') =>
    $.ui.mount({ plugin: 'model-guard', surface, component: 'Pane', requestId: 'models', props: { bodyColumns: 60 } } as never) as Promise<{
      press: (q: { key: string }) => Promise<void>
      find: (q: { key: string }) => Promise<{ text?: string } | undefined>
      unmount: () => Promise<void>
    }>

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
