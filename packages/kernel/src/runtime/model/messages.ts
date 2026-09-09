/**
 * HistoryItem[] → ModelMessage[] (AI SDK v7 shapes). The kernel stores canonical items; this conversion is
 * done per request. Consecutive user-role material (user text, fragments, summaries) is merged into one
 * message so providers that require strict alternation are happy.
 */
import type { HistoryItem, ToolResultItem } from '@aiwc/protocol'
import type { AssistantModelMessage, ModelMessage, ToolModelMessage, UserModelMessage } from 'ai'
import { turnAbortedFragment } from '../context/fragments/turnAborted'
import { isImagePlaceholder, renderToolOutput } from '../context/manager'

type UserPart = Exclude<UserModelMessage['content'], string>[number]
type AssistantPart = Exclude<AssistantModelMessage['content'], string>[number]
type ToolPart = ToolModelMessage['content'][number]
type ToolResultOutput = Extract<ToolPart, { type: 'tool-result' }>['output']

/**
 * Image outputs are never sent as base64: history holds the bounded placeholder (ContextManager) and the
 * model sees the same one-line description, so the model-visible text matches what is persisted.
 */
export function toolResultOutput(item: ToolResultItem): ToolResultOutput {
  const out = item.output
  if (item.isError) return { type: 'error-text', value: renderToolOutput(out) }
  switch (out.type) {
    case 'text':
      return { type: 'text', value: out.text }
    case 'json':
      return isImagePlaceholder(out.value) ? { type: 'text', value: renderToolOutput(out) } : { type: 'json', value: out.value }
    case 'image':
      return { type: 'text', value: renderToolOutput(out) }
  }
}

export function historyToModelMessages(items: readonly HistoryItem[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  let userParts: UserPart[] = []
  let assistant: { message: AssistantModelMessage; parts: AssistantPart[]; stepId: string } | undefined
  let tool: { message: ToolModelMessage; parts: ToolPart[] } | undefined
  const knownCalls = new Set<string>()

  const flushUser = (): void => {
    if (userParts.length === 0) return
    messages.push({ role: 'user', content: userParts })
    userParts = []
  }
  const closeAssistant = (): void => {
    assistant = undefined
  }
  const closeTool = (): void => {
    tool = undefined
  }
  const pushUserText = (text: string): void => {
    closeAssistant()
    closeTool()
    if (text.trim()) userParts.push({ type: 'text', text })
  }
  const openAssistant = (stepId: string): { message: AssistantModelMessage; parts: AssistantPart[]; stepId: string } => {
    flushUser()
    closeTool()
    if (assistant && assistant.stepId === stepId) return assistant
    const parts: AssistantPart[] = []
    const message: AssistantModelMessage = { role: 'assistant', content: parts }
    messages.push(message)
    assistant = { message, parts, stepId }
    return assistant
  }

  for (const item of items) {
    switch (item.type) {
      case 'user_message': {
        closeAssistant()
        closeTool()
        for (const p of item.content) {
          if (p.type === 'text') userParts.push({ type: 'text', text: p.text })
          else if (p.type === 'image') userParts.push({ type: 'image', image: p.data, mediaType: p.mediaType })
          else userParts.push({ type: 'file', data: p.data, mediaType: p.mediaType, filename: p.name })
        }
        break
      }
      case 'context_fragment':
        pushUserText(item.text)
        break
      case 'compaction_summary':
        pushUserText(`<compaction_summary>\n${item.summary}`)
        break
      case 'turn_aborted': {
        const f = turnAbortedFragment(item.reason)
        pushUserText(`${f.marker}\n${f.render()}`)
        break
      }
      case 'assistant_message': {
        if (!item.text && !item.reasoning) break
        const a = openAssistant(item.stepId)
        if (item.reasoning) a.parts.push({ type: 'reasoning', text: item.reasoning })
        if (item.text) a.parts.push({ type: 'text', text: item.text })
        break
      }
      case 'tool_call': {
        const a = openAssistant(item.stepId)
        a.parts.push({ type: 'tool-call', toolCallId: item.callId, toolName: item.toolName, input: item.input })
        knownCalls.add(item.callId)
        break
      }
      case 'tool_result': {
        if (!knownCalls.has(item.callId)) break
        flushUser()
        closeAssistant()
        if (!tool) {
          const parts: ToolPart[] = []
          const message: ToolModelMessage = { role: 'tool', content: parts }
          messages.push(message)
          tool = { message, parts }
        }
        tool.parts.push({ type: 'tool-result', toolCallId: item.callId, toolName: item.toolName, output: toolResultOutput(item) })
        break
      }
    }
  }
  flushUser()
  return messages.filter((m) => (typeof m.content === 'string' ? m.content.length > 0 : m.content.length > 0))
}
