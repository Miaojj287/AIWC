/**
 * A turn's time budget (KernelConfig.turnTimeoutMs). The clock stops while a tool call waits for the user's
 * approval: the agent is not working then, and an answer given after a long absence must find the turn alive
 * instead of a turn that timed out and settled the request as a denial. Everything else — model calls, tools,
 * compaction — keeps counting, so a stuck turn still ends.
 */

export interface TurnBudget {
  /** Stop the clock until the returned function is called; overlapping waits keep it stopped until the last ends. */
  pause(): () => void
  /** The turn ended: stop for good. */
  dispose(): void
}

export function createTurnBudget(ms: number, onExpire: () => void, now: () => number = Date.now): TurnBudget {
  let remaining = ms
  let startedAt = now()
  let waits = 0
  let disposed = false
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    timer = setTimeout(
      () => {
        timer = undefined
        expired = true
        if (!disposed) onExpire()
      },
      Math.max(0, remaining),
    )
    ;(timer as { unref?: () => void }).unref?.()
  }
  arm()

  return {
    pause() {
      if (disposed) return () => {}
      waits++
      if (waits === 1 && timer) {
        clearTimeout(timer)
        timer = undefined
        remaining -= now() - startedAt
      }
      let resumed = false
      return () => {
        if (resumed) return
        resumed = true
        waits--
        // A budget spent before the wait began runs out right away once it ends.
        if (waits === 0 && !disposed && !expired) {
          startedAt = now()
          arm()
        }
      }
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}
