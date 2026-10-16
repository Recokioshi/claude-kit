# progress-pane 0.6.0: menu on top, a main-thread companion, clearer Plan and Agents

## What changed
- **The menu sits under the header on every page.** The Overview and the Log used to draw it
  last, the Plan, Agents and Needs tabs first.
- **The main thread has a companion on the Overview**, above the plan: the same creature and
  accessory a subagent on that model and effort gets, working while a turn runs, resting while
  it waits for the person, done with the run. Beside it: which creature that is, and how many
  subagents are running right now (`2 agents running · 13 in all`). The creature is named
  rather than the model again: the header already shows the model and effort.
- **Phase titles stay bold on desktop.** A desktop Button draws its own label and dropped the
  bold, so on the Plan page the title is now bold text and the fold is a `▾ 2/6` / `▸ 5/5`
  button at the row's end. The terminal is unchanged (the title is the fold button).
- **Agents are parted by a hairline** with air on each side: a `─` rule on the terminal, a
  one-pixel Svg rule with a margin on desktop, mobile and VS Code (they had no gap at all).
- **The doing step stays in view in a short pane.** The step window used to keep two done
  steps above the first open one even when that pushed the open one into `+N more`.

## How
- `hooks/pane.tsx`: `menu` after `top` in every Overview branch; the Log uses `page()`.
- `hooks/lead.tsx` (new): `leadBlock`, `leadRows`, `mainPose`, `crewLine`, `MAIN_COMPANION`.
- `hooks/agents.tsx`: `companionArt` draws any companion from `{ key, family, effort, pose,
  status }`; a subagent's and the main thread's both go through it. `separator` between entries.
- `hooks/frame.tsx`: `RowSpec.action`, a trailing Button used in a proportional font.
- `hooks/overview.tsx`: `phaseRow` takes `fold: { key, onPress, isOpen }`; `stepWindow` keeps
  the first open step.
- `hooks/register.tsx`: `ViewData.isMainWorking` from the inbox's `isTurnRunning` (`turn.start`
  fires for the main thread's prompt turns only); the companion timer also runs on the
  Overview and blits `companion-main` while a turn runs; closing the pane stops it.

## Tests
`tests/layout.test.tsx` (new): menu position on every tab, a finished run and a session with no
worklog; desktop phase titles outside the fold Button and its labels; the terminal hairline and
the desktop Svg rule; the main companion's place, states, desktop Svg, when it is left out, and
the step fold. `tests/crew.test.tsx`: the timer blits `companion-main` during a turn and stops
after. The gallery-mock tests in `tests/register.test.tsx` now expect the menu under the header.

## Not verified
The desktop drawing (the bold title next to the fold button, the one-pixel rule, the Svg
companion's place) was checked only as an element tree. It still needs a look in the app.
