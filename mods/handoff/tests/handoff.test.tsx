import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'

const GOOD = `To: web

## TL;DR
Consent copy and the error-report checkbox are done in api; the privacy policy sentence must follow on the web.

## Done
- error-report consent checkbox · 4e9d692
- EN/PL copy via the copy skill · 9b11bb1

## Next steps
1. Update the privacy policy sentence in web (beta).
2. Open a PR to master.

## Decisions & constraints
- web holds the official legal documents.

## For the receiving side
- Mirror the sentence from docs/legal/privacy.md.

## Gotchas
- none
`

const FACTS = { repo: 'api', branch: 'claude/consent', dirty: 0, commits: ['4e9d692 feat: consent'], remote: 'acme/api', prs: ['https://github.com/acme/api/pull/337'], worklog: null }

describe('the note', () => {
  test('the fork is asked for the six sections, with the facts', () => {
    const p = Hooks.forkPrompt('consent', FACTS, 'web')
    for (const s of Hooks.SECTIONS) expect(p).toContain(`## ${s}`)
    expect(p).toContain('pull/337')
    expect(p).toContain('the user said: web')
  })
  test('a complete answer has no missing sections; a partial one says which', () => {
    expect(Hooks.missingSections(GOOD)).toEqual([])
    expect(Hooks.missingSections('## TL;DR\nx\n## Done\ny')).toEqual(['Next steps', 'Decisions & constraints', 'For the receiving side', 'Gotchas'])
  })
  test('assembled, it previews its TL;DR, next steps and target', () => {
    const { to, body } = Hooks.splitTo(GOOD)
    expect(to).toBe('web')
    const text = Hooks.assemble({ title: 'Consent copy', repo: 'api', to: to ?? '', branch: 'claude/consent', created: '2026-10-04 14:02' }, FACTS, Hooks.sectionsOf(body))
    expect(text).toContain('## State (facts)\n- repo: api (acme/api)')
    const preview = Hooks.previewOf(text)
    expect(preview.to).toBe('web')
    expect(preview.tldr).toContain('privacy policy sentence must follow')
    expect(preview.next[0]).toBe('Update the privacy policy sentence in web (beta).')
  })
  test('PR links and targets', () => {
    expect(Hooks.prUrlsIn('see https://github.com/acme/api/pull/337 and https://github.com/acme/api/pull/337')).toEqual(['https://github.com/acme/api/pull/337'])
    expect(Hooks.isFor('acme/web', 'web')).toBe(true)
    expect(Hooks.isFor('api', 'web')).toBe(false)
  })
  test('a target matches the repo by exact name, not by substring', () => {
    expect(Hooks.isFor('api', 'api-gateway')).toBe(false)
    expect(Hooks.isFor('api', 'my-api')).toBe(false)
    expect(Hooks.isFor('api-gateway', 'api')).toBe(false)
    expect(Hooks.isFor('my-api', 'api')).toBe(false)
    expect(Hooks.isFor('acme/api-gateway', 'api')).toBe(false)
    expect(Hooks.isFor('acme/Api', 'api')).toBe(true)
  })
  test('section headers are matched by prefix, in any case, with a trailing colon', () => {
    const variant = GOOD.replace('## Next steps', '## Next steps (for the next session)').replace('## TL;DR', '## tl;dr:  ').replace('## Gotchas', '## GOTCHAS:')
    expect(Hooks.missingSections(variant)).toEqual([])
    const s = Hooks.sectionsOf(Hooks.splitTo(variant).body)
    expect(s['Next steps']).toContain('1. Update the privacy policy sentence')
    expect(s['TL;DR']).toContain('Consent copy')
    expect(s.Gotchas).toBe('- none')
    expect(Hooks.missingSections('## Doneness\nx')).toContain('Done')
  })
})

type World = { repo: string; fork: (prompt: string) => { isAnswered: true; text: string } | { isAnswered: false; reason: 'api-error' } }

function worldOf(on: On, world: World) {
  const files = new Map<string, string>()
  const filled: string[] = []
  const toasts: string[] = []
  const copied: string[] = []
  const forks: string[] = []
  const root = `/Users/me/dev/${world.repo}`
  const rootNow = () => `/Users/me/dev/${world.repo}`
  mock.clock(on)
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: rootNow(), remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: rootNow() }))
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: 'Opened https://github.com/acme/api/pull/337', toolUses: [] }] }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('process.run', ($, e) => {
    const a = e.argv.join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (a.includes('rev-parse')) return out('claude/consent\n')
    if (a.includes('status --porcelain')) return out(' M src/a.ts\n')
    if (a.includes('log -8')) return out('4e9d692 feat: consent\n9b11bb1 copy\n')
    if (a.includes('remote get-url')) return out('git@github.com:acme/api.git\n')
    return out('')
  })
  on('fs.list', () => ({ deny: 'none' }))
  on('fs.read', ($, e) => {
    const t = files.get(String((e as { path?: string }).path ?? ''))
    return t === undefined ? { deny: 'missing' } : { value: t as never }
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    files.set(path, text)
    return { value: undefined } as never
  })
  on('model.fork', ($, e) => {
    forks.push(String((e as { prompt?: string }).prompt ?? ''))
    return { value: world.fork(String((e as { prompt?: string }).prompt ?? '')) as never }
  })
  on('ui.copy', ($, e) => {
    copied.push(String((e as { text?: string }).text ?? ''))
    return { value: { isCopied: true } } as never
  })
  on('prompt.fill', ($, e) => {
    filled.push(String((e as { text?: string }).text ?? ''))
    return { isFilled: true } as never
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? ''))
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: { command: 'handoff' } }) as never)
  return { files, filled, toasts, copied, forks, root }
}

