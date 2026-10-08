---
worklog: 1
title: model-guard 0.3: choose model versions, not families
plan: docs/plans/model-guard-per-version-models.md
branch: model-guard-per-version
gate: cd mods/model-guard && claude plugin test . && claude plugin validate --strict . && npx tsc -p .
status: active
started: 2026-10-08T20:19Z
updated: 2026-10-08T20:56Z
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
- [ ] B1 State contract, store persistence, migration
- [ ] B2 Enforcement on version keys
- [ ] B3 Catalog refresh, seen ids, new-model toast
- [ ] B4 Text commands

## Phase C · Pane
- [ ] C1 Two-level list, more, new-versions view

## Phase D · Release
- [ ] D1 README, api-notes, version 0.3.0
- [ ] D2 Manual check in terminal and desktop

## Log
- 22:56 Ruling: an alias whose family has no list entries passes to the host even if a version rule blocks one — needs the API list empty — c…
- 22:56 A review fixes 5853b08: -0 keys, alias rewrite on family block, Vertex/gateway/dotted ids, lenient parsePolicy; 111 tests ✓
- 22:47 A review round 1: 1 BLOCKER (opus-5-0 ≠ opus-5 key), 6 SHOULD-FIX, 6 NIT — all sent back to impl-a
- 22:37 A3 done · f77cf9c: 35 tests; phase review running
- 22:37 A2 done · e5b3b5a: 24 tests; API `line` sets the family of unparsable ids
- 22:37 A3 doing
- 22:37 A2 doing
- 22:37 A1 done · 2645e3b: 14 tests; gate green on mg-a (92 pass)
- 22:24 S1 done · 2b557cb: API ok with bearer (14 models, has `line`); store live across processes; Buttons focusable
- 22:24 Ruling: no seed.ts (API works); "more" rows are focusable Buttons, no [ ] paging — cost if wrong: one view tweak
- 22:24 Ruling: spike ran headless (claude -p --plugin-dir), not in desktop+terminal — no hot-reload prompt, 0 cost — desktop↔terminal store …
- 22:20 S1 doing
- 22:20 A1 doing
- 22:19 started on model-guard-per-version
