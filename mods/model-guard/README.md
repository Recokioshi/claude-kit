# model-guard

Choose the models this session may use. A rule like "only Opus and Sonnet in this repo"
becomes a switch you set once instead of a paragraph you retype. Every family is allowed until
you turn one off, so the guard restricts only what you choose.

Tested with Claude Code 2.1.289.

## `/models`
```
 MODELS · web-app default
 ● 1: opus     claude-opus-5-5             12 uses
 ● 2: sonnet   claude-sonnet-5-5            4 uses
 ○ 3: haiku    claude-haiku-4-5-20251001 1 refused
 ○ 4: fable    claude-fable-5-1           2 swapped
 ○ 5: other
 f: fallback: opus   m: explicit asks: deny
 RECENT
 2m  ~ agent 3f2a91c0  fable → opus
 7m  ✗ lint fixes       haiku refused
 s: Save for web-app   g: Save as global default
 r: Reset   x: Close
```
- `1–5` toggle a family. The list can't become empty.
- `f` cycles the fallback.
- `m` switches what happens when Claude explicitly asks for a model that is off:
  `deny` (Claude gets an error and picks again) or `swap` (it runs on the fallback).
- `s` saves the current choice (models, fallback, explicit-ask mode) as this repo's default; it is
  read again at every session start and after `/clear`.
- `g` saves it as the **global default**: every repo without its own saved choice uses it, in this
  session and every new one. A repo saved with `s` keeps its own choice (the confirmation says
  so; press `s` there to replace it). It writes the mod's settings (`pluginConfigs` in
  `~/.claude/settings.json`), the same values `/plugin configure model-guard@claude-kit` edits, so
  no file editing is needed.
- The header says where the current choice came from: `web-app default`, `global default` or
  `changed this session`.
- It works the same on the phone (no dropdowns).

Text forms: `/models opus,sonnet`, `/models save`, `/models default`, `/models reset`. Where nothing draws (cloud
sessions), `/models` prints the same information.

## What it enforces
| Where | What happens to a model that is off |
|---|---|
| Agent tool `model: "haiku"` | refused, with the model to use (or swapped in `swap` mode) |
| An agent type that pins a model (e.g. Explore on Haiku), workflow agents, engine forks | each request is swapped to the fallback (toast once per agent) |
| `Workflow` script containing `model: 'haiku'` | refused before it starts |
| `/model haiku` | refused, with the reason |
| Your main conversation's own model | left alone (that is your `/model` choice) |

A status line (`model-guard: allowed: opus, sonnet · 2 swapped`) appears only after
something was refused or swapped.

## Settings (`/config` → model-guard)
- `defaultAllowed`: default `opus,sonnet,haiku,fable,other` (everything allowed).
- `fallback`: default `opus`.
- `mode`: default `deny`.

Example: a team that wants only Opus and Sonnet in one repo opens `/models` there once, leaves
`opus,sonnet` on and presses `s` (or runs `/models opus,sonnet` then `/models save`).

## Notes
- Families are detected from the model id (`opus`, `sonnet`, `haiku`, `fable`); anything else
  is `other`.
- For an organization-wide hard limit, use managed `availableModels`. This mod is the
  per-session, per-repo layer on top.
