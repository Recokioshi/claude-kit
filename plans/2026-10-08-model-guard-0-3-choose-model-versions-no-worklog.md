---
worklog: 1
title: model-guard 0.3: choose model versions, not families
plan: docs/plans/model-guard-per-version-models.md
branch: model-guard-per-version
gate: cd mods/model-guard && claude plugin test . && claude plugin validate --strict . && npx tsc -p .
status: active
started: 2026-10-08T20:19Z
updated: 2026-10-08T20:19Z
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
- [ ] S1 Models API via session login, store across processes, pane focus → api-notes

## Phase A · Pure core
- [ ] A1 ids.ts: parse, key, compare versions
- [ ] A2 catalog.ts: list, API narrowing, merge, view split
- [ ] A3 policy.ts: rules, alias to id, swap target, migration

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
- 22:19 started on model-guard-per-version
