/**
 * What the guard does with one request. Pure: no `$`; the hooks module acts
 * on the answer (and records it).
 */
import type { Catalog, CatalogEntry } from './catalog'
import { aliasOf, familyOfId, isInherited, splitSuffix } from './ids'
import { concreteFor, isAllowedModel, swapTarget } from './policy'
import type { Policy } from './policy'
import { blockedOf, nameOf, refusalOf, workflowModels } from './state'

export type SpawnDecision =
  | { kind: 'pass' }
  /** An alias whose family has a blocked version: the newest allowed one, not the host's newest. */
  | { kind: 'rewrite'; model: string }
  | { kind: 'deny'; from: string; reason: string }
  | { kind: 'swap'; from: string; to: CatalogEntry; model: string }

/** A subagent asked for on `asked` (as the Agent tool's `model` gave it). */
export function spawnDecision(policy: Policy, catalog: Catalog, asked: string | undefined): SpawnDecision {
  if (asked === undefined || isInherited(asked)) {
    return { kind: 'pass' }
  }
  const concrete = concreteFor(policy, catalog, asked)
  if (concrete !== null) {
    return concrete === asked ? { kind: 'pass' } : { kind: 'rewrite', model: concrete }
  }
  const from = nameOf(asked)
  const target = swapTarget(policy, catalog, aliasOf(asked)?.family ?? familyOfId(asked))
  const to = target?.ids[0]
  if (policy.mode === 'deny' || target === null || to === undefined) {
    return { kind: 'deny', from, reason: refusalOf(policy, asked, to ?? null) }
  }
  return { kind: 'swap', from, to: target, model: to + splitSuffix(asked).suffix }
}

/** A request already on its way (`turn.step`'s resolved model): where it goes instead, or null to leave it. */
export function stepSwap(policy: Policy, catalog: Catalog, model: string): { to: CatalogEntry; model: string } | null {
  if (isAllowedModel(policy, catalog, model)) {
    return null
  }
  const target = swapTarget(policy, catalog, familyOfId(model))
  const to = target?.ids[0]
  return target === null || to === undefined ? null : { to: target, model: to + splitSuffix(model).suffix }
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
