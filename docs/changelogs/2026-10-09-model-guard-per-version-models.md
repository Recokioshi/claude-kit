# model-guard 0.3: choose model versions, not families

**Date:** 2026-10-09
**Status:** Completed (not yet installed or released: on branch `model-guard-per-version`)

## Summary
model-guard used to know five hardcoded families and one hardcoded id each, so every model release
meant a code change, and "allow Opus 4.8, block Opus 5" could not be expressed. 0.3 loads the model
list from Anthropic's Models API through the session's own login (plus the models sessions run and
`/models add`), keeps rules per version with a per-family default for new versions (allowed until
blocked), and keeps the rules and the list in the plugin store, which every local Claude Code
window (desktop, terminals, VS Code) shares. Each rule is its own store entry, so edits from two
windows at the same moment both survive. No `docs/systemdocumentation.md` in this repo: the mod's
README and `docs/api-notes.md` carry the documentation.

## Changes
- Created `mods/model-guard/hooks/ids.ts`: every spelling of a version (dated, `[1m]`, `-0`,
  Bedrock, Vertex, gateway) maps to one key such as `opus-5`; families read from the id.
- Created `mods/model-guard/hooks/catalog.ts`: the model list, the Models API response narrowed
  by hand, merging API / seen / added sources, the main view and "more" split.
- Created `mods/model-guard/hooks/policy.ts`: version rules over family defaults, alias to the
  newest allowed version, swap targets, the never-all-blocked guard, migration from 0.2.
- Created `mods/model-guard/hooks/rows.ts`: a list as a base record plus one store key per row.
- Created `mods/model-guard/hooks/lists.ts`: store and Models API logic behind plain-function
  ports (the loader follows `$` only within one file).
- Created `mods/model-guard/hooks/commands.ts`, `decide.ts`: `/models` text forms and the
  per-request decisions, both pure.
- Replaced `mods/model-guard/hooks/families.ts` with `state.ts`; rewrote `register.tsx` (all `$`
  glue: spawn, `turn.step`, Workflow, `/model`, refresh, main-model check, fail-open `.catch`
  on every guard) and `view.tsx` (versions view with "more", new-versions view, list status line).
- Modified `mods/model-guard/types/index.d.ts`: the new state, kept under a shape tag so a hot
  reload of a 0.2 value reads as absent.
- Replaced `mods/model-guard/tests/model-guard.test.tsx` with a shared `harness.ts` and per-area
  test files (ids, catalog, policy, rows, lists, enforcement, refresh, pane, commands).
- Modified `mods/model-guard/README.md`, `.claude-plugin/plugin.json` (0.3.0),
  `.claude-plugin/marketplace.json` (0.3.0), root `README.md`, `install.sh` (picker text).
- Modified `docs/api-notes.md`: spike results (Models API with the session login, store shared
  live between processes, store file naming) and the mod API facts this work turned up.
- Created `docs/plans/model-guard-per-version-models.md` (the plan) and the worklog in `plans/`.

## Testing
- `claude plugin test .` in `mods/model-guard`: 163 pass, 0 fail (19 before). Mutation checks on
  the per-turn reload, the alias rewrite, store-first edits, the fork pass-through, once-per-agent
  toasts, the main-model alias rule, the first-fill silence and the `turn.step` fail-open each
  fail a test.
- `claude plugin validate --strict .` passes; `npx tsc -p .` clean; `tests/install.test.sh` 6/6.
- Real engine, headless (`claude -p` with `--plugin-dir`, zero model turns): the Models API answers
  through a subscription login (14 models); a block made in one process is read by the next; three
  processes editing different rows at the same moment, three rounds, nothing lost.
- Three reviews by a separate agent (pure core, wiring and pane, docs); every BLOCKER and
  SHOULD-FIX fixed.
- Not checked by hand: the pane in the desktop app, terminal and VS Code, and real subagent spawns
  against blocked versions (those need 0.3.0 installed and interactive sessions).

## Next Steps
- Install and try it: `claude plugin update model-guard@claude-kit`, start new sessions, block a
  version in the desktop app and check a terminal session refuses it from its next turn.
- Push and open a PR (`/ship`).

## Related
- Plan: `docs/plans/model-guard-per-version-models.md`
- Worklog: `plans/2026-10-08-model-guard-0-3-choose-model-versions-no-worklog.md`
