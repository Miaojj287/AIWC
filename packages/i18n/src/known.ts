/**
 * Reverse translation of system messages the business packages emit in Chinese (see
 * locales/zh-CN/known.ts). The zh-CN catalog of `known` and `main` is indexed once: plain strings by
 * exact text, `{name}` templates as anchored patterns (most literal text first). A match is re-rendered
 * in the target language with its captured params localized recursively ("已熔断：发送校验失败" →
 * "Stopped: Send verification failed"). Anything unknown — user data, provider errors — passes through.
 *
 * Apply it only to system fields (errors, reasons, progress steps), never to chat content.
 */
import type { Language } from '@aiwc/protocol'
import type { MessageTree } from './core'
import { zhCN } from './locales/zh-CN'
import { translate, type MessageKey } from './translate'

interface Pattern {
  key: MessageKey
  regex: RegExp
  names: string[]
  weight: number
}

interface Index {
  exact: Map<string, MessageKey>
  patterns: Pattern[]
}

const INDEXED_NAMESPACES = ['known', 'main'] as const
const ARG = /\{([A-Za-z_][\w]*)\}/g
const MAX_DEPTH = 3

let index: Index | undefined

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function buildIndex(): Index {
  const exact = new Map<string, MessageKey>()
  const patterns: Pattern[] = []
  const walk = (tree: MessageTree, prefix: string) => {
    for (const [name, value] of Object.entries(tree)) {
      const key = `${prefix}.${name}`
      if (typeof value !== 'string') {
        walk(value, key)
        continue
      }
      if (!value.includes('{')) {
        if (!exact.has(value)) exact.set(value, key as MessageKey)
        continue
      }
      // Only simple `{name}` templates are reversible; plural / select messages are skipped.
      if (/\{[^}]*[,#]/.test(value)) continue
      const names: string[] = []
      let source = '^'
      let literal = 0
      let last = 0
      for (const match of value.matchAll(ARG)) {
        const chunk = value.slice(last, match.index)
        source += escapeRegex(chunk)
        literal += chunk.length
        source += '([\\s\\S]+?)'
        names.push(match[1] as string)
        last = (match.index ?? 0) + match[0].length
      }
      const tail = value.slice(last)
      source += `${escapeRegex(tail)}$`
      literal += tail.length
      // A template that is (almost) all placeholders would swallow arbitrary text.
      if (literal < 2) continue
      patterns.push({ key: key as MessageKey, regex: new RegExp(source), names, weight: literal })
    }
  }
  for (const ns of INDEXED_NAMESPACES) walk(zhCN[ns], ns)
  patterns.sort((a, b) => b.weight - a.weight)
  return { exact, patterns }
}

/**
 * Translate a known package-emitted system message into `language`. Chinese UI (the source
 * language) and unknown text are returned unchanged.
 */
export function localizeKnown(text: string, language: Language): string
export function localizeKnown(text: string | undefined, language: Language): string | undefined
export function localizeKnown(text: string | undefined, language: Language, depth = 0): string | undefined {
  if (!text || language === 'zh-CN' || depth > MAX_DEPTH) return text
  index ??= buildIndex()
  const trimmed = text.trim()
  const exactKey = index.exact.get(trimmed)
  if (exactKey) return translate(language, exactKey)
  for (const pattern of index.patterns) {
    const match = pattern.regex.exec(trimmed)
    if (!match) continue
    const params: Record<string, string> = {}
    pattern.names.forEach((name, i) => {
      params[name] = (localizeKnown as (t: string, l: Language, d: number) => string)(
        match[i + 1] ?? '',
        language,
        depth + 1,
      )
    })
    return translate(language, pattern.key, params)
  }
  return text
}

/** Test hook: rebuild the index after catalog changes. */
function __resetKnownIndexForTests(): void {
  index = undefined
}
