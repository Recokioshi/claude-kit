/**
 * What the guard does with one request. Pure: no `$`; the hooks module acts
 * on the answer (and records it).
 */
import type { Catalog, CatalogEntry } from './catalog'
import { aliasOf, familyOfId, isInherited, keyOf, splitSuffix } from './ids'
import { concreteFor, isAllowedModel, swapTarget } from './policy'
import type { Policy } from './policy'
import { blockedOf, labelOf, nameOf, refusalOf, workflowModels } from './state'

export type SpawnDecision =
  | { kind: 'pass' }
  /** An alias whose family has a blocked version: the newest allowed one, not the host's newest. */
  | { kind: 'rewrite'; model: string }
  | { kind: 'deny'; from: string; reason: string }
  | { kind: 'swap'; from: string; to: CatalogEntry; model: string }

export type SpawnAsk = {
  /** The Agent tool's `model` as given. */
  model: string | undefined
  /** The parent's model: whose provider an alias rewrite must speak to. */
  parentModel: string
  /** A workflow script's agent: the engine takes only a deny there (turn.step swaps its requests). */
  isWorkflow: boolean
}

/** What comes before `claude` in an id, plus Vertex's `@`: the provider a spelling talks to. */
const styleOf = (id: string) => `${id.toLowerCase().split('claude')[0] ?? ''}${id.includes('@') ? '@' : ''}`

/** The spelling of `entry` that talks to the same provider as `like` (first-party, Bedrock, Vertex, a gateway). */
function spellingFor(entry: CatalogEntry, like: string): string | undefined {
  const style = styleOf(like)
  return entry.ids.find(id => styleOf(id) === style) ?? entry.ids[0]
}

/** `like`'s context suffix (`[1m]`), only when the target is in the same family: another family may not have it. */
const suffixFor = (like: string, target: CatalogEntry) => (target.family === (aliasOf(like)?.family ?? familyOfId(like)) ? splitSuffix(like).suffix : '')

/** A subagent about to start. */
export function spawnDecision(policy: Policy, catalog: Catalog, ask: SpawnAsk): SpawnDecision {
  const asked = ask.model
  if (asked === undefined || isInherited(asked)) {
    return { kind: 'pass' }
  }
  const like = aliasOf(asked) === null ? asked : ask.parentModel
  const concrete = concreteFor(policy, catalog, asked)
  if (concrete !== null) {
    if (concrete === asked || ask.isWorkflow) return { kind: 'pass' }
    const entry = catalog.entries.find(e => e.key === keyOf(concrete))
    const id = entry === undefined ? undefined : spellingFor(entry, like)
    return { kind: 'rewrite', model: id === undefined ? concrete : `${id}${splitSuffix(asked).suffix}` }
  }
  const from = nameOf(asked)
  const target = swapTarget(policy, catalog, aliasOf(asked)?.family ?? familyOfId(asked))
  const to = target === null ? undefined : spellingFor(target, like)
  if (policy.mode === 'deny' || target === null || to === undefined) {
    return { kind: 'deny', from, reason: refusalOf(policy, asked, to ?? null) }
  }
  return ask.isWorkflow ? { kind: 'pass' } : { kind: 'swap', from, to: target, model: `${to}${suffixFor(asked, target)}` }
}

/** A request already on its way (`turn.step`'s resolved model): where it goes instead, or null to leave it. */
export function stepSwap(policy: Policy, catalog: Catalog, model: string): { to: CatalogEntry; model: string } | null {
  if (isAllowedModel(policy, catalog, model)) {
    return null
  }
  const target = swapTarget(policy, catalog, familyOfId(model))
  const to = target === null ? undefined : spellingFor(target, model)
  return target === null || to === undefined ? null : { to: target, model: `${to}${suffixFor(model, target)}` }
}

/** A Workflow script naming blocked versions: the names and the refusal, or null to let it run. */
export function workflowRefusal(policy: Policy, catalog: Catalog, script: string): { banned: string[]; reason: string } | null {
  const banned = [...new Set(workflowModels(script).filter(m => !isAllowedModel(policy, catalog, m)))]
  if (banned.length === 0) {
    return null
  }
  const target = swapTarget(policy, catalog, familyOfId(banned[0] ?? ''))
  const reason = `model-guard: this workflow asks for ${banned.join(', ')}, which this session blocks (blocked: ${blockedOf(policy).join(', ')}). Use "${target?.ids[0] ?? 'inherit'}" instead.`
  return { banned, reason }
}

/** Why `/model` to a blocked version is refused, with the allowed one to pick instead. */
export function switchRefusal(policy: Policy, catalog: Catalog, toModel: string): string {
  const target = swapTarget(policy, catalog, familyOfId(toModel))
  const instead = target === null ? '' : ` ${labelOf(target.key)} (${spellingFor(target, toModel) ?? target.key}) is allowed;`
  return `${labelOf(keyOf(toModel))} is blocked.${instead} change it in /models.`
}
