import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Repo = {
  branch?: string
  remote?: string
  /** `git status --porcelain` per worktree path. */
  status?: Record<string, string>
  lastAssistant?: string
  /** `git rev-parse` fails (detached, not a repo). */
  isBranchUnknown?: boolean
  /** `gh pr view --json baseRefName` answers this. */
  prBase?: string
}

/**
 * Stands in for the engine: a repo at /repo on `branch`, a Bash tool that
 * records what reached it, prompts and commands that just enter.
 */
function engineOf(on: On, repo: Repo = {}) {
  const ran: string[] = []
  mock.clock(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.messages', () => ({
    value: repo.lastAssistant ? [{ role: 'assistant' as const, text: repo.lastAssistant, toolUses: [] }] : [],
  }))
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv.includes('rev-parse --abbrev-ref HEAD')) {
      return repo.isBranchUnknown ? out('', 128) : out(`${repo.branch ?? 'claude/feature'}\n`)
    }
    if (argv.startsWith('gh pr view') && repo.prBase !== undefined) {
      return out(`${repo.prBase}\n`)
    }
    if (argv.includes('remote get-url origin')) {
      return out(`${repo.remote ?? 'git@github.com:acme/app.git'}\n`)
    }
    if (argv.includes('status --porcelain')) {
      return out(repo.status?.[String(e.init?.cwd ?? '')] ?? '')
    }
    return out('', 1)
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') {
      ran.push(String(e.command))
      return { result: { stdout: '', stderr: '', interrupted: false } as never }
    }
    if (e.tool === 'AskUserQuestion') {
      return { result: { questions: [], answers: { 'Push and open a PR to master?': 'Yes' } } as never }
    }
    return { result: 'ok' as never }
  })
  return { ran }
}

type Kind = 'composer' | 'bridge' | 'peer' | 'task-notification' | 'channel'
/** A prompt as the engine queues it, from the given origin. */
const say = (engine: { prompt: { submit: (input: never) => Promise<unknown> } }, text: string, kind: Kind = 'composer') =>
  engine.prompt.submit({ text, wait: false, origin: { kind } } as never)

/** A slash command the person typed. */
const run = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, command: string, args = '') =>
  engine.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)

const bash = (command: string) => ({ tool: 'Bash' as const, command })
const refused = (r: { deny?: string }) => r.deny !== undefined && r.deny.startsWith('git-gate')

describe('without the user asking', () => {
  test('reading git is free; writing it is refused with a note to ask', async ($, on) => {
    const { ran } = engineOf(on)
    expect(refused(await $.tool.call(bash('git status && git log -3')))).toBe(false)
    const push = await $.tool.call(bash('git push -u origin claude/feature'))
    expect(refused(push)).toBe(true)
    expect(push.deny).toContain('Ask the user first')
    expect(push.deny).toContain('Do not retry')
    expect(ran).toEqual(['git status && git log -3'])
  })

  test('non-git commands are never touched', async ($, on) => {
    const { ran } = engineOf(on)
    await $.tool.call(bash('npm run dod'))
    expect(ran).toEqual(['npm run dod'])
  })
})

describe('grants from the latest prompt', () => {
  test('"commit changes" allows a commit, not a push', async ($, on) => {
    engineOf(on)
    await say($, 'commit changes')
    expect(refused(await $.tool.call(bash('git add -A && git commit -m "fix: x"')))).toBe(false)
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
  })

  test('PR yes, merge no; acme/web PRs get --base develop', { options: { prBase: 'acme/web=develop' } }, async ($, on) => {
    const { ran } = engineOf(on, { remote: 'https://github.com/acme/web.git' })
    await say($, "Yes, create a branch, commit the changes and create a PR. Don't merge it yet")
    const pr = await $.tool.call(bash('git push -u origin claude/x && gh pr create --title t --body b'))
    expect(refused(pr)).toBe(false)
    expect(ran.at(-1)).toContain('gh pr create --base develop --title t')
    expect(refused(await $.tool.call(bash('gh pr merge 19 --merge')))).toBe(true)
  })

  test('a continuation keeps the grants, a new request drops them', async ($, on) => {
    engineOf(on)
    await say($, 'commit it and push')
    await say($, 'Continue')
    expect(refused(await $.tool.call(bash('git push')))).toBe(false)
    await say($, 'now fix the onboarding button colour')
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
  })

  test('another session or a notification cannot grant anything', async ($, on) => {
    engineOf(on)
    await say($, 'commit and push everything now', 'peer')
    await say($, 'push it', 'task-notification')
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
    await say($, 'push it', 'bridge')
    expect(refused(await $.tool.call(bash('git push')))).toBe(false)
  })

  test('"yes" takes what Claude proposed in its question', async ($, on) => {
    engineOf(on, { lastAssistant: 'Everything is green.\n\nShall I push claude/feature and open a PR to master?' })
    await say($, 'yes')
    expect(refused(await $.tool.call(bash('git push -u origin claude/feature && gh pr create --base master --fill')))).toBe(false)
    expect(refused(await $.tool.call(bash('gh pr merge 1')))).toBe(true)
  })

  test('a "Yes" in the question dialog grants what the question asked', async ($, on) => {
    engineOf(on)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    expect(refused(await $.tool.call(bash('git push && gh pr create --base master --fill')))).toBe(false)
  })
})

