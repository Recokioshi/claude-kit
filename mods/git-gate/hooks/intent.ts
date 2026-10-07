/**
 * What git work a person's words allow. Pure: no `$`.
 *
 * Reads English and Polish, the way the user writes: "commit and create a PR
 * to master, don't merge it yet", "zmerguj do schema-v2/main", "yes", "dawaj".
 * A negated verb ("don't merge") is a denial that beats every grant.
 */

export const GRANTS = ['commit', 'merge', 'push', 'pr', 'force', 'discard', 'branch-delete', 'worktree-remove', 'stash'] as const
export type Grant = (typeof GRANTS)[number]

export type Intent = {
  grants: Grant[]
  denies: Grant[]
  /** Branches named as merge targets ("merge to schema-v2/main"). */
  mergeTargets: string[]
  /** "continue", "go on", "dalej": keeps the grants already in force. */
  isContinuation: boolean
  /** "yes", "ok", "do it", "tak": also takes what Claude proposed. */
  isAffirmation: boolean
  /** `/ship [mode]` */
  ship?: ShipMode
  /** `/kickoff …` */
  isKickoff: boolean
}

export type ShipMode = 'commit' | 'push' | 'pr' | 'merge'

type Verb = { grant: Grant; re: RegExp }

/** Each grant's words; the regexes run on lower-cased text with paths and code spans removed. */
const VERBS: Verb[] = [
  { grant: 'commit', re: /\b(?:re)?commit(?:s|ted|ting|uj|nij)?\b|\b(?:za|s|z)(?:commit|komit|kommit)\w*/g },
  { grant: 'push', re: /\bpush(?:es|ed|ing)?\b(?![\s-]+notif)|\b(?:wy|s|za)?push(?:uj|nij|ować|owac)\b|\bwypchnij\b/g },
  { grant: 'pr', re: /\b(?:create|open|make|raise|submit|file|prepare|send|draft|utwórz|utworz|otwórz|otworz|zrób|zrob|stwórz|stworz|wystaw|załóż|zaloz)\b[^.;!?\n]{0,24}?\b(?:pr|prs|pull[- ]?requests?)\b|\b(?:pr|pull[- ]?request)\s+(?:to|into|against|do|na)\s+(?:master|main|beta|production|prod|develop|dev|[\w.-]+\/[\w./-]+)\b/g },
  { grant: 'merge', re: /\bmerg(?:e|ed|es|ing)\b(?!\s+conflicts?)|\b(?:z)?merg(?:uj|nij|ować|owac)\b|\bzmergeuj\b|\bscal(?:ić|ic)?\b/g },
  { grant: 'force', re: /\bforce[- ]?push\w*|\bpush\w*\s+(?:--force\b|-f\b|--force-with-lease\b)|\bforce[- ]with[- ]lease\b|--force-with-lease\b/g },
  { grant: 'discard', re: /\bdiscard\w*\s+(?:(?:all|the|my|your|local|uncommitted|those|these|that|this)\s+)*(?:changes|edits|modifications|work)\b|\bthrow (?:away )?(?:(?:the|my|all|local|those)\s+)*changes\b|\breset --hard\b|\bhard reset\b|\bgit clean\b|\bodrzu[cć] zmiany\b|\bwywal zmiany\b/g },
  { grant: 'branch-delete', re: /\b(?:delete|remove|drop|prune|usuń|usun|wywal)\b[^.;!?\n]{0,30}\bbranch(?:es)?\b|\bbranch(?:es)?\b[^.;!?\n]{0,20}\b(?:delete|remove|usuń|usun)\b/g },
  { grant: 'worktree-remove', re: /\b(?:delete|remove|clean ?up|prune|drop|usuń|usun|wyczyść|wyczysc)\b[^.;!?\n]{0,40}\bworktrees?\b|\bworktrees?\b[^.;!?\n]{0,30}\b(?:delete|remove|usuń|usun)\b/g },
  { grant: 'stash', re: /\bstash\w*/g },
]