const run = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, args = '') =>
  engine.command.run({ command: 'handoff', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
const start = (engine: { session: { start: (input: never) => Promise<unknown> } }, cwd: string) =>
  engine.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)

describe('/handoff', () => {
  test('writes the note under ~/.claude/handoffs, copies it and says where', async ($, on) => {
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: true, text: GOOD }) })
    await start($, w.root)
    const r = await run($, 'to web consent copy')
    const [path, text] = [...w.files.entries()][0] ?? ['', '']
    expect(path).toMatch(/^\/Users\/me\/\.claude\/handoffs\/api\/\d{4}-\d{2}-\d{2}-\d{4}-consent-copy\.md$/)
    expect(text).toContain('to: web')
    expect(text).toContain('branch: claude/consent · 1 uncommitted file')
    expect(text).toContain('PRs mentioned: https://github.com/acme/api/pull/337')
    expect(w.copied[0]).toBe(text)
    expect(r.text).toContain('copied to the clipboard')
    expect(w.forks[0]).toContain('4e9d692 feat: consent')
  })

  test('a fork that leaves sections out is asked once more', async ($, on) => {
    let calls = 0
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: true, text: ++calls === 1 ? '## TL;DR\nhalf' : GOOD }) })
    await start($, w.root)
    await run($, 'consent')
    expect(w.forks).toHaveLength(2)
    expect(w.forks[1]).toContain('missing these sections')
    expect([...w.files.values()][0]).toContain('## For the receiving side\n- Mirror the sentence')
  })

  test('when the fork cannot answer, the note still holds the facts', async ($, on) => {
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: false, reason: 'api-error' }) })
    await start($, w.root)
    const r = await run($, 'consent')
    expect(r.text).toContain('the note holds the facts')
    expect([...w.files.values()][0]).toContain('- last commits: 4e9d692 feat: consent | 9b11bb1 copy')
  })
})

describe('picking it up in the other repo', () => {
  test('a note for this repo shows as a toast; pick inserts a pointer with the TL;DR', async ($, on) => {
    const world: World = { repo: 'api', fork: () => ({ isAnswered: true, text: GOOD }) }
    const w = worldOf(on, world)
    await start($, w.root)
    await run($, 'consent copy')
    world.repo = 'web'
    await start($, '/Users/me/dev/web')
    expect(w.toasts.some(t => t.includes('1 handoff waiting from api'))).toBe(true)
    const r = await run($, 'pick 1')
    expect(r.text).toContain('Inserted the handoff')
    expect(w.filled[0]).toContain('Continue from the handoff in /Users/me/.claude/handoffs/api/')
    expect(w.filled[0]).toContain('TL;DR: Consent copy and the error-report checkbox are done')
  })

  test('the list answers in text where nothing draws', async ($, on) => {
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: true, text: GOOD }) })
    await start($, w.root)
    await run($, 'consent copy')
    const list = await run($, 'list')
    expect(list.text).toContain('1. api → web · consent copy')
    expect(list.text).toContain('/handoff pick <n>')
  })

  test('pick n inserts and marks it picked up', async ($, on) => {
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: true, text: GOOD }) })
    await start($, w.root)
    await run($, 'consent copy')
    await run($, 'pick 1')
    expect(w.filled[0]).toContain('TL;DR: Consent copy and the error-report checkbox are done')
    expect((await run($, 'list')).text).toContain('(picked up)')
  })

  test('the pane works on every surface; Insert fills the prompt', async ($, on) => {
    const w = worldOf(on, { repo: 'api', fork: () => ({ isAnswered: true, text: GOOD }) })
    await start($, w.root)
    await run($, 'consent copy')
    for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
      const ui = await $.ui.mount({ plugin: 'handoff', surface, component: 'Pane', requestId: 'handoff', props: { bodyColumns: 64 } as never })
      expect(await ui.find({ key: 'insert' })).toBeDefined()
      expect(await ui.find({ text: /TL;DR/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'Pane', requestId: 'handoff', props: { bodyColumns: 64 } as never })
    await ui.press({ key: 'insert' })
    expect(w.filled[0]).toContain('Continue from the handoff')
  })
})