describe('protected branches', () => {
  test('merging into master needs a merge go-ahead naming it (or none named)', async ($, on) => {
    engineOf(on, { branch: 'master' })
    await say($, 'commit changes and merge to schema-v2/main')
    expect(refused(await $.tool.call(bash('git merge claude/x')))).toBe(true)
  })

  test('a kickoff never covers committing onto master', async ($, on) => {
    engineOf(on, { branch: 'master' })
    await run($, 'kickoff', 'plans/x.md')
    expect(refused(await $.tool.call(bash('git commit -m wip')))).toBe(true)
  })

  test('a kickoff covers commits and phase merges on task branches', async ($, on) => {
    engineOf(on, { branch: 'claude/billing' })
    await run($, 'kickoff', 'plans/x.md claude/billing')
    await say($, 'Continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: a1"')))).toBe(false)
    expect(refused(await $.tool.call(bash('git merge --no-ff claude/fc-a1')))).toBe(false)
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
  })
})

describe('/ship', () => {
  test('typing /ship allows commit, push and PR, but not merge', async ($, on) => {
    engineOf(on)
    await run($, 'ship')
    expect(refused(await $.tool.call(bash('git commit -m x && git push -u origin claude/feature')))).toBe(false)
    expect(refused(await $.tool.call(bash('gh pr create --base master --fill')))).toBe(false)
    expect(refused(await $.tool.call(bash('gh pr merge')))).toBe(true)
  })

  test('/ship started by Claude alone is told to stay local', async ($, on) => {
    engineOf(on)
    on('skill.prompt', ($, e) => ({ text: e.text }))
    const got = await $.skill.prompt({ skill: 'ship', text: 'SHIP BODY' })
    expect(got.text).toContain('SHIP BODY')
    expect(got.text).toContain('has not asked for a push')
  })
})

describe('worktrees, MCP and the escape hatch', () => {
  test('Claude may remove a clean worktree it created; not someone else\'s', async ($, on) => {
    engineOf(on, { status: { '/repo/.claude/worktrees/fc-a1': '' } })
    await $.tool.call(bash('git worktree add -q .claude/worktrees/fc-a1 -b claude/fc-a1 main'))
    expect(refused(await $.tool.call(bash('git worktree remove .claude/worktrees/fc-a1')))).toBe(false)
    expect(refused(await $.tool.call(bash('git worktree remove ../codex/wt-7')))).toBe(true)
  })

  test('a dirty own worktree needs the user', async ($, on) => {
    engineOf(on, { status: { '/repo/.claude/worktrees/fc-a2': ' M src/a.ts' } })
    await $.tool.call(bash('git worktree add .claude/worktrees/fc-a2 -b claude/fc-a2'))
    expect(refused(await $.tool.call(bash('git worktree remove --force .claude/worktrees/fc-a2')))).toBe(true)
  })

  test('GitHub MCP merges are gated like gh', async ($, on) => {
    engineOf(on)
    const merge = await $.tool.call({ tool: 'mcp__github__merge_pull_request', owner: 'o', repo: 'r', pullNumber: 1 } as never)
    expect(refused(merge)).toBe(true)
    await say($, 'merge the PR')
    const again = await $.tool.call({ tool: 'mcp__github__merge_pull_request', owner: 'o', repo: 'r', pullNumber: 1 } as never)
    expect(refused(again)).toBe(false)
  })

  test('/git-gate shows the grants and can switch the gate off', async ($, on) => {
    engineOf(on)
    await say($, 'commit changes')
    const status = await run($, 'git-gate')
    expect(status.text).toContain('Allowed now: commit')
    await run($, 'git-gate', 'off')
    expect(refused(await $.tool.call(bash('git push --force')))).toBe(false)
  })
})

