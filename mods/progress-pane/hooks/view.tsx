/**
 * progress-pane drawings, in the Notebook theme: the band (one line, its
 * count, step and agents pressable), the pane (Overview / Plan / Log / Agents,
 * one step's or agent's page, Needs you) and the Markdown text form.
 * Pure: element table + data in, tree out. This module is the barrel.
 *
 * Pane glyphs: □ todo · ✎ doing (or ● by the pen setting) · ✓ done ·
 * ! blocked · – skipped · ▸ current phase · ? decision · ~ drift ·
 * ■/□ meter · │ margin line and ┄ rules on `subtle`.
 */
export { bandSegments, drawBand } from './band'
export type { Seg } from './band'
export { ruleParts } from './frame'
export { drawPane } from './pane'
export { askText, currentStepOf, elapsedOf, healthOf, isExpanded, meter, paneMeterCells, shortModel, textOf } from './text'
export type { Answer, BandActions, PaneActions, PaneView, Tab, ViewData } from './view-types'
