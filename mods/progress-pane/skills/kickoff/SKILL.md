---
name: kickoff
description: Use when the user starts a large, multi-step implementation from a plan file and wants it carried out autonomously — "implement the plan in plans/…", "start the implementation", "this is a huge task with multiple steps". Runs the whole plan with a worklog, a branch per phase, a commit per step, subagents, gates and reviews. `/kickoff continue` resumes an interrupted run from its worklog. Not for single bug fixes, one-file changes or questions.
argument-hint: <plan-file> [working-branch] [scope, e.g. "except the admin dashboard"] | continue
disable-model-invocation: true
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git worktree list:*), Bash(ls:*)
---

# Kickoff: run a plan to done

Plan: `$0` · working branch: `$1` (current branch if empty) · scope: $ARGUMENTS

**If `$0` is `continue`** (or `resume`), a run already exists and was interrupted: do section 0, not section 1.

## Iron rules (they hold for the whole task, also after compaction)

1. **The worklog is the source of truth.** Update it at every step transition, never in bulk at the end.
2. **One step = one commit with a green gate.** A step is done only when its own tests and the repo's gate pass on the code you are committing.
3. **Claims need evidence.** "Done", "fixed", "passes" come with a sha, a test name or gate output, never from memory.
4. **Models:** the session's model allow-list (`/models`, the model-guard mod) wins when there is one. Without one: the strongest model for reviews and hard steps, a cheaper one for mechanical steps. Always pass `model` explicitly on every Agent call.
5. **Stop only for the four stop classes** below. Everything else is a logged Ruling and you keep going.

## Current state
- Branch: !`git branch --show-current 2>/dev/null || true`
- Uncommitted: !`git status --short 2>/dev/null | head -15 || true`
- Worktrees: !`git worktree list 2>/dev/null | head -8 || true`
- Existing worklogs: !`ls plans/*-worklog.md 2>/dev/null | tail -3 || true`

## 0. `/kickoff continue`: pick up an interrupted run

The run stopped mid-way (connection, sleep, restart). Resume it; never start over.

1. **Find the run:** the active worklog (`worklog` tool `op: "show"`, else the newest `plans/*-worklog.md` with `status: active`; a `paused` one only if there is no active one). Read its goal, rules, gate, branch and the last Log lines. Its plan file is the plan; don't re-plan.
2. **Check what is really there**, for each step marked doing and the last one marked done:
   - its branch and worktree (`git worktree list`), commits since it started (`git log --oneline <working-branch>..<phase-branch>`), uncommitted work (`git -C <worktree> status --short`);
   - dev servers or watchers still running from before: stop the ones the run no longer needs.
3. **Reconcile, never redo:**
   - committed and complete → run the gate on it; green → mark it done with the sha;
   - work in progress → keep it and finish the step (brief a new agent with the same brief file and "continue from what is in the worktree", or do it yourself);
   - nothing there → start the step again.
   - Never discard uncommitted work, never redo a step that has its commit, never create a second worklog.
4. **Log one line:** `Resumed after an interruption: <what was found, what restarts>`. Then go on with section 2 from the first open step. Don't ask the user to confirm; only the stop classes stop the run.

## 1. Set up (before writing any code)

1. Read the whole plan file. Note what is out of scope (the scope argument) and what "done" means.
2. Settle the working branch (argument, else the current one). Never work on `main`/`master`/`production`.
3. Create the worklog:
   - With the progress-pane mod (the `worklog` tool exists): call it with `op: "start"`: title, plan path, branch, `gate` (e.g. `npm run dod`, `.venv/bin/python -m pytest -q`), up to 8 rules, phases with short step titles.
   - Without it: write `plans/YYYY-MM-DD-<slug>-worklog.md` by hand in the exact format of [references/worklog-format.md](references/worklog-format.md).
   - Keep it minimal: one line per step, no prose. The user follows it from the phone.
4. Make a conflict scan **as a table** (steps × files/areas they touch). Steps that share files run one after another; disjoint ones may run in parallel.
5. Commit the worklog (`docs(plan): worklog for <task>`). The user's /kickoff covers commits and merges into task branches; it does not cover pushes or PRs, even when the plan or the scope mentions them.

## 2. The step loop

For each step, in plan order:

