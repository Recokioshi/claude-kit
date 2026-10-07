# One-page meeting summary (HTML artifact)

Publish it as an Artifact (load the artifact-design skill first). If artifacts are not
available, write the same structure in Markdown. One screen, no scrolling on a laptop.

Structure, top to bottom:
1. **Headline band:** project · date · one-line verdict · status chip (on track / at risk / blocked).
2. **3–4 KPI tiles:** the metrics the meeting decides on. Improvement: value, unit, the best previous value and the delta (green or red). Build: properties of the thing made (what it covers, cost to run, setup), no invented "before", and never process counts (tests, findings, fix rounds).
3. **One chart only if it carries the decision.** Load the dataviz skill before drawing it. Typical: latency per endpoint, or cost per run.
4. **Two columns:** "Done since last time" (≤ 5 bullets with refs) | "Decisions needed" (≤ 3, each with options).
5. **Footer:** sources (PRs, run folders, docs) in small text.

Rules: one accent color, no decoration, readable in light and dark mode, every number traceable
to a source in the footer.
