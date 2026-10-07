# Final report (end of a kickoff run)

Read this when the run is finished. The report is the user's first read on the phone: lead with
the verdict, keep every section short, and cite evidence.

```markdown
**<Verdict in one sentence>**: e.g. "Everything in the plan except the admin dashboard is done on `claude/team-billing`; nothing is pushed."

**Done** (<n>/<m> steps · gate ✓ `<gate>` on the final merge: <suite counts>)
- <phase>: <one line> · <first sha>..<last sha>

**Needs you**
- <decision or action only the user can take, one line each> (or "nothing")

**Rulings** (decisions I made on my own)
- <what> — <why> — <cost if wrong>

**Not verified by hand**
- <what the manual check did not cover>

**Left on your machine**
- <dev servers, simulator state, test data, worktrees kept> (or "nothing; all stopped")

Worklog: `<path>` · next: `/ship` to push and open the PR
```

Rules:
- No section longer than 6 lines. Link to files instead of repeating them.
- Numbers come from the actual output (test counts, shas), never estimated.
- Use ✅/⚠️/❌ only for status, at most one per line.