/** Words right before a verb that turn it into a noun ("the push", "last commit"). */
const NOUN_BEFORE = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'last', 'latest', 'previous', 'my', 'your', 'our', 'its', 'their', 'his', 'her', 'which', 'whose', 'every', 'each', 'any', 'some', 'of', 'failed', 'broken', 'first', 'final', 'recent', 'initial', 'git'])
/** Words right after a verb that make it a noun ("push notification", "merge conflict"). */
const NOUN_AFTER = /^(?:fail(?:s|ed|ure)?|notif\w*|comments?|messages?|hooks?|history|log|logs|button|conflicts?|access|rights|permissions?|events?|queue|policy|policies|description|title|template|rules?|step|was|is|broke|didn'?t|did)$/
/** A question about state ("did you push?", "why did the merge fail?") grants nothing. */
const STATE_QUESTION = /^(?:did|does|do|is|was|were|have|has|had|why|what|how|where|when|which|who|czy|dlaczego|co|jak|kiedy)\b/
/** Negators, scoped to the verb right after them (≤ 3 words, same clause, no comma). */
const NEGATOR = /\b(?:don'?t|dont|do not|never|not|no|not yet|no need to|won'?t|wont|shouldn'?t|without|avoid|skip|hold off(?: on)?|nie|bez|stop)\s*$/
/** "don't forget to push" is a request. */
const NOT_A_NEGATION = /\b(?:don'?t|do not|nie)\s+(?:forget|hesitate|zapomnij)\b/

const CONTINUATIONS = /^(?:continue|go on|carry on|keep going|resume|proceed|next|dalej|kontynuuj|jedź dalej|jedz dalej|lecimy)$/
const STRONG_YES = new Set(['y', 'yes', 'yep', 'yeah', 'ok', 'okay', 'sure', 'go', 'approved', 'lgtm', 'tak', 'dawaj', 'jasne', 'zgoda', 'proceed', 'pewnie', 'śmiało', 'smialo', 'perfect', 'great'])
const YES_WORDS = new Set([...STRONG_YES, 'ahead', 'do', 'it', 'that', 'please', "let's", 'lets', 'sounds', 'good', 'thanks', 'thank', 'you', 'fine', 'alright', 'right', 'correct', 'zrób', 'zrob', 'to', 'dzięki', 'dzieki', 'please,'])

/** A branch name as people type it: `master`, `schema-v2/main`, `claude/fc-a8`. */
const BRANCH = /([A-Za-z0-9][\w./-]*[\w-])/
const MERGE_TARGET = new RegExp(String.raw`(?:\bz|\b)merg\w*\b[^.;!?\n]{0,30}?\b(?:to|into|do|na)\s+` + BRANCH.source, 'gi')

/** Splits text into clauses, so "create a PR but don't merge it" negates only the merge. */
function clausesOf(text: string): string[] {
  return text
    .split(/[.;!?\n]+|,\s*(?=(?:but|ale|and then|then)\b)|\b(?:but|ale)\b/i)
    .map(c => c.trim())
    .filter(c => c !== '')
}

/** Typographic quotes become plain ones, so "don’t" reads as "don't". */
function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
}

/** Code spans and file paths carry no intent ("plans/…-push-notifications-plan.md"). */
function withoutCode(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/(?:^|\s)\S*\/\S*\.[A-Za-z0-9]{1,5}\b/g, ' ')
    .replace(/(?:^|\s)\S+\.(?:md|ts|tsx|js|jsx|json|py|sh|txt|ya?ml)\b/g, ' ')
}

function verbsIn(text: string, withNegation: boolean): { grants: Set<Grant>; denies: Set<Grant> } {
  const grants = new Set<Grant>()
  const denies = new Set<Grant>()

  for (const clause of clausesOf(withoutCode(normalize(text)).toLowerCase())) {
    const isStateQuestion = STATE_QUESTION.test(clause) && !/^(?:can|could|would|will|please)\b/.test(clause)
    for (const verb of VERBS) {
      verb.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = verb.re.exec(clause)) !== null) {
        const before = clause.slice(0, m.index)
        const after = clause.slice(m.index + m[0].length)
        // Negation: a negator within three words right before, in the same stretch.
        const lead = before.split(/[,;:]/).pop() ?? ''
        const near = lead.trim().split(/\s+/).slice(-4).join(' ')
        const negated = withNegation && (NEGATOR.test(near) || /\b(?:don'?t|do not|never|not|no|nie|bez|skip|hold off|without)\b(?:\s+\S+){0,2}\s*$/.test(near))
          && !NOT_A_NEGATION.test(near + ' ' + m[0])
        if (negated) {
          denies.add(verb.grant)
          continue
        }
        if (isStateQuestion) continue
        const prev = before.trim().split(/\s+/).pop() ?? ''
        const next = after.trim().split(/\s+/)[0] ?? ''
        const isNoun = verb.grant !== 'pr' && verb.grant !== 'discard' && verb.grant !== 'force' && (NOUN_BEFORE.has(prev) || NOUN_AFTER.test(next))
        if (isNoun) continue
        grants.add(verb.grant)
      }
    }
  }

  return { grants, denies }
}

/** Adds what a grant implies: pushing needs a commit first, a PR needs a push. */
export function withImplied(grants: Iterable<Grant>): Grant[] {
  const set = new Set(grants)
  if (set.has('pr')) {
    set.add('push')
  }
  if (set.has('push')) {
    set.add('commit')
  }
  return GRANTS.filter(g => set.has(g))
}

const SHIP_GRANTS: Record<ShipMode, Grant[]> = {
  commit: ['commit'],
  push: ['commit', 'push'],
  pr: ['commit', 'push', 'pr'],
  merge: ['commit', 'push', 'pr', 'merge'],
}

export function shipGrants(mode: ShipMode): Grant[] {
  return SHIP_GRANTS[mode]
}

/** `/ship`, `/ship merge`, `/ship push --base x`: the mode, `pr` by default. */
export function shipModeOf(args: string): ShipMode {
  const word = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return word === 'commit' || word === 'push' || word === 'merge' || word === 'pr' ? word : 'pr'
}

/**
 * A whole message that only says yes: "yes", "ok go ahead", "tak, dawaj".
 * "yes but first explain the diff" is not one: it asks for something else.
 */
export function isAffirmationText(text: string): boolean {
  const words = normalize(text).toLowerCase().replace(/[.!,:;)(]+/g, ' ').trim().split(/\s+/).filter(w => w !== '')
  if (words.length === 0 || words.length > 8) return false
  const hasYes = words.some(w => STRONG_YES.has(w)) || /\b(?:go ahead|do it|zrób to|zrob to|sounds good)\b/.test(words.join(' '))
  return hasYes && words.every(w => YES_WORDS.has(w))
}

/** Reads one prompt the person sent. */
export function readIntent(text: string): Intent {
  const trimmed = normalize(text).trim()
  const lower = trimmed.toLowerCase().replace(/[.!,]+$/g, '').trim()

  if (/^\/ship\b/.test(lower)) {
    const mode = shipModeOf(trimmed.slice(5))
    return { grants: shipGrants(mode), denies: [], mergeTargets: [], isContinuation: false, isAffirmation: false, ship: mode, isKickoff: false }
  }

  const isKickoff = /^\/kickoff\b/.test(lower)
  const isContinuation = CONTINUATIONS.test(lower) || lower === ''
  const isAffirmation = !isContinuation && isAffirmationText(lower)

  const read = verbsIn(trimmed, true)
  const denies = read.denies
  // A kickoff authorizes the routine of a long task: commits on its branches.
  // Words in its arguments ("…except the push part") grant nothing more.
  const grants = isKickoff ? new Set<Grant>(['commit']) : read.grants
  const mergeTargets: string[] = []
  MERGE_TARGET.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MERGE_TARGET.exec(trimmed)) !== null) {
    const target = m[1]
    if (target !== undefined && !/^(it|this|that|them|the|a)$/i.test(target)) {
      mergeTargets.push(target)
    }
  }

  for (const d of denies) {
    grants.delete(d)
  }

  return {
    grants: withImplied(grants).filter(g => !denies.has(g)),
    denies: [...denies],
    mergeTargets,
    isContinuation,
    isAffirmation,
    isKickoff,
  }
}

