# model-guard

Choose the model versions Claude and its subagents may use. "Allow Opus 4.8, block Opus 5"
becomes a switch you set once, in one list every Claude Code window on your machine shares
(desktop app, terminals, VS Code), instead of a paragraph you retype. New models are allowed
until you block them.

Tested with Claude Code 2.1.293.

## `/models`
```
 MODELS · global
 list: Anthropic, updated 3h ago
 OPUS
 ● 1: 5.5    claude-opus-5-5             12 uses
 ○ 2: 5      claude-opus-5              1 refused
 SONNET
 ● 3: 5.5    claude-sonnet-5-5            4 uses
 HAIKU
 ● 4: 5.5    claude-haiku-5-5
 FABLE
 ● 5: 5.1    claude-fable-5-1
 o: ▸ 9 older versions
 n: new versions…   f: fallback: opus 5.5   m: explicit asks: deny
 RECENT
 2m  ~ agent 3f2a91c0  opus 5 → opus 5.5
 u: Refresh list   s: Separate list for web-app   x: Close
```
- On show: the newest version of each family, plus every version you set a rule for. `o` shows
  the older ones (Tab or the arrows reach them, Enter toggles).
- `1–9`, or Enter on a row, allows or blocks one version. The change is saved at once for every
  window; the others pick it up at their next turn or when `/models` opens. The last allowed
  model can't be blocked.
- `n` opens the defaults new versions get, per family and for families not named yet (all
  allowed until you change them). `b` goes back.
- `f` cycles the fallback: where a request on a blocked version goes when its own family has
  nothing allowed.
- `m` switches what happens when Claude explicitly asks for a blocked version: `deny` (Claude
  gets an error naming the model to use, and picks again) or `swap` (it runs on the newest
  allowed version of the same family, else the fallback).
- `s` gives this repo a list of its own, a copy of the global one; pressed again, the repo goes
  back to the global list.
- `u` refreshes the model list now. The line under the header says where the list came from and
  when, or why the last refresh failed.
- It works the same on the phone (no input fields there).

## Text forms
Everything the pane does, as text, for the phone, cloud sessions and `claude -p`:
```
/models                              the pane, or the same as text where nothing draws
/models allow|block <model>          one version: opus 4.8, opus-4.8, claude-opus-4-8
/models new <family> allow|block     versions without a rule of their own, new ones included
/models new other allow|block        the same for families not named yet
/models add <id> · remove <id>       a model the list does not show (a gateway's, say)
/models refresh                      the list from Anthropic now
/models fallback <model>             a version, or a family (its newest allowed version)
/models mode deny|swap
/models repo · global                this repo gets its own list · back to the global one
/models help
```
A family is not a version: `/models block opus` asks you to name one (`opus 5`) or to use
`/models new opus block`. A rule for a version the list does not have yet is kept and applies
once it appears. The 0.2 forms still work: `/models opus,sonnet` allows those families and
blocks the others; `save` is `repo`, `reset` is `global`.

## Where the model list comes from
- **Anthropic's Models API**, through the session's own login (the mod never sees the
  credential): at session start when the list is more than a day old, and on `u` or
  `/models refresh`. A model new to the list gets one toast, e.g. `new model Claude Opus 5.6
  (claude-opus-5-6), allowed. /models to change.` The very first fill announces nothing.
- **Models sessions run**: the main conversation's model, `/model` switches, and what subagents
  ran on. On Bedrock, Vertex or a gateway, where there is no Anthropic login to ask with, this
  is where the list comes from.
- **`/models add <id>`** for anything else.

Every spelling of a version counts as that version: `claude-opus-5`, `claude-opus-5-20260901`,
`claude-opus-5[1m]`, `claude-opus-5-0`, `us.anthropic.claude-opus-5-v1:0` and
`claude-opus-5@20260901` are all "opus 5", so a block holds for each. A swap or a rewrite uses
the spelling of the requester's provider when the list has it.

## What it enforces
| Where | What happens to a blocked version |
|---|---|
| Agent tool `model: "claude-opus-5"` | refused, naming the model to use (or swapped in `swap` mode) |
| Agent tool `model: "opus"` while an Opus version is blocked | pointed at the newest allowed Opus before it starts |
| An agent type that pins a model, an engine fork's requests | each request is swapped to the newest allowed version of its family, else the fallback (one toast per agent) |
| A workflow's agents | refused in `deny` mode; in `swap` mode their requests are swapped as above |
| `Workflow` script (or `scriptPath`) containing `model: 'claude-opus-5'` | refused before it starts |
| `/model claude-opus-5` | refused, naming the allowed version to pick |
| Your main conversation's own model | left alone (that is your `/model` choice); a toast says when it runs on a blocked version |

A status line (`model-guard: blocked: opus 5 · 2 swapped`) appears only after something was
refused or swapped. If a check itself fails, the request is let through and the status line
says so: a broken guard never stops every agent.

## Where it is kept
One JSON file per installed plugin, `~/.claude/plugins/store/model-guard_<marketplace>-<hash>.json`,
read and written by every Claude Code process on the machine: the global list
(`policy:global`), each repo's own list (`repo:<path>`) and the model list (`catalog`). Each
rule you set is its own entry (`policy:global|version|opus-5`), so edits to different rows from
two windows, even at the same moment, never overwrite each other. It does not reach other
machines or cloud sessions.

## Upgrading from 0.2
Nothing to do. The first 0.3 session turns your 0.2 choice into the global list: families you
had on stay allowed, families you had off are blocked (their new versions too), and a repo you
saved with `s` keeps its choice as that repo's own list. The settings rows (`/config` →
model-guard) are read only for that first seeding; after it, change things in `/models`.

## Notes
- For an organization-wide hard limit, use managed `availableModels`. This mod is the
  per-machine, per-repo layer on top.
