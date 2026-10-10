# progress-pane

Mission control for long autonomous tasks: a worklog you can follow while Claude works, made
reliable and glanceable from the terminal, desktop or phone.

Tested with Claude Code 2.1.296.

## Why it can be trusted: three layers
A UI that only shows what the model *says* is only as good as the model's discipline. This mod
keeps three layers and shows you where they disagree.

| Layer | Source | Why it holds |
|---|---|---|
| **Declared**: phases, steps, decisions, blockers, log | `plans/YYYY-MM-DD-<slug>-worklog.md` in format **WL1** (see `docs/worklog-spec.md`), written through the **`worklog` tool** | Typed input, legal transitions only, ≤ 3 steps doing, length limits. **A step can be marked done only when the latest finished gate run (`npm run dod`, pytest…) started after the step did and passed** (a step done straight from todo counts from the last step marked done); `force` needs a reason and is logged as a Ruling. `finish` needs every step settled and every decision answered, or `force` + a reason. Only the lead agent can write. Hand edits are re-parsed, and errors go back to Claude on the same tool result with line numbers |
| **Observed**: gate runs, commits, agents, dev servers, context/cost | The mod's own hooks on Bash results, spawns and turns | The engine's facts; the model is not involved |
| **Reconciled**: drift | D1 commit not linked to a step (docs-only commits, and commits within 15 min of a step marked done, are fine) · D2 worklog stale (20 min, 15+ calls, and no step started in the last hour still doing) · D3 done without a green gate · D4 agent finished but step still doing · D5 too many doing · D6 gate red | Deterministic rules. Shown as `~` (NOTICED; a red gate as the health `✗`), and told to Claude at most every 10 minutes per rule, so it corrects itself |

While a worklog is active, a short, static system-prompt section reminds Claude of the
contract. It stays the same text, so it doesn't break the prompt cache. After `/compact`,
`worklog show` re-orients Claude.

## What you see
**Band** (one line above the prompt, only while a worklog is active):
```
! 7/18 ■■■■□□□□□□  ✎ B3 Seat limit checks · 2 agents · gate ✓ 4m · 9e1d0aa 2m · 3h12m       ? 1  ~ 1
```
- The first glyph is the run's health: `✎` working, `!` needs you (yellow for a question, red for a
  blocker), `✗` gate red, `✓` finished. `✎` also marks the current step.
