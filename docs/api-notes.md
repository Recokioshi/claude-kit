# Mod API notes: verified against Claude Code 2.1.288 types / 2.1.289 CLI

These notes are the ground truth for the mods in this kit: they come from the
engine-written declaration file (20k lines), the bundled `plugin-authoring`
guide, and spikes run through `claude plugin validate` / `claude plugin test`
in this container.

## Shape of a mod
- Folder = plugin: `.claude-plugin/plugin.json`, `hooks/hooks.json` → `{ "modules": ["./register.tsx"] }`,
  `hooks/register.tsx` exporting `register: Register = (on, options) => {}`.
- State the UI reads lives in `$.state` (survives hot reload), declared in a contract
  (`types/index.d.ts`, `interface PluginState { <plugin>: {...} }`), named in plugin.json `"types"`.
- Cross-session values: `$.store` (JSON, ≤ 4 MiB per plugin).
- Options: plugin.json `userConfig` → `register(on, options)`; stored in settings `pluginConfigs`.
- No Node, no DOM: files via `$.fs`, commands via `$.process.run(argv)`, time via `$.clock`.

## Events used by this kit
| Event | Used for | Verified detail |
|---|---|---|
| `tool.call` | git-gate, progress observation | `{ deny }` refuses (model sees error); `await next(e)` then read `isError`/`text`; `{ ...ran, context: [...] }` appends a model-only reminder to the result |
| `agent.spawn` | model-guard | sees `model` (as given), `parentModel`, `subagentType`, `background`; `next(e)` → `{ model, agentId }`; can `{ deny }` or `next({...e, model})` |
| `turn.step` | model-guard safety net | every model request (main + subagents via `agentId`, workflows, forks); `next({...e, model})` swaps model; streaming hook (async generator) |
| `classic.PreModelSwitch` | model-guard | `{ permissionDecision: 'deny', permissionDecisionReason }` vetoes `/model` |
| `prompt.submit` | git-gate grants | `e.origin.kind`: `composer` (typed), `bridge` (phone/web Remote Control), `sdk`, `peer`, `task-notification`, `scheduled-trigger`, `plugin` |
| `command.run` / `skill.prompt` | git-gate ↔ /ship, /kickoff | `skill.prompt` fires for `/name`, Skill tool and preloads; hook can rewrite the skill text the model reads |
| `prompt.compose` | progress-pane | append a `scope: 'session'` system-prompt section (worklog contract) |
| `turn.complete` | progress-pane | `agentId` for subagents; `usage` |
| `session.start` / `session.end` | registration, timers, persistence | first `session.start` awaited before first prompt |
| `ui.render` `Pane` / `AbovePrompt` | UI | `$.ui.resolve(e)` table per surface; mobile has no Input/Select |

## UI facts that shape the designs
- Elements: Box, Text, Button (+ Input/Select except mobile; Markdown, Code, Link everywhere; Raster terminal-only).
- `Text` takes no `key`; tests find text through a keyed `Box` or by `text`.
- Theme color tokens (`success`, `warning`, `error`) validate; plus `dimColor`, `bold`, `inverse`.
- A pane opened unasked only seats from 144 columns; opened by a command/press it seats at any width.
- One status line per plugin (`$.ui.status`), toasts (`$.ui.toast`), native question dialog (`$.ui.ask`, 2–4 options, rejects when dismissed or headless).
- Band (`AbovePrompt`) must size to `e.props.bodyColumns`; return `next(e)` to show nothing.
- Render hooks never write state; writes happen in handlers via `update($, atom, fn)`.

## Testing facts
- `claude plugin test <dir>` runs `*.test.ts(x)`; `$.tool.call(...)` raises the plugin's `tool.call` hooks; the test's own `on('tool.call', ...)` stands in for core.
- `$.ui.mount({ plugin, surface, component, requestId, props })` → `find/findAll/press/drawn`.
- `claude plugin validate <dir>` lists hooks, `$` calls and state reads/writes per module.