/**
 * What Claude offered in its last message, read from its closing lines
 * ("Shall I push and open a PR to master?"), for a "yes" to take.
 */
export function proposalsIn(assistantText: string): { grants: Grant[]; mergeTargets: string[] } {
  // Only the offers count: questions and "want me to / shall I" sentences,
  // never a status line that happens to say "merged".
  const sentences = normalize(assistantText.slice(-900)).split(/(?<=[.!?])\s+|\n+/)
  const offers = sentences
    .filter(s => /\?\s*$/.test(s) || /\b(?:shall i|should i|want me to|do you want|would you like|czy mam|mam teraz|chcesz)\b/i.test(s))
    .join('\n')
  // "Shall I push now, without merging?" offers the push only.
  const { grants, denies } = verbsIn(offers, true)
  const intent = readIntent(offers)
  return { grants: withImplied(grants).filter(g => !denies.has(g)), mergeTargets: intent.mergeTargets }
}

const NEGATIVE_ANSWER = /^(?:no|nope|cancel|skip|later|not now|don'?t|nie|anuluj|pomiń|pomin|później|pozniej)\b/i

/**
 * Grants from an AskUserQuestion answer: an option that names git work grants
 * that work; a plain "yes" takes the question's verbs; a "no" grants nothing.
 */
export function grantsFromAnswer(question: string, answer: string): { grants: Grant[]; denies: Grant[] } {
  const a = answer.trim()
  if (a === '' || NEGATIVE_ANSWER.test(a)) {
    return { grants: [], denies: [] }
  }
  const own = verbsIn(a, true)
  if (own.grants.size > 0 || own.denies.size > 0) {
    const grants = withImplied(own.grants).filter(g => !own.denies.has(g))
    return { grants, denies: [...own.denies] }
  }
  if (isAffirmationText(a) || /^(?:approve|allow|confirm|proceed|accept)/i.test(a)) {
    return { grants: withImplied(verbsIn(question, false).grants), denies: [] }
  }
  return { grants: [], denies: [] }
}

/**
 * Whether a prompt's origin speaks for the person. An absent origin is the
 * person's own (the engine leaves it out for a plain typed prompt).
 */
export function isTrusted(origin: { kind: string } | null | undefined, trusted: readonly string[]): boolean {
  return trusted.includes(origin?.kind ?? 'composer')
}
