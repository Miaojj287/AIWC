/**
 * Pieces of a child run (delegate_analysis / workflow_run step) that outlive or watch it: the trace kept with the
 * parent's tool result so the transcript can still show what the child did after a reload, and the approval waits
 * that pause the parent's clocks (a step waiting for the user is not working time — CLAUDE.md §5).
 */
import {
  SUBAGENT_TRACE_MAX_ITEMS,
  SUBAGENT_TRACE_OUTPUT_CHARS,
  type ApprovalId,
  type AssistantMessageItem,
  type Event,
  type HistoryItem,
  type SubagentTrace,
  type ToolCallItem,
  type ToolResultItem,
} from '@aiwc/protocol'

const shorten = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)

/** Longest reply / reasoning text kept per trace item. */
const SUBAGENT_TRACE_TEXT_CHARS = 4000
/** Upper bound of one serialized trace: it is stored with the parent's tool result and replayed on every reload. */
export const SUBAGENT_TRACE_MAX_BYTES = 64 * 1024

/** Room for the `items` / `omitted` keys around the measured parts. */
const TRACE_ENVELOPE_BYTES = 64

const utf8Bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').length

function boundedReply(item: AssistantMessageItem): AssistantMessageItem {
  const text = shorten(item.text, SUBAGENT_TRACE_TEXT_CHARS)
  const reasoning = item.reasoning === undefined ? undefined : shorten(item.reasoning, SUBAGENT_TRACE_TEXT_CHARS)
  if (text === item.text && reasoning === item.reasoning) return item
  return { ...item, text, ...(reasoning !== undefined ? { reasoning } : {}) }
}

function boundedCall(item: ToolCallItem): ToolCallItem {
  const text = JSON.stringify(item.input) ?? ''
  // the arguments as a shortened string: still readable in the row, no longer parseable (nothing re-runs them)
  return text.length > SUBAGENT_TRACE_OUTPUT_CHARS
    ? { ...item, input: shorten(text, SUBAGENT_TRACE_OUTPUT_CHARS) }
    : item
}

function boundedResult(item: ToolResultItem): ToolResultItem {
  const { subagents: _nested, artifacts: _files, ...rest } = item
  switch (item.output.type) {
    case 'text':
      return { ...rest, output: { type: 'text', text: shorten(item.output.text, SUBAGENT_TRACE_OUTPUT_CHARS) } }
    case 'json': {
      const text = JSON.stringify(item.output.value) ?? ''
      return text.length > SUBAGENT_TRACE_OUTPUT_CHARS
        ? { ...rest, output: { type: 'text', text: shorten(text, SUBAGENT_TRACE_OUTPUT_CHARS) }, truncated: true }
        : rest
    }
    case 'image':
      // an image is the tool's output for the model; the trace keeps only that there was one
      return { ...rest, output: { type: 'text', text: `[image ${item.output.mediaType}]` } }
  }
}

/**
 * The child's work as the transcript shows it: replies, tool calls and results (texts, arguments and outputs shortened,
 * images dropped), newest SUBAGENT_TRACE_MAX_ITEMS kept and at most SUBAGENT_TRACE_MAX_BYTES in all. The prompt (the parent's instruction with the child preamble) and the
 * context fragments are the model's input, not the child's work, so they are left out.
 */
export function buildSubagentTrace(
  items: readonly HistoryItem[],
  meta: Omit<SubagentTrace, 'items' | 'omitted'>,
): SubagentTrace {
  const work: HistoryItem[] = []
  for (const item of items) {
    if (item.type === 'assistant_message') work.push(boundedReply(item))
    else if (item.type === 'tool_call') work.push(boundedCall(item))
    else if (item.type === 'tool_result') work.push(boundedResult(item))
  }
  let omitted = Math.max(0, work.length - SUBAGENT_TRACE_MAX_ITEMS)
  // then the oldest go until the whole trace fits its byte budget (the newest item always stays)
  let bytes = work.slice(omitted).reduce((sum, item) => sum + utf8Bytes(item) + 1, utf8Bytes(meta))
  while (bytes > SUBAGENT_TRACE_MAX_BYTES - TRACE_ENVELOPE_BYTES && omitted < work.length - 1) {
    bytes -= utf8Bytes(work[omitted]) + 1
    omitted++
  }
  return { ...meta, items: omitted ? work.slice(omitted) : work, ...(omitted ? { omitted } : {}) }
}

/**
 * Watches a child's approval events and holds `onWait` (the parent's clocks) paused while any is open. `stop()`
 * ends every wait still open (the child was cut off mid-question).
 */
export function watchApprovalWaits(
  emit: (event: Event) => void,
  childId: string,
  onWait: (() => () => void) | undefined,
): { emit: (event: Event) => void; stop: () => void } {
  const open = new Map<ApprovalId, () => void>()
  return {
    emit(event) {
      if (onWait && event.threadId === childId) {
        if (event.type === 'approval.requested' && !open.has(event.approvalId)) open.set(event.approvalId, onWait())
        else if (event.type === 'approval.resolved') {
          open.get(event.approvalId)?.()
          open.delete(event.approvalId)
        }
      }
      emit(event)
    },
    stop() {
      for (const resume of open.values()) resume()
      open.clear()
    },
  }
}