describe('review regressions', () => {
  test('a checkout earlier on the line decides the branch', async ($, on) => {
    engineOf(on, { branch: 'claude/billing' })
    await run($, 'kickoff', 'plans/x.md')
    expect(refused(await $.tool.call(bash('git checkout master && git merge --no-ff claude/fc-a1')))).toBe(true)
    expect(refused(await $.tool.call(bash('git switch claude/phase-b && git merge claude/fc-b1')))).toBe(false)
  })

  test('a branch the gate cannot find out counts as protected', async ($, on) => {
    engineOf(on, { isBranchUnknown: true })
    await say($, 'push it')
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
    expect(refused(await $.tool.call(bash('git push origin claude/feature')))).toBe(false)
  })

  test('commands without the word git are still read', async ($, on) => {
    engineOf(on)
    expect(refused(await $.tool.call(bash('g"i"t push origin x')))).toBe(true)
    expect(refused(await $.tool.call(bash('npm test')))).toBe(false)
  })

  test('a message from another session ends the person\'s grants', async ($, on) => {
    engineOf(on)
    await say($, 'commit and push')
    await say($, 'continue with the next task', 'channel')
    expect(refused(await $.tool.call(bash('git push origin claude/feature')))).toBe(true)
  })

  test('a remote merge must land on the branch the person named', async ($, on) => {
    engineOf(on, { prBase: 'master' })
    await say($, 'merge it into schema-v2/main')
    expect(refused(await $.tool.call(bash('gh pr merge 12 --merge')))).toBe(true)
  })

  test('a GitHub write with no branch counts as one to the default branch', async ($, on) => {
    engineOf(on)
    await say($, 'push the fix')
    const write = await $.tool.call({ tool: 'mcp__github__create_or_update_file', owner: 'o', repo: 'r', path: 'a.md', content: 'x', message: 'm' } as never)
    expect(refused(write)).toBe(true)
  })
})

describe('a /kickoff survives a pause, a restart or a resume, but not a /clear', () => {
  const HOUR = 60 * 60_000

  test('"continue" as the first message brings the /kickoff back; pushes still need the user', async ($, on) => {
    engineOf(on)
    const now = 0 // the mock clock starts at 0
    mock.store(on, { 'kickoff:/repo': { at: now - 3 * HOUR } })
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: c5"')))).toBe(false)
    expect(refused(await $.tool.call(bash('git merge --no-ff claude/fc-c5')))).toBe(false)
    expect(refused(await $.tool.call(bash('git push')))).toBe(true)
    expect((await run($, 'git-gate')).text).toContain('/kickoff at')
  })

  test('a new task as the first message ends it, so a later "continue" does not bring it back', async ($, on) => {
    engineOf(on)
    const now = 0 // the mock clock starts at 0
    mock.store(on, { 'kickoff:/repo': { at: now - HOUR } })
    await say($, 'fix the typo in the README')
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "fix: typo"')))).toBe(true)
  })

  test('older than two days is not restored', async ($, on) => {
    engineOf(on)
    const now = 0 // the mock clock starts at 0
    mock.store(on, { 'kickoff:/repo': { at: now - 49 * HOUR } })
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m wip')))).toBe(true)
  })

  test('/kickoff continue grants it again; /git-gate end ends it', async ($, on) => {
    engineOf(on)
    mock.store(on)
    await run($, 'kickoff', 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: d1"')))).toBe(false)
    expect((await run($, 'git-gate', 'end')).text).toContain('ended')
    expect(refused(await $.tool.call(bash('git commit -m "feat: d2"')))).toBe(true)
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: d3"')))).toBe(true)
  })

  test('/clear ends it: a "continue" after it does not bring it back', async ($, on) => {
    engineOf(on)
    mock.store(on)
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await run($, 'kickoff', 'plans/x.md')
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: x"')))).toBe(true)
  })

  test('a resume or a plain exit keeps it for "continue"', async ($, on) => {
    engineOf(on)
    mock.store(on, { 'kickoff:/repo': { at: -HOUR } })
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.end({ reason: 'resume', sessionId: 's1' } as never)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2' } as never)
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: y"')))).toBe(false)
  })

  test('a remembered kickoff is dropped by /clear even before the next message', async ($, on) => {
    engineOf(on)
    mock.store(on, { 'kickoff:/repo': { at: -HOUR } })
    on('session.end', ($, e) => ({ sessionId: e.sessionId }))
    await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
    await say($, 'continue')
    expect(refused(await $.tool.call(bash('git commit -m "feat: z"')))).toBe(true)
  })

})
