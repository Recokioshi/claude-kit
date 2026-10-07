/**
 * Shell reading for git-gate: enough of POSIX shell syntax to find every git
 * and gh invocation in a Bash command, including ones hidden behind chains,
 * control keywords, redirects, wrappers, `cd`, subshells, heredocs,
 * `bash -c`, `eval` and command substitution.
 *
 * It is a safety net, not a parser of the whole language: anything it cannot
 * read with confidence is reported as `opaque`, and the policy treats that as
 * needing the strongest grant.
 */

/** One simple command: its words after wrappers and assignments are stripped. */
export type Invocation = {
  /** The program, path-stripped (`/usr/bin/git` → `git`). */
  program: string
  /** Its arguments, quotes removed. */
  args: string[]
  /** The text it came from, for messages. */
  raw: string
  /** Where an earlier `cd`/`pushd` on the line moved to; null = the session folder. */
  dir: string | null
  /** The branch an earlier `git checkout/switch` on the line moved to, in that folder. */
  branch: string | null
}

export type ShellReading = {
  invocations: Invocation[]
  /** Constructs that hide commands this reader cannot see into. */
  opaque: string[]
}

const MAX_DEPTH = 3

/** Index just past the end of a heredoc body that starts after `from` (the `<<` operator's line end). */
function skipHeredoc(command: string, opAt: number): { bodyStart: number; end: number } | null {
  const m = /^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(command.slice(opAt))
  if (!m) return null
  const delimiter = m[3] ?? ''
  const allowTabs = m[1] === '-'
  const lineEnd = command.indexOf('\n', opAt)
  if (lineEnd === -1) return { bodyStart: command.length, end: command.length }
  let pos = lineEnd + 1
  while (pos <= command.length) {
    const next = command.indexOf('\n', pos)
    const line = command.slice(pos, next === -1 ? command.length : next)
    if ((allowTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
      return { bodyStart: lineEnd + 1, end: next === -1 ? command.length : next }
    }
    if (next === -1) break
    pos = next + 1
  }
  return { bodyStart: lineEnd + 1, end: command.length }
}

/**
 * Splits a command line into simple commands on `&&`, `||`, `;`, `|`, `&`
 * and newlines that sit outside quotes and heredoc bodies, collecting
 * `$( … )` and backtick bodies so they are read too.
 */
export function splitTopLevel(command: string): { parts: string[]; substitutions: string[] } {
  const parts: string[] = []
  const substitutions: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  /** Heredocs opened on the current line, skipped when the line ends. */
  let pendingHeredocs: number[] = []
  let i = 0

  const flush = () => {
    if (current.trim() !== '') parts.push(current.trim())
    current = ''
  }

  while (i < command.length) {
    const ch = command[i] ?? ''
    const next = command[i + 1] ?? ''

    if (quote === "'") {
      current += ch
      if (ch === "'") quote = null
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + next
      i += 2
      continue
    }
    if (ch === '$' && next === '(' && command[i + 2] !== '(') {
      const end = matchParen(command, i + 1)
      substitutions.push(command.slice(i + 2, end))
      current += command.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1)
      const stop = end === -1 ? command.length : end
      substitutions.push(command.slice(i + 1, stop))
      current += command.slice(i, stop + 1)
      i = stop + 1
      continue
    }
    if (quote === '"') {
      current += ch
      if (ch === '"') quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      i += 1
      continue
    }
    if (ch === '<' && next === '<' && command[i + 2] !== '<') {
      // A heredoc: its body is data, never commands.
      pendingHeredocs.push(i)
      current += '<<'
      i += 2
      continue
    }
    if (ch === '\n' && pendingHeredocs.length > 0) {
      let end = i
      for (const at of pendingHeredocs) {
        const skipped = skipHeredoc(command, at)
        if (skipped) end = Math.max(end, skipped.end)
      }
      pendingHeredocs = []
      flush()
      i = end + 1
      continue
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      flush()
      i += 2
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '|') {
      flush()
      i += 1
      continue
    }
    // A lone & ends a background command; &> and >& are redirects.
    if (ch === '&' && next !== '>' && command[i - 1] !== '>') {
      flush()
      i += 1
      continue
    }
    current += ch
    i += 1
  }

  flush()
  return { parts, substitutions }
}

