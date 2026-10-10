# progress-pane themes

Ten visual directions for the progress-pane mod's band and pane. Each one is drawn with the
same sample run, so they compare one to one, and each plays a short loop of its motion.
`index.html` is the gallery. Open it in a browser; it needs no server.

The owner picked Notebook, which progress-pane 0.3 draws. Two more pages show the result:

- `notebook-drawn.html`: the trees the mod itself returns for a sample run with five subagents,
  captured from its test harness and rendered (terminal and desktop). A snapshot, not live.
- `companions/companions.html`: every companion (model family × effort, and the poses) as the
  terminal and the desktop draw it. Rebuild with `node docs/progress-pane-themes/companions/build.mjs`.

| File | What it is |
|---|---|
| `index.html` | The gallery, built from the files below |
| `<theme>.json` | One theme: band at 100 and 60 columns, the overview pane at 72, palettes, glyphs, spacing rhythm, motion, other surfaces, feasibility, what changes in `view.tsx` |
| `<theme>.frames.json` | That theme's motion loop: patches on the still, frame by frame |
| `current.json` | What 0.2.1 draws today, as the baseline |
| `judge.json` | A judge's scores after comparing all ten, and the pairs it found too close |
| `separations*.json` | What changed in the six themes revised after that judgement |
| `BRIEF.md`, `MOTION.md` | The briefs the designs and the loops were made from (engine limits, sample data, markup) |
| `check.mjs`, `build.mjs`, `template.html` | The width checker, the gallery build, and its page |

The themes are typeset, console, notebook, companion, neon (Night Drive), transit,
blueprint, brutalist, garden and departure.

To check a theme after editing it, then rebuild the gallery:

```bash
node docs/progress-pane-themes/check.mjs transit
node docs/progress-pane-themes/build.mjs docs/progress-pane-themes/index.html
```

Markup in the mockups: `{tone}…{/}` colors a run (`success`, `warning`, `error`, `claude`, `dim`,
`bold`, `accent`, `accent2`, `inverse`, `bg2`), and `{#rrggbb}` or `{bg#rrggbb}` stands for a
24-bit Raster cell. Tags take no cells. Every line is measured against its budget by `check.mjs`.