- The time at the end is how long the run has been going (from the worklog's `started`). Once
  it is finished or paused it stops at the last update and reads `took 2h05m`.
- **Click the count** (`7/18`) to open the whole plan; **click the step** to open its details;
  **click `2 agents`** for the Agents tab; **click `? 1` / `! 1` / `~ 1`** to open what is
  waiting on you and what was noticed.
  In the terminal, focus the band with ctrl+x tab, then Enter.
- Decisions (`?`), blockers (`!`) and drift the mod noticed (`~`) are pinned at the right. Drift
  alone never shows `!`: nothing is waiting on you until Claude asks.
- As the terminal narrows, segments drop: bar → git → agents → gate. The step title is
  truncated, never dropped.

**Pane** (`/progress`; docked beside the transcript or inline), in the Notebook look: a margin
for status glyphs, a ruled line, the body, and notes that end on the same column; one ruled
blank row between sections; the line the pen is on carries a highlighter.
```
 ! │ Add team billing                                             3h12m
   │ claude/team-billing                       ■■■■■■■□□□□□□□□□□□  7/18
   │ Opus 5.5 · xhigh · 1.2M tokens · ≈$3.80 · 1h48m working
   │
   │ NEEDS YOU ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ? │ D1 Bill per seat or per workspace?                       blocks B4
 ~ │ commit 3f2a1bc not linked to a step                             3m
   │
   │ PLAN ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ✓A ▸B □C
 ▸ │ B UI                                                           2/6
 ✓ │ B1 Hide billing tab                                        3f2a1bc
 ✓ │ B2 Plan picker                                             9e1d0aa
 ✎ │ B3 Seat limit checks                                opus 6m · Edit
 □ │ B4 Upgrade prompt copy                                        ? D1
 □ │ B5 Invoice history list                                  sonnet 1m
 □ │ B6 Empty states
   │
   │ SIGNALS ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
   │ gate    ✓ passed 4m ago · took 52s
   │ git     claude/team-billing · 9e1d0aa 2m ago · 6 today
   │ ctx     61% · session $4.10 · agents ≈$1.32
   │
   │ 1: Overview 2: Plan 3: Log 4: Agents n: Needs 2 o: File x: Close
```
- The meter is the checklist: one box per step (up to 24; 20 boxes above that).
- The footer's tabs keep two cells apart when they fit; on a narrow pane the gaps close to one
  and `Needs you` reads `Needs`.
- Finished phases fold into the chip strip.
- With nothing asked, the top section reads `~ NOTICED` instead of `! NEEDS YOU`.
- Agents fold into their step's row: a step is linked when the agent's description starts with
  the step id. An agent with no step shows as drift.
- Under the branch, the main thread's own figures, worded like a subagent's: the model and effort
  it last ran with, tokens, estimated cost, and the time it spent working (the sum of its turns;
  the elapsed time at the top right is wall time).
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

**A finished run** (the worklog's `status: done`; reopen an old one with `/progress use <path>`)
replaces NEEDS YOU, PLAN and SIGNALS with a summary card, centered and bordered on the terminal,
then the plan as it ended:
```
      ╭──────────────────────────────────────────────────────────╮
      │                  ✓ Finished · took 3h12m                 │
      │                                                          │
      │ worked   5h42m · main 2h05m + crew 3h37m                  │
      │ plan     18 steps done · 1 skipped · 3 phases             │
      │          2 decisions asked · 4 rulings                    │
      │ crew     7 subagents · 140 tool calls                     │
      │ cost     ≈$11.60 at API prices                            │
      │          main ≈$7.08 · crew ≈$4.50                        │
      │ tokens   in 492k · out 276k                               │
      │          cache read 7.0M · written 900k                   │
      │ requests 144 · 140 tool calls on main                     │
      │ git      14 commits · 3 merges · 2 branches               │
      │ files    +2 added · 1 edited · −1 removed                 │
      │ lines    +2,340 −610                                      │
      │                                                          │
      │    [frog]   [owl]   [fox]   [songbird]                    │
      │      ×3      ×2      ×1       ×1                          │
      ╰──────────────────────────────────────────────────────────╯
```
- **Worked** adds up working time: the main thread's turns plus every subagent's runs, so it can
  be longer than the wall time when agents worked side by side.
- **The lineup** is the crew as companions, one per creature and accessory, with how many ran.
- **Git** counts commits and merges since the run's base (HEAD when the worklog started),
  branches with a commit since it started, and the net diff (files and lines) at the end.
- **The figures cover what this mod watched**: requests, turns and tool calls while the worklog
  was active, in sessions where the mod was loaded. They are kept per worklog in the plugin
  store, so a long run survives restarts and compaction; two windows on one worklog write the
  same entry, and the last write wins. Costs are estimates at API list prices, never the
  engine's session figure. Nothing is written into the worklog file. The turn that finishes the
  worklog is not counted: by its end the worklog is no longer active.
- A run finished with questions or blockers still open (a forced finish) keeps them above the card.

**Agents** (`4` in the pane, `/progress agents`, or click `2 agents` on the band): every subagent
of the session, running first, each with its own companion.
```
 AGENTS ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  2 · 1 running
 ≈$1.32 at API prices · 412k tokens · 14m

 ✎ │ [owl]  B3 Seat limit checks                           6m
   │        Opus 5.5 · xhigh
   │        ■■■□□ 3/5 wiring the guard
   │        120k tokens · ≈$0.42 · 18 tools
   │        Edit seat-limits.ts
```
- **The companion** is a small pixel creature: the model family picks the creature, the effort
  its accessory, and the agent's state its pose (working, resting while it waits on a long call,
  done, failed). On the terminal it is drawn in true color with half-block cells and moves two
  frames a second while the Agents tab is open; elsewhere it is an SVG.
- **Progress** is the agent's own: a subagent reports its plan and each finished step with the
  worklog tool's op `progress` (the `/kickoff` brief asks for it). An agent that reports
  nothing shows its context fill in pencil instead.
- **Figures** per agent: model and effort as sent on its last request, tokens, context fill,
  estimated cost, tool calls, how long it ran, and `round 2` when an agent with the same
  description ran before (a retry, a second review). The summary line adds them up.
- **Press an agent** for its page: who it is, its progress and figures, and its log (each tool
  call it made and each note it reported, newest first). `k`/`j` previous/next, `b` back.
- **Cost** is an estimate at Anthropic's API list prices from the token counts the engine
  reports (`hooks/cost.ts`, from the model table of 2026-10-06), not a bill: a subscription pays
  nothing per token. SIGNALS shows the engine's own session figure and the agents' estimate as
  two numbers, never added, since the session figure may already include the agents.

**VS Code**: the band above the prompt is drawn only in the terminal and the desktop app; in VS Code
open the pane with `/progress`.

**Text**: `/progress text` prints the overview as Markdown, for cloud sessions and anywhere
nothing draws.

## Commands
- `/progress`: open the pane. `/progress plan`: the whole plan. `/progress agents`: the crew. `/progress B6`: that step's details.
- `/progress text`: print the overview.
- `/progress band off|on`: hide or show the band.
- `/progress use plans/x-worklog.md`: follow a specific file.

## The tool (`mcp__progress-pane__worklog`)
Operations: `start`, `step`, `add`, `attention`, `resolve`, `log`, `finish`, `show`, and
`progress` for subagents (`done`, `total`, `note`: their own steps, shown in the Agents tab and
never written to the worklog; the lead is refused it and uses `step`). Every
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
- Notebook's ink blue and highlighter follow the `theme` setting (`/config`): a light theme gets
  the light pair, any other theme the dark pair. With no theme row, the ink is a mid-tone that
  reads on both and the doing row is marked by bold and the pen alone.
- The pen glyph `✎` (U+270E) needs a font with Dingbats. If yours shows a box, set the mod's
  `Pen glyph` option to `●` in `/config` (or `pluginConfigs.progress-pane.options.pen`).
- The branch in SIGNALS is the checkout's, read from git (`git branch --show-current`), and read
  again after a checkout or switch.
