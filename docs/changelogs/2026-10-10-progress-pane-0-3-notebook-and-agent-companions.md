# progress-pane 0.3: the Notebook look, and an Agents tab with companions

**Date:** 2026-10-10
**Status:** Completed (uncommitted on `master`; not yet installed: the desktop app runs the
cached 0.2.1 until `./install.sh` copies 0.3.0)

## Summary
The owner found the band and pane dull and badly spaced. Of ten designed themes
(`docs/progress-pane-themes/index.html`) they picked Notebook, now drawn by the mod: a margin for
status glyphs, a ruled line, the body, notes that end on one column, one ruled blank row between
sections, ink blue for structure and one highlighter stroke on the line the pen is on. It also
ports the useful parts of another kit's savvy-progress mod: a detailed list of subagents with
model, effort, tokens, context, estimated cost, time and round, plus each agent's own progress and
log. Every subagent gets a pixel companion: the model family picks the creature (fox, owl,
songbird, frog, ink blot), the effort its accessory (buck teeth, pencil, mortarboard, monocle,
both). No `docs/systemdocumentation.md` in this repo; the mod's README carries the documentation.

## Changes
- Created `mods/progress-pane/hooks/frame.tsx`, `band.tsx`, `overview.tsx`, `pages.tsx`,
  `pane.tsx`, `text.ts`: the Notebook drawing, split out of `view.tsx` (now a barrel). Terminal
  rows go through a 5-cell frame (` g │ `); desktop, VS Code and mobile use fixed-width margin and
  label Boxes instead of ruled lines. The pane meter is one box per step. The footer's gaps close
  and "Needs you" shortens when seven tabs do not fit.
- Created `mods/progress-pane/hooks/view-types.ts`: the drawing contract (ViewData with `tones`,
  PaneView with the `agents`/`agent` tabs, actions) and `tonesOf` (ink and highlighter from the
  `theme` setting; a mid-tone and no highlighter when it is unknown).
- Created `mods/progress-pane/hooks/crew.ts`: agent rows built on spawn and updated per model
  request (`withUsage`), tool call (`withTool`), progress report (`withProgress`) and end; rounds,
  caps, totals, roster order and the companion's pose.
- Created `mods/progress-pane/hooks/cost.ts`: API list prices per model from the claude-api
  reference (model table cached 2026-10-06), cost per request, context windows, formatting.
- Created `mods/progress-pane/hooks/companions.ts`: the five creatures, six accessories and four
  poses as 12×10 pixel art; Raster cells with half blocks (two pixels per cell, true color) and an
  animated SVG with reduced-motion support.
- Created `mods/progress-pane/hooks/agents.tsx`: the Agents tab (summary line, one entry per agent
  with its companion and five lines: title, model and effort, progress, figures, last move) and
  one agent's page (details, then its log).
- Modified `mods/progress-pane/hooks/register.tsx`: `turn.step` records each subagent request's
  model, effort, tokens and cost; `tool.call` adds each subagent tool call to its log; the
  worklog tool answers op `progress` for subagents (facts only, never the file; the lead is
  refused); `turn.complete` ends rows, with the turn's usage when no request was seen; the branch
  from `git branch --show-current`; theme colors and the `pen` option; a 500 ms timer that blits
  the working companions only while the terminal shows the Agents tab; `/progress agents`;
  prev/next on an agent page walks the roster.
- Modified `mods/progress-pane/hooks/ops.ts`: op `progress` (`done`, `total`, `note`) in the
  schema and the tool description.
- Modified `mods/progress-pane/hooks/observe.ts`: the richer `AgentRow`, `branch`, and the
  `since` / `lasted` phrasings ("just now", "took under 1m").
- Modified `mods/progress-pane/types/index.d.ts`: the state contract for the new agent fields,
  branch and tabs.
- Modified `mods/progress-pane/.claude-plugin/plugin.json`: 0.3.0, description, `pen` option.
- Modified `mods/progress-pane/README.md`: the Notebook band and pane, the Agents tab, the op,
  theme colors, the pen option, the branch; tested with Claude Code 2.1.296.
- Modified `skills/kickoff/references/subagent-brief.md`: implementer briefs ask the subagent to
  report its own progress with op `progress`.
- Modified `.claude-plugin/marketplace.json`, `README.md`, `install.sh`: version and descriptions.
- Modified `docs/api-notes.md`: engine facts verified while building (one hooks module, half-block
  Raster and blit, the theme row, effort and usage per request, state across reloads, test facts).
- Created `docs/progress-pane-themes/companions/` (the companion sheet and its build script) and
  `docs/progress-pane-themes/notebook-drawn.html` (the trees the mod draws, captured from its
  test harness and rendered: terminal and desktop, five agents).

## Testing
- `claude plugin test`: 231 pass, 0 fail (logic, register, crew and companions suites). New
  tests cover the band at 100/80/60 columns, the Overview row by row against the gallery mock at
  74 columns, the highlighter and its fallback, the per-step meter, blank-row rhythm, desktop
  layout, prices and cost, effort levels, rounds and caps, progress clamping, poses, totals,
  theme tones, a request's figures reaching the Agents tab, the progress op for subagent and
  lead, Raster on the terminal with the timer blitting, Svg with alt on desktop, the agent page,
  an agent ending done or failed, a row left by 0.2 read safely, a resumed agent running again,
  context windows, the branch, and the companion art (dimensions, distinct
  silhouettes and accessories, a Raster round trip, SVG size and structure).
- `tsc` on the whole mod: no errors. `claude plugin validate`: passes. `tests/install.test.sh`: passes.
- Not run: the mod in a live session (the desktop app runs the cached copy). The desktop look
  was checked from the drawn trees only, rendered in a browser, not in the app itself.

## Review
- An independent review found no blockers. Fixed from it: 0.2 rows left in the session state
  after a reload are normalized on read (they would have broken the Agents tab); a resumed
  subagent goes back to running; an interrupted agent reads "stopped before it finished", not an
  error; resting companions settle on their still frame; a desktop draw no longer stops the
  terminal's animation; a detached HEAD clears the branch; a progress report counts as activity;
  200K windows for the 4.5-and-earlier models; two columns from 98 so each half keeps its margin.
- Left as is: retired Opus 4.1 prices at the Opus family default (the bundled table has no row
  for it); the Agents tab keeps its ruled margin below 48 columns.

## Next Steps
- Run `./install.sh` and open a new desktop session (or `/reload-plugins` in a terminal) to see 0.3.
- The Notebook spec's ink-in margin animation (a Client) was left out; the page is static.
- `register.tsx` is 650 lines: the engine follows `$` only within one file, so wiring stays there.

## Related
- `docs/progress-pane-themes/index.html` (the ten themes), `docs/progress-pane-themes/notebook.json`
  (the chosen spec).
