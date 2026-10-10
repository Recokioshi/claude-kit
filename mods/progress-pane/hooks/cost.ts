/**
 * What a model request costs at Anthropic's API list prices, estimated from
 * the token counts the engine reports. Not a bill: a subscription pays
 * nothing per token, and partner platforms price differently. Pure.
 *
 * Source: the claude-api reference bundled with Claude Code 2.1.295 (model
 * table cached 2026-10-06). Cache writes are 1.25x input (5-minute TTL);
 * cache reads 0.1x input, except Fable 5.1 (0.025x) and Opus 5.5 (0.05x).
 */

/** USD per million tokens: input, output, cache read, cache write. */
type Price = readonly [input: number, output: number, cacheRead: number, cacheWrite: number]

/** First match wins: specific versions before their family. */
const PRICES: readonly (readonly [RegExp, Price])[] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet-4/, [3, 15, 0.3, 3.75]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  // Haiku 5.5 up to 100K prompt tokens ($0.50 / $2.50 above): agents rarely pass it.
  [/haiku-5/, [0.1, 0.5, 0.01, 0.125]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

/** When the model is not recognised: Opus 5.5's price, the default model. */
const FALLBACK: Price = [4, 20, 0.2, 5]

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const priceOf = (model: string): Price => PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? FALLBACK

export function costOf(model: string, u: Usage): number {
  const [input, output, read, write] = priceOf(model)
  return ((u.input_tokens || 0) * input + (u.output_tokens || 0) * output + (u.cache_read_input_tokens || 0) * read + (u.cache_creation_input_tokens || 0) * write) / 1e6
}

/** Every token a request carried: what its context held once it answered. */
export const tokensOf = (u: Usage): number => (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

/** The context window: 1M from Opus and Sonnet 4.6 (and every 5.x), 200K on Haiku 4.5 and the 4.5-and-earlier models. */
export const windowOf = (model: string): number => (/haiku-[1-4]|claude-3|(?:opus|sonnet)-4(?:-[0-5])?(?![0-9-])|(?:opus|sonnet)-4-[0-5](?![0-9])|(?:opus|sonnet)-4-20\d{6}/.test(model.toLowerCase()) ? 200_000 : 1_000_000)

/** "412k", "1.3M", "820". */
export const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

/** "$0.42", "$12.3". */
export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