/** The index of the `)` closing the `(` at `open`, honouring quotes. */
function matchParen(text: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote !== null) {
      if (ch === '\\' && quote === '"') {
        i += 1
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return text.length
}

/** Splits one simple command into words, honouring quotes and escapes. */
export function tokenize(text: string): string[] {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|((?:[^\s"'\\]|\\.)+)/g
  let word = ''
  let lastEnd = -1
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    const piece = m[1] !== undefined
      ? m[1].replace(/\\(.)/g, '$1')
      : m[2] !== undefined
        ? m[2]
        : (m[3] ?? '').replace(/\\(.)/g, '$1')
    // Adjacent pieces (`--base="x"`, `g''it`) form one word.
    if (m.index === lastEnd) {
      word += piece
    } else {
      if (lastEnd !== -1) words.push(word)
      word = piece
    }
    lastEnd = m.index + m[0].length
  }
  if (lastEnd !== -1) words.push(word)
  return words
}

const PREFIXES = new Set(['command', 'exec', 'nohup', 'time', 'then', 'do', 'else', '!', 'builtin', 'noglob', 'if', 'elif', 'while', 'until', '{', '('])
const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])
/** A redirection word: `>file`, `2>&1`, `&>out`, `<in`, `>>log`. */
const REDIRECT = /^(?:\d*>>?|&>>?|\d*<|\d*>&|<&)\S*$/

/** Drops leading assignments, redirects, keywords and wrappers: `if env A=1 sudo nice git` → `git`. */
export function unwrap(words: string[]): string[] {
  const w = [...words]
  let changed = true

  while (changed && w.length > 0) {
    changed = false
    const first = w[0] ?? ''

    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || REDIRECT.test(first)) {
      w.shift()
      // `> file` with a space: the file is the next word.
      if (/^(?:\d*>>?|&>>?|\d*<)$/.test(first)) w.shift()
      changed = true
      continue
    }
    if (PREFIXES.has(first)) {
      w.shift()
      if (first === 'command') {
        while (w.length > 0 && /^-[pvV]+$/.test(w[0] ?? '')) w.shift()
      }
      changed = true
      continue
    }
    if (first === 'env') {
      w.shift()
      while (w.length > 0 && ((w[0] ?? '').startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0] ?? ''))) {
        const opt = w.shift() ?? ''
        if (opt === '-u' || opt === '-C' || opt === '-S') w.shift()
      }
      changed = true
      continue
    }
    if (first === 'sudo' || first === 'doas') {
      w.shift()
      while (w.length > 0 && (w[0] ?? '').startsWith('-')) {
        const opt = w.shift() ?? ''
        if (SUDO_VALUE_OPTIONS.has(opt)) w.shift()
      }
      changed = true
      continue
    }
    if (first === 'nice') {
      w.shift()
      if (w[0] === '-n') w.splice(0, 2)
      else if (/^-\d+$/.test(w[0] ?? '')) w.shift()
      changed = true
      continue
    }
    if (first === 'timeout' || first === 'gtimeout') {
      w.shift()
      while (w.length > 0 && (w[0] ?? '').startsWith('-')) {
        const opt = w.shift() ?? ''
        if (opt === '-s' || opt === '-k' || opt === '--signal' || opt === '--kill-after') w.shift()
      }
      w.shift() // the duration
      changed = true
      continue
    }
    if (first === 'xargs' || first === 'stdbuf' || first === 'caffeinate') {
      w.shift()
      while (w.length > 0 && (w[0] ?? '').startsWith('-')) {
        const opt = w.shift() ?? ''
        if (first === 'xargs' && /^-[IEdLnPs]$/.test(opt)) w.shift()
        if (first === 'caffeinate' && /^-[tw]$/.test(opt)) w.shift()
      }
      changed = true
      continue
    }
  }

  return w
}

/**
 * Reads a whole Bash command into the simple commands it runs, recursing into
 * `bash -c '…'`, `eval '…'`, `$( … )` and backticks.
 */
export function readShell(command: string, depth = 0, startDir: string | null = null): ShellReading {
  const invocations: Invocation[] = []
  const opaque: string[] = []
  let dir = startDir
  let branch: string | null = null

  if (depth > MAX_DEPTH) return { invocations, opaque: ['nesting too deep'] }

  const { parts, substitutions } = splitTopLevel(command)

  for (const sub of substitutions) {
    const inner = readShell(sub, depth + 1, dir)
    invocations.push(...inner.invocations)
    opaque.push(...inner.opaque)
  }

  for (const part of parts) {
    const stripped = part.replace(/^[({\s]+/, '').replace(/[)}\s]+$/, '')
    const words = unwrap(tokenize(stripped))
    const head = words[0]
    if (head === undefined) continue
    const program = head.replace(/^\\/, '').split('/').pop() ?? head

    if (program === 'cd' || program === 'pushd') {
      dir = joinDir(dir, words[1])
      branch = null
      continue
    }

    if (SHELLS.has(program)) {
      const flagIndex = words.findIndex((w, i) => i > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w))
      const script = flagIndex === -1 ? undefined : words[flagIndex + 1]
      if (script !== undefined) {
        const inner = readShell(script, depth + 1, dir)
        invocations.push(...inner.invocations)
        opaque.push(...inner.opaque)
      }
      // `bash script.sh`: the script's body is not visible here. Scripts are
      // the user's own tooling, so they are not gated (see README: limits).
      continue
    }

    if (program === 'eval') {
      const inner = readShell(words.slice(1).join(' '), depth + 1, dir)
      invocations.push(...inner.invocations)
      opaque.push(...inner.opaque)
      continue
    }

    invocations.push({ program, args: words.slice(1), raw: part, dir, branch })

    // `git checkout main && git merge x` merges into main: remember the switch.
    if (program === 'git') {
      const switched = switchedBranch(words.slice(1))
      if (switched !== null) branch = switched
    }
  }

  return { invocations, opaque }
}

/** The branch a `git checkout <b>` / `git switch <b>` (or `-b/-c <new>`) moves to, else null. */
function switchedBranch(args: string[]): string | null {
  let i = 0
  while (i < args.length && (args[i] ?? '').startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  if (sub !== 'checkout' && sub !== 'switch') return null
  const rest = args.slice(i + 1)
  if (rest.includes('--')) return null
  const create = rest.findIndex(a => /^-[bBcC]$/.test(a))
  if (create !== -1) return rest[create + 1] ?? null
  const positional = rest.filter(a => !a.startsWith('-'))
  return positional.length === 1 && positional[0] !== '.' ? (positional[0] ?? null) : null
}

/** The folder a `cd arg` moves to from `dir` (null = the session folder). */
export function joinDir(dir: string | null, arg: string | undefined): string | null {
  if (arg === undefined || arg === '~' || arg === '-') {
    return arg ?? '~'
  }
  if (arg.startsWith('/') || arg.startsWith('~/') || arg.startsWith('$')) {
    return arg
  }
  return dir ? `${dir}/${arg}` : arg
}
