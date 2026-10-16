# progress-pane 0.4.0: the band and pane in every session

## What changed
The band above the prompt and the `/progress` pane no longer need a worklog. A session without
one shows what the mod observes: the main thread's model and effort, tokens, context fill,
subagents (Overview list and Agents tab), gate, last commit and time since the first request.
With a worklog nothing changes. Plain sessions get no Plan, Log or Needs tab and no File key.

## How
- `hooks/adhoc.ts`: an empty stand-in worklog (`ADHOC_DOC`) that exists only inside the view
  data, and `isQuiet` (a fresh session draws no band). `ViewData.isAdhoc` makes the drawings
  skip the plan.
- `register.tsx`: a `session` state atom (totals and first-request time, kept for one session
  id, in memory only). `onRun` adds to the worklog's run while one is active, else to the
  session. Drawing reads it without writing. `anyData` is the worklog's view, else the
  session's. A paused worklog gives the band back to the session.
- `observe.ts`: `redGateOf` (D6) split out of `driftOf`, so a session shows a red gate without
  any worklog rule.
- `band.tsx` (`sessionSegments`, drop order time → tokens → git → agents → gate → effort),
  `overview.tsx` (`crewBlock`, session header), `pane.tsx` (footer tabs, Overview fallback for
  worklog tabs), `text.ts` (`/progress text`).

## Decisions
- The stand-in is never stored in the `worklog` state: the system-prompt contract and the drift
  notices to Claude stay off without a worklog.
- Only D6 applies without steps; D1 would fire on every commit.
- Session figures are not saved to the plugin store: per-session keys would grow it without end.
  They restart on a new session id.

## Tests
`tests/session.test.tsx` (band text and narrowing, quiet session, engine-level band and pane,
nothing stored, no contract in the prompt); `engineOf` takes `status: 'none'`. Two tests that
expected "No active worklog" now expect the session text. `claude plugin test .`: 368 pass;
`claude plugin validate --strict .` passes; `npx tsc -p .` passes with 0 errors, using the engine
types the plugin cache holds (`~/.claude/plugins/cache/claude-kit/progress-pane/0.2.0/.claude-plugin/types`,
copied into the gitignored `.claude-plugin/types`; a fresh clone has none until the engine loads the mod once).
