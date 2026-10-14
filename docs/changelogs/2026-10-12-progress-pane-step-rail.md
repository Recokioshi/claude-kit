# progress-pane: steps hang under their phase on a rail

**Date:** 2026-10-12
**Status:** Completed (0.3.1; 0.3.0 shipped without it in PR #5)

## Summary
In the desktop app, phases and their steps drew at the same level with nothing grouping them,
so the Plan and Overview read as one flat list. Step rows now carry a thin rail in the theme's
ink before the body and sit one level in: on the terminal a `▏` glyph after the ruled margin, on
desktop, VS Code and mobile a one-cell colored bar. Phase rows stay at the margin, so a phase
and its steps read as one block. The highlighter on the doing row starts after the rail, which
keeps its own color.

## Changes
- Modified `mods/progress-pane/hooks/frame.tsx`: `RowSpec.rail` (a color) and `RAIL_CELLS`; the
  terminal row draws the rail after the lead space and gives its body two cells; the
  proportional row draws a 1-wide colored Box and a 1-wide gap before the body.
- Modified `mods/progress-pane/hooks/overview.tsx`: step rows, the "done above" / "+N more" folds
  and loose-agent rows under the phase take the rail in `tones.ink` (Plan and Overview alike).
- Modified `mods/progress-pane/README.md`: the pane example and a line on the rail.
- Modified `mods/progress-pane/tests/register.test.tsx`: the measured Overview rows, the
  no-highlighter row, the fold row, the under-48 row, and the desktop rail Box.
- Regenerated `docs/progress-pane-themes/notebook-drawn.html` (Overview and Plan, both surfaces).

## Testing
- `claude plugin test`: 294 pass, 0 fail. `tsc`: no errors. `claude plugin validate`: passes.
- Looked at the drawn trees rendered in a browser (terminal and desktop); not the live app.

## Next Steps
- None.
