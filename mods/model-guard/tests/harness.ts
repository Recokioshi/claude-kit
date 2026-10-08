/** The engine beneath model-guard in tests: a shared store, the Models API, spawns and steps. */
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import Hooks from '../hooks'
import type { Policy } from '../hooks/policy'

/** The real Models API ids (2026-10-08), newest first per family. */
export const API_IDS = [
  'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5',
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929',
]

/** A Models API page, as the real one answers. */
export const pageOf = (ids: readonly string[], hasMore = false) =>
  JSON.stringify({ data: ids.map(id => ({ type: 'model', id, display_name: id, created_at: '2026-10-01T00:00:00Z' })), has_more: hasMore, first_id: ids[0] ?? null, last_id: ids.at(-1) ?? null })

export type EngineOptions = {
  /** The session's login: a bearer handle, or none (Bedrock, Vertex, a gateway). */
  login?: boolean
  /** The Models API's answer per request, in order; the last one repeats. */
  api?: readonly { status: number; text: string }[]
  /** The main conversation's model, as /model shows it. */
  mainModel?: string
}

export function engineOf(on: On, options: EngineOptions = {}) {
  const fetched: { url: string; auth?: string }[] = []
  const spawned: (string | undefined)[] = []
  const steps: string[] = []
  const toasts: string[] = []
  /** The shared store file, as every Claude Code process on the machine sees it. */
  const store = new Map<string, unknown>()
  const clock = mock.clock(on)
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.cwd', () => ({ value: '/Users/me/dev/web-app' }))
  on('session.repo', () => ({ value: { root: '/Users/me/dev/web-app', remote: null, internal: false, name: null } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: options.mainModel ?? 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: options.login === true ? { handle: 'h-1', kind: 'bearer' as const } : null }))
  on('http.fetch', ($, e) => {
    fetched.push({ url: e.url, auth: e.init?.auth })
    const answers = options.api ?? [{ status: 200, text: pageOf(API_IDS) }]
    const answer = answers[Math.min(fetched.length - 1, answers.length - 1)] ?? { status: 500, text: '' }
    return { value: { status: answer.status, ok: answer.status < 300, headers: {}, text: answer.text } }
  })
  on('command.register', () => ({ value: { command: 'models' } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.spawn', ($, e) => {
    spawned.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `agent-${spawned.length}` }
  })
  on('turn.step', async function* ($, e) {
    steps.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null } as never
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.PostModelSwitch', () => ({}))
  on('tool.call', () => ({ result: 'ran' as never }))
  return { spawned, steps, toasts, store, fetched, clock }
}

export type Store = Map<string, unknown>

/** The Models API list in the store, as a refresh in some instance left it. */
export function seedList(store: Store, ids: readonly string[] = API_IDS) {
  const { catalog } = Hooks.mergeCatalog(Hooks.EMPTY_CATALOG, ids.map(id => ({ id, source: 'api' as const })), 0)
  store.set('catalog', { ...catalog, fetchedAt: 0 })
}

/** A list some instance saved (or this one, before the test looks). */
export function seedPolicy(store: Store, policy: Partial<Policy>, key = 'policy:global') {
  store.set(key, { ...Hooks.DEFAULT_POLICY, ...policy })
}

export const policyIn = (store: Store, key = 'policy:global') => store.get(key) as Policy

export const spawnOf = (model?: string, description = 'A3 soft landing') =>
  ({ prompt: 'do it', description, subagentType: 'general-purpose', model, parentModel: 'claude-opus-5-5', background: true, fork: false }) as never

export const run = (engine: { command: { run: (input: never) => Promise<{ text?: string }> } }, args = '') =>
  engine.command.run({ command: 'models', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)

export async function stepOn($: { turn: { step: (input: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, model: string, agentId?: string) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, messageCount: 3, agentId } as never)
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

export const turnOf = ($: { turn: { start: (input: never) => Promise<unknown> } }) => $.turn.start({ text: 'next', turnId: 't2' } as never)

/** Opus 5.5 and 5 blocked: "allow 4.8, block 5" with the newer 5.5 blocked too. */
export const ONLY_OPUS_48 = { versions: { 'opus-5.5': 'block' as const, 'opus-5': 'block' as const } }
