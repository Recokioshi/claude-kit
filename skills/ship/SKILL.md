---
name: ship
description: Use when the user wants finished work delivered — "commit", "push", "create/open a PR", "ship it", "wrap it up in a branch and open a PR to master". Runs the gate, makes clean commits, pushes and opens the pull request against the right base; merges only when asked. Not for reviewing PRs, resolving review comments or CI babysitting.
argument-hint: "[pr | commit | push | merge] [--base <branch>] [--draft]"
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git remote:*), Bash(git worktree list:*), Bash(git worktree remove:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git pull:*), Bash(git switch:*), Bash(git checkout -b:*), Bash(gh pr view:*), Bash(gh pr list:*), Bash(gh pr create:*), Bash(gh pr checks:*), Bash(npm run dod:*), Bash(npm test:*), Bash(.venv/bin/python -m pytest:*), Bash(pytest:*), Bash(lsof:*), Bash(pgrep:*), Bash(cat .claude/ship.json:*), Bash(ls:*)
---

# Ship

Mode: **$0** (empty means `pr`) · arguments: $ARGUMENTS

| Mode | Does |
|---|---|
| `commit` | gate → commits |
| `push` | gate → commits → push |
| `pr` (default) | gate → commits → push → pull request |
| `merge` | all of `pr`, then merge the PR once its checks pass |

**Never** merge unless the mode is `merge`. Never `--force`, `--admin`, or `git stash`. Never commit secrets or `.env*`.

## Where things stand
- Repo: !`git remote get-url origin 2>/dev/null || true`
- Branch: !`git branch --show-current 2>/dev/null || true`
- Changes: !`git status --short 2>/dev/null | head -30 || true`
- Recent commits (match their style): !`git log --oneline -8 2>/dev/null || true`
- Open PR for this branch: !`gh pr view --json number,url,state,baseRefName 2>/dev/null || echo none`
- Repo ship settings: !`cat .claude/ship.json 2>/dev/null || echo none`
- Worktrees: !`git worktree list 2>/dev/null | head -10 || true`

## 1. Preflight
- On `main`, `master`, `production` or `beta`: create a branch first (`claude/<short-topic>`). Never commit onto those.
- Detached HEAD, a rebase or merge in progress, or conflicts: stop and say what you found.
- Nothing to commit and nothing unpushed: say so and stop.

## 2. Gate
The gate is `gate` from `.claude/ship.json`, else the repo's own quality gate: `npm run dod` if `package.json` has it, else `npm test`, else `.venv/bin/python -m pytest -q`. Run it on the code you are about to commit.

- **Red:** stop. Show the failing lines. Fix only if the failure is in your own changes, then run it again.
- Skip the gate only if the user passed `--no-gate`.

## 3. Commits
- Look at every changed and untracked file before staging. Stage by path, not `git add -A`.
- Leave out secrets, `.env*`, large binaries, local tooling folders (`.claude/worktrees/`), build output, and files unrelated to the work. List what you left out.
- Group the work into logical commits in this repo's style (conventional `type(scope): subject` where the log shows it). Use the commit trailer your environment requires.

## 4. Push
`git push -u origin <branch>`. If the remote branch has moved, stop and report. Never force.

## 5. Pull request (mode `pr` or `merge`)
- **Base**, first that applies:
  1. `--base` argument;
  2. `prBase` in `.claude/ship.json`;
  3. the repo's default branch.

  A repo with a non-default PR base or gate says so in `.claude/ship.json`:
  ```json
  {"gate": "npm test", "prBase": "develop"}
  ```
- If a PR for the branch already exists, update it (push) instead of opening another.
- **Title:** conventional, ≤ 70 chars.
- **Body:** the repo's PR template if it has one (`.github/pull_request_template.md` …), else:
  ```markdown
  ## Summary
  <2–3 lines: what and why>
  ## Changes
  - <grouped by area, with paths>
  ## Testing
  - <gate command> ✓ (<counts from its output>)
  - <manual checks done, or "not checked by hand: …">
  ## Notes
  - <follow-ups, env vars, deploy steps for the user> (or none)
  ```
  Link the changelog or worklog when there is one.
- `--draft` opens it as a draft.

## 6. Merge (mode `merge` only)
`gh pr checks <n> --watch`. All green → merge the way the repo merges (it uses merge commits unless its settings say otherwise). Red → stop and report the failing check. Then switch back to the base and pull.

## 7. Clean up what this session started
- Stop dev servers, emulators and watchers you started (`lsof -ti :<port>`, `pgrep -f "<dev server>"`). Leave the user's own running.
- Worktrees: list each with branch, whether it is clean, and whether you created it in this session. Remove only your own clean ones. Ask about the rest. Never remove one with uncommitted work.

## 8. Report
```
Shipped <branch> → <base>: <PR url>
Commits: <n> (<first sha>..<last sha>) · gate ✓ <command> (<counts>)
Left out: <files> (or none) · cleaned: <servers/worktrees> (or nothing to clean)
```

## Gotchas
- Only the user starts this skill (`/ship`). With the git-gate mod loaded, that typed `/ship [mode]` is what authorizes the commit, push and PR, and nothing past the mode: `merge` needs `/ship merge`. A refusal from git-gate means stop and ask, never a workaround.
- `gh pr create` without `--base` targets the default branch. Always pass `--base`.
