# Plan: model-guard 0.3 — choose model versions, not families

Status: implemented on `model-guard-per-version` (worklog: `plans/2026-10-08-model-guard-0-3-choose-model-versions-no-worklog.md`) · Target: `mods/model-guard` 0.2.0 → 0.3.0

## Why
- The rows (`FAMILIES`) and the ids next to them (`DEFAULT_IDS`) are hardcoded in
  `hooks/families.ts`, so every release needs a code change, a version bump and
  `claude plugin update`. `DEFAULT_IDS.haiku` already points at an old model.
- A family is too coarse: "allow Opus 4.8, block Opus 5" can't be expressed today.
- A model with a new family name lands in `other`, with no row of its own.

## Goals
1. The model list comes from the host (Anthropic's Models API through the session's own
   login), not from code. Updating it needs no release.
2. Allow or block individual versions. New versions are **allowed by default**.
3. `/models` shows the newest version of each family, plus every version with a rule of its
   own. A "more" control lists all older versions.
4. The list and the rules are global for this machine: Claude Code desktop, every terminal
   `claude` and the VS Code extension read and write the same data. Cloud sessions are out of
   scope.

## Non-goals
- Syncing across machines or to cloud sessions (would need `pluginConfigs` in settings.json
  synced with dotfiles, or managed settings; not planned).
- Changing the main conversation's model. It stays the user's `/model` choice; we only warn.
- Bedrock / Vertex / gateway setups get the fallback list (no first-party credential), but
  enforcement works the same.

