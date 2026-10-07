/**
 * handoff: hand work to another session or repository without copy-paste.
 *
 * /handoff [to <repo>] [topic]: gathers the facts itself (branch, uncommitted
 * files, last commits, PR links in the transcript, the active worklog), asks a
 * fork of this conversation for the narrative in six fixed sections (one
 * retry if any is missing, facts-only if the fork cannot answer), writes
 * ~/.claude/handoffs/<repo>/<date-time>-<slug>.md, indexes it, copies it, and
 * opens the pane.
 * /handoff pick [n]: the newest notes from every repo; Insert puts a pointer
 * and the TL;DR into the prompt, Insert full the whole note.
 * session.start: a toast when a note addressed to this repo is waiting.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { assemble, factsOnly, forkPrompt, isFor, missingSections, previewOf, prUrlsIn, sectionsOf, slugOf, splitTo, stampOf } from './note'
import type { Entry, Facts } from './note'
import { drawHandoffs } from './view'
import type { Preview } from './view'

const PANE = 'handoff'
const pane = atom({ plugin: 'handoff', key: 'pane' } as const, { items: [] as Entry[], selected: 0, previews: {} as Record<string, Preview>, repo: '' })

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const run = await $.process.run(['git', ...args], { timeoutMs: 8000 })
    return run.exitCode === 0 ? run.stdout.trim() : null
  } catch {
    return null
  }
}

async function repoOf($: EngineInterface): Promise<{ root: string; name: string }> {
  let root: string
  try {
    root = (await $.session.repo())?.root ?? (await $.session.cwd())
  } catch {
    root = await $.session.cwd()
  }
  return { root, name: root.split('/').filter(Boolean).pop() ?? root }
}

async function gatherFacts($: EngineInterface, root: string, name: string): Promise<Facts> {
  const branch = await git($, ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await git($, ['-C', root, 'status', '--porcelain'])
  const log = await git($, ['-C', root, 'log', '-8', '--format=%h %s'])
  const remote = await git($, ['-C', root, 'remote', 'get-url', 'origin'])
  let prs: string[] = []
  try {
    const messages = await $.session.messages()
    prs = prUrlsIn(messages.map(m => [m.text, ...m.toolUses.map(u => u.text ?? '')].join('\n')).join('\n')).slice(-6)
  } catch {
    prs = []
  }
  let worklog: string | null = null
  try {
    const listed = await $.fs.list(`${root}/plans`)
    for (const e of [...listed].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (!e.name.endsWith('-worklog.md')) continue
      const text = await $.fs.read(`${root}/plans/${e.name}`)
      if (typeof text === 'string' && /^status:\s*active/m.test(text)) {
        const done = (text.match(/^- \[x\]/gm) ?? []).length
        const total = (text.match(/^- \[[ ~x!]\]/gm) ?? []).length
        const doing = (text.match(/^- \[~\] (\S+ .+)$/m)?.[1] ?? '').replace(/ @\S+$/, '')
        worklog = `plans/${e.name} · ${done}/${total} done${doing ? ` · doing ${doing}` : ''}`
        break
      }
    }
  } catch {
    worklog = null
  }
  return {
    repo: name,
    branch,
    dirty: status ? status.split('\n').filter(Boolean).length : 0,
    commits: log ? log.split('\n').filter(Boolean) : [],
    remote: remote ? (remote.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? remote) : null,
    prs,
    worklog,
  }
}

/** Every indexed note, newest first. */
async function entries($: EngineInterface): Promise<Entry[]> {
  const out: Entry[] = []
  try {
    for (const key of await $.store.keys()) {
      if (!key.startsWith('handoff:')) continue
      const value = (await $.store.get(key)) as Entry | undefined
      if (value && typeof value.path === 'string') out.push(value)
    }
  } catch {
    // an unreadable store lists nothing
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

async function loadPane($: EngineInterface): Promise<void> {
  const { name } = await repoOf($)
  const items = await entries($)
  const previews: Record<string, Preview> = {}
  for (const item of items.slice(0, 6)) {
    try {
      const text = await $.fs.read(item.path)
      if (typeof text === 'string') previews[item.id] = previewOf(text)
    } catch {
      previews[item.id] = { tldr: '(file missing)', next: [] }
    }
  }
  await update($, pane, p => ({ ...p, items, previews, repo: name, selected: Math.min(p.selected, Math.max(0, items.length - 1)) }))
}

/** Puts a note into the prompt: a pointer with its TL;DR, or the whole text. */
async function insert($: EngineInterface, item: Entry, isFull: boolean): Promise<void> {
  let text = ''
  try {
    const read = await $.fs.read(item.path)
    text = typeof read === 'string' ? read : ''
  } catch {
    text = ''
  }
  const preview = previewOf(text)
  const fill = isFull
    ? `Continue from this handoff (from ${item.repo}):\n\n${text}\n`
    : `Continue from the handoff in ${item.path} (from ${item.repo}, branch ${item.branch ?? '?'}). Read it first.\nTL;DR: ${preview.tldr}\n`
  await $.prompt.fill({ text: fill, mode: 'insert' })
  const consumed = { ...item, consumedAt: await $.clock.now() }
  await $.store.set(`handoff:${item.id}`, consumed)
}

async function create($: EngineInterface, args: string): Promise<{ text: string }> {
  const { root, name } = await repoOf($)
  const toMatch = /^to\s+(\S+)\s*/i.exec(args)
  const to = toMatch?.[1] ?? null
  const topic = args.slice(toMatch?.[0].length ?? 0).trim()
  const facts = await gatherFacts($, root, name)

  let body = ''
  let target: string | null = to
  let sections: Record<string, string> = {}
  const first = await $.model.fork({ prompt: forkPrompt(topic, facts, to) })
  if (first.isAnswered) {
    body = first.text
    let missing = missingSections(body)
    if (missing.length > 0) {
      const retry = await $.model.fork({ prompt: `${forkPrompt(topic, facts, to)}\n\nYour last answer was missing these sections: ${missing.join(', ')}. Answer again with all six.` })
      if (retry.isAnswered && missingSections(retry.text).length < missing.length) {
        body = retry.text
        missing = missingSections(body)
      }
    }
    const split = splitTo(body)
    target = to ?? split.to
    sections = sectionsOf(split.body)
  }
  if (Object.keys(sections).length === 0) {
    sections = factsOnly(topic)
  }

  const now = await $.clock.now()
  const stamp = stampOf(now)
  const title = topic || (sections['TL;DR'] ?? '').split(/[.\n]/)[0]?.slice(0, 70) || `${name} handoff`
  const home = (await $.env.get('HOME')) ?? root
  const path = `${home}/.claude/handoffs/${name}/${stamp.file}-${slugOf(title)}.md`
  const text = assemble({ title, repo: name, to: target ?? name, branch: facts.branch, created: `${stamp.date} ${stamp.time}` }, facts, sections)
  await $.fs.write(path, text)

  const entry: Entry = { id: `${stamp.file}-${slugOf(title)}`, path, repo: name, to: target ?? name, title, branch: facts.branch, createdAt: now }
  await $.store.set(`handoff:${entry.id}`, entry)

  let copied = false
  try {
    copied = (await $.ui.copy({ text })).isCopied
  } catch {
    copied = false
  }
  await loadPane($)
  await update($, pane, p => ({ ...p, selected: 0 }))
  try {
    await $.ui.open({ id: PANE, title: 'Handoff', rows: 12 })
  } catch {
    // the text answer is enough where nothing draws
  }
  return {
    text: `Handoff for ${entry.to} saved to ${path}${copied ? ' and copied to the clipboard' : ''}.${first.isAnswered ? '' : ' (The narrative could not be generated; the note holds the facts.)'}\nIn the other session: /handoff pick`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'Write a handoff note for another session or repo, or pick one up (handoff)', argumentHint: '[to <repo>] [topic] | pick [n] | list' })
    const { name } = await repoOf($)
    const waiting = (await entries($)).filter(i => i.consumedAt === undefined && i.repo !== name && isFor(i.to, name))
    if (waiting.length > 0) {
      $.ui.toast(`${waiting.length} handoff${waiting.length === 1 ? '' : 's'} waiting from ${waiting[0]?.repo ?? 'another repo'}: /handoff pick`, { timeoutMs: 8000 })
    }
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    const [verb, arg] = args.split(/\s+/)
    if (verb === 'pick' || verb === 'list') {
      await loadPane($)
      const state = await read($, pane)
      const n = Number(arg)
      if (verb === 'pick' && Number.isInteger(n) && n >= 1 && state.items[n - 1]) {
        const item = state.items[n - 1]
        if (item) await insert($, item, false)
        return { text: `Inserted the handoff "${item?.title ?? ''}" into your prompt.` }
      }
      let isPlaced = false
      try {
        isPlaced = (await $.ui.open({ id: PANE, title: 'Handoffs', rows: 12 })).isPlaced
      } catch {
        isPlaced = false
      }
      if (isPlaced) return { text: '' }
      return {
        text: state.items.length === 0
          ? 'No handoffs yet. /handoff writes one.'
          : state.items.slice(0, 8).map((item, i) => `${i + 1}. ${item.repo} → ${item.to} · ${item.title}${item.consumedAt !== undefined ? ' (picked up)' : ''}\n   ${state.previews[item.id]?.tldr ?? ''}`).join('\n') + '\n/handoff pick <n> inserts one.',
      }
    }
    return create($, args)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const state = await read($, pane)
    const now = await $.clock.now()
    const current = state.items[state.selected]
    return drawHandoffs(t, state.items, state.selected, current ? (state.previews[current.id] ?? null) : null, state.repo, now, e.props.bodyColumns ?? e.viewport?.columns ?? 60, {
      select: index => void update($, pane, p => ({ ...p, selected: index })),
      insert: () => {
        if (current) void insert($, current, false).then(() => $.ui.close({ id: PANE }))
      },
      insertFull: () => {
        if (current) void insert($, current, true).then(() => $.ui.close({ id: PANE }))
      },
      copy: () => {
        if (current) void $.fs.read(current.path).then(text => $.ui.copy({ text: typeof text === 'string' ? text : '', surface: e.surface }))
      },
      close: () => void $.ui.close({ id: PANE }),
    })
  })
}