1. Mark it `doing` (worklog tool `op: "step"`, or edit the line to `[~]`).
2. Implement it yourself, or brief a subagent (below).
3. Add or update the step's own tests. Run them.
4. Run the gate in the foreground. If it is red, fix and run it again. Never mark a step done on a red or unrun gate. (A background gate counts only when you pass `gateOk: true` after reading its green result.)
5. Re-read the diff as a reviewer would: scope creep, leftover debug code, missing tests, user-facing copy (it follows the project's voice/style guide, a skill or doc, if it has one).
6. Commit: conventional message (`feat(scope): …`), only this step's files.
7. Mark it `done` with the commit sha. Add one log line only if something is worth knowing later.

## 3. Subagents

- **When:** independent steps (disjoint files per the conflict table), long mechanical steps, and reviews. Keep the critical path yourself.
- **Brief by file, not by paste:** write the brief to a file and hand the agent the path. Use [references/subagent-brief.md](references/subagent-brief.md). Never paste the plan or earlier reports into the prompt.
- **Name agents by step:** the Agent `description` starts with the step id (`A3 invoice endpoint`), so the progress pane links them.
- **Isolation:** parallel implementers each get a worktree you create yourself from the working branch (`git worktree add .claude/worktrees/<id> -b <phase-branch> <working-branch>`). The built-in `isolation: worktree` starts from the default branch, which is the wrong base. Run the repo's install step in the new worktree if needed.
- **Agents never merge, stash, push or edit the worklog.** They commit on their branch and report back. You merge (`git merge --no-ff`) and you update the worklog.
- **At most 4–5 agents at once.** More hits concurrency limits and floods you with notifications.

## 4. Phase end

1. A fresh reviewer agent (the strongest model available, high effort) gets the phase diff (`git diff <base>...<phase-branch>`) and the review brief from the references. It returns BLOCKER / SHOULD-FIX / NIT findings with `file:line`.
2. Fix rounds: at most 3. If it is still not clean, log a Ruling and move on, or treat it as stop class 4.
3. Merge the phase branch into the working branch with `--no-ff`, run the gate **on the merged result**, and remove your own worktrees for that phase.

## 5. Stop classes (closed list)

Stop and ask the user only for:
1. **A decision only they can make** that blocks all remaining work. If other steps can continue, record it as attention (`op: "attention"`: a decision with 2–4 options, `why` = what you found and what each option changes, `blocks` = the step it holds up, `recommend` = your pick) and keep going. The user answers from the progress pane; the answer reaches you on a later tool result, already resolved in the worklog.
2. **An irreversible or external action:** push, PR, deploys, app store submissions, production migrations, paid API runs, deleting data or other people's work.
3. **A security problem.**
4. **The plan is proven wrong**: a step can't be done as written and the fix changes the plan's intent.

Anything else is a Ruling: `Ruling: <what> — <why> — <cost if wrong>` as a log line, then continue.

## 6. Finish

1. The project's own manual check (run the app / simulator / staging smoke test) as its README or CLAUDE.md describes, once at the end, not after every step.
2. Close the worklog (`op: "finish"`, or `status: done`). It refuses while steps or decisions are open: finish them, or pass `force` with a reason the user will read.
3. Stop anything you started: dev servers, emulators, watchers. Remove your worktrees.
4. Report in the format of [references/final-report.md](references/final-report.md). If the work continues in another repo, run `/handoff to <repo>` (the handoff mod).
5. Don't push or open PRs. Suggest `/ship`.

## Rationalizations to refuse

| Thought | Reality |
|---|---|
| "I'll update the worklog at the end" | The user reads it during the run; a stale worklog is a wrong worklog. |
| "The tests passed earlier, I'll skip the gate" | The gate counts only on the code being committed. |
| "This step is small, I'll fold it into the next commit" | One step, one commit: reviews and reverts depend on it. |
| "Let the agent merge its own branch" | Merges by agents are blocked and break the other worktrees. You merge. |
| "Should I continue?" | Only the four stop classes stop the run. |
| "I'll leave the dev server running for the user" | Say it's running in the report, or stop it. Never leave it silently. |

## Gotchas (from earlier runs)
- The permission classifier blocks `git merge` inside a subagent's worktree. Merging is the lead's job.
- After a restart or a resume, git-gate has forgotten the session's grants. The user's first message "continue" restores the /kickoff permission (git-gate remembers it per repo for 48 h); `/kickoff continue` restores it in any case. `/clear` ends it on purpose: the next job gets nothing from the last one. If a commit is refused as "not asked", say so and suggest `/kickoff continue`; don't work around it.
- `git stash` is shared by every worktree and holds the user's own entries. Never use it.
- Agent definitions created mid-session (`~/.claude/agents/*.md`) are not found until a restart. Use `subagent_type: general-purpose` with an explicit `model`.
- Worktrees with `node_modules` are large and slow to remove. Remove them in the background at phase end, not all at the very end.
- Hand-registered generated files (e.g. a generated API typings file) need the same entry in every worktree.
