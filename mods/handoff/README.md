# handoff

Hand work to another session or repo without copy-paste. This replaces the "the agent on web
finished… I will paste its report below" routine.

Tested with Claude Code 2.1.289.

## Writing one: `/handoff [to <repo>] [topic]`
```
/handoff to web consent copy
```
1. **Facts it gathers itself:**
   - branch and uncommitted files;
   - last 8 commits;
   - the remote;
   - PR links mentioned in this conversation;
   - the active worklog (title, progress, the step in progress).
2. **The narrative:** a fork of this conversation (cache-cheap, it reuses the prompt cache)
   writes six fixed sections. The facts are given to it as authoritative.
   ```
   ## TL;DR  ## Done  ## Next steps  ## Decisions & constraints
   ## For the receiving side  ## Gotchas
   ```
   If a section is missing, it is asked once more. If it can't answer at all, the note still
   holds the facts.
3. **Saved** to `~/.claude/handoffs/<repo>/<date-time>-<slug>.md`, outside the repo: readable
   from any session, never committed by accident.
4. **Indexed**, **copied to the clipboard**, and shown in the pane.

## Picking one up: `/handoff pick`
```
 HANDOFFS · newest first                 1 for web
 1: ▶ 14:02  api → web              consent copy
 2:   Tue    mobile → api           cost table format
 ── 1 · claude/consent ─────────────────────────────────
 TL;DR  Consent copy and the error-report checkbox are done…
 Next   1 Update the privacy sentence · 2 Open a PR to master
 i: Insert   f: Insert full   c: Copy   x: Close
```
- **Insert** puts a pointer with the TL;DR into your prompt ("Continue from the handoff in
  <path>… Read it first"), so the other session reads the file instead of a paste.
- **Insert full** inserts the whole note.
- Text forms: `/handoff list`, `/handoff pick 2`.
- **A note addressed to this repo shows a toast when the session starts:**
  "1 handoff waiting from api: /handoff pick".
- Picked-up notes are dimmed.

## Notes
- `to` comes from `/handoff to <repo>`, or from the fork's own `To:` line. It defaults to this
  repo.
- It works on the phone (buttons only). Where nothing draws, every command answers in text.
