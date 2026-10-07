/** Mirrors hooks/families.ts. */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'

export type ModelGuardEvent = {
  at: number
  kind: 'swap' | 'deny'
  what: string
  from: ModelFamily
  to?: ModelFamily
}

export type ModelGuardState = {
  isReady: boolean
  allowed: ModelFamily[]
  fallback: ModelFamily
  mode: 'deny' | 'swap'
  source: 'config' | 'repo' | 'session'
  repoName: string | null
  repoDefault: ModelFamily[] | null
  stats: Record<ModelFamily, { uses: number; swapped: number; denied: number }>
  seen: Partial<Record<ModelFamily, string>>
  recent: ModelGuardEvent[]
  swappedLoops: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'model-guard': { guard: ModelGuardState }
  }
}
