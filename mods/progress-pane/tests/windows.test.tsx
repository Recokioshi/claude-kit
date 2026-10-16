import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'
import { SAMPLE } from './logic.test'

// Native Windows: the repo root as the engine hands it (backslashes), paths and tool inputs in Windows style.
const ROOT = String.raw`C:\Users\me\dev\web-app`
const FILES = 'C:/Users/me/dev/web-app'
const WORKLOG = `${FILES}/plans/a-worklog.md`
const TOOL = 'mcp__progress-pane__worklog'

describe('paths in both styles', () => {
  test('absolute: a leading slash or backslash, or a drive letter with either separator', () => {
    for (const p of ['/home/me/x.md', String.raw`\plans\x.md`, String.raw`C:\repo\plans\x-worklog.md`, 'c:/repo/plans/x-worklog.md', String.raw`\\server\share\x.md`]) expect(Hooks.isAbsolutePath(p)).toBe(true)
    for (const p of ['plans/x.md', String.raw`plans\x.md`, 'C:x.md', '']) expect(Hooks.isAbsolutePath(p)).toBe(false)
  })

  test('a Windows path gets / separators and a capital drive; any other path is left alone', () => {
    expect(Hooks.normalizePath(String.raw`c:\Users\me\x.md`)).toBe('C:/Users/me/x.md')
    expect(Hooks.normalizePath(String.raw`\\server\share\x.md`)).toBe('//server/share/x.md')
    expect(Hooks.normalizePath('/Users/me/web-app')).toBe('/Users/me/web-app')
    expect(Hooks.normalizePath(String.raw`/tmp/odd\name.md`)).toBe(String.raw`/tmp/odd\name.md`)
  })

  test('the same file in two spellings is the same path; on POSIX case and backslashes count', () => {
    expect(Hooks.samePath(String.raw`C:\Repo\plans\a.md`, 'c:/repo/plans/a.md')).toBe(true)
    expect(Hooks.samePath(String.raw`C:\Repo\plans\a.md`, 'C:/repo/plans/b.md')).toBe(false)
    expect(Hooks.samePath('/a/B.md', '/a/b.md')).toBe(false)
    expect(Hooks.samePath(String.raw`/a/b\c.md`, '/a/b/c.md')).toBe(false)
  })

  test('joined with one slash, whatever the root ends in', () => {
    expect(Hooks.joinPath(ROOT, String.raw`plans\a-worklog.md`)).toBe(WORKLOG)
    expect(Hooks.joinPath('C:/', 'plans')).toBe('C:/plans')
    expect(Hooks.joinPath('/Users/me/web-app', 'plans/a.md')).toBe('/Users/me/web-app/plans/a.md')
  })

  test('relative to the root across separators and drive-letter case; elsewhere it stays whole', () => {
    expect(Hooks.relativeTo(ROOT, 'c:/users/me/dev/web-app/plans/a-worklog.md')).toBe('plans/a-worklog.md')
    expect(Hooks.relativeTo('C:/Users/me/dev/web-app', String.raw`C:\Users\me\dev\web-app\plans\a-worklog.md`)).toBe('plans/a-worklog.md')
    expect(Hooks.relativeTo(ROOT, String.raw`D:\other\a-worklog.md`)).toBe('D:/other/a-worklog.md')
    expect(Hooks.relativeTo('/Users/me/web-app', '/Users/me/web-app/plans/a.md')).toBe('plans/a.md')
    expect(Hooks.relativeTo('/Users/me/web-app', '/Users/me/web-app-2/plans/a.md')).toBe('/Users/me/web-app-2/plans/a.md')
  })
})

