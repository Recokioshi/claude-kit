# Worklog format WL1

The contract shared by the `/kickoff` skill (writes it), the `progress-pane` mod (reads,
validates and safely writes it) and `/report` + `handoff` (read it).

It is Markdown, so it can be read on GitHub, a phone and a diff. It is strict and
line-oriented, so a small parser reads it deterministically and can say exactly which line
is wrong. It uses a familiar worklog shape: `plans/…-worklog.md`, Rules, phases with checkboxes,
Notes, and a newest-first Log.

## Location

`plans/YYYY-MM-DD-<slug>-worklog.md` in the repository the task runs in, committed with the
work. Only one worklog per repo has `status: active`. That is the one the pane shows.

## Example

```markdown
---
worklog: 1
title: Add team billing
plan: plans/2026-09-27-team-billing-plan.md
branch: claude/team-billing
gate: npm test
status: active
started: 2026-09-28T14:11Z
updated: 2026-09-28T16:40Z
---

Goal: everything in the plan except the admin dashboard, tested and reviewed.

## Rules
- Phase branch `claude/tb-<id>` cut from the working branch; merged back --no-ff after review + green gate.
- No pushes, no PRs, no deploys or production migrations. Never `git stash`.

## Attention
- [?] D1 Bill per seat or per team? — options: per seat / per team
  why: B2 shows the price on 3 screens; per seat also needs a seat count from the API
  blocks: B2
  recommend: per seat
- [!] A4 Payment provider sandbox key missing in .env.local

## Phase A · API
- [x] A1 Add the billing_accounts table · 3f2a1bc
- [x] A2 Move existing teams to the free plan · 9e1d0aa — 2 review rounds
- [~] A3 Invoice endpoint keeps trial teams working @impl-a3
- [ ] A4 Plan limits behind BILLING_ENFORCED
- [-] A5 Legacy cleanup — not needed: no prod data

## Phase B · UI
- [ ] B1 Hide the upgrade button for non-admins
- [ ] B2 Billing settings page shows the current plan

## Notes
- Deploy follow-up for the user: set BILLING_ENFORCED on prod after review.

## Log
- 16:40 A2 done: backfill runs in one transaction; gate ✓
- 16:05 Ruling: kept old plan rows — reversible — cost if wrong: one cleanup migration
- 15:02 started phase A on claude/tb-a
```

## Grammar

| Block | Pattern | Rules |
|---|---|---|
| Front matter | `key: value` between `---` lines | Required: `worklog: 1`, `title`, `status` (`active` \| `paused` \| `done`). Optional: `plan`, `branch`, `gate`, `started`, `updated` (ISO-8601 UTC, minutes) |
| Goal | one line `Goal: …` after the front matter | optional, ≤ 160 chars |
| Rules | `## Rules` + `- …` bullets | optional, ≤ 8 bullets |
| Attention | `## Attention` + `- [?] D<k> <question>[ — options: a / b]` or `- [!] <step-id> <blocker>`, each optionally followed by indented `  why: <context, ≤400>`, `  blocks: <step-id>` (decisions), `  recommend: <one of the options>` (decisions). The id is not repeated in the question | optional |
| Phase | `## Phase <key> · <title>` | key: 1–4 letters or digits (`1`, `A`, `DOC`); unique |
| Step | `- [<s>] <id> <title>[ · <sha>][ @<owner>][ — <note>]` | id: `[A-Za-z]{0,4}\d+(\.\d+)?[a-z]?` (`A8`, `2.3`, `DOC2`, `a1b`), unique in the file |
| Notes | `## Notes` + `- …` bullets | optional, ≤ 10 bullets |
| Log | `## Log` + `- HH:MM <text>` or `- YYYY-MM-DD HH:MM <text>` | newest first, ≤ 30 lines (the tool drops the oldest) |

Step status `<s>`:

| Mark | Meaning | Pane glyph |
|---|---|---|
| `[ ]` | todo | ○ |
| `[~]` | doing (at most 3 at once) | ● |
| `[x]` | done | ✓ |
| `[!]` | blocked (the reason goes in Attention) | ! |
| `[-]` | skipped (reason in the note) | – |

Lines that match no pattern inside a known block are **errors** (reported with the line
number). Text outside blocks (other than Goal) is an error as well, so drift can't creep in
quietly.

## Limits (anti-bloat)
Title ≤ 80 chars; step title ≤ 90; note ≤ 120; log line ≤ 140; ≤ 12 phases; ≤ 30 steps per
phase.

## Transitions
- `todo → doing → done | blocked | skipped`; `blocked → doing | skipped`; `done → doing` only
  with a reason (logged).
- `done` needs the gate to have passed since the step went to `doing` (when a gate is set and
  the mod observes it), unless `force` + a reason is given; that is logged as a Ruling.
- Every change rewrites `updated`.

## Who writes
- **The lead agent only.** Subagents report back. They never edit the worklog, especially not
  from a worktree.
- With the `progress-pane` mod, the lead writes through the `worklog` tool. It validates,
  writes and returns the next step.
- Without the mod, the lead edits by hand following this grammar. A hand edit is re-parsed
  after the tool call, and errors come back to Claude on the same result.
- Agent descriptions start with the step id (`A3 invoice endpoint`), so the pane can link agents
  to steps.
