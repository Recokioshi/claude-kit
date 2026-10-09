/** Mirrors hooks/state.ts, hooks/catalog.ts and hooks/policy.ts. */
export type ModelDecision = 'allow' | 'block'

export type ModelPolicy = {
  families: Record<string, ModelDecision>
  unnamedFamilies: ModelDecision
  versions: Record<string, ModelDecision>
  fallback: string | null
  mode: 'deny' | 'swap'
}

export type ModelCatalogEntry = {
  key: string
  family: string
  version: string
  ids: string[]
  displayName?: string
  createdAt?: string
  sources: ('api' | 'seen' | 'added' | 'seed')[]
  firstSeenAt: number
}

export type ModelCatalog = { entries: ModelCatalogEntry[]; fetchedAt: number | null; lastError: string | null }

export type ModelGuardEvent = {
  at: number
  kind: 'swap' | 'deny'
  what: string
  from: string
  to?: string
}

export type ModelGuardState = {
  isReady: boolean
  policy: ModelPolicy
  source: 'global' | 'repo'
  repoRoot: string | null
  repoName: string | null
  catalog: ModelCatalog
  stats: Record<string, { uses: number; swapped: number; denied: number }>
  recent: ModelGuardEvent[]
  swappedLoops: string[]
  expanded: boolean
  view: 'versions' | 'families'
  mainModel: string | null
}

declare module 'claude-code' {
  interface PluginState {
    /** Shaped: a reload whose code names another shape tag reads an older build's value as absent. */
    'model-guard': { guard: Shaped<ModelGuardState> }
  }
}
