# End-of-task report (in the conversation)

```markdown
**<Verdict>**: <branch/PR state, e.g. "done on `claude/x`, nothing pushed">

✅ **Done** (<n>/<m> · gate ✓ <command>: <counts>)
- <item> · <sha or PR>

⚠️ **Needs you**
- <decision or action> (or "nothing")

**Rulings** (my own calls)
- <what> — <why> — <cost if wrong>

**Not verified by hand:** <list or "none">
**Left running:** <servers, simulators, test data> (or "nothing")
**Next:** <one line, e.g. "/ship to open the PR">
```

Rules: ≤ 25 lines; every section optional except the verdict; links to files instead of
repeating their content. **Done** lists what was made or changed and what it does; the gate
line is the only process detail, as evidence. Review rounds, retries and fixes made on the way
appear only when they changed the result.
