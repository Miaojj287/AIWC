/**
 * <Trans> — a message whose params include React elements (a bold word, a link, an icon):
 *
 *   <Trans k="kit.dialog.typeToConfirm" params={{ word: <strong>{word}</strong> }} />
 *
 * Primitive params format as usual (plural / select still work); element params are spliced in where
 * their `{placeholder}` appears, so word order stays under the translation's control.
 */
import { Fragment, type ReactNode } from 'react'
import { translate, type MessageKey } from '@aiwc/i18n'
import { useLanguageStore } from './index'

/** Private-use code point: cannot appear in catalog copy, so it safely marks where an element goes. */
const MARK = String.fromCharCode(0xe000)
const SPLIT = new RegExp(`${MARK}(\\d+)${MARK}`)

export interface TransProps {
  k: MessageKey
  params?: Readonly<Record<string, ReactNode>>
}

export function Trans({ k, params = {} }: TransProps) {
  const language = useLanguageStore((s) => s.language)
  const primitives: Record<string, string | number | boolean> = {}
  const nodes: ReactNode[] = []
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') primitives[name] = value
    else if (value === null || value === undefined) primitives[name] = ''
    else {
      primitives[name] = `${MARK}${nodes.length}${MARK}`
      nodes.push(value)
    }
  }
  const text = translate(language, k, primitives)
  if (nodes.length === 0) return <>{text}</>
  const parts = text.split(SPLIT)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          part ? (
            <Fragment key={i}>{part}</Fragment>
          ) : null
        ) : (
          <Fragment key={i}>{nodes[Number(part)]}</Fragment>
        ),
      )}
    </>
  )
}
