/**
 * Message-format runtime shared by the renderer (src/i18n) and the main process (electron/main/i18n).
 * No dependencies, no React. A catalog is a plain nested object; a key is its dotted path; a value is
 * a template in a small ICU subset:
 *
 *   `{name}`                                          interpolation
 *   `{n, plural, =0 {none} one {# item} other {# items}}`  `#` = the number; categories via Intl.PluralRules
 *   `{kind, select, dm {单聊} group {群聊} other {会话}}`   enum branches; `other` is the fallback
 *
 * Literal braces are not supported on purpose — UI copy never needs them and the parser stays tiny.
 */

export type MessageTree = { readonly [key: string]: string | MessageTree }

/** Every leaf widened to `string` — the shape one catalog imposes on the others. */
export type DeepStrings<T> = { readonly [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> }

/** Union of dotted leaf paths: `'common.cancel' | 'chat.header.export' | …`. */
export type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends MessageTree ? `${K}.${DotPaths<T[K]>}` : never
}[keyof T & string]

export type MessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>

type Node =
  | { type: 'text'; value: string }
  | { type: 'arg'; name: string }
  | { type: 'pound' }
  | { type: 'plural' | 'select'; name: string; branches: ReadonlyMap<string, readonly Node[]> }

/** Walk `tree` along a dotted key; undefined when any segment is missing or lands on a subtree. */
export function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

const parsed = new Map<string, readonly Node[]>()

function parse(template: string): readonly Node[] {
  const cached = parsed.get(template)
  if (cached) return cached
  const [nodes, end] = parseNodes(template, 0, false)
  if (end !== template.length) throw new Error(`i18n: unbalanced braces in "${template}"`)
  parsed.set(template, nodes)
  return nodes
}

/** Parse until the end of input or an unmatched `}` (which closes the enclosing branch). */
function parseNodes(src: string, start: number, inPlural: boolean): [Node[], number] {
  const nodes: Node[] = []
  let i = start
  let text = ''
  const flush = () => {
    if (text) nodes.push({ type: 'text', value: text })
    text = ''
  }
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === '}') {
      flush()
      return [nodes, i]
    }
    if (ch === '#' && inPlural) {
      flush()
      nodes.push({ type: 'pound' })
      i++
      continue
    }
    if (ch !== '{') {
      text += ch
      i++
      continue
    }
    flush()
    const [node, next] = parseArgument(src, i + 1)
    nodes.push(node)
    i = next
  }
  flush()
  return [nodes, i]
}

function parseArgument(src: string, start: number): [Node, number] {
  let i = start
  let name = ''
  while (i < src.length && src[i] !== ',' && src[i] !== '}') name += src[i++]
  name = name.trim()
  if (!name) throw new Error(`i18n: empty argument in "${src}"`)
  if (src[i] === '}') return [{ type: 'arg', name }, i + 1]
  i++ // ','
  let kind = ''
  while (i < src.length && src[i] !== ',') kind += src[i++]
  kind = kind.trim()
  if (kind !== 'plural' && kind !== 'select') throw new Error(`i18n: unsupported argument type "${kind}" in "${src}"`)
  i++ // ','
  const branches = new Map<string, readonly Node[]>()
  for (;;) {
    while (i < src.length && /\s/.test(src[i] as string)) i++
    if (i >= src.length) throw new Error(`i18n: unterminated ${kind} in "${src}"`)
    if (src[i] === '}') {
      i++
      break
    }
    let selector = ''
    while (i < src.length && src[i] !== '{' && !/\s/.test(src[i] as string)) selector += src[i++]
    while (i < src.length && /\s/.test(src[i] as string)) i++
    if (src[i] !== '{') throw new Error(`i18n: expected "{" after "${selector}" in "${src}"`)
    const [body, end] = parseNodes(src, i + 1, kind === 'plural')
    if (src[end] !== '}') throw new Error(`i18n: unterminated branch "${selector}" in "${src}"`)
    branches.set(selector, body)
    i = end + 1
  }
  if (!branches.has('other')) throw new Error(`i18n: ${kind} without "other" branch in "${src}"`)
  return [{ type: kind, name, branches }, i]
}

const pluralRules = new Map<string, Intl.PluralRules | null>()

function pluralCategory(language: string, n: number): string {
  let rules = pluralRules.get(language)
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(language)
    } catch {
      rules = null
    }
    pluralRules.set(language, rules)
  }
  if (rules) return rules.select(n)
  return n === 1 ? 'one' : 'other'
}

function render(nodes: readonly Node[], params: MessageParams, language: string, pound: number | undefined): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value
        break
      case 'pound':
        out += pound === undefined ? '#' : String(pound)
        break
      case 'arg': {
        const value = params[node.name]
        // A missing parameter stays visible as `{name}` so the gap is noticed instead of silently blank.
        out += value === undefined || value === null ? `{${node.name}}` : String(value)
        break
      }
      case 'plural': {
        const n = Number(params[node.name] ?? 0)
        const branch =
          node.branches.get(`=${n}`) ??
          node.branches.get(pluralCategory(language, n)) ??
          node.branches.get('other') ??
          []
        out += render(branch, params, language, n)
        break
      }
      case 'select': {
        const value = String(params[node.name] ?? 'other')
        const branch = node.branches.get(value) ?? node.branches.get('other') ?? []
        out += render(branch, params, language, pound)
        break
      }
    }
  }
  return out
}

/** Interpolate `template` with `params`; `language` picks the plural rules (BCP 47 tag). */
export function formatMessage(template: string, params: MessageParams = {}, language = 'en-US'): string {
  if (!template.includes('{')) return template
  return render(parse(template), params, language, undefined)
}

/** Placeholder names a template refers to — used by the catalog parity test. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>()
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (node.type === 'arg' || node.type === 'plural' || node.type === 'select') names.add(node.name)
      if (node.type === 'plural' || node.type === 'select') for (const branch of node.branches.values()) walk(branch)
    }
  }
  if (template.includes('{')) walk(parse(template))
  return [...names].sort()
}

/** Dotted leaf keys of a catalog, sorted — the other half of the parity test. */
export function leafKeys(tree: MessageTree, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') keys.push(path)
    else keys.push(...leafKeys(value, path))
  }
  return keys.sort()
}
