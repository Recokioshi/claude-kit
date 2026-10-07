/** Mirrors GRANTS in hooks/intent.ts. */
export type Grant = 'commit' | 'merge' | 'push' | 'pr' | 'force' | 'discard' | 'branch-delete' | 'worktree-remove' | 'stash'

/** One judged git operation, newest first in `decisions`. */
export type GateDecision = {
  at: number
  tool: string
  label: string
  allowed: boolean
  need?: Grant
}

/** The grants in force (see hooks/policy.ts GrantState). */
export type GateGrants = {
  prompt: Grant[]
  denies: Grant[]
  sticky: Grant[]
  kickoffAt?: number
  isResumeChecked?: boolean
  mergeTargets: string[]
  isOff: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'git-gate': {
      grants: GateGrants
      ownWorktrees: string[]
      decisions: GateDecision[]
    }
  }
}
