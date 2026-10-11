/**
 * The prompt being edited in place (编辑 on a sent prompt). One at a time: starting an edit elsewhere ends the
 * previous one. The edited text lives here rather than in the bubble, so it survives what happens after 发送 —
 * cancelling the rewind confirmation keeps the editor open with the edit, and a rewind that fails leaves it too;
 * a rewind that goes ahead removes the prompt (and with it the editor).
 */
import { create } from 'zustand'
import type { Mention } from '@aiwc/protocol'

export interface PromptEdit {
  itemId: string
  text: string
  mentions: Mention[]
}

interface PromptEditState {
  editing?: PromptEdit
}

export const usePromptEditStore = create<PromptEditState>(() => ({}))

export function startPromptEdit(edit: PromptEdit): void {
  usePromptEditStore.setState({ editing: edit })
}

/** Keep the editor's text and chips (only for the prompt being edited). */
export function updatePromptEdit(itemId: string, text: string, mentions: Mention[]): void {
  const current = usePromptEditStore.getState().editing
  if (current?.itemId === itemId) usePromptEditStore.setState({ editing: { itemId, text, mentions } })
}

export function endPromptEdit(itemId: string): void {
  if (usePromptEditStore.getState().editing?.itemId === itemId) usePromptEditStore.setState({ editing: undefined })
}