describe('what the mod sees of a Windows shell', () => {
  test('a tool label names the file of a Windows path, and a PowerShell command like a Bash one', () => {
    expect(Hooks.toolLabel('Edit', { file_path: String.raw`C:\Users\me\dev\web-app\src\tiers.ts` })).toBe('Edit tiers.ts')
    expect(Hooks.toolLabel('Edit', { file_path: '/Users/me/web-app/src/tiers.ts' })).toBe('Edit tiers.ts')
    expect(Hooks.toolLabel('PowerShell', { command: 'npm run test -- --watch' })).toBe('$ npm run test')
  })

  test('PowerShell and Bash calls read alike; other tools run no command', () => {
    expect(Hooks.shellCallOf('PowerShell', { command: 'npm test', run_in_background: true })).toEqual({ command: 'npm test', isBackground: true })
    expect(Hooks.shellCallOf('Bash', { command: 'npm test' })).toEqual({ command: 'npm test', isBackground: false })
    expect(Hooks.shellCallOf('PowerShell', {})).toEqual({ command: '', isBackground: false })
    expect(Hooks.shellCallOf('Edit', { command: 'npm test' })).toBeNull()
  })

  test('gates in PowerShell syntax: ; separators, && in pwsh 7, the & call operator, a block after if', () => {
    for (const c of ['npm test', 'npm run test', String.raw`$env:CI='1'; npm run dod`, 'cd app; npm test', 'cd app && npm test', '& npm run test', 'cd app; if ($?) { npm run dod }']) {
      expect(Hooks.gateRunOf(c, undefined), c).not.toBeNull()
    }
    expect(Hooks.gateRunOf('npm run dod 2>&1 | Select-Object -Last 20', 'npm run dod')).toEqual({ isPiped: true })
    expect(Hooks.gateRunOf('Write-Host "npm test"', undefined)).toBeNull()
  })

  test('commits in PowerShell syntax', () => {
    expect(Hooks.isCommitCommand('git add -A; git commit -m "feat: x"')).toBe(true)
    expect(Hooks.isCommitCommand('git -C C:\\repo commit -m "feat: x"')).toBe(true)
    expect(Hooks.isCommitCommand('git push origin main')).toBe(false)
  })
})

type Fs = Map<string, { text: string; mtimeMs: number }>

