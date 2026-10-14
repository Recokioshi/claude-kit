# Motion preview brief

The gallery page shows each theme's band and pane as a still. It can also play a short loop
of frames, so the person sees the theme's character in motion, not just its resting state.
You write that loop for ONE theme, as `<key>.frames.json` next to `<key>.json`.

## Format

```json
{
  "frames": [
    { "ms": 2400, "label": "at rest" },
    { "ms": 180,  "label": "blink", "pane": { "1": "<the whole line 1, changed>" } },
    { "ms": 2400, "label": "at rest" },
    { "ms": 900,  "label": "gate passes", "band100": "<whole band line>", "band60": "<whole band line>", "pane": { "17": "…", "1": "…" } }
  ]
}
```

- Each frame is a PATCH on the still, not on the previous frame: lines it names are swapped in,
  everything else shows the still. `pane` keys are 0-based indexes into `paneOverview`.
  `band100` / `band60` replace the whole band line. A frame with no patches shows the still.
- Frame 0 MUST be the still itself (no patches), labelled `at rest`, and long (>= 2000 ms).
  The loop returns to it; Pause shows it.
- `ms` is how long that frame is shown (>= 80). `label` is 1-4 words, lower case, naming
  what the person is seeing ("blink", "looks at NEEDS YOU", "B3 done", "gate passes",
  "tail-light breathes"). The page prints it beside the mockup.
- Same markup as the still: `{success} {error} {warning} {claude} {dim} {bold} {accent}
  {accent2} {inverse} {bg2} {italic} {underline}` closed by `{/}`, plus `{#rrggbb}` (a raw
  foreground) and `{bg#rrggbb}` (a raw background) to show what a Raster's 24-bit cells would
  paint (a gradient, a glow ramp). Prefer the named tones: they switch with the Dark/Light
  toggle, raw hex does not. Use raw hex only where the theme's spec really paints graded
  colors, and pick values that read on both the dark and the light palette.
- Every line keeps its budget: band100 <= 100 cells, band60 <= 60, pane lines <= 72, tags not
  counted, width-1 BMP glyphs only. Keep the right column aligned exactly as in the still.

## What the loop shows

Read the theme's `animation` (idea, trigger, cadence, element, staticFrame) and show THAT, true
to its spec, in 4-12 frames, a loop of 6-16 seconds:

1. The idle motion, if the theme has one (a blink, a breath, a sway, a beacon), at its real
   cadence or compressed a little so it is seen within the loop. Rest frames between, so it
   reads as calm, the way it would feel on a real screen.
2. One event, in this theme's own way: pick the one its spec makes most of. Either
   "gate passes" (gate goes ● running → ✓, signals row and band update) or "B3 done"
   (B3 → done with sha c41e7b2, B4 → doing with `opus 0m · Read`, the count 7/18 → 8/18,
   the meter one step on, the phase 2/6 → 3/6, the band's step becomes `B4 Upgrade prompt
   copy`). Keep every number consistent across the band and the pane in that frame.
3. Back to rest. If the event changed the data, the loop may simply cut back to the still.

A theme whose spec says "no idle motion" still gets a loop: show its event (a change is its
motion), with long rests either side.

Restraint is the point: the owner asked for character that is "not too disturbing" in a tool.
No flashing, no frame that recolors the whole pane, no motion in the band's text unless the
spec puts it there. If the spec puts the animated part in a Client or Raster region, animate
only the lines that region covers.

## Check before you finish

Run `node <dir>/check.mjs <key>`: it measures every frame and the still and prints each
violation. Fix until it prints `<key>: ok`.
