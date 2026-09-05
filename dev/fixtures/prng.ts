/**
 * Small deterministic PRNG (mulberry32) so the generated dataset is reproducible from a seed.
 * No external dependencies: this file also runs under `node --experimental-strip-types`.
 */
export interface Rng {
  /** float in [0, 1) */
  next(): number
  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number
  /** true with probability p */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  /** pick an index by weight */
  weightedIndex(weights: readonly number[]): number
  /** Fisher–Yates copy */
  shuffle<T>(items: readonly T[]): T[]
  /** n distinct items */
  sample<T>(items: readonly T[], n: number): T[]
  /** normal-ish value via 3 uniform draws, clamped to [min, max] */
  bell(min: number, max: number): number
  /** derive an independent child generator */
  fork(): Rng
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    chance(p) {
      return next() < p
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick from empty list')
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    weightedIndex(weights) {
      let total = 0
      for (const w of weights) total += w
      let r = next() * total
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0
        if (r < 0) return i
      }
      return weights.length - 1
    },
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = out[i] as (typeof items)[number]
        out[i] = out[j] as (typeof items)[number]
        out[j] = a
      }
      return out
    },
    sample(items, n) {
      return rng.shuffle(items).slice(0, Math.min(n, items.length))
    },
    bell(min, max) {
      const u = (next() + next() + next()) / 3
      return min + u * (max - min)
    },
    fork() {
      return createRng(Math.floor(next() * 0xffffffff))
    },
  }
  return rng
}

/** Stable 32-bit hash of a string (FNV-1a) — for deriving per-entity seeds. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
