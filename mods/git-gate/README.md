# git-gate

Git only when you asked. Commits, pushes, pull requests, merges and destructive git commands
run only when your latest message allowed them. "Your latest message" also covers `/ship`,
`/kickoff`, and the answer you picked in Claude's question dialog. Anything else is refused,
and Claude gets a note telling it to ask you. There is no UI.

Tested with Claude Code 2.1.289.

## How permission works

| You say | Allowed |
|---|---|
| "commit changes" | commit |
| "push it" | commit, push |
| "create a PR to master", "open PR" | commit, push, PR |
| "…create a PR. Don't merge it yet" | commit, push, PR; merge refused even if asked later in the same turn |
| "merge to schema-v2/main" | merge, into the branch you named only |
| "force push", "discard", "delete the branch", "remove worktrees", "stash" | that one destructive action |
| "Continue", "go on", "dalej" | keeps what was already allowed |
| "yes", "ok, go ahead", "tak, dawaj" (the whole message) | also what Claude asked in its closing question ("Shall I push?") |
| `/ship` · `/ship commit` · `/ship push` · `/ship merge` | commit+push+PR · commit · commit+push · all four |
| `/kickoff …` | commits and merges into task branches (never onto a protected branch). Words in its arguments grant nothing more |
| "continue" as your **first** message after a pause, restart or resume | brings back the last `/kickoff` in this repo (remembered for 48 h). Any other first message ends it. `/clear` always ends it: a new job starts with no permissions |
| `/kickoff continue` | the same, at any time, and the skill resumes the run from its worklog |

- Polish works too ("zacommituj i wypchnij, ale nie merguj").
- A "not" before a verb ("don't merge", "skip the merge", "no need to push", "without merging")
  always wins over a grant. "don't forget to push" is a request.
- Nouns are not requests: "why did the push fail?", "push notifications", "the last commit",
  "merge conflict", file names and `code spans` grant nothing.
- Only your own prompts count: typed, Remote Control (phone or web), and SDK. Messages from
  other sessions, task notifications, schedules, channels and plugins never grant anything;
  a new task from another session or a channel also ends what your last message allowed.
- A branch the gate cannot find out (detached HEAD, unreadable repo) counts as protected, and so
  does a GitHub write that names no branch. A PR merge must land on the branch you named.

## What is gated

| Needs | Commands |
|---|---|
| commit | commit, cherry-pick, revert, am, rebase, `reset <ref>` |
| merge | `git merge`/`pull`, `gh pr merge`, `gh api …/merge`, MCP merge/auto-merge; also pushes or merges onto protected branches |
| push | `git push`, MCP push_files/create_or_update_file/create_branch |
| PR | `gh pr create`, MCP create_pull_request |
| force | `--force`, `-f`, `--force-with-lease`, `+ref`, `:branch`, `--delete`, `--mirror`, git aliases it cannot read |
| discard | `reset --hard`, `clean -f`, `checkout -- .`, `restore <path>`, `switch --discard-changes`, filter-branch |
| branch-delete | `branch -D`, `branch -f`, `update-ref -d` |
| worktree-remove | other people's worktrees, or dirty ones. A clean worktree Claude created in this session is free |
| stash | everything except `stash list/show` (the stash is shared across worktrees) |

It reads through `&&`, `||`, `;`, pipes, `if`/`while`/`{ }` blocks, `cd` (also `~`), `git -C`,
subshells, `bash -c`, `eval`, `$(…)`, backticks, redirects, heredocs (their text is not run), a
`git checkout x &&` earlier on the line, and the wrappers `env`, `sudo`, `nice`, `timeout`,
`stdbuf`, `caffeinate`, `xargs` and `command`.

**Extra.** `gh pr create` without `--base` gets the base set for that repo in `prBase`
(none by default; e.g. `acme/web=develop` sends `acme/web` PRs to `develop`).

## Commands
- `/git-gate`: what is allowed right now, the protected branches, the last decisions.
- `/git-gate off` / `on`: escape hatch for this session.
- `/git-gate end`: the /kickoff task is over; drop its permission now and for later sessions.

## Settings (`/config` → git-gate)
- `protectedBranches`: default `main,master,production,prod,beta,release/*`.
- `prBase`: comma-separated `owner/repo=branch` pairs, e.g. `acme/web=develop`. Empty by default.
- `trustedOrigins`: default `composer,bridge,sdk,auto-continuation`.

## Limits (by design)
This is a safety net for an honest-but-eager agent, not a security boundary. It cannot see
inside scripts (`bash deploy.sh`) or aliases defined in your git config. The real protection
for important branches is branch protection on GitHub. If the gate itself fails while checking
a git command, it refuses the command (fail closed). Other Bash commands are never affected.

## Files
- `hooks/shell.ts`: shell reader.
- `hooks/classify.ts`: git/gh/MCP operations.
- `hooks/intent.ts`: grants from words.
- `hooks/policy.ts`: decisions.
- `hooks/register.ts`: wiring.
- `tests/`: 167 tests (`claude plugin test .`).
