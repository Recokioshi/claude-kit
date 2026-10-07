---
name: report
description: Use when the user asks for a status report, progress update or summary meant for other people — "a short report for the Slack/Teams channel", "a single Teams message", "something visual for the meeting", "slides for the client", "summarize where the search work stands", "how did the run go". Produces scannable, visual, evidence-backed reports. Not for code review, commit messages, PR descriptions or changelogs.
argument-hint: "[teams | meeting | deck | chat] [topic or since <date>]"
allowed-tools: Bash(git log:*), Bash(git branch:*), Bash(git status:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(ls:*), Bash(cat:*)
---

# Report

Format: **$0** (if empty, infer it: Slack/Teams/channel → `teams`, meeting/client/visual → `meeting`, slides/deck → `deck`, end of a task → `chat`) · topic: $ARGUMENTS

## First: what was the task? (it decides what the report is about)
| Task | The report is about | Not in the report |
|---|---|---|
| **Build**: create a feature, skill, tool, doc, pipeline | **the thing made**: what each part does for its user, how it is used, its footprint (cost, size, tokens, setup) and its limits | how it was made: test counts, review findings, validation passes, fix rounds, retries |
| **Improve**: fix, review, refine, optimize, measure, compare | **the change**: before → after on the metrics that moved, what was found and fixed | — process numbers *are* the result here |

In a **build** report, a process fact goes in only when it changed the result, and then it is
written as that change, under **Open**: "scope cut: X left out", "behaves differently than
asked: Y", "known problem not fixed: Z". "Fixed 36 review findings" or "309 tests pass" is not
a result of a build; it is how the result was reached.

## What makes it readable (the user rejects anything else)
1. **The answer first.** The first line is the verdict ("Search p95 latency 420 ms → 180 ms, ready for review").
2. **Visual, not prose.** One table or a short list per section, ✅/⚠️/❌ for status, no paragraph over 3 lines.
3. **Numbers with units.** When there is a baseline (an improvement), use one: the best previous result only (never every earlier run), and the delta. A build has no "before"; don't invent one.
4. **Evidence for every claim**: a commit sha, PR number, run folder or file, taken from real output, never from memory. Evidence is a short ref next to the claim, not a table row of its own.
5. **Facts and judgment kept apart**: what happened, then a separate "Recommendation" or "Next" line.
6. **Only what the reader needs.** Leave out internal steps, retries and tool names. "Excluding the one outlier customer"-style caveats go in only when the reader would decide differently because of them.

## Gather (read-only, before writing)
- Worklog: !`ls -t plans/*-worklog.md docs/*worklog*.md docs/*progress*.md 2>/dev/null | head -3 || true`
- Recent commits: !`git log --since="7 days ago" --oneline 2>/dev/null | head -20 || true`
- Recently merged PRs: !`gh pr list --state merged --limit 8 --json number,title,mergedAt 2>/dev/null || true`
- Then read what the topic needs: the worklog, analysis docs, run folders, benchmark or score files, changelogs.
- Ask the user only for what you can't find (e.g. the audience, if the format doesn't say).

## Write, using the template for the format
| Format | Template | Output |
|---|---|---|
| `teams` | [references/teams.md](references/teams.md) | one Teams/Slack message to paste, ≤ 15 lines |
| `meeting` | [references/meeting.md](references/meeting.md) | one-page HTML artifact (or Markdown if no artifacts) |
| `deck` | [references/deck.md](references/deck.md) | 5–7 slide outline, then the pptx/slides skill |
| `chat` | [references/chat.md](references/chat.md) | end-of-task report in the conversation |

Read only the template you need.

## Check before sending (30-second test)
- Could a reader who skims only the bold text and the table give the verdict back? If not, rewrite the first line.
- Build report: does every table row describe the thing made (what it does, how it's used, what it costs)? Delete rows about the making of it.
- Every number has a unit; an improvement's baseline is the best previous result.
- Every ✅ has evidence; every ⚠️/❌ says what happens next.
- No sentence explains how Claude worked.

## Gotchas
- Teams renders Markdown tables in messages, but not nested lists or headings above `###`. Keep it flat.
- Slack doesn't render Markdown tables in messages: put the table in a code block, or use a short list.
- No customer data (names, ids, emails) in reports. Talk about fields, counts and rates.
- Match the channel's language; transcreate, never translate literally.
