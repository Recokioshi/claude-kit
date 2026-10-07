/**
 * Which git operations a tool call performs, read from a Bash command line or
 * a GitHub MCP tool's arguments. Pure: no `$`.
 */
import { joinDir, readShell } from './shell'
import type { Invocation } from './shell'

/**
 * What an operation needs from the user, cheapest first.
 *
 * - commit: creates or rewrites local commits (commit, cherry-pick, revert, rebase, reset to a ref)
 * - merge: merges into a branch (local `git merge`, or a PR merge on the host)
 * - push: sends commits to a remote (git push, MCP pushes)
 * - pr: opens a pull request
 * - force: force-push, or deleting a remote branch
 * - discard: throws away uncommitted work or local history (reset --hard, clean -f, checkout -- .)
 * - branch-delete: deletes or force-moves a local branch
 * - worktree-remove: removes a worktree
 * - stash: touches the shared stash
 * - opaque: hides a git command (an alias defined with -c, a filter tool)
 */
export type OpKind =
  | 'commit'
  | 'merge'
  | 'push'
  | 'pr'
  | 'force'
  | 'discard'
  | 'branch-delete'
  | 'worktree-remove'
  | 'stash'
  | 'opaque'

export type GitOp = {
  kind: OpKind
  /** Short human label: `git push`, `gh pr merge`. */
  label: string
  /** The branch the operation lands on, when the command names it. */
  target?: string
  /** For `merge`/`push` without a named target: the folder whose current branch it is. */
  dir?: string | null
  /** The branch an earlier `git checkout/switch` on the same line moved to (beats the folder's HEAD). */
  lineBranch?: string | null
  /** For a remote merge: the PR number, to look up its base. */
  pr?: string
  /** For a remote merge: `owner/repo` when the call names it. */
  repo?: string
  /** For pr: the base the PR is opened against, when given. */
  base?: string
  /** True when `gh pr create` names no `--base`. */
  missingBase?: boolean
  /** For worktree-remove: the path. */
  path?: string
  /** For worktree-remove: --force given. */
  isForced?: boolean
}

/** `--del` → `--delete` when git would accept the abbreviation (a unique prefix of a known long option). */
export function expandLong(opt: string, known: readonly string[]): string {
  if (!opt.startsWith('--') || opt.length < 4) return opt
  const [name, value] = opt.includes('=') ? [opt.slice(0, opt.indexOf('=')), opt.slice(opt.indexOf('='))] : [opt, '']
  if (known.includes(name)) return opt
  const hits = known.filter(k => k.startsWith(name))
  return hits.length === 1 ? `${hits[0]}${value}` : opt
}

const PUSH_LONG = ['--force', '--force-with-lease', '--force-if-includes', '--delete', '--prune', '--all', '--mirror', '--tags', '--set-upstream', '--dry-run', '--push-option', '--repo', '--receive-pack', '--exec', '--no-verify', '--verbose', '--quiet', '--atomic', '--follow-tags', '--signed', '--porcelain', '--ipv4', '--ipv6', '--recurse-submodules', '--thin', '--no-thin']
const RESET_LONG = ['--hard', '--soft', '--mixed', '--merge', '--keep', '--quiet', '--patch', '--recurse-submodules']
const CLEAN_LONG = ['--force', '--dry-run', '--quiet', '--exclude', '--interactive']
const PUSH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

/** Git's own options that take a value before the subcommand. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])

/** Reads every git/gh operation out of a Bash command. */
export function classifyBash(command: string): GitOp[] {
  const reading = readShell(command)
  const ops: GitOp[] = []

  for (const inv of reading.invocations) {
    const found = inv.program === 'git' ? classifyGit(inv) : inv.program === 'gh' ? classifyGh(inv) : []
    ops.push(...found.map(op => (inv.branch ? { ...op, lineBranch: inv.branch } : op)))
  }

  for (const what of reading.opaque) {
    ops.push({ kind: 'opaque', label: what })
  }

  return ops
}

