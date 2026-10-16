# /kickoff ships inside progress-pane (progress-pane 0.5.0, git-gate 0.2.1)

## What changed
The `kickoff` skill moved from `skills/kickoff` to `mods/progress-pane/skills/kickoff`.
Installing progress-pane now gives you `/kickoff`; there is no separate skill to install.

## What was checked first (Claude Code, `claude -p --plugin-dir <spike>`)
- A skill bundled in a plugin answers to its bare name (`/pingspike`) and to its full name
  (`/progress-pane:pingspike`).
- With the old standalone skill still in `~/.claude/skills/`, a bare `/kickoff` runs the
  standalone one, not the bundled one (the real kickoff ran, not the stub). So a leftover
  standalone copy shadows the mod's and, never updated again, goes stale.

## Changes
- `git mv skills/kickoff mods/progress-pane/skills/kickoff` (SKILL.md, references, evals).
  The skill text is unchanged: it still falls back to a hand-written worklog where the
  `worklog` tool is missing (cloud sessions, the mod disabled in a repo).
- git-gate 0.2.1: `/progress-pane:kickoff` grants what `/kickoff` grants (commits and merges
  into task branches, never a push), in the prompt reader (`readIntent`) and the
  `command.run` matcher. Only that exact prefix: another plugin's `…:kickoff` grants nothing.
- install.sh: `kickoff` is no longer a skill in the catalog. An old standalone copy installed
  by this kit (it has the `.claude-kit-source` marker) is removed when progress-pane is
  selected or on `--uninstall`, shown in the plan and `--list`; it stays, with a note, when
  progress-pane is not selected. A kickoff skill without the marker is never touched.
- READMEs, CONTRIBUTING (a mod may carry `skills/<name>/`), plugin and marketplace
  descriptions; versions bumped (progress-pane 0.4.0 → 0.5.0, git-gate 0.2.0 → 0.2.1).

## Decisions
- Accepted the namespace instead of keeping a standalone skill: bare `/kickoff` keeps working
  once the old copy is gone, and the full name is a second, always-unambiguous spelling.
- git-gate was not made to depend on progress-pane: it only has to recognise the name.
- `/ship` and `/report` stay standalone skills.

## Tests
git-gate: intent and command tests for `/progress-pane:kickoff` (169 pass). `tests/install.test.sh`:
the skill's new location, no skill row, the old copy removed / kept / left alone when it is
the user's own / removed on `--uninstall` (13 ok). progress-pane 368 pass. `claude plugin
validate --strict .` passes for both mods; `npx tsc -p .` has 0 errors for both, using the
engine types from the plugin cache (see the session-band changelog).

## Not done
- Not run through a real install on this machine: `./install.sh` would remove the kit's
  standalone `~/.claude/skills/kickoff` and update both mods' desktop copies. After it, start a new session.
- Not observed: the exact command name the engine reports for the namespaced skill in
  `command.run`. git-gate matches both `kickoff` and `progress-pane:kickoff`, and the prompt
  reader matches the typed text either way.
