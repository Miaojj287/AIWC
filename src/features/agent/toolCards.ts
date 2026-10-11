/**
 * Tool cards — rich content a feature renders under its own tool-call rows (a live authorization
 * card, a result link), plus the one-line approval note for its tools when the generic risk copy
 * would be wrong ("以你的微信身份发送" is not what pushing a table to 飞书 does). The agent panel stays
 * ignorant of every other feature: features register by tool name from their `register()`.
 */
import type { ComponentType } from 'react'
import type { Translator } from '@/i18n'
import type { IconComponent } from '@/kit'
import type { ApprovalRequest, ToolCallView } from './model'

export interface ToolCardProps {
  call: ToolCallView
}

export type ApprovalNote = (request: ApprovalRequest, t: Translator) => string | undefined

export interface ApprovalBodyProps {
  request: ApprovalRequest
}

/**
 * `inline` cards stay visible under the row (a live authorization link must not hide behind a click); `detail` cards
 * replace the input / output JSON when the row is expanded (a command and its output).
 */
export type ToolCardPlacement = 'inline' | 'detail'

interface RegisteredCard {
  card: ComponentType<ToolCardProps>
  placement: ToolCardPlacement
  /** The row's kind icon when the tool says more than its risk does (a terminal for `shell`); else the risk's icon. */
  icon?: IconComponent
}

const cards = new Map<string, RegisteredCard>()
const notes = new Map<string, ApprovalNote>()
const bodies = new Map<string, ComponentType<ApprovalBodyProps>>()

/** What the approval shows instead of the raw input JSON (a table preview, a command line). */
export function registerApprovalBody(toolName: string, body: ComponentType<ApprovalBodyProps>): () => void {
  bodies.set(toolName, body)
  return () => {
    if (bodies.get(toolName) === body) bodies.delete(toolName)
  }
}

export function approvalBodyFor(toolName: string): ComponentType<ApprovalBodyProps> | undefined {
  return bodies.get(toolName)
}

export function registerToolCard(
  toolName: string,
  card: ComponentType<ToolCardProps>,
  placement: ToolCardPlacement = 'inline',
  icon?: IconComponent,
): () => void {
  cards.set(toolName, { card, placement, icon })
  return () => {
    if (cards.get(toolName)?.card === card) cards.delete(toolName)
  }
}

export function toolCardFor(toolName: string): RegisteredCard | undefined {
  return cards.get(toolName)
}

const prefixIcons = new Map<string, IconComponent>()

/** The kind icon for a family of tools named by prefix (`mcp__` → a plug), when no card names the tool itself. */
export function registerToolIconPrefix(prefix: string, icon: IconComponent): () => void {
  prefixIcons.set(prefix, icon)
  return () => {
    if (prefixIcons.get(prefix) === icon) prefixIcons.delete(prefix)
  }
}

export function toolIconFor(toolName: string): IconComponent | undefined {
  const own = cards.get(toolName)?.icon
  if (own) return own
  for (const [prefix, icon] of prefixIcons) if (toolName.startsWith(prefix)) return icon
  return undefined
}

export function registerApprovalNote(toolName: string, note: ApprovalNote): () => void {
  notes.set(toolName, note)
  return () => {
    if (notes.get(toolName) === note) notes.delete(toolName)
  }
}

export function approvalNoteFor(request: ApprovalRequest, t: Translator): string | undefined {
  try {
    return notes.get(request.toolName)?.(request, t)
  } catch {
    return undefined
  }
}
