# progress-pane theme brief (shared by every design agent)

You are designing ONE visual theme for `progress-pane`, a Claude Code mod in
`/Users/adriangaik/claude-kit/mods/progress-pane`. Read `README.md` there (the "What you see"
section) and `hooks/view.tsx` (the current drawing) before designing. The owner's complaint
about the current look, verbatim:

> it looks kind of boring and basic. Starting from the elements being close to each other,
> kind of blended on into another, not aligned nicely, the spacing between elements are
> meaningless. But not only that - it's dull. Above the chat input, claude has a small creature
> sitting there and looking at the user, doing silly things sometimes. The ultracode slider
> changes the vibe completely to some cybernetic pixel animation. Add some character to this
> mod. Keep them polished, refined, well thought and visually aesthetic, interesting and
> appealing, but also not too disturbing. It can be fun, but still - it's only a tool.

So: SPACING AND ALIGNMENT FIRST (a stated rhythm: section gaps, gutters, an aligned right
column), then CHARACTER (a theme with a point of view), never at the cost of legibility.
It is a tool the person glances at a hundred times a day.

## What the mod draws (two sites)

1. **The band**: ONE line above the prompt, sized to the terminal width. Shown while a worklog
   is active. Parts: health glyph · done/total · a 10-cell meter · current step id+title ·
   agents · gate · last commit · elapsed · and pinned right: `? n` decisions, `! n` blockers,
   `~ n` noticed drift. Segments drop as the width narrows (bar → git → agents → gate); the step
   title truncates, never drops. The band must stay ONE row.
2. **The pane** (`/progress`): Overview (header, NEEDS YOU / NOTICED, PLAN of the current phase
   with folded done phases as chips, SIGNALS: gate, git, ctx/cost, then a footer of tab
   buttons), Plan tab, Log tab, step details, Needs-you tab. Design the OVERVIEW fully and say
   in a sentence how the other tabs follow.

## What the engine can draw (hard constraints; the critic will check them)

- Elements: `Box` (flex layout: row/column, gap, padding, margin, width, flexGrow, borders,
  `backgroundColor`), `Text` (`color`, `backgroundColor`, `dimColor`, `bold`, `italic`,
  `underline`, `strikethrough`, `inverse`, `wrap`), `Button` (`plain` or `[ label ]`, hotkey,
  `variant="primary"`; may hold strings and `Text` chips), `Input`/`Select` (not on mobile),
  `Markdown`, `Code`, `Link`.
- `Box.borderStyle` ONLY one of: single, double, round, bold, singleDouble, doubleSingle,
  classic, arrow, dashed, quote. Border takes a full row top and bottom and a column each side.
- Colors: theme keys that follow the person's light/dark theme — `text`, `inactive`, `subtle`,
  `suggestion`, `remember`, `success`, `error`, `warning`, `merged`, `claude` (the Claude
  orange/terracotta accent), `permission`, `planMode`, `autoAccept`, `promptBorder`,
  `bashBorder`, `ide`, `diffAdded`, `diffRemoved` — OR any raw hex `#rrggbb` (hex ignores the
  person's theme, so hex is for personality accents; semantic meaning stays on theme keys so it
  reads on both dark and light terminals).
- Terminal: monospace cell grid. Glyphs must be width-1 BMP characters (box drawing, blocks
  ▁▂▃▄▅▆▇█ ░▒▓, braille ⠁⠿, geometric ○●◐◑◒◓◔◕◯◉◎▶▷►▸▹▪▫■□◆◇◈, arrows, ─━│┃┄┅┆┇┈┉╌╍, ╭╮╰╯,
  ·•∙⋅, ✓✗✦✧★☆⚑⚐ etc). NO emoji, NO double-width CJK, NO combining marks.
- Terminal ONLY: `Raster` (a fixed grid of cells, each a glyph with 24-bit fg/bg; repainted at
  up to ~60 fps by `$.ui.blit` without a re-render) and `Image` (kitty graphics protocol, a
  real picture, only in kitty/Ghostty; shows its alt text elsewhere).
