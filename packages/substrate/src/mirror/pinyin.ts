/**
 * Pinyin search keys for chat titles and contact names, so `zs` finds 张三 and `cpq` finds 产品群.
 *
 * A key is a space-separated list of lowercase ASCII words stored next to the name in the mirror:
 * the full reading with the contextual pronunciation (`zhangsan`) followed by the initials of every
 * reading of every character (`zs`; a polyphone such as 重 adds both `z…` and `c…`). Names without a
 * Han character get an empty key: plain substring search already covers them. The cartesian product
 * of polyphone initials is capped, contextual reading first, so a name full of polyphones stays small.
 */
import { pinyin } from 'pinyin-pro'

/** Most initials variants one name contributes (the contextual one is always first). */
const MAX_INITIAL_VARIANTS = 8
/** Longest name (in characters) that gets a key; WeChat titles are far shorter. */
const MAX_NAME_CHARS = 64

const HAN = /\p{Script=Han}/u
const ASCII_ALNUM = /^[a-z0-9]$/

const BASE_OPTIONS = { toneType: 'none', type: 'array', v: true } as const

function readingsOf(char: string): string[] {
  const all = pinyin(char, { ...BASE_OPTIONS, multiple: true })
  return [...new Set(all.map((r) => r.toLowerCase()).filter((r) => /^[a-z]+$/.test(r)))]
}

/** Pinyin key words for one name; empty when it has no Han character. */
function keyWordsFor(name: string): string[] {
  const chars = Array.from(name.trim()).slice(0, MAX_NAME_CHARS)
  if (!chars.some((c) => HAN.test(c))) return []
  const contextual = pinyin(chars.join(''), { ...BASE_OPTIONS, nonZh: 'spaced', surname: 'head' })
  const aligned = contextual.length === chars.length

  let full = ''
  // Each slot: the initials this character may start with, contextual reading first.
  const slots: string[][] = []
  chars.forEach((char, i) => {
    const lower = char.toLowerCase()
    if (HAN.test(char)) {
      const ctx = aligned ? (contextual[i] ?? '').toLowerCase() : ''
      const readings = readingsOf(char)
      const primary = /^[a-z]+$/.test(ctx) ? ctx : (readings[0] ?? '')
      if (!primary) return
      full += primary
      const initials = [...new Set([primary[0], ...readings.map((r) => r[0])])].filter((c): c is string => !!c)
      slots.push(initials)
    } else if (ASCII_ALNUM.test(lower)) {
      full += lower
      slots.push([lower])
    }
  })

  let variants = ['']
  for (const options of slots) {
    const next: string[] = []
    for (const prefix of variants) {
      for (const option of options) {
        if (next.length >= MAX_INITIAL_VARIANTS) break
        next.push(prefix + option)
      }
    }
    variants = next
  }
  return [full, ...variants].filter((w) => w.length > 0)
}

/**
 * The stored search key for one or more names of the same row (title; nickname + remark): deduped
 * words joined by spaces, '' when none of the names contains a Han character.
 */
export function pinyinSearchKey(...names: ReadonlyArray<string | null | undefined>): string {
  const words: string[] = []
  for (const name of names) if (name) words.push(...keyWordsFor(name))
  return [...new Set(words)].join(' ')
}

/**
 * The query as it would appear inside a key, or undefined when the query cannot be pinyin (it holds
 * anything but ASCII letters / digits after dropping spaces, apostrophes and a leading `@`).
 */
export function pinyinQuery(query: string): string | undefined {
  const q = query.trim().replace(/^@/, '').replace(/[\s']/g, '').toLowerCase()
  return /^[a-z][a-z0-9]*$/.test(q) ? q : undefined
}
