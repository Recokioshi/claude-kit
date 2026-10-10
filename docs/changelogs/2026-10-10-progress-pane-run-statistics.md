# progress-pane: main-thread figures and a finished-run summary

**Date:** 2026-10-10
**Status:** Completed (uncommitted, on `progress-pane-notebook`; part of the unreleased 0.3.0)

## Summary
The owner wanted the main thread measured like the subagents, and a summary worth reading after a
long run. The pane header now has a third row under the branch: the model and effort the main
thread last ran with, its tokens, estimated cost and time worked. A finished worklog replaces
NEEDS YOU, PLAN and SIGNALS with a summary card: time worked by main and crew, the plan, crew
size, cost, tokens in/out/cache, requests and tool calls, git figures (commits, merges, branches,
files added/edited/removed, lines +/−), and a lineup of the crew's companions, then the plan as
it ended. The run's totals are kept per worklog in the plugin store, so they survive restarts and
compaction; nothing is written into the worklog file.

## Changes
- Created `mods/progress-pane/hooks/runstats.ts`: a run's totals (main and agents: requests,
  tokens by kind, estimated cost, working time, tool calls; agent count, failures, the
  creature-and-accessory histogram; base sha; git figures), their accumulators, `parseRun` (the
  store's `unknown` narrowed field by field), decision and ruling counts, and parsers for
  `git diff --name-status`, `--shortstat`, `for-each-ref` and counts.
- Created `mods/progress-pane/hooks/summary.tsx`: the finished card (centered and bordered on the
  terminal, labelled rows elsewhere and below 48 columns), the companion lineup (Rasters on the
  terminal, Svgs elsewhere) and the plan recap.
- Modified `mods/progress-pane/hooks/register.tsx`: a `run` atom loaded from the store per worklog
  and written back at each turn's end and at `finish`; main and subagent requests, main turns and
  subagent runs (durations), tool calls and spawns feed it while the worklog is active; the base
  sha is recorded at `start`; git figures are computed at `finish` and once when a finished
  worklog is opened without them.
- Modified `mods/progress-pane/hooks/overview.tsx`: the header's third row (`mainLine`) and
  `headerRows`; `pane.tsx` uses it in the row budget and draws the finished layout.
- Modified `mods/progress-pane/hooks/text.ts`: `/progress text` adds the run's figures.
- Modified `mods/progress-pane/hooks/view-types.ts`, `index.ts`, `types/index.d.ts`: `run` in
  ViewData, the barrel, and the state contract.
- Modified `mods/progress-pane/README.md`: the header row, the finished summary, what the
  figures cover.
- Regenerated `docs/progress-pane-themes/notebook-drawn.html` with the new header row and a
  finished run (terminal and desktop).

## Testing
- `claude plugin test`: 294 pass, 0 fail. New `tests/run.test.tsx`: accumulation by kind and
  cost, the lineup order, decision and ruling counts, `parseRun` on garbage and partial data,
  every git parser on literal outputs; through the engine: the header row from main requests,
  totals reaching the store at a turn's end, a run picked up from the store by a later session,
  the finished card on the terminal (border, git figures, lineup Rasters, plan recap) and on
  desktop (rows, Svgs, no border), nothing added once the worklog is not active, steps of a
  phase keyed D not counted as decisions, open asks kept above the card after a forced finish.
- `tsc` on the whole mod: no errors. `claude plugin validate`: passes.
- Not checked by hand: the live render in the app; the drawn trees were rendered in a browser.

## Next Steps
- The turn that finishes the worklog is not counted (it ends after the worklog stops being active).
- None required. Figures start counting from this version: runs before it show the plan and git
  figures only.