- Desktop app, VS Code and mobile (Remote Control): draw with a PROPORTIONAL font. A row of
  `────` sized to columns wraps there, so the current code draws sections as a bold dim label
  with a gap above instead of a rule. Alignment by padding-with-spaces does NOT hold there.
  They have `Svg` (static, or `isInteractive` for CSS/SMIL animation), never `Raster`.
- `Client` (terminal and desktop only): a region drawn by a surface module with its own local
  state, `every(ms, fn)` frame timer, pointer and key listeners. This is how a small living
  thing (a creature, a sparkline that breathes) is done without re-rendering the whole tree.
- A redraw of the tree happens when state changes (`update($, atom, …)`); a timer in the hooks
  module (`$.clock.every`) can tick state at a low cadence (seconds), not per frame.
- Hover: a keyed `Box` can carry `hover` style overrides (color, background, border) and reveal
  an absolutely positioned card; no hook runs for it.
- Buttons are the only pressable things. The count, step, `? n` counts, phase headers, step
  rows and tab labels are Buttons today.

## The sample data (identical for every theme; the mockup MUST use exactly this)

- Title: **Add team billing** · branch `claude/team-billing` · gate `npm run dod`
- Started 3h12m ago · 7 of 18 steps done · health: `!` (one decision waits on the person)
- Phases: A API (done, 5/5) · **B UI (current, 2/6)** · C Docs (todo, 0/7)
- Phase B steps:
  - B1 Hide billing tab — done · 3f2a1bc
  - B2 Plan picker — done · 9e1d0aa
  - B3 Seat limit checks — DOING · agent opus, 6m, last tool Edit
  - B4 Upgrade prompt copy — todo
  - B5 Invoice history list — todo
  - B6 Empty states — todo
- Agents running: 2 (opus on B3 for 6m; sonnet "B5 scaffold list" for 1m)
- Gate: ✓ passed 4m ago, took 52s · git: 9e1d0aa 2m ago, 6 commits today · ctx 61% · $4.10
- Needs you: `? D1 Bill per seat or per workspace?` (options: per seat / per workspace;
  recommend: per seat; blocks B4; why: "B4 copy names the unit; per seat also needs a seat
  count from the API")
- Noticed (drift): `~ 3m  commit 3f2a1bc not linked to a step`
- Band counts at the right: `? 1` and `~ 1` (no blockers, so no `! n`)
- Log (newest first): `16:40 B2 done: picker reads plans from the API; dod ✓` ·
  `16:05 Ruling: kept old subscription rows — reversible — cost if wrong: one cleanup migration`
  · `15:02 started phase B on claude/tb-b`

## Mockup markup (so the page can color it)

Write the band and pane as literal monospace lines. Color a run with `{tone}…{/}` where tone
is one of: `success error warning claude dim bold accent accent2 inverse bg2` (accent/accent2
are your theme's hex accents; bg2 a subtle background band; dim = dimColor; bold = bold).
Tags nest one level at most and do not count toward the column width. Example:
`{error}{bold}!{/}{/} {bold}7/18{/} {success}━━━━{/}{dim}──────{/}  B3 Seat limit checks`

Column budget: `band100` ≤ 100 cells, `band60` ≤ 60 cells (segments dropped as the code does),
every `paneOverview` line ≤ 72 cells, at most 26 lines. Count cells carefully; the critic will.
Blank lines are part of the design: use them deliberately.

## What "polished, not disturbing" means here

- One idea per theme, carried through band, pane, glyph set, and the empty/finished states.
- Animation, if any, is idle-aware (a few frames per second at most, slower when the person
  is typing, static on mobile/VS Code), lives in a small fixed region (a Client or a Raster,
  never the band's text), and has a static frame that is good on its own. Say what the
  trigger is (a gate passing, a step done, a question raised) and what rests.
- Semantic colors keep their meaning across themes: success/warning/error are never swapped.
- The right column of a row (sha, agent, time) is aligned across rows; sections have the same
  gap; labels share one width; nothing runs into its neighbour.
- It must still read on a light terminal theme. Hex accents must have an answer for light.
