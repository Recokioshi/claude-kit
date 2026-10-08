/**
 * Model ids → one key per version, so every spelling of a version (dated,
 * Bedrock, Vertex, `[1m]`) shares one rule. Pure: no `$`.
 */

/** Families the mod knows by name: alias words, display order. Anything else still parses. */
export const KNOWN_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const

export type ParsedModel = { family: string; version: string; key: string }

/** Everything up to and including `anthropic.` or `anthropic/`: 'us.anthropic.', a Bedrock ARN's profile path, a gateway's 'anthropic/'. */
const PROVIDER_PREFIX = /^.*anthropic[./]/
const VERTEX_SUFFIX = /@.*$/
const BEDROCK_SUFFIX = /-v\d+(?::\d+)?$/
const LATEST_SUFFIX = /-latest$/
const DATE_SUFFIX = /-\d{8}$/
const NEW_ORDER = /^claude-([a-z]+)-(\d+(?:[-.]\d+)*)$/
const OLD_ORDER = /^claude-(\d+(?:[-.]\d+)*)-([a-z]+)$/
/** A rule key's shape: 'opus-4.8'. */
const VERSION_KEY = /^([a-z]+)-(\d+(?:\.\d+)*)$/

/** '4-8' or '4.8' → '4.8'; parts numeric, trailing zero parts dropped ('5-0' → '5'), at least one kept. */
const parsed = (family: string, digits: string): ParsedModel => {
  const parts = digits.split(/[-.]/).map(p => String(Number(p)))
  while (parts.length > 1 && parts.at(-1) === '0') {
    parts.pop()
  }
  const version = parts.join('.')
  return { family, version, key: `${family}-${version}` }
}

/** 'claude-opus-4-8-20260301', 'us.anthropic.claude-opus-4-8-v1:0', 'claude-3-5-sonnet-v2@20241022', 'claude-opus-4.8' → family + version; anything else → null. */
export function parseModelId(id: string): ParsedModel | null {
  const bare = splitSuffix(id)
    .base.toLowerCase()
    .replace(PROVIDER_PREFIX, '')
    .replace(VERTEX_SUFFIX, '')
    .replace(BEDROCK_SUFFIX, '')
    .replace(LATEST_SUFFIX, '')
    .replace(DATE_SUFFIX, '')
  const fresh = NEW_ORDER.exec(bare)
  if (fresh?.[1] !== undefined && fresh[2] !== undefined) {
    return parsed(fresh[1], fresh[2])
  }
  const old = OLD_ORDER.exec(bare)
  if (old?.[1] !== undefined && old[2] !== undefined) {
    return parsed(old[2], old[1])
  }
  return null
}

/** 'claude-opus-5[1m]' → base 'claude-opus-5', suffix '[1m]'. Trimmed; case kept. */
export function splitSuffix(model: string): { base: string; suffix: string } {
  const text = model.trim()
  const match = /(?:\[[^\]]*\])+$/.exec(text)
  if (match === null) {
    return { base: text, suffix: '' }
  }
  return { base: text.slice(0, match.index).trim(), suffix: match[0] }
}

/** The rule key for any spelling: 'opus-4.8', or the lowercased id when it does not parse. A key is its own key ('opus-5.0' → 'opus-5'). */
export function keyOf(id: string): string {
  const parsedKey = parseModelId(id)?.key
  if (parsedKey !== undefined) return parsedKey
  const base = splitSuffix(id).base.toLowerCase()
  const key = VERSION_KEY.exec(base)
  return key?.[1] !== undefined && key[2] !== undefined ? parsed(key[1], key[2]).key : base
}

/** The family read from the id; for one that does not parse, a known family word inside it ('opusplan' → opus); else 'other'. */
export function familyOfId(id: string): string {
  const parsedFamily = parseModelId(id)?.family
  if (parsedFamily !== undefined) return parsedFamily
  const text = splitSuffix(id).base.toLowerCase()
  return KNOWN_FAMILIES.find(f => text.includes(f)) ?? 'other'
}

/** A rule key's family: 'opus-4.8' → 'opus'; null for a key not shaped family-version (an unparsable id). */
export function familyOfKey(key: string): string | null {
  return VERSION_KEY.exec(key)?.[1] ?? null
}

/** No model, or `inherit`: the request runs on the parent's model, which is the user's own choice. */
export function isInherited(model: string | null | undefined): boolean {
  const m = (model ?? '').trim().toLowerCase()
  return m === '' || m === 'inherit'
}

/** 'opus', 'Opus', 'opus[1m]' → { family: 'opus', suffix: '[1m]' } when family is known (KNOWN_FAMILIES or `extra`). */
export function aliasOf(model: string, extra: readonly string[] = []): { family: string; suffix: string } | null {
  const { base, suffix } = splitSuffix(model)
  const family = base.toLowerCase()
  const known = (KNOWN_FAMILIES as readonly string[]).includes(family) || extra.some(f => f.toLowerCase() === family)
  return family !== '' && known ? { family, suffix } : null
}

const partsOf = (version: string): number[] =>
  version.split('.').map(p => {
    const n = Number(p)
    return Number.isFinite(n) ? n : 0
  })

/** Numeric per dot part, missing parts = 0: '4.8' < '4.10' < '5' == '5.0' < '5.5'. */
export function compareVersions(a: string, b: string): number {
  const pa = partsOf(a)
  const pb = partsOf(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) {
      return d < 0 ? -1 : 1
    }
  }
  return 0
}

/** Display rank: KNOWN_FAMILIES in order, then any other family (the caller sorts those alphabetically), 'other' last. */
export function familyRank(family: string): number {
  const i = (KNOWN_FAMILIES as readonly string[]).indexOf(family)
  if (i >= 0) {
    return i
  }
  return family === 'other' ? KNOWN_FAMILIES.length + 1 : KNOWN_FAMILIES.length
}
