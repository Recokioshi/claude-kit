---
worklog: 1
title: model-guard 0.3: choose model versions, not families
plan: docs/plans/model-guard-per-version-models.md
branch: model-guard-per-version
gate: cd mods/model-guard && claude plugin test . && claude plugin validate --strict . && npx tsc -p .
status: done
started: 2026-10-08T20:19Z
updated: 2026-10-09T01:26Z
---

Goal: Everything in the plan: per-version allow/block, list from the host, machine-wide store, tested; no push/PR.

## Rules
- Phase branches mg-<key> cut from model-guard-per-version; merged back --no-ff after review + green gate.
- No pushes, no PRs, no deploys. Never git stash.
- Pure logic in ids/catalog/policy (no $); $ glue stays in register.tsx (loader rule).
- New models allowed by default; store is machine-wide; cloud sessions out of scope.
- The main conversation's model is never changed: warn only.
- API responses are narrowed by hand-written guards before use.

## Phase S · Spike
- [x] S1 Models API via session login, store across processes, pane focus → api-notes · 2b557cb — API ok with bearer (14 models, has `line`); store live across processes; Buttons focusable

## Phase A · Pure core
- [x] A1 ids.ts: parse, key, compare versions · 2645e3b — 14 tests; gate green on mg-a (92 pass)
- [x] A2 catalog.ts: list, API narrowing, merge, view split · e5b3b5a — 24 tests; API `line` sets the family of unparsable ids
- [x] A3 policy.ts: rules, alias to id, swap target, migration · f77cf9c — 35 tests; phase review running

## Phase B · Wiring
- [x] B1 State contract, store persistence, migration · 7545e01 — 108 tests; reload + alias tests mutation-checked
- [x] B2 Enforcement on version keys · 7545e01 — landed with B1 (same commit, see Ruling)
- [x] B3 Catalog refresh, seen ids, new-model toast · 4cf89c7 — 116 tests; first-fill-silent rule mutation-checked; store/API in lists.ts via ports
- [x] B4 Text commands · 82e3202 — 128 tests; parsing + decisions pure (commands.ts, decide.ts); tests split by area

## Phase C · Pane
- [x] C1 Two-level list, more, new-versions view · df3eccf — 132 tests; n view, list status line, u refresh, phone controls

## Phase D · Release
- [x] D1 README, api-notes, version 0.3.0 · 74694e6 — review fixes 79a883c (reset explains, turn.step fails open); 163 tests, installer tests 6/6
- [x] D2 Manual check in terminal and desktop · cb56cc4 — headless real-engine checks ✓; installing 0.3.0 + pane/spawns in desktop/VS Code left for you
- [x] D3 Edits from two windows at the same moment both survive · cb56cc4 — rules as per-row store keys; 160 tests; 3 real processes × 3 rounds, nothing lost

## Log
- 03:26 finished: model-guard 0.3 on model-guard-per-version: per-version rules, list from the Models API, one list for every local window; 1…
- 03:26 Phase D merged 6bf9bbf; gate on merge ✓ (163 pass, validate ✓, tsc ✓, installer 6/6). Changelog written.
- 03:25 D1 done · 74694e6 (gate green on the model's word: background run): review fixes 79a883c (reset explains, turn.step fails open); 163 …
- 03:20 D3 done · cb56cc4 (gate green on the model's word: background run): rules as per-row store keys; 160 tests; 3 real processes × 3 roun…
- 03:20 Ruling: D2 done without a green gate — A manual check, no code of its own: headless real-engine runs passed (API refresh, cross-proce…
- 03:19 D2 doing
- 03:19 D3 doing
- 03:15 D2 headless (real engine, 0 turns): refresh 14 models ✓, block seen by another process ✓; two processes at once → one block lost: D3 …
- 03:15 added D3 Edits from two windows at the same moment both survive
- 03:14 D1 committed; gate ✓ in background (153 pass, validate ✓, tsc ✓, install.sh -n ✓, JSON ✓); docs review running
- 03:12 D1 doing
- 03:12 Ruling: a turn.start reload racing a pane press can show the old value until the next redraw; the store keeps the press — cost: one s…
- 03:12 Ruling: register.tsx is 342 lines (all $ glue; logic in 7 pure modules) and turn.start reads 3 store keys — cost if wrong: one oversi…
- 03:12 Ruling: guard hooks fail open with a status line (as 0.2) — a broken guard must not stop every agent — cost if wrong: a blocked model…
- 03:12 B/C review fixes e29e183: store-first writes, workflow deny-or-pass, no-login session-only, provider spelling, main model from step; …
- 23:32 B/C review: 0 BLOCKER, 8 SHOULD-FIX (store-first writes, workflow spawns, no-login, provider spelling, main model, pane errors, input…
- 23:11 C1 gate evidence: exact gate run in background after the commit, exit 0 — 132 pass, validate ✓, tsc ✓
- 23:11 C1 done · df3eccf (gate green on the model's word: background run): 132 tests; n view, list status line, u refresh, phone controls
- 23:09 C1 doing
- 23:09 Ruling: register.tsx stays ~330 lines — every $ call must live in it (loader); all logic is in pure modules — cost if wrong: one file…
- 23:09 B4 done · 82e3202: 128 tests; parsing + decisions pure (commands.ts, decide.ts); tests split by area
- 23:04 B3 done · 4cf89c7: 116 tests; first-fill-silent rule mutation-checked; store/API in lists.ts via ports
- 23:04 B4 doing
- 23:00 Ruling: B2 done without a green gate — Same commit as B1, whose gate ran green on this exact code (108 pass, validate ✓, tsc ✓)
- 23:00 B3 doing
- 23:00 Ruling: $ can't cross an import (validate refuses) — B3 moves store/API logic to lists.ts behind plain-function ports to keep registe…
- 23:00 B2 doing
- 23:00 B1 done · 7545e01: 108 tests; reload + alias tests mutation-checked
- 22:57 Ruling: B1+B2 land as one commit — the state shape change breaks enforcement, so no green midpoint — cost: a larger review diff
- 22:57 B1 doing
