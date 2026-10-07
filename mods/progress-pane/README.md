# progress-pane

Mission control for long autonomous tasks: a worklog you can follow while Claude works, made
reliable and glanceable from the terminal, desktop or phone.

Tested with Claude Code 2.1.289.

## Why it can be trusted: three layers
A UI that only shows what the model *says* is only as good as the model's discipline. This mod
keeps three layers and shows you where they disagree.

| Layer | Source | Why it holds |
|---|---|---|
| **Declared**: phases, steps, decisions, blockers, log | `plans/YYYY-MM-DD-<slug>-worklog.md` in format **WL1** (see `docs/worklog-spec.md`), written through the **`worklog` tool** | Typed input, legal transitions only, ≤ 3 steps doing, length limits. **A step can be marked done only when the latest finished gate run (`npm run dod`, pytest…) started after the step did and passed** (a step done straight from todo counts from the last step marked done); `force` needs a reason and is logged as a Ruling. `finish` needs every step settled and every decision answered, or `force` + a reason. Only the lead agent can write. Hand edits are re-parsed, and errors go back to Claude on the same tool result with line numbers |
| **Observed**: gate runs, commits, agents, dev servers, context/cost | The mod's own hooks on Bash results, spawns and turns | The engine's facts; the model is not involved |
| **Reconciled**: drift | D1 commit not linked to a step (docs-only commits, and commits within 15 min of a step marked done, are fine) · D2 worklog stale (20 min, 15+ calls, and no step started in the last hour still doing) · D3 done without a green gate · D4 agent finished but step still doing · D5 too many doing · D6 gate red | Deterministic rules. Shown under NEEDS YOU, and told to Claude at most every 10 minutes per rule, so it corrects itself |

While a worklog is active, a short, static system-prompt section reminds Claude of the
contract. It stays the same text, so it doesn't break the prompt cache. After `/compact`,
`worklog show` re-orients Claude.

## What you see
**Band** (one line above the prompt, only while a worklog is active):
```
! 7/18 ━━━━──────  A3 Seat count follows team membership · 2 agents · gate ✓ 4m · 9e1d0aa 2m · 3h12m    ? 1  ! 1
```
- The first glyph is the run's health: `▶` working, `!` needs you, `✗` gate red, `✓` finished.
- The time at the end is how long the run has been going (from the worklog's `started`). Once
  it is finished or paused it stops at the last update and reads `took 2h05m`.
- **Click the count** (`7/18`) to open the whole plan; **click the step** to open its details;
  **click `? 1` / `! 1`** to open what is waiting on you.
  In the terminal, focus the band with ctrl+x tab, then Enter.
- Decisions (`?`) and blockers/drift (`!`) are pinned at the right.
- As the terminal narrows, segments drop: bar → git → agents → gate. The step title is
  truncated, never dropped.

**Pane** (`/progress`; docked beside the transcript or inline):
```
 ! Add team billing                         3h12m
 claude/team-billing…          ━━━━━──────  7/18
 ! NEEDS YOU ────────────────────────────────
  ? D1 Bill per seat or per workspace?
  ~ 3m  commit 3f2a1bc not linked to a step
 PLAN ─────────────────────────────── ✓A ▶B ○C
  ▶ B UI                                    2/6
   ✓ B1 Hide billing tab                3f2a1bc
   ● B3 Seat limit checks          opus 6m Edit
   ○ B4 Upgrade prompt copy
 SIGNALS ────────────────────────────────────
 gate ✓ 4m · 52s   git 9e1d0aa 2m · 6 today
 ctx 61% · $4.10
 1: [Overview]  2: Plan  3: Log  o: File  x: Close
```
- Finished phases fold into the chip strip.
- Agents fold into their step's row: a step is linked when the agent's description starts with
  the step id. An agent with no step shows as drift.
- From 100 columns inline, the pane uses two columns.
- `2` **Plan**: every phase, scrollable. Press a phase to fold or unfold it (the current one
  starts open); press a step to open its details.
- **Step details**: status and timing, note, commits, gate runs since the step started, its
  agents (model, time, tools), drift, the decisions or blockers that name it, and its log
  lines. `k`/`j` previous/next step, `b` back.
- `3` shows the log (Rulings highlighted). `o` puts `@<worklog>` into your prompt.
- `n` **Needs you**: each question with its context: when it was asked, the step it blocks,
  Claude's *why* and its recommended option. Answer with an option button or in your own words
  (a text field on terminal and desktop; "Reply in chat" on the phone). The answer is
  resolved in the worklog at once and reaches Claude **during the running step**, on its next
  tool result; with no turn running it is sent as a message. Answered items stay listed with
  "Claude has it".
- On desktop and mobile, sections are plain labels (their font is not monospace, so `────`
  rules would wrap).
- It is the same on the phone.

**Text**: `/progress text` prints the overview as Markdown, for cloud sessions and VS Code,
where nothing draws.

## Commands
- `/progress`: open the pane. `/progress plan`: the whole plan. `/progress B6`: that step's details.
- `/progress text`: print the overview.
- `/progress band off|on`: hide or show the band.
- `/progress use plans/x-worklog.md`: follow a specific file.

## The tool (`mcp__progress-pane__worklog`)
Operations: `start`, `step`, `add`, `attention`, `resolve`, `log`, `finish`, `show`. Every
call answers with one line: `OK A3 → done · 8/18 done · next: A4 Billing gate; A5 …`. Calls are
applied one at a time, each to the file as it is on disk. `start` with `replace: true` keeps the
old worklog with `status: paused`. The
`/kickoff` skill uses it. Without this mod, `/kickoff` writes the same WL1 format by hand.

## Notes
- The gate is the worklog's `gate:` (e.g. `npm run dod`), or common test runners when unset.
  It counts only as the program of a command (`cd app && npm run dod`), not as an argument
  (`echo`, `grep`). Piped (`npm run dod | tail`), the exit status is the pipe's, so the output
  is read for failures (`failed`, `FAIL`, `✗`, `error TS…`).
- A gate started in the background has no result to see: `done` then needs the model's
  `gateOk: true` (logged as its claim), and the run is ignored after 30 min.
- Dev servers (Expo, Convex dev, Vite, Next, emulators) started in the background are listed
  until `pgrep` no longer finds them.
- The worklog file is the source of truth. The mod re-reads it when it changes on disk
  (polled every 5 s).