## Decisions (agreed)
| Question | Decision |
|---|---|
| New versions | Allowed by default (per family, switchable), with a one-time "new model" toast |
| "All instances" | Every local session on this machine: desktop, terminal CLIs, VS Code. Not cloud |
| Session-only edits | Dropped: a toggle saves to the active list (global or this repo's override) at once |

---

## Step 0 — Spike (before any refactor)
A throwaway hook in a scratch mod, run in a terminal session and a desktop session. Record
the results in `docs/api-notes.md`.

1. **Models API with the session credential.**
   `const a = await $.session.authorize()` → `$.http.fetch('https://api.anthropic.com/v1/models?limit=1000', { auth: a.handle, headers: { 'anthropic-version': '2023-06-01' } })`.
   Try it with `kind: 'bearer'` (subscription login). If it fails with 401/403, retry with
   `anthropic-beta: oauth-2025-04-20`. Record the status, the model count, the shape of one entry
   (`id`, `display_name`, `created_at`, `type`), and `has_more` / `last_id`.
2. **`$.store` across processes.** In session A, `store.set('k1', …)`. In an already-running
   session B, `store.get('k1')`: does B see it without a restart? Then `store.set('k2', …)` in B
   and check that A's `k1` survives (if the store writes the whole file, one session can wipe
   another's keys).
3. **Pane keyboard focus.** Can a `Button` without a `hotkey` be reached from the keyboard in the
   terminal pane? This decides how the "more" list is navigated (see UI).

Outcomes that change the plan:
- 1 fails for `bearer` → the list comes from runtime sightings + `/models add` + a seed module
  (`hooks/seed.ts`, the only hardcoded data left). Everything else stays the same.
- 2 shows clobbering or stale reads → store the global data in our own JSON file through
  `$.fs.read` / `$.fs.write` (e.g. `~/.claude/model-guard/models.json`), re-reading and merging
  before every write.

---

## Design

### 1. Model ids → one key per version (`hooks/ids.ts`, pure)
Every spelling of a version shares one key, so a dated id or a 1M-context variant can't get
around a block:

| Spelling | Key |
|---|---|
| `claude-opus-5`, `claude-opus-5-20260901`, `claude-opus-5[1m]` | `opus-5` |
| `us.anthropic.claude-opus-4-8-20260301-v1:0` (Bedrock), `claude-opus-4-8@20260301` (Vertex) | `opus-4.8` |
| `claude-haiku-4-5-20251001` | `haiku-4.5` |
| `claude-3-5-sonnet-20241022` (old order) | `sonnet-3.5` |
| `claude-nova-1` (a new family) | `nova-1`, family `nova` |
| anything else | the id lowercased, family `other` |

- `parseModelId(id) → { family, version, key } | null` strips the provider prefix, the `-vN:M`
  suffix, `@date`, an 8-digit date and `[…]`.
- The family is read from the id (`claude-<family>-<n>`), so a new family gets its own group
  automatically.
- `compareVersions(a, b)`: numeric per part. The API's `created_at` breaks ties and wins when known.
- Aliases: `opus`, `sonnet`, `haiku`, `fable` (and any family seen in the list) are family
  aliases. `inherit` / empty means the parent's model, left alone as today.
- A context suffix is kept when an alias is rewritten: `opus[1m]` → `claude-opus-4-8[1m]`.

### 2. The model list (`hooks/catalog.ts`, pure)
```ts
type CatalogEntry = {
  key: string            // 'opus-4.8'
  family: string         // 'opus'
  version: string        // '4.8'
  ids: string[]          // every spelling seen; ids[0] is the one to send
  displayName?: string   // 'Claude Opus 4.8' (API)
  createdAt?: string     // ISO (API)
  sources: ('api' | 'seen' | 'added' | 'seed')[]
  firstSeenAt: number
}
type Catalog = { entries: CatalogEntry[]; fetchedAt: number | null; lastError: string | null }
```
- `parseModelsResponse(text: string): Result<ApiModel[], string>`: the API answer is external
  input. It is narrowed field by field with hand-written guards (mods have no Zod), and a bad
  shape returns an error, never a partial list.
- `mergeCatalog(catalog, incoming, now)`: dedupe by key, union the `ids` and `sources`, keep
  `firstSeenAt`, return `{ catalog, added: CatalogEntry[] }` (for the "new model" toast).
- `newestPerFamily`, and `splitForView(catalog, policy)` → `{ main, more }`. `main` is the
  newest per family plus every version with its own rule. `more` is the rest, newest first.

Sources, all merged into one list:
1. **API** (`GET /v1/models`, following `has_more`): at session start when `fetchedAt` is older
   than 24 h, and on `u` / `/models refresh`. Not awaited, so it never delays a session.
   A failure is stored in `lastError` and shown in the pane and in the text answer; it is never
   swallowed. No credential (`authorize()` → null) or
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` → no fetch, and the pane says why.
2. **Seen**: `$.session.model()` at start, `classic.PostModelSwitch.to_model`, the
   `agent.spawn` result's `model`, `turn.step`'s `e.model`.
3. **Added**: `/models add <id>` (removable with `/models remove <id>`).
4. **Seed**: only if step 0.1 fails: a short list in `hooks/seed.ts`.

When a refresh adds entries and the list **already had an API fill** (`fetchedAt !== null`
before it): one toast per new model,
`model-guard: new model Claude Opus 5.6 (claude-opus-5-6) — allowed. /models to change.`
The first API fill toasts nothing, even when the list already held `seen` entries; otherwise it
would announce ~45 models at once.

### 3. Rules (`hooks/policy.ts`, pure)
```ts
type Decision = 'allow' | 'block'
type Policy = {
  families: Record<string, Decision>  // default for versions with no rule of their own
  unnamedFamilies: Decision           // default for a family not in `families`; 'allow'
  versions: Record<string, Decision>  // key → rule; wins over the family default
  fallback: string | null             // a version key, e.g. 'opus-4.8'
  mode: 'deny' | 'swap'
}
```
- `decisionFor(policy, key, family)`: version rule → family default → `unnamedFamilies`
  (`allow` unless the user narrowed it). So a new version, and a family never seen before, are
  allowed.
- `concreteFor(policy, catalog, asked)`: an alias (`opus`) → the newest *allowed* version in
  that family → its `ids[0]`. A full id → itself if allowed, else `null`.
- `swapTarget(policy, catalog, key)`: the newest allowed version in the **same family** first,
  then `fallback`, then the newest allowed in the order opus, fable, sonnet, haiku, then any.
- The pane never lets every known version end up blocked (same rule as the empty-list guard today).
- `migrate(old)`: the 0.2 store record (`{ allowed, fallback, mode }` or a plain array), and
  the `defaultAllowed` / `fallback` / `mode` config strings, map to `families` defaults
  (a family on → allow, off → block). `other` → `unnamedFamilies`. Fallback family → its newest
  version key. Nothing is lost.
- `swapTarget`'s preference order (opus, fable, sonnet, haiku) is the one family list left in
  code, and only as a tie-break.

### 4. Enforcement (changes in `hooks/register.tsx`)
| Hook | 0.2 | 0.3 |
|---|---|---|
| `agent.spawn` | alias passed through (the host picks the newest, possibly blocked) | **alias rewritten to `concreteFor`** before `next()`; a blocked id → deny or swap to `swapTarget` (by `mode`) |
| `turn.step` | blocked family → fallback from `DEFAULT_IDS` | blocked key → `swapTarget`'s id; toast once per agent as today |
| `Workflow` | refuses disallowed families | refuses a script naming a blocked version, or an alias whose family has no allowed version; an alias with one passes (`turn.step` sends its requests to the allowed version) |
| `classic.PreModelSwitch` | family check | key check on the resolved `to_model` |
| main model | untouched | untouched; **toast** at start and after `/model` when it runs on a blocked version |

Stats (`uses` / `swapped` / `refused`) and the RECENT log move from family to version key.

### 5. Saving and sharing between instances
| Store key | Holds |
|---|---|
| `catalog` | the merged model list (≈ 50 entries, a few KB) |
| `policy:global` | the global rules: what every repo uses by default |
| `repo:<root>` | an optional per-repo override (`Policy`); the 0.2 records here are migrated on first read |

- A toggle writes to the active list right away: the repo override if this repo has one, else
  global. Every write re-reads the key, applies the one change and writes it back, so two
  instances editing different rows don't lose each other's change.
- Other instances pick up changes at session start, at every main-loop `turn.start` (no
  `agentId`; one store read), and when the pane opens. So blocking a model in the desktop app applies to a running terminal
  session from its next turn.
- The `userConfig` fields in `plugin.json` (`defaultAllowed`, `fallback`, `mode`) are only read
  once, to seed `policy:global` when it doesn't exist yet. Their descriptions say so. Remove
  them in a later version.

### 6. The `/models` pane (`hooks/view.tsx`)
```
 MODELS · global
 OPUS
 ● 1  4.8   claude-opus-4-8        12 uses
 ○ 2  5     claude-opus-5        1 refused
 SONNET
 ● 3  5.5   claude-sonnet-5-5       4 uses
 HAIKU
 ● 4  5.5   claude-haiku-5-5
 FABLE
 ● 5  5.1   claude-fable-5-1
 o: 9 older versions ▸
 n: new versions…   f: fallback: opus 4.8   m: explicit asks: deny
 u: refresh · updated 3h ago (Anthropic API)
 s: Separate list for web-app   x: Close
```
- Digits toggle the visible rows (at most 9 per page).
- `o` is a Button that flips an `expanded` flag in `$.state` (there is no folding element). The
  expanded list pages 9 rows at a time (`[` / `]`), with digits renumbered per page, unless
  spike 0.3 shows focusable Buttons are enough.
- `n` switches to a second view that lists the families with their default for new versions.
  Digits toggle them; `x` goes back.
- `f` cycles the fallback over the newest allowed version per family.
- `s` copies the global list into an override for this repo. With an override active it reads
  `Back to the global list`, which deletes the override.
- The header shows the active list: `global` or `<repo> override`. If the last refresh failed,
  a dim line shows `lastError`.
- `ui.open` rows grow from 13 to fit (≈ 18).

### 7. Text commands (needed on mobile, which has no Input, and in cloud / `-p`)
```
/models                              pane, or the text answer where nothing draws
/models allow <id|key|"opus 4.8">    /models block <…>
/models new <family> allow|block     default for new versions of a family
/models add <id>   /models remove <id>   /models refresh
/models fallback <id|key>   /models mode deny|swap
/models repo   /models global        start / drop this repo's override
```
0.2 forms keep working: `/models opus,sonnet` sets the family defaults (listed families allow;
the other known families and `unnamedFamilies` block). `save` → `repo`. `reset` → `global`. `default` answers that lists are global
now.

---

## Files
| File | Change | Size target |
|---|---|---|
| `hooks/ids.ts` | new: parse / key / compare | ~80 |
| `hooks/catalog.ts` | new: list type, API narrowing, merge, view split | ~160 |
| `hooks/policy.ts` | new: rules, alias → id, swap target, migration | ~160 |
| `hooks/families.ts` | becomes `hooks/state.ts`: GuardState, events, stats, summary, `ageOf`; `FAMILIES`, `DEFAULT_IDS`, `familyOf` removed | ~100 |
| `hooks/seed.ts` | only if spike 0.1 fails | ~20 |
| `hooks/register.tsx` | rewired hooks, refresh, store reads/writes, commands | ≤ 300, see note |
| `hooks/view.tsx` | two-level list, "more" pages, new-versions view, text answer | ~180 |
| `hooks/index.ts` | export the new modules | — |
| `types/index.d.ts` | new state contract (keys instead of families) | — |
| `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | 0.3.0; `userConfig` descriptions marked as one-time seed; drop `fallback.options` | — |
| `README.md` | rewrite `/models`, enforcement table, settings | — |
| `docs/api-notes.md` | spike results; `session.authorize` / `http.fetch` / `PostModelSwitch` rows | — |

Note: the loader requires helpers that take `$` to be top-level functions in the same file, so
all the store, http and session glue lives in `register.tsx`. Everything decidable without
`$` goes to the pure modules. If `register.tsx` still passes ~300 lines, split the pane and
commands into a second module listed in `hooks/hooks.json` (check first that two modules can
share the atom and the store helpers; otherwise accept the size and note why).

On hot reload, `$.state` may still hold a 0.2-shaped `guard`. Seeding treats any state whose
version marker isn't 3 as not ready.

## Tests (`tests/`, `claude plugin test .`)
- **ids**: every spelling in the table → the same key; old 3.x order; new family; unknown → `other`;
  version order (4.8 < 5 < 5.5; created_at tie-break); `opus[1m]` rewrites with its suffix kept.
- **catalog**: API narrowing rejects bad shapes (missing `id`, wrong types, non-JSON); pagination
  merge; dedupe across sources with the spellings collected; `added` lists only new keys;
  `splitForView` keeps ruled versions in `main`.
- **policy**: version rule beats family default; a new version inherits the family default
  (allow); an unknown family follows `unnamedFamilies` (allow by default); `concreteFor('opus')` → 4.8 when 5 is blocked;
  `swapTarget` same family first, then fallback; never all blocked; migration from both 0.2
  record shapes and from the config strings.
- **enforcement** (stubbed `agent.spawn` / `turn.step` / `tool.call` as today): alias rewritten;
  a blocked full id refused in `deny` and swapped in `swap`; the dated and `[1m]` spellings of
  a blocked version refused too; `turn.step` swap target in the same family; Workflow; `/model`
  to a blocked version refused; main-model toast.
- **refresh** (stub `session.authorize` and `http.fetch`): bearer + 200 → list saved, one
  "new model" toast per new key on later fills, and none on the first API fill even when `seen`
  entries already exist; 401 → `lastError` shown, list kept;
  `authorize` null → no fetch; not refetched within 24 h.
- **persistence**: a toggle writes `policy:global` at once; a repo override takes precedence and
  `/models global` drops it; a store change made "by another instance" (written straight to the
  stub store) is picked up at the next `turn.start`.
- **view**: main and "more" rows, paging, the new-versions view, header source, `lastError` line,
  narrow width without ids, and the mobile surface (Buttons only).

## Order of work
0. Spike (above) → api-notes.
1. Branch `model-guard-per-version` from `master`.
2. `ids.ts` + tests → `catalog.ts` + tests → `policy.ts` + tests (pure, test-first).
3. `state.ts` (from `families.ts`), types contract.
4. `register.tsx`: persistence + migration, then enforcement, then refresh, then commands.
5. `view.tsx` + view tests.
6. README, api-notes, versions 0.3.0 (plugin.json and marketplace.json).
7. Gate in `mods/model-guard`: `claude plugin test .`, `claude plugin validate --strict .`,
   `npx tsc -p .`. All must pass.
8. Try it: terminal `/reload-plugins`; desktop/VS Code: `claude plugin update model-guard@claude-kit`
   and a new session. Block a version in desktop, then check that a running terminal session
   refuses it from its next turn.
9. `/worklog`, PR.

## Done when
- No model id or family name is hardcoded outside `seed.ts` (only if the spike requires it),
  the alias list in `ids.ts` and the tie-break order in `policy.ts`.
- "Allow Opus 4.8, block Opus 5" holds for subagents asking `opus`, for full and dated ids, for
  workflows, for pinned agent types (`turn.step`), and for `/model`.
- A new model released upstream shows up within 24 h (or on `u`), allowed, with one toast.
- A change made in any local instance applies to the others by their next turn.
- The gate in step 7 passes.
