/**
 * `/models <args>` read into one command. Pure: no `$`. Every form works as
 * text, so the phone (no input fields) and sessions that draw nothing can
 * change everything the pane can.
 */
import type { Catalog, Result } from './catalog'
import { aliasOf, keyOf } from './ids'
import { withFamily, withFamilyList, withUnnamed, withVersion } from './policy'
import type { Decision, Mode, Policy } from './policy'
import { familyListProblem, labelOf } from './state'

export type Command =
  | { kind: 'open' }
  | { kind: 'rule'; decision: Decision; target: string }
  | { kind: 'family'; family: string; decision: Decision }
  | { kind: 'add'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'refresh' }
  | { kind: 'fallback'; target: string }
  | { kind: 'mode'; mode: Mode }
  | { kind: 'repo' }
  | { kind: 'global' }
  | { kind: 'default' }
  | { kind: 'families'; words: string[] }
  | { kind: 'help'; problem: string }

export const HELP = [
  '/models                              the pane (or this text where nothing draws)',
  '/models allow|block <model>          one version: opus 4.8, claude-opus-4-8',
  '/models new <family> allow|block     versions without a rule of their own, new ones included',
  '/models add <id> · remove <id>       a model the list does not show',
  '/models refresh                      the list from Anthropic now',
  '/models fallback <model>             where blocked requests go · /models mode deny|swap',
  '/models repo · global                this repo gets its own list · back to the global one',
].join('\n')

const isDecision = (w: string | undefined): w is Decision => w === 'allow' || w === 'block'
const isMode = (w: string | undefined): w is Mode => w === 'deny' || w === 'swap'

export function parseCommand(args: string): Command {
  const words = args.trim().toLowerCase().split(/[\s,;]+/).filter(Boolean)
  const [verb, ...rest] = words
  const tail = rest.join(' ')
  switch (verb) {
    case undefined:
      return { kind: 'open' }
    case 'allow':
    case 'block':
      return tail === '' ? { kind: 'help', problem: `Name the model to ${verb}, e.g. /models ${verb} opus 4.8.` } : { kind: 'rule', decision: verb, target: tail }
    case 'new': {
      const [family, decision] = rest
      return family !== undefined && isDecision(decision) && rest.length === 2 ? { kind: 'family', family, decision } : { kind: 'help', problem: 'Say the family and allow or block, e.g. /models new haiku block.' }
    }
    case 'add':
    case 'remove':
      return rest.length === 1 && rest[0] !== undefined ? { kind: verb, id: rest[0] } : { kind: 'help', problem: `Give one model id, e.g. /models ${verb} claude-opus-5-6.` }
    case 'refresh':
      return { kind: 'refresh' }
    case 'fallback':
      return tail === '' ? { kind: 'help', problem: 'Name the fallback, e.g. /models fallback opus 4.8.' } : { kind: 'fallback', target: tail }
    case 'mode': {
      const [mode] = rest
      return isMode(mode) ? { kind: 'mode', mode } : { kind: 'help', problem: 'The mode is deny or swap.' }
    }
    case 'repo':
    case 'save':
      return { kind: 'repo' }
    case 'global':
    case 'reset':
      return { kind: 'global' }
    case 'default':
      return { kind: 'default' }
    case 'help':
      return { kind: 'help', problem: '' }
    default:
      return { kind: 'families', words }
  }
}

/** "opus 4.8", "opus-4.8", "opus4-8", "claude-opus-4-8" → the version key; a bare family is not a version. */
export function versionOf(target: string, catalog: Catalog): Result<{ key: string; isListed: boolean }> {
  const text = target.trim().toLowerCase()
  const spaced = /^([a-z]+)[\s-]*(\d+(?:[.-]\d+)*)$/.exec(text)
  const alias = aliasOf(text, catalog.entries.map(e => e.family))
  if (spaced === null && alias !== null) {
    return { ok: false, error: `"${text}" is a whole family: name one version (e.g. ${alias.family} 4.8), or use /models new ${alias.family} allow|block.` }
  }
  const key = spaced?.[1] !== undefined && spaced[2] !== undefined ? keyOf(`${spaced[1]}-${spaced[2].replace(/-/g, '.')}`) : keyOf(text)
  return { ok: true, value: { key, isListed: catalog.entries.some(e => e.key === key) } }
}

/** A change to the list in force, and what to say once it is saved. */
export type PolicyEdit = { change: (policy: Policy, catalog: Catalog) => Policy; done: string }

/** The rule change a command asks for (or why it can't be made); null for a command that changes no rule. */
export function editOf(command: Command, catalog: Catalog): Result<PolicyEdit> | null {
  switch (command.kind) {
    case 'rule': {
      const version = versionOf(command.target, catalog)
      if (!version.ok) return version
      const { key, isListed } = version.value
      const later = isListed ? '' : ' It is not in the model list yet; the rule applies once it is.'
      const done = `${command.decision === 'allow' ? 'Allowed' : 'Blocked'} ${labelOf(key)}.${later}`
      return { ok: true, value: { change: (p, c) => withVersion(p, c, key, command.decision), done } }
    }
    case 'family': {
      const { family, decision } = command
      const isUnnamed = family === 'other' || family === 'others'
      const done = `New ${isUnnamed ? 'families' : `${family} versions`} without a rule of their own: ${decision === 'allow' ? 'allowed' : 'blocked'}.`
      return { ok: true, value: { change: (p, c) => (isUnnamed ? withUnnamed(p, c, decision) : withFamily(p, c, family, decision)), done } }
    }
    case 'families': {
      const problem = familyListProblem(command.words, catalog)
      if (problem !== null) return { ok: false, error: problem }
      return { ok: true, value: { change: (p, c) => withFamilyList(p, c, command.words), done: `Allowed families: ${command.words.join(', ')}.` } }
    }
    case 'fallback': {
      const version = versionOf(command.target, catalog)
      const fallback = version.ok ? version.value.key : (aliasOf(command.target)?.family ?? command.target)
      return { ok: true, value: { change: p => ({ ...p, fallback }), done: `Fallback: ${labelOf(fallback)}.` } }
    }
    case 'mode':
      return { ok: true, value: { change: p => ({ ...p, mode: command.mode }), done: `Explicit asks for a blocked model are now ${command.mode === 'deny' ? 'refused' : 'swapped'}.` } }
    default:
      return null
  }
}

/** The answer of a command that needs nothing from the session; null for the others. */
export function fixedAnswerOf(command: Command): string | null {
  if (command.kind === 'help') return [command.problem, HELP].filter(Boolean).join('\n')
  if (command.kind === 'default') return 'Lists are global now: a change in /models applies to every repo without its own list. /models repo gives a repo its own.'
  return null
}
