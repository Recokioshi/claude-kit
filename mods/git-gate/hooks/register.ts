/**
 * git-gate: git only when the user asked for it.
 *
 * prompt.submit / command.run / AskUserQuestion answers: read what the person
 * allowed (commit, push, PR, merge, …) into the session's grants.
 * tool.call (Bash, GitHub MCP): classify the git work a call does and refuse
 * what no grant covers, with a message telling Claude to ask instead.
 * skill.prompt (ship): a /ship Claude started on its own is told to stay local.
 *
 * No UI: refusals reach Claude as the tool's error; `/git-gate` prints the
 * grants in force as text.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { classifyBash, classifyMcp, worktreeAdds } from './classify'
import type { GitOp } from './classify'
import { readIntent, proposalsIn, grantsFromAnswer, shipGrants, shipModeOf, withImplied, isTrusted } from './intent'
import type { Grant } from './intent'
import { decide, denyText, EMPTY_GRANTS } from './policy'
import type { GrantState, OpContext } from './policy'
import type { GateDecision } from '../types'

const PLUGIN = 'git-gate'
const grants = atom({ plugin: 'git-gate', key: 'grants' } as const, EMPTY_GRANTS)
const ownWorktrees = atom({ plugin: 'git-gate', key: 'ownWorktrees' } as const, [] as string[])
const decisions = atom({ plugin: 'git-gate', key: 'decisions' } as const, [] as GateDecision[])

const DEFAULT_PROTECTED = ['main', 'master', 'production', 'prod', 'beta', 'release/*']
const DEFAULT_TRUSTED = ['composer', 'bridge', 'sdk', 'auto-continuation']
const DEFAULT_PR_BASE: string[] = []

const GITHUB_MCP = /^mcp__.*__(create_pull_request|create_pull_request_with_copilot|merge_pull_request|enable_pr_auto_merge|push_files|create_or_update_file|delete_file|update_pull_request_branch|create_branch)$/

type Options = {
  protectedBranches: readonly string[]
  trustedOrigins: readonly string[]
  prBase: readonly string[]
}

function optionsOf(raw: Readonly<Record<string, unknown>>): Options {
  const list = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length > 0
      ? v.map(String)
      : typeof v === 'string' && v.trim() !== ''
        ? v.split(',').map(s => s.trim()).filter(s => s !== '')
        : fallback
  return {
    protectedBranches: list(raw.protectedBranches, DEFAULT_PROTECTED),
    trustedOrigins: list(raw.trustedOrigins, DEFAULT_TRUSTED),
    prBase: list(raw.prBase, DEFAULT_PR_BASE),
  }
}

/** `owner/repo` from a remote URL (https or ssh). */
export function slugOf(remote: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

function absolute(cwd: string, dir: string | null | undefined, home?: string): string {
  if (!dir) {
    return cwd
  }
  const expanded = home === undefined ? dir : dir.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home)
  return expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`.replace(/\/\.\//g, '/')
}

async function homeOf($: EngineInterface): Promise<string | undefined> {
  try {
    return (await $.env.get('HOME')) ?? undefined
  } catch {
    return undefined
  }
}

async function gitOut($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(['git', ...args], { cwd, timeoutMs: 8000 })
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    return null
  }
}

async function contextOf($: EngineInterface, op: GitOp, sessionCwd: string, owned: readonly string[]): Promise<OpContext> {
  const home = await homeOf($)
  const cwd = absolute(sessionCwd, op.dir, home)
  if (op.kind === 'worktree-remove') {
    const path = op.path === undefined ? undefined : absolute(cwd, op.path, home)
    if (path === undefined) {
      return {}
    }
    const isOwn = owned.includes(path) || /\/\.claude\/worktrees\/agent-[^/]+$/.test(path)
    if (!isOwn) {
      return { isOwnCleanWorktree: false }
    }
    // A status that cannot be read counts as dirty.
    const status = await gitOut($, path, ['status', '--porcelain'])
    return { isOwnCleanWorktree: status === '' }
  }
  if (op.kind === 'merge' && op.target === 'remote') {
    return { prBase: op.pr === undefined ? undefined : await prBaseOf($, op.pr, op.repo, cwd) }
  }
  if ((op.kind === 'merge' || op.kind === 'push' || op.kind === 'commit') && op.target === undefined) {
    // `git checkout master && git merge x`: the branch the line moved to wins.
    if (op.lineBranch) {
      return { branch: op.lineBranch }
    }
    const branch = await gitOut($, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
    return { branch: branch === null || branch === 'HEAD' ? undefined : branch }
  }
  return {}
}

async function prBaseOf($: EngineInterface, pr: string, repo: string | undefined, cwd: string): Promise<string | undefined> {
  try {
    const run = await $.process.run(['gh', 'pr', 'view', pr, ...(repo ? ['-R', repo] : []), '--json', 'baseRefName', '-q', '.baseRefName'], { cwd, timeoutMs: 10000 })
    const base = run.stdout.trim()
    return run.exitCode === 0 && base !== '' ? base : undefined
  } catch {
    return undefined
  }
}

async function record($: EngineInterface, entry: GateDecision): Promise<void> {
  await update($, decisions, list => [entry, ...list].slice(0, 20))
}

async function lastAssistantText($: EngineInterface): Promise<string> {
  try {
    const messages = await $.session.messages()
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m?.role === 'assistant' && m.text.trim() !== '') {
        return m.text
      }
    }
  } catch {
    // no transcript to read: a "yes" then grants nothing extra
  }
  return ''
}

/** A /kickoff is remembered per repo for this long, for a "continue" after a restart. */
const KICKOFF_TTL_MS = 48 * 60 * 60_000
const kickoffKeyOf = (root: string) => `kickoff:${root}`

async function repoRootOf($: EngineInterface): Promise<string> {
  try {
    return (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
    return $.session.cwd()
  }
}

/**
 * Folds one human prompt into the grants. Returns when a remembered /kickoff
 * was restored (a "continue" after a restart, a resume or a /clear).
 */
async function applyPrompt($: EngineInterface, text: string): Promise<{ restoredAt?: number }> {
  const intent = readIntent(text)
  let proposed: { grants: Grant[]; mergeTargets: string[] } = { grants: [], mergeTargets: [] }
  if (intent.isAffirmation) {
    proposed = proposalsIn(await lastAssistantText($))
  }
  const now = await $.clock.now()
  const before = await read($, grants)

  // The session's grants live in memory and are gone after a restart, a resume
  // or a /clear. The /kickoff is also kept per repo: the first prompt after
  // that brings it back when it is a "continue", and ends it when it is
  // anything else (a new task).
  let restoredAt: number | undefined
  if (intent.isKickoff) {
    await storeSet($, kickoffKeyOf(await repoRootOf($)), { at: now })
  } else if (!before.isResumeChecked && before.sticky.length === 0) {
    const key = kickoffKeyOf(await repoRootOf($))
    const saved = await storeGet($, key)
    const at = typeof saved === 'object' && saved !== null ? Number((saved as { at?: unknown }).at) : NaN
    if (Number.isFinite(at) && now - at < KICKOFF_TTL_MS && intent.isContinuation) {
      restoredAt = at
    } else if (Number.isFinite(at)) {
      await storeDelete($, key)
    }
  }

  await update($, grants, state => {
    const keep = intent.isContinuation || intent.isAffirmation
    // A kickoff's grants are the task's standing permission (sticky), never "asked right now".
    const fresh = intent.isKickoff ? [] : intent.grants
    const prompt = withImplied([...(keep ? state.prompt : []), ...fresh, ...proposed.grants])
    const denies = keep ? [...new Set([...state.denies, ...intent.denies])].filter(d => !intent.grants.includes(d) && !proposed.grants.includes(d)) : intent.denies
    const sticky = intent.isKickoff || restoredAt !== undefined ? withImplied([...state.sticky, 'commit']) : state.sticky
    return {
      ...state,
      prompt: prompt.filter(g => !denies.includes(g)),
      denies,
      sticky,
      kickoffAt: intent.isKickoff ? now : (restoredAt ?? state.kickoffAt),
      isResumeChecked: true,
      mergeTargets: [...new Set([...(keep ? state.mergeTargets : []), ...intent.mergeTargets, ...proposed.mergeTargets])],
    }
  })
  return { restoredAt }
}

async function storeGet($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

async function storeSet($: EngineInterface, key: string, value: unknown): Promise<void> {
  try {
    await $.store.set(key, value)
  } catch {
    // not remembered: a restart then needs /kickoff continue
  }
}

async function storeDelete($: EngineInterface, key: string): Promise<void> {
  try {
    await $.store.delete(key)
  } catch {
    // nothing to forget
  }
}

const clockText = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

/** Origins that start new work for someone else; they never grant and they end the person's grants. */
const CLEARS_GRANTS = new Set(['peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'scheduled-trigger'])

function prBaseFor(slug: string | null, prBase: readonly string[]): string | undefined {
  if (slug === null) {
    return undefined
  }
  for (const entry of prBase) {
    const [repo, base] = entry.split('=')
    if (repo?.trim().toLowerCase() === slug.toLowerCase() && base) {
      return base.trim()
    }
  }
  return undefined
}

/** Judges a list of operations; the first refusal wins. */
async function judge($: EngineInterface, ops: GitOp[], options: Options, tool: string): Promise<{ deny: string } | null> {
  const state = await read($, grants)
  const owned = await read($, ownWorktrees)
  const cwd = await $.session.cwd()
  for (const op of ops) {
    const ctx = await contextOf($, op, cwd, owned)
    const verdict = decide(op, state, ctx, options.protectedBranches)
    await record($, { at: await $.clock.now(), tool, label: op.label, allowed: verdict.allow, need: verdict.allow ? undefined : verdict.need })
    if (!verdict.allow) {
      return { deny: denyText(op, verdict) }
    }
  }
  return null
}

export const register: Register = (on, rawOptions) => {
  const options = optionsOf(rawOptions)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-gate',
      description: 'Show which git actions you have allowed in this session (git-gate)',
      argumentHint: '[off|on|end]',
    })
    return next(e)
  })

  // /clear is a deliberate new start: the /kickoff permission ends with the old job.
  // A pause, a restart or a resume keeps it for "continue".
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await storeDelete($, kickoffKeyOf(await repoRootOf($)))
      await update($, grants, s => ({ ...s, sticky: [], kickoffAt: undefined }))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (isTrusted(e.origin, options.trustedOrigins)) {
      const { restoredAt } = await applyPrompt($, e.text)
      if (restoredAt !== undefined) {
        $.ui.toast(`git-gate: /kickoff from ${clockText(restoredAt)} restored (commits and phase merges).`)
        const note = `git-gate: the user's /kickoff from ${clockText(restoredAt)} is restored after the interruption: commits and merges into task branches are allowed again. Pushes, PRs and anything onto a protected branch still need the user. Re-read the worklog and continue where the run stopped.`
        return next({ ...e, context: [...(e.context ?? []), note] })
      }
    } else if (CLEARS_GRANTS.has(e.origin?.kind ?? '')) {
      // Another session or a channel starts new work: what the person allowed
      // for their own last request does not carry over to it.
      await update($, grants, s => ({ ...s, prompt: [], mergeTargets: [] }))
    }
    return next(e)
  })

  on('command.run', { command: ['ship', 'kickoff'] }, async ($, e, next) => {
    if (isTrusted(e.origin, options.trustedOrigins)) {
      const text = `/${e.command} ${e.args ?? ''}`
      await applyPrompt($, text)
      if (e.command === 'ship') {
        const mode = shipModeOf(e.args ?? '')
        await update($, grants, s => ({ ...s, prompt: withImplied([...s.prompt, ...shipGrants(mode)]), denies: [] }))
      }
    }
    return next(e)
  })

  on('skill.prompt', { skill: 'ship' }, async ($, e, next) => {
    const result = await next(e)
    const state = await read($, grants)
    if (state.isOff || state.prompt.includes('push') || state.sticky.includes('push')) {
      return result
    }
    return {
      text: `${result.text}\n\n> git-gate: the user has not asked for a push or a pull request in this turn. Do only the local steps (gate, commits), then ask the user whether to push and open the PR.`,
    }
  })

  on('command.run', { command: 'git-gate' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'end') {
      // The /kickoff task is over: drop its standing permission here and for later sessions.
      await storeDelete($, kickoffKeyOf(await repoRootOf($)))
      await update($, grants, s => ({ ...s, sticky: [], kickoffAt: undefined }))
      return { text: 'git-gate: the /kickoff permission is ended for this repo. Commits need your go-ahead again.' }
    }
    if (arg === 'off' || arg === 'on') {
      await update($, grants, s => ({ ...s, isOff: arg === 'off' }))
      return { text: arg === 'off' ? 'git-gate is off for this session. `/git-gate on` turns it back on.' : 'git-gate is on.' }
    }
    const state = await read($, grants)
    const recent = await read($, decisions)
    const lines = [
      `git-gate ${state.isOff ? 'is OFF' : 'is on'}.`,
      `Allowed now: ${state.prompt.length ? state.prompt.join(', ') : 'nothing'}${state.sticky.length ? ` · for this task (/kickoff${state.kickoffAt ? ` at ${clockText(state.kickoffAt)}` : ''}): ${state.sticky.join(', ')} · \`/git-gate end\` ends it` : ''}`,
      state.denies.length ? `Refused in your last message: ${state.denies.join(', ')}` : '',
      state.mergeTargets.length ? `Merge targets you named: ${state.mergeTargets.join(', ')}` : '',
      `Protected branches: ${options.protectedBranches.join(', ')}`,
      recent.length ? 'Recent:' : '',
      ...recent.slice(0, 5).map(d => `  ${d.allowed ? 'ran    ' : 'refused'} ${d.label}${d.need ? ` (needs ${d.need})` : ''}`),
    ]
    return { text: lines.filter(l => l !== '').join('\n') }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const result = await next(e)
    try {
      const answers = (result.result as { answers?: Record<string, unknown> } | undefined)?.answers ?? {}
      for (const [question, answer] of Object.entries(answers)) {
        const got = grantsFromAnswer(question, String(answer))
        if (got.grants.length > 0 || got.denies.length > 0) {
          await update($, grants, s => ({
            ...s,
            prompt: withImplied([...s.prompt, ...got.grants]).filter(g => !got.denies.includes(g)),
            denies: [...new Set([...s.denies.filter(d => !got.grants.includes(d)), ...got.denies])],
          }))
        }
      }
    } catch {
      // an answer the gate cannot read grants nothing
    }
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = String(e.command ?? '')
    const ops = classifyBash(command)
    if (ops.length > 0) {
      const refused = await judge($, ops, options, 'Bash')
      if (refused !== null) {
        return refused
      }
    }

    let rewritten = command
    const pr = ops.find(op => op.kind === 'pr' && op.missingBase)
    if (pr !== undefined && ops.filter(op => op.kind === 'pr').length === 1 && !/--repo\b|-R\b/.test(command)) {
      const remote = await gitOut($, absolute(await $.session.cwd(), pr.dir, await homeOf($)), ['remote', 'get-url', 'origin'])
      const base = prBaseFor(remote === null ? null : slugOf(remote), options.prBase)
      if (base !== undefined) {
        rewritten = command.replace(/\bgh\s+pr\s+create\b/, `gh pr create --base ${base}`)
      }
    }

    const ran = await next(rewritten === command ? e : { ...e, command: rewritten })

    if (ran.deny === undefined && ran.isError !== true) {
      const added = worktreeAdds(command)
      if (added.length > 0) {
        const cwd = await $.session.cwd()
        const home = await homeOf($)
        await update($, ownWorktrees, list => [...new Set([...list, ...added.map(a => absolute(absolute(cwd, a.dir, home), a.path, home))])])
      }
    }
    if (rewritten !== command && ran.deny === undefined) {
      const note = `git-gate added \`${rewritten.match(/--base \S+/)?.[0] ?? '--base'}\` from the repo's PR base setting.`
      return { ...ran, context: [...(ran.context ?? []), note] }
    }
    return ran
  }).catch(($, e, next) => {
    // Quotes and backslashes removed, so `g"i"t push` still reads as git.
    const command = String(e.command ?? '').replace(/['"\\]/g, '')
    return /\b(git|gh)\b/.test(command)
      ? { deny: 'git-gate could not check this git command, so it did not run. Ask the user before trying again.' }
      : next(e)
  })

  on('tool.call', { tool: GITHUB_MCP }, async ($, e, next) => {
    const ops = classifyMcp(e.tool, e as unknown as Record<string, unknown>)
    if (ops.length > 0) {
      const refused = await judge($, ops, options, e.tool)
      if (refused !== null) {
        return refused
      }
    }
    return next(e)
  }).catch(() => ({ deny: 'git-gate could not check this GitHub action, so it did not run. Ask the user before trying again.' }))
}