/** A Windows session: the repo root with backslashes, files kept under their `C:/` spelling, shell calls answered per command. */
function windowsEngine(on: On, bash: (command: string) => { ok: boolean; text?: string } = () => ({ ok: true }), files: Record<string, string> = {}) {
  const fs: Fs = new Map(Object.entries(files).map(([p, text]) => [p, { text, mtimeMs: 1 }]))
  let tick = 10
  const clock = mock.clock(on)
  // This test host is POSIX, so the engine resolves `C:/x` against its cwd: undo that to see the path the mod passed.
  const unrooted = (path: string) => path.replace(/^.*?\/(?=[A-Za-z]:\/)/, '')
  const pathOf = (e: unknown) => unrooted(String((e as { path?: string }).path ?? ''))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 61_000, window: 100_000, percent: 61 }, rateLimits: [], cost: { usd: 4.1 } } as never }))
  on('fs.list', ($, e) => {
    const dir = pathOf(e)
    const entries = [...fs.entries()].filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
    if (entries.length === 0) return { deny: 'no such folder' }
    return { value: entries.map(([p, f]) => ({ name: p.slice(dir.length + 1), kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })) as never }
  })
  on('fs.read', ($, e) => {
    const f = fs.get(pathOf(e))
    return f ? { value: f.text as never } : { deny: 'missing' }
  })
  on('fs.stat', ($, e) => {
    const f = fs.get(pathOf(e))
    return f ? { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } as never } : { deny: 'missing' }
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    tick += 1
    fs.set(unrooted(path), { text, mtimeMs: tick })
    return { value: undefined } as never
  })
  // `pgrep` does not exist on Windows: a server check that ran would throw, as it does there.
  on('process.run', ($, e) => {
    if (e.argv[0] === 'pgrep') throw new Error('spawn pgrep ENOENT')
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', () => ({ value: { tool: TOOL } }) as never)
  on('command.register', () => ({ value: { command: 'progress' } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('prompt.fill', () => ({ value: { isFilled: true } }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('tool.call', ($, e) => {
    // The generated tool types come from a build with no PowerShell tool.
    const name: string = e.tool
    if (name === 'PowerShell' || name === 'Bash') {
      const r = bash(String((e as { command?: string }).command ?? ''))
      return r.ok ? { result: { stdout: r.text ?? '', stderr: '', interrupted: false } as never, text: r.text ?? '' } : { isError: true as const, result: 'failed' as never, text: r.text ?? 'exit 1' }
    }
    if (e.tool === 'Edit') {
      const { file_path, new_string } = e as unknown as { file_path: string; new_string: string }
      tick += 1
      fs.set(Hooks.normalizePath(file_path), { text: new_string, mtimeMs: tick })
      return { result: 'edited' as never }
    }
    return { result: 'ok' as never }
  })
  return { fs, clock }
}

const start = (engine: { session: { start: (input: never) => Promise<unknown> } }) => engine.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
const tool = (engine: { tool: { call: (input: never) => Promise<{ deny?: string; result?: unknown }> } }, input: Record<string, unknown>) => engine.tool.call({ tool: TOOL, ...input } as never)
const progress = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, args = '') =>
  engine.command.run({ command: 'progress', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as never)

const PLAN = { op: 'start', title: 'Tier restructure', branch: 'claude/tiers', gate: 'npm run dod', phases: [{ title: 'API', steps: ['Drop tier', 'Migrate'] }] }

describe('a session on native Windows', () => {
  test('the worklog is found under plans/ and followed', async ($, on) => {
    windowsEngine(on, undefined, { [WORKLOG]: SAMPLE })
    await start($)
    expect((await progress($, 'text')).text).toContain('Team billing')
  })

  test('/progress use takes a drive-letter path with backslashes or slashes, and a relative one with backslashes', async ($, on) => {
    windowsEngine(on, undefined, { [WORKLOG]: SAMPLE.replace('Team billing', 'Team billing, other') })
    await start($)
    expect((await progress($, String.raw`use C:\Users\me\dev\web-app\plans\a-worklog.md`)).text).toContain('Following')
    expect((await progress($, 'use c:/Users/me/dev/web-app/plans/a-worklog.md')).text).toContain('Following')
    expect((await progress($, String.raw`use plans\a-worklog.md`)).text).toContain('Following')
    expect((await progress($, String.raw`use C:\elsewhere\nope-worklog.md`)).text).toContain('Could not read')
  })

  test('start writes plans/<date>-<slug>-worklog.md under the root and names it relative to the root', async ($, on) => {
    const { fs } = windowsEngine(on)
    await start($)
    const r = await tool($, PLAN)
    const path = [...fs.keys()].find(p => p.endsWith('-tier-restructure-worklog.md'))
    expect(path?.startsWith(`${FILES}/plans/`)).toBe(true)
    expect(String(r.result)).toContain(' · file: plans/')
    expect(String(r.result)).not.toContain('C:')
  })

  test('the contract names the worklog relative to the root', async ($, on) => {
    windowsEngine(on, undefined, { [WORKLOG]: SAMPLE })
    await start($)
    const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
    expect(composed.sections.find(s => s.id === 'progress-pane')?.text).toContain('# Active worklog: plans/a-worklog.md')
  })

  test('a PowerShell gate run counts: done is refused until it passes, and a red one keeps it refused', async ($, on) => {
    windowsEngine(on, cmd => ({ ok: !cmd.includes('red') }))
    await start($)
    await tool($, PLAN)
    await tool($, { op: 'step', id: 'A1', status: 'doing' })
    expect((await tool($, { op: 'step', id: 'A1', status: 'done', commit: 'abc1234' })).deny).toContain('not done until `npm run dod` passes')
    await $.tool.call({ tool: 'PowerShell', command: 'npm run dod 2>&1 | Select-Object -Last 20' } as never)
    expect(String((await tool($, { op: 'step', id: 'A1', status: 'done', commit: 'abc1234' })).result)).toContain('OK A1 → done')
    await tool($, { op: 'step', id: 'A2', status: 'doing' })
    await $.tool.call({ tool: 'PowerShell', command: 'cd app; npm run dod; red' } as never)
    expect((await progress($, 'text')).text).toContain('gate failed')
  })

  test('a PowerShell commit is seen, and a dev server it leaves running is not tracked (no pgrep to check it)', async ($, on) => {
    windowsEngine(on, cmd => ({ ok: true, text: cmd.startsWith('git commit') ? '[claude/fc-a3 4e9d692] feat(a3): seat count\n 2 files changed' : '' }), { [WORKLOG]: SAMPLE })
    await start($)
    await $.tool.call({ tool: 'PowerShell', command: 'git commit -m "feat(a3): seat count"' } as never)
    await $.tool.call({ tool: 'PowerShell', command: 'npx expo start --dev-client', run_in_background: true } as never)
    const text = (await progress($, 'text')).text ?? ''
    expect(text).toContain('last commit 4e9d692')
    expect(text).not.toContain('left running')
  })

  test('a broken hand edit through the Edit tool is reported back, whichever way the tool spells the path', async ($, on) => {
    windowsEngine(on, undefined, { [WORKLOG]: SAMPLE })
    await start($)
    for (const file_path of [String.raw`C:\Users\me\dev\web-app\plans\a-worklog.md`, String.raw`c:\users\me\dev\web-app\plans\a-worklog.md`, WORKLOG]) {
      const r = await $.tool.call({ tool: 'Edit', file_path, old_string: 'x', new_string: SAMPLE.replace('- [ ] B1', '* B1') } as never)
      expect(((r as { context?: string[] }).context ?? []).join(' ')).toContain('no longer follows WL1')
    }
  })
})
