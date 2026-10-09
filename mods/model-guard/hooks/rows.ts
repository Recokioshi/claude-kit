/**
 * A list in the store: a base record (written once, when the list is seeded
 * or copied) and one store key per row laid over it, e.g.
 * `policy:global|version|opus-5 → block`. Two windows editing different rows
 * write different keys, so neither overwrites the other: the store keeps
 * every key a process writes (only the same key is last-write-wins). Pure.
 */
import { keyOf } from './ids'
import type { Decision, Mode, Policy } from './policy'

const SEP = '|'

export type Row = readonly [key: string, value: unknown]

const isDecision = (v: unknown): v is Decision => v === 'allow' || v === 'block'
const isMode = (v: unknown): v is Mode => v === 'deny' || v === 'swap'
const own = (rules: Record<string, Decision>, name: string) => (Object.hasOwn(rules, name) ? rules[name] : undefined)

/** Whether `key` is one of `listKey`'s rows. */
export const isRowOf = (listKey: string, key: string) => key.startsWith(`${listKey}${SEP}`)

/** `base` with its rows laid over it; a row that does not read as one is ignored. */
export function withRows(base: Policy, listKey: string, rows: readonly Row[]): Policy {
  const versions = { ...base.versions }
  const families = { ...base.families }
  let { unnamedFamilies, fallback, mode } = base
  for (const [key, value] of rows) {
    if (!isRowOf(listKey, key)) continue
    const [field = '', ...rest] = key.slice(listKey.length + SEP.length).split(SEP)
    const name = rest.join(SEP)
    if (field === 'version' && name !== '' && isDecision(value)) versions[keyOf(name)] = value
    else if (field === 'family' && name !== '' && isDecision(value)) families[name] = value
    else if (field === 'unnamed' && isDecision(value)) unnamedFamilies = value
    else if (field === 'fallback' && (typeof value === 'string' || value === null)) fallback = value
    else if (field === 'mode' && isMode(value)) mode = value
  }
  return { families, unnamedFamilies, versions, fallback, mode }
}

/** The rows that make `before` into `after`, one store key each. */
export function changedRows(listKey: string, before: Policy, after: Policy): Row[] {
  const rows: Row[] = []
  for (const [name, value] of Object.entries(after.versions)) {
    if (own(before.versions, name) !== value) rows.push([`${listKey}${SEP}version${SEP}${name}`, value])
  }
  for (const [name, value] of Object.entries(after.families)) {
    if (own(before.families, name) !== value) rows.push([`${listKey}${SEP}family${SEP}${name}`, value])
  }
  if (before.unnamedFamilies !== after.unnamedFamilies) rows.push([`${listKey}${SEP}unnamed`, after.unnamedFamilies])
  if (before.fallback !== after.fallback) rows.push([`${listKey}${SEP}fallback`, after.fallback])
  if (before.mode !== after.mode) rows.push([`${listKey}${SEP}mode`, after.mode])
  return rows
}
