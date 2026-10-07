# Teams/Slack message (≤ 15 lines, pasted into a project channel)

Pick the table by the task type (see SKILL.md). Header, **Done**, **Open** and **Next** are the
same for both.

**Build** (something new was made): one row per part, about the part.
```markdown
**<Project>: <what was made and what it gives the reader, in one line>** ✅/⚠️/❌

| <Part> | What it does | How you use it |
|---|---|---|
| <name> | <the effect for its user> | <command, screen, file> |

**Footprint:** <what it costs to have: tokens, $/month, setup, size>
**Done:** <what is ready and where (refs)>
**Open:** <limits, scope cuts, known problems that change the result; each with owner or blocker>
**Next:** <1–2 concrete steps>
```

**Improve** (something existing got better, was fixed or measured): before → after.
```markdown
**<Project>: <verdict in one line>** ✅/⚠️/❌

| | Now | Before (best) | Δ |
|---|---|---|---|
| <metric 1, unit> | <value> | <value> | <+/-> |
| Cost / <unit> | $<x> | $<y> | <-z%> |

**Done:** <3 items max, comma-separated, each with a short ref (PR #, run)>
**Open:** <1–3 items, each with its owner or blocker>
**Next:** <1–2 concrete steps, with dates if known>
```

Example, build (the claude-kit):
```markdown
**Claude Code kit: 3 skills + 4 mods that turn our working rules into commands and guards** ✅

| For | Skill (you type it) | Mod (runs by itself) |
|---|---|---|
| Long plans | `/kickoff <plan>`: worklog, branch per phase, commit per step | progress-pane: live worklog; a step is done only on a green gate |
| Shipping | `/ship [pr\|merge]`: gate, commits, PR to the right base | git-gate: git writes only when your message asked for them |
| Reports | `/report [teams\|meeting\|deck\|chat]`: verdict first, with evidence | handoff: carries state to the next repo · model-guard: `/models` allow-list |

**Footprint:** ≈ 420 tokens of skill text in every session; 1.5–3.5k while a skill runs
**Done:** all 7 in the claude-kit repo, installed with `./install.sh`
**Open:** mods are early access: re-test after Claude Code updates
**Next:** use it on one real `/kickoff` and one `/ship`, adjust from that
```

Example, improve (search latency, figures from a production traffic replay):
```markdown
**Search: p95 latency 420 ms → 180 ms on replayed production traffic** ✅

| | Now | Before (best) | Δ |
|---|---|---|---|
| p95 latency | 180 ms | 420 ms | −57% |
| p50 latency | 45 ms | 95 ms | −53% |
| Cost / 1 000 queries | $0.012 | $0.019 | −37% |

**Done:** composite index on (team_id, updated_at) (#41), cache for repeat queries (#43), query-plan check in CI (#44)
**Open:** p95 right after a deploy (cold cache) is still 310 ms; owner: <name>
**Next:** review PR #43 · decide the cache TTL (5 vs 15 min)
```