function classifyGit(inv: Invocation): GitOp[] {
  const args = inv.args
  let dir = inv.dir
  let i = 0

  while (i < args.length && (args[i] ?? '').startsWith('-')) {
    const opt = args[i] ?? ''
    const [name, inlineValue] = opt.includes('=') ? [opt.slice(0, opt.indexOf('=')), opt.slice(opt.indexOf('=') + 1)] : [opt, undefined]
    if (GIT_VALUE_OPTIONS.has(name)) {
      const value = inlineValue ?? args[i + 1] ?? ''
      if (name === '-C') {
        dir = joinDir(dir, value)
      }
      if (name === '-c' && /^alias\./i.test(value)) {
        return [{ kind: 'opaque', label: `git -c ${value.split('=')[0] ?? 'alias'}` }]
      }
      i += inlineValue === undefined ? 2 : 1
    } else {
      i += 1
    }
  }

  const sub = args[i]
  const known = sub === 'push' ? PUSH_LONG : sub === 'reset' ? RESET_LONG : sub === 'clean' ? CLEAN_LONG : []
  const rest = args.slice(i + 1).map(a => expandLong(a, known))
  const flags = rest.filter(a => a.startsWith('-'))
  const positional = rest.filter(a => !a.startsWith('-'))
  const has = (...names: string[]) => rest.some(a => names.includes(a))

  switch (sub) {
    case undefined:
      return []
    case 'commit':
    case 'cherry-pick':
    case 'revert':
    case 'am': {
      if (has('--abort', '--quit', '--skip') || (sub !== 'commit' && has('--no-commit', '-n'))) {
        return []
      }
      return [{ kind: 'commit', label: `git ${sub}` }]
    }
    case 'merge': {
      if (has('--abort', '--quit')) {
        return []
      }
      if (has('--continue')) {
        return [{ kind: 'commit', label: 'git merge --continue' }]
      }
      return [{ kind: 'merge', label: `git merge ${positional.join(' ')}`.trim(), dir }]
    }
    case 'pull': {
      // A pull merges or rebases the remote branch into the current one.
      return [{ kind: 'merge', label: 'git pull', dir }]
    }
    case 'rebase': {
      if (has('--abort', '--quit', '--skip', '--show-current-patch', '--edit-todo')) {
        return []
      }
      return [{ kind: 'commit', label: 'git rebase', dir }]
    }
    case 'reset': {
      if (has('--hard', '--merge', '--keep')) {
        return [{ kind: 'discard', label: `git reset ${flags.join(' ')}`.trim() }]
      }
      // `git reset HEAD~1` rewrites local history; `git reset file` only unstages.
      const ref = positional[0]
      if (ref !== undefined && /^(HEAD[~^]|[0-9a-f]{7,40}$|origin\/)/.test(ref)) {
        return [{ kind: 'commit', label: `git reset ${ref}` }]
      }
      return []
    }
    case 'clean': {
      const forced = flags.some(f => f === '--force' || (/^-[^-]/.test(f) && f.includes('f')))
      const dryRun = flags.some(f => f === '--dry-run' || (/^-[^-]/.test(f) && f.includes('n')))
      return forced && !dryRun ? [{ kind: 'discard', label: 'git clean -f' }] : []
    }
    case 'checkout':
    case 'restore': {
      const dashDash = rest.indexOf('--')
      const paths = dashDash === -1 ? (positional.includes('.') ? ['.'] : []) : rest.slice(dashDash + 1)
      const stagedOnly = sub === 'restore' && has('--staged', '-S') && !has('--worktree', '-W')
      if (sub === 'restore' && !stagedOnly && positional.length > 0) {
        return [{ kind: 'discard', label: `git restore ${positional.join(' ')}` }]
      }
      if (sub === 'checkout' && has('-B')) {
        return [{ kind: 'branch-delete', label: `git checkout -B ${positional[0] ?? ''}`.trim() }]
      }
      const fileLike = dashDash === -1 ? positional.filter(a => /\.[A-Za-z0-9]{1,6}$/.test(a) && !/^(origin|upstream)\//.test(a)) : []
      if (sub === 'checkout' && paths.length === 0 && fileLike.length > 0) {
        return [{ kind: 'discard', label: `git checkout ${fileLike.join(' ')}` }]
      }
      if (sub === 'checkout' && paths.length > 0) {
        return [{ kind: 'discard', label: `git checkout -- ${paths.join(' ')}` }]
      }
      if (sub === 'checkout' && has('-f', '--force')) {
        return [{ kind: 'discard', label: 'git checkout --force' }]
      }
      return []
    }
    case 'switch': {
      if (has('-C', '--force-create')) return [{ kind: 'branch-delete', label: `git switch -C ${positional[0] ?? ''}`.trim() }]
      return has('--discard-changes', '-f', '--force') ? [{ kind: 'discard', label: 'git switch --discard-changes' }] : []
    }
    case 'branch': {
      const bundled = flags.filter(f => /^-[a-zA-Z]+$/.test(f)).join('')
      const deletes = flags.some(f => f === '-D' || (f === '--delete' && has('--force', '-f'))) || /D/.test(bundled) || (/d/.test(bundled) && /f/.test(bundled))
      const moves = flags.some(f => f === '-M' || f === '-C' || (f === '-f' || f === '--force'))
      return deletes || moves
        ? [{ kind: 'branch-delete', label: `git branch ${flags.join(' ')} ${positional.join(' ')}`.trim() }]
        : []
    }
    case 'push': {
      // Positional words, without the values of options that take one.
      const words: string[] = []
      for (let k = 0; k < rest.length; k += 1) {
        const a = rest[k] ?? ''
        if (PUSH_VALUE.has(a)) {
          k += 1
          continue
        }
        if (!a.startsWith('-')) words.push(a)
      }
      const refspecs = words.slice(1)
      const shortFlags = flags.filter(f => /^-[a-zA-Z]+$/.test(f)).join('')
      const isForce = flags.some(f => f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes' || f === '--mirror' || f === '--prune') || /f/.test(shortFlags)
        || refspecs.some(r => r.startsWith('+'))
      const isDelete = flags.some(f => f === '--delete') || /d/.test(shortFlags) || refspecs.some(r => r.startsWith(':'))
      const isEverything = flags.some(f => f === '--all' || f === '--mirror') || refspecs.some(r => r.includes('*'))
      const label = `git push${flags.length ? ` ${flags.join(' ')}` : ''}${words.length ? ` ${words.join(' ')}` : ''}`
      if (isForce || isDelete) {
        return [{ kind: 'force', label, target: refspecs[0]?.replace(/^\+/, '').split(':').pop()?.replace(/^refs\/heads\//, ''), dir }]
      }
      if (isEverything) {
        // Every branch, protected ones included.
        return [{ kind: 'push', label, target: '*', dir }]
      }
      if (refspecs.length === 0) {
        return [{ kind: 'push', label, dir }]
      }
      return refspecs.map(r => {
        const target = r.split(':').pop()?.replace(/^refs\/heads\//, '')
        return { kind: 'push' as const, label, target: target === 'HEAD' || target === '' ? undefined : target, dir }
      })
    }
    case 'worktree': {
      if (positional[0] === 'remove') {
        return [{ kind: 'worktree-remove', label: 'git worktree remove', path: positional[1], isForced: has('--force', '-f') }]
      }
      return []
    }
    case 'stash': {
      const action = positional[0] ?? 'push'
      return ['list', 'show'].includes(action) ? [] : [{ kind: 'stash', label: `git stash ${action}` }]
    }
    case 'filter-branch':
    case 'filter-repo':
    case 'replace':
      return [{ kind: 'discard', label: `git ${sub}` }]
    case 'update-ref': {
      if (has('-d')) return [{ kind: 'branch-delete', label: 'git update-ref -d' }]
      const ref = positional[0] ?? ''
      // Moving a branch ref by hand rewrites that branch's history.
      return /^refs\/heads\//.test(ref) ? [{ kind: 'force', label: `git update-ref ${ref}`, target: ref.replace(/^refs\/heads\//, '') }] : [{ kind: 'commit', label: 'git update-ref' }]
    }
    default:
      return []
  }
}

function optionValue(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? ''
    for (const name of names) {
      if (a === name) {
        return args[i + 1]
      }
      if (a.startsWith(`${name}=`)) {
        return a.slice(name.length + 1)
      }
    }
  }
  return undefined
}

function classifyGh(inv: Invocation): GitOp[] {
  const [group, action] = inv.args
  const rest = inv.args.slice(2)

  if (group === 'pr' && action === 'create') {
    const base = optionValue(rest, '--base', '-B')
    return [{ kind: 'pr', label: 'gh pr create', base, missingBase: base === undefined }]
  }
  if (group === 'pr' && action === 'merge') {
    const pr = rest.find(a => !a.startsWith('-') && /^\d+$|\/pull\/\d+/.test(a))
    return [{ kind: 'merge', label: `gh pr merge ${rest.filter(a => !a.startsWith('-')).join(' ')}`.trim(), target: 'remote', pr: pr?.match(/(\d+)$/)?.[1], repo: optionValue(rest, '--repo', '-R') }]
  }
  if (group === 'repo' && action === 'sync' && rest.some(a => a === '--force')) {
    return [{ kind: 'force', label: 'gh repo sync --force' }]
  }
  if (group === 'api') {
    const joined = inv.args.join(' ')
    const method = (optionValue(inv.args, '-X', '--method') ?? (/(^|\s)-X(\w+)/.exec(joined)?.[2] ?? 'GET')).toUpperCase()
    if (/\/pulls\/\d+\/merge\b/.test(joined) || /mergePullRequest|enablePullRequestAutoMerge/.test(joined) || (/\/merges\b/.test(joined) && method === 'POST')) {
      return [{ kind: 'merge', label: 'gh api (merge)', target: 'remote' }]
    }
    if (/\/git\/refs\//.test(joined) && method === 'DELETE') {
      return [{ kind: 'force', label: 'gh api (delete ref)' }]
    }
    if (/\/git\/refs\//.test(joined) && (method === 'PATCH' || method === 'POST')) {
      return [{ kind: 'force', label: 'gh api (move ref)' }]
    }
    if (/\/contents\//.test(joined) && (method === 'PUT' || method === 'DELETE')) {
      return [{ kind: 'push', label: 'gh api (commit a file)', target: '<default>' }]
    }
  }
  if (group === 'repo' && action === 'delete') {
    return [{ kind: 'discard', label: 'gh repo delete' }]
  }
  return []
}

/** GitHub MCP tools that change the remote, by the tool's own name (after `mcp__<server>__`). */
export function classifyMcp(tool: string, input: Record<string, unknown>): GitOp[] {
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(tool)
  const name = m?.[1] ?? ''
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)

  switch (name) {
    case 'create_pull_request':
    case 'create_pull_request_with_copilot':
      return [{ kind: 'pr', label: 'create pull request (MCP)', base: str('base'), missingBase: str('base') === undefined }]
    case 'merge_pull_request':
    case 'enable_pr_auto_merge': {
      const n = input.pullNumber ?? input.pull_number
      return [{ kind: 'merge', label: `${name.replace(/_/g, ' ')} (MCP)`, target: 'remote', pr: n === undefined ? undefined : String(n), repo: str('owner') && str('repo') ? `${str('owner')}/${str('repo')}` : undefined }]
    }
    case 'push_files':
    case 'create_or_update_file':
    case 'delete_file':
      // No branch means the repository's default branch.
      return [{ kind: 'push', label: `${name.replace(/_/g, ' ')} (MCP)`, target: str('branch') ?? '<default>' }]
    case 'update_pull_request_branch':
      return [{ kind: 'push', label: `${name.replace(/_/g, ' ')} (MCP)`, target: str('branch') }]
    case 'create_branch':
      return [{ kind: 'push', label: 'create branch (MCP)', target: str('branch') }]
    default:
      return []
  }
}

/** The paths a command adds worktrees at (`git worktree add <path>`), as written. */
export function worktreeAdds(command: string): { path: string; dir: string | null }[] {
  const found: { path: string; dir: string | null }[] = []
  for (const inv of readShell(command).invocations) {
    if (inv.program !== 'git') {
      continue
    }
    const args = inv.args
    let dir = inv.dir
    let i = 0
    while (i < args.length && (args[i] ?? '').startsWith('-')) {
      if (args[i] === '-C') {
        dir = joinDir(dir, args[i + 1])
        i += 2
      } else if (args[i] === '-c') {
        i += 2
      } else {
        i += 1
      }
    }
    if (args[i] !== 'worktree' || args[i + 1] !== 'add') {
      continue
    }
    const rest = args.slice(i + 2)
    for (let k = 0; k < rest.length; k += 1) {
      const a = rest[k] ?? ''
      if (a === '-b' || a === '-B' || a === '--reason') {
        k += 1
        continue
      }
      if (a.startsWith('-')) {
        continue
      }
      found.push({ path: a, dir })
      break
    }
  }
  return found
}
