/**
 * Decides whether a git operation may run under the grants in force. Pure.
 */
import type { GitOp } from './classify'
import type { Grant } from './intent'

export type GrantState = {
  /** From the person's latest substantive prompt (plus "yes" to Claude's proposal). */
  prompt: Grant[]
  /** Denied in the latest prompt ("don't merge it yet"); beats every grant. */
  denies: Grant[]
  /** From /kickoff: kept until /clear, and restored after a restart by "continue". */
  sticky: Grant[]
  /** When the /kickoff behind `sticky` was typed (ms), for /git-gate. */
  kickoffAt?: number
  /** The first prompt of this session's state has been read for a remembered /kickoff. */
  isResumeChecked?: boolean
  /** Branches the person named as merge targets. */
  mergeTargets: string[]
  /** The gate is off for this session (`/git-gate off`). */
  isOff: boolean
}

export const EMPTY_GRANTS: GrantState = { prompt: [], denies: [], sticky: [], mergeTargets: [], isOff: false }

/** What the policy knows about where an operation lands. */
export type OpContext = {
  /** The branch the operation lands on (resolved by the caller when the command names none). */
  branch?: string
  /** For worktree-remove: Claude created it in this session and it is clean. */
  isOwnCleanWorktree?: boolean
  /** For a remote merge: the PR's base branch, when it could be looked up. */
  prBase?: string
}

export type Verdict = { allow: true } | { allow: false; need: Grant; why: string }

/** `release/*` style patterns. */
export function isProtected(branch: string | undefined, patterns: readonly string[]): boolean {
  if (branch === undefined) {
    return false
  }
  return patterns.some(p => {
    const re = new RegExp(`^${p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`)
    return re.test(branch)
  })
}

function has(state: GrantState, grant: Grant): boolean {
  if (state.denies.includes(grant)) {
    return false
  }
  return state.prompt.includes(grant) || state.sticky.includes(grant)
}

/** The verdict for one operation. */
export function decide(op: GitOp, state: GrantState, ctx: OpContext, protectedBranches: readonly string[]): Verdict {
  if (state.isOff) {
    return { allow: true }
  }

  const deny = (need: Grant, why: string): Verdict => ({ allow: false, need, why })
  const branch = op.target === 'remote' ? undefined : (op.target ?? ctx.branch)
  // A branch the gate could not find out, or a GitHub write to the default
  // branch, is treated as protected: unknown never means safe.
  const onProtected = branch === undefined || branch === '<default>' || isProtected(branch, protectedBranches)

  switch (op.kind) {
    case 'commit': {
      // A task's standing permission (/kickoff) never covers committing onto a
      // protected branch; the person saying "commit" right now does.
      const isAskedNow = state.prompt.includes('commit') && !state.denies.includes('commit')
      if (onProtected && !isAskedNow) {
        return deny('commit', `it writes commits straight onto the protected branch ${branch}`)
      }
      return has(state, 'commit') ? { allow: true } : deny('commit', 'it creates commits')
    }
    case 'merge': {
      if (op.target === 'remote') {
        if (!has(state, 'merge')) {
          return deny('merge', 'it merges a pull request')
        }
        // "merge it into schema-v2/main": the PR's base must be the branch named.
        if (state.mergeTargets.length > 0 && (ctx.prBase === undefined || !state.mergeTargets.includes(ctx.prBase))) {
          return deny('merge', `it merges a pull request into ${ctx.prBase ?? 'a base the gate could not look up'}, not ${state.mergeTargets.join(' or ')}`)
        }
        return { allow: true }
      }
      if (onProtected) {
        const named = branch !== undefined && state.mergeTargets.includes(branch)
        return has(state, 'merge') && (named || state.mergeTargets.length === 0)
          ? { allow: true }
          : deny('merge', `it merges into the protected branch ${branch}`)
      }
      return has(state, 'merge') || has(state, 'commit') ? { allow: true } : deny('merge', `it merges into ${branch}`)
    }
    case 'push':
      if (onProtected) {
        return has(state, 'merge') && has(state, 'push') ? { allow: true } : deny('merge', `it pushes to the protected branch ${branch}`)
      }
      return has(state, 'push') ? { allow: true } : deny('push', `it pushes ${branch} to the remote`)
    case 'pr':
      return has(state, 'pr') ? { allow: true } : deny('pr', 'it opens a pull request')
    case 'force':
      return has(state, 'force') ? { allow: true } : deny('force', 'it force-pushes or deletes a remote branch')
    case 'discard':
      return has(state, 'discard') ? { allow: true } : deny('discard', 'it throws away uncommitted work or history')
    case 'branch-delete':
      return has(state, 'branch-delete') ? { allow: true } : deny('branch-delete', 'it deletes or force-moves a branch')
    case 'worktree-remove':
      return ctx.isOwnCleanWorktree || has(state, 'worktree-remove')
        ? { allow: true }
        : deny('worktree-remove', 'it removes a worktree Claude did not create in this session, or one with uncommitted work')
    case 'stash':
      return has(state, 'stash') ? { allow: true } : deny('stash', 'the stash is shared by every worktree and holds your own entries')
    case 'opaque':
      return has(state, 'force') ? { allow: true } : deny('force', 'it hides a git command behind an alias the gate cannot read')
  }
}

const ASK: Record<Grant, string> = {
  commit: 'Commit these changes?',
  merge: 'Merge it?',
  push: 'Push the branch?',
  pr: 'Push and open a pull request?',
  force: 'Force-push (this rewrites the remote branch)?',
  discard: 'Discard those changes? They cannot be recovered.',
  'branch-delete': 'Delete that branch?',
  'worktree-remove': 'Remove that worktree?',
  stash: 'Use git stash?',
}

/** The text Claude receives when an operation is refused. */
export function denyText(op: GitOp, verdict: Extract<Verdict, { allow: false }>): string {
  return [
    `git-gate: \`${op.label}\` was not run because ${verdict.why}, and the user's latest message did not ask for that.`,
    `Ask the user first, for example: "${ASK[verdict.need]}". Then stop and wait for the answer.`,
    'Do not retry, split, rephrase or work around this command.',
  ].join(' ')
}
