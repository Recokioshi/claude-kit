/**
 * The handoff note: what the fork is asked for, how its answer is checked,
 * and the file it becomes. Pure.
 */

export const SECTIONS = ['TL;DR', 'Done', 'Next steps', 'Decisions & constraints', 'For the receiving side', 'Gotchas'] as const

export type Facts = {
  repo: string
  branch: string | null
  dirty: number
  commits: string[]
  remote: string | null
  prs: string[]
  worklog: string | null
}

export type Entry = {
  id: string
  path: string
  repo: string
  to: string
  title: string
  branch: string | null
  createdAt: number
  consumedAt?: number
}

export function forkPrompt(topic: string, facts: Facts, to: string | null): string {
  return [
    'Write a handoff note so another Claude Code session, possibly in another repository, can continue this work without reading this conversation.',
    `First line: \`To: <repository or session the note is for>\`${to ? ` (the user said: ${to})` : ' (this repository if unsure)'}.`,
    'Then exactly these Markdown sections, in this order, and nothing else:',
    '## TL;DR — two lines at most: what this work is and where it stands.',
    '## Done — bullets, each with its evidence (commit sha, PR, file).',
    '## Next steps — numbered, concrete, in the order to do them.',
    '## Decisions & constraints — decisions made, rules the user gave, things not to do.',
    '## For the receiving side — what the other repository or session must do or know; "none" if nothing.',
    '## Gotchas — traps hit in this session; "none" if nothing.',
    'Under 60 lines. No preamble, no closing remarks. Do not invent facts; the facts below are authoritative.',
    '',
    `Topic: ${topic || 'the current work'}`,
    'Facts:',
    factsBlock(facts),
  ].join('\n')
}

export function factsBlock(f: Facts): string {
  const lines = [
    `- repo: ${f.repo}${f.remote ? ` (${f.remote})` : ''}`,
    `- branch: ${f.branch ?? 'unknown'}${f.dirty > 0 ? ` · ${f.dirty} uncommitted ${f.dirty === 1 ? 'file' : 'files'}` : ' · clean'}`,
  ]
  if (f.commits.length) lines.push(`- last commits: ${f.commits.slice(0, 8).join(' | ')}`)
  if (f.prs.length) lines.push(`- PRs mentioned: ${f.prs.join(', ')}`)
  if (f.worklog) lines.push(`- worklog: ${f.worklog}`)
  return lines.join('\n')
}

/** A section's name at the start of a header, any case, then a non-word or the end: `Next steps (for the next session):` is "Next steps". */
function headPattern(section: string): string {
  return `${section.replace(/[.*+?^${}()|[\]\\&;]/g, m => `\\${m}`)}(?![\\w])`
}

/** Sections the answer is missing. */
export function missingSections(text: string): string[] {
  return SECTIONS.filter(s => !new RegExp(`^##\\s+${headPattern(s)}.*$`, 'mi').test(text))
}

/** The `To:` line, and the body without it. */
export function splitTo(text: string): { to: string | null; body: string } {
  const m = /^\s*To:\s*`?([^`\n]+?)`?\s*$/m.exec(text)
  const body = text.replace(/^\s*To:.*$/m, '').trim()
  return { to: m?.[1]?.trim() ?? null, body }
}

/** Keeps only the six sections, in order, whatever the fork wrapped them in. */
export function sectionsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = body.split(/^##\s+/m)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const head = (nl === -1 ? part : part.slice(0, nl)).trim()
    const match = SECTIONS.find(s => new RegExp(`^${headPattern(s)}`, 'i').test(head))
    if (match) out[match] = (nl === -1 ? '' : part.slice(nl + 1)).trim()
  }
  return out
}

export function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'handoff'
}

export function stampOf(ms: number): { date: string; time: string; file: string } {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  return { date, time, file: `${date}-${p(d.getHours())}${p(d.getMinutes())}` }
}

/** The whole note file: front matter, the facts, the six sections. */
export function assemble(meta: { title: string; repo: string; to: string; branch: string | null; created: string }, facts: Facts, sections: Record<string, string>): string {
  const out = [
    '---',
    'handoff: 1',
    `title: ${meta.title}`,
    `from: ${meta.repo}`,
    `to: ${meta.to}`,
    meta.branch ? `branch: ${meta.branch}` : null,
    `created: ${meta.created}`,
    '---',
    '',
    `# ${meta.title}`,
    '',
    '## State (facts)',
    factsBlock(facts),
    '',
  ].filter((l): l is string => l !== null)
  for (const s of SECTIONS) {
    out.push(`## ${s}`, sections[s]?.trim() || 'none', '')
  }
  return out.join('\n')
}

/** A note built from the facts alone, when the fork could not answer. */
export function factsOnly(topic: string): Record<string, string> {
  return {
    'TL;DR': `${topic || 'Work in progress'}. The narrative could not be generated; see State (facts).`,
    Done: 'see the last commits above',
    'Next steps': '1. Read the State section and the worklog, then continue.',
    'Decisions & constraints': 'none recorded',
    'For the receiving side': 'none',
    Gotchas: 'none',
  }
}

/** TL;DR and the first next steps, for the preview. */
export function previewOf(text: string): { tldr: string; next: string[]; to: string | null } {
  const s = sectionsOf(text.replace(/^---[\s\S]*?\n---\n/, ''))
  const to = /^to:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null
  const next = (s['Next steps'] ?? '').split('\n').map(l => l.replace(/^\s*(\d+[.)]|-)\s*/, '').trim()).filter(Boolean).slice(0, 3)
  return { tldr: (s['TL;DR'] ?? '').replace(/\s+/g, ' ').trim(), next, to }
}

/** github.com/<owner>/<repo>/pull/<n> links in a text. */
export function prUrlsIn(text: string): string[] {
  return [...new Set(text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g) ?? [])]
}

/** "14:02", "Tue", "Sep 28". */
export function whenOf(ms: number, now: number): string {
  const d = new Date(ms)
  if (now - ms < 20 * 60 * 60_000) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (now - ms < 6 * 24 * 60 * 60_000) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] ?? ''
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`
}

/** Whether a note's `to` names this repository. */
export function isFor(to: string, repo: string): boolean {
  return to.trim().toLowerCase().replace(/^.*\//, '') === repo.trim().toLowerCase()
}
