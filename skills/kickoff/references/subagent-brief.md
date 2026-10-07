# Subagent briefs

Read this when you are about to dispatch an implementer or a reviewer. Write the brief to a
file (in the session scratchpad, or `.claude/briefs/<step>.md`) and pass the agent its path.

## Implementer brief (one step)

```markdown
# <step id> <step title>

## Fit
One or two lines: what this step is for, and where it sits in the plan (phase, what comes before and after).

## Read first
- <plan file> §<section> (only the part for this step)
- <files the step changes, and the ones it depends on>

## Interfaces you must keep
- <function signatures, schema fields, API shapes other steps rely on>

## Decided already (don't reopen)
- <ambiguities you resolved, with the choice>

## Work
- Branch: <phase branch> in worktree <path> (already created; `npm ci` done)
- Gate: `<gate command>` must be green before you commit
- Tests: add/extend <test files> so the step is covered
- User-facing text follows the project's voice/style guide <skill or doc> (if any)

## Never
- merge, rebase onto, or push any branch · git stash · edit the worklog · touch files outside <area>
- deploys, production migrations / any paid or external action

## Report (≤ 30 lines, as your final message)
- commits: <sha> <subject> (one per line)
- tests added/changed, gate result (last lines of its output)
- anything skipped, and why · concerns · env vars or follow-ups for the user
```

Spawn: `Agent({ description: "<step id> <few words>", subagent_type: "general-purpose", model: "<model per the Models rule>", prompt: "Read <brief path> and follow it." })`.

## Reviewer brief (one phase)

```markdown
# Review: phase <key> · <title>

Diff: `git diff $(git merge-base <working-branch> <phase-branch>)...<phase-branch>`
Plan: <plan file> §<section>

Check, in this order:
1. Spec: does the diff do what the phase's steps say, completely? List missing items.
2. Correctness: bugs, edge cases, error paths, data migrations, auth checks.
3. Tests: does each behaviour change have a test that would fail without it?
4. Conventions: the repo's CLAUDE.md rules (data access layers, validation, i18n/voice, idempotency).

Read only. Report ≤ 30 lines:
- BLOCKER file:line — what and why
- SHOULD-FIX file:line — …
- NIT file:line — …
- plan coverage: complete | missing <items>
```

Spawn the reviewer fresh (no shared history) with the strongest model available, and say "high effort" in the brief.
