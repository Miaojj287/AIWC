/**
 * Tool cards — rich content a feature renders under its own tool-call rows (a live authorization
 * card, a result link), plus the one-line approval note for its tools when the generic risk copy
 * would be wrong ("以你的微信身份发送" is not what pushing a table to 飞书 does). The agent panel stays
 * ignorant of every other feature: features register by tool name from their `register()`.
 */
import type { ComponentType } from 'react'
import type { Translator } from '@/i18n'
import type { ApprovalRequest, ToolCallView } from './model'

export interface ToolCardProps {
  call: ToolCallView
}

export type ApprovalNote = (request: ApprovalRequest, t: Translator) => string | undefined

export interface ApprovalBodyProps {
  request: ApprovalRequest
}

const cards = new Map<string, ComponentType<ToolCardProps>>()
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

export function registerToolCard(toolName: string, card: ComponentType<ToolCardProps>): () => void {
  cards.set(toolName, card)
  return () => {
    if (cards.get(toolName) === card) cards.delete(toolName)
  }
}

export function toolCardFor(toolName: string): ComponentType<ToolCardProps> | undefined {
  return cards.get(toolName)
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
