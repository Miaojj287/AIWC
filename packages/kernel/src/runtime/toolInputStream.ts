/**
 * A tool call's arguments while the model is still writing them: raw JSON text deltas become throttled `tool.input`
 * events, so the transcript can show a search query or a file being written before the call is complete. The first
 * delta of a call goes out at once (the row appears with its tool name); later ones are batched to at most one event
 * per call every TOOL_INPUT_FLUSH_MS, and the rest is flushed when the whole call arrives. Display only — the
 * call's `tool.call` event replaces whatever the renderer parsed from the text.
 */
import type { CallId, Event, ThreadId, TurnId } from '@aiwc/protocol'

/** At most one `tool.input` event per call this often. */
export const TOOL_INPUT_FLUSH_MS = 100
/** Raw argument text streamed per call; past this the row waits for the finished call. */
export const TOOL_INPUT_MAX_CHARS = 64_000

interface Pending {
  toolName: string
  buffered: string
  sent: number
  lastAt: number
}

export interface ToolInputStream {
  push(callId: CallId, toolName: string, delta: string): void
  /** Send what is buffered for the call (it is complete). */
  flush(callId: CallId): void
  /** The attempt was dropped (stream retry): forget every call. */
  reset(): void
}

export function createToolInputStream(deps: {
  emit: (event: Event) => void
  threadId: ThreadId
  turnId: TurnId
  clock: () => number
}): ToolInputStream {
  const calls = new Map<CallId, Pending>()

  const send = (callId: CallId, p: Pending): void => {
    const room = TOOL_INPUT_MAX_CHARS - p.sent
    const delta = room > 0 ? p.buffered.slice(0, room) : ''
    p.buffered = ''
    p.lastAt = deps.clock()
    if (!delta && p.sent > 0) return
    p.sent += delta.length
    deps.emit({ type: 'tool.input', threadId: deps.threadId, turnId: deps.turnId, callId, toolName: p.toolName, delta })
  }

  return {
    push(callId, toolName, delta) {
      let p = calls.get(callId)
      if (!p) {
        p = { toolName, buffered: delta, sent: 0, lastAt: 0 }
        calls.set(callId, p)
        send(callId, p)
        return
      }
      p.buffered += delta
      if (deps.clock() - p.lastAt >= TOOL_INPUT_FLUSH_MS) send(callId, p)
    },
    flush(callId) {
      const p = calls.get(callId)
      if (p?.buffered) send(callId, p)
      calls.delete(callId)
    },
    reset() {
      calls.clear()
    },
  }
}
