/**
 * The contract between the hooks module and the drawings: what a drawing is
 * handed (ViewData, PaneView), what it can ask for (actions), and the
 * Notebook theme's colors as the hooks module resolved them for this session.
 */
import type { Drift, Facts } from './observe'
import type { Worklog } from './worklog'

export type Answer = { id: string; question: string; answer: string; at: number; isDelivered: boolean }

/**
 * Notebook's colors for this session. `ink` is a hex that reads on the
 * person's terminal theme; `highlighter` is the doing row's background, or
 * null when the theme is unknown (bold and the pen then mark the row alone).
 */
export type Tones = { ink: string; highlighter: string | null; pen: '✎' | '●' }

export const DEFAULT_TONES: Tones = { ink: '#5b84d6', highlighter: null, pen: '✎' }

export type ViewData = {
  doc: Worklog
  path: string
  facts: Facts
  drift: Drift[]
  now: number
  startedMs: number | null
  /** When each step went to doing / done, as the mod saw it. */
  startedAt: Record<string, number>
  doneAt: Record<string, number>
  /** Answers given in the pane: delivered to Claude, or still on their way. */
  answered: Answer[]
  tones: Tones
}

export type Tab = 'overview' | 'plan' | 'log' | 'step' | 'needs' | 'agents' | 'agent'
export type Back = 'overview' | 'plan' | 'agents'
/** What the pane shows: a tab, one step (`step`) or one subagent (`agent`), reached from `back`. */
export type PaneView = { tab: Tab; step?: string; agent?: string; back?: Back; expanded: Record<string, boolean> }

export type PaneActions = {
  tab: (tab: 'overview' | 'plan' | 'log' | 'agents') => void
  file: () => void
  close: () => void
  openStep: (id: string, back: Back) => void
  /** One subagent's page: its companion, progress, figures and log. */
  openAgent: (id: string, back: Back) => void
  togglePhase: (key: string) => void
  back: () => void
  /** To the previous (-1) or next (+1) step in plan order, or agent in the roster. */
  move: (delta: number) => void
  openNeeds: () => void
  /** Sends the person's answer to a decision or blocker to Claude. */
  answer: (id: string, text: string) => void
  /** Where the surface has no text field: puts `D1: ` in the prompt box instead. */
  replyInChat: (id: string) => void
}

export type BandActions = { openPlan: () => void; openStep: (id: string) => void; openNeeds: () => void; openAgents: () => void }

/** Notebook's ink and highlighter for each kind of terminal theme. */
const DARK_TONES = { ink: '#8db4f0', highlighter: '#3a3418' }
const LIGHT_TONES = { ink: '#2d55c4', highlighter: '#fff2a8' }

/**
 * Notebook's colors for the person's `theme` setting: a value naming light
 * picks the light pair, any other value the dark pair, and no value at all
 * the mid-tone ink with no highlighter. `pen` is the glyph setting.
 */
export function tonesOf(theme: unknown, pen: unknown): Tones {
  const glyph = pen === '●' ? '●' : '✎'
  if (typeof theme !== 'string' || theme.trim() === '') return { ...DEFAULT_TONES, pen: glyph }
  return { ...(/light/i.test(theme) ? LIGHT_TONES : DARK_TONES), pen: glyph }
}
