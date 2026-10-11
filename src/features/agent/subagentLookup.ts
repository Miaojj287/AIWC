/**
 * Finding a sub-agent's run by its child id across the conversations the panel holds (the log tab only knows the
 * child id; the run lives under its parent's tool row). Pure — tested in renderEvents.test.ts.
 */
import type { SubagentRun, ThreadViewState } from './model'

export function findSubagentRun(
  views: Readonly<Record<string, ThreadViewState>>,
  childId: string,
): { threadId: ThreadViewState['threadId']; run: SubagentRun } | undefined {
  for (const view of Object.values(views)) {
    for (let i = view.items.length - 1; i >= 0; i--) {
      const it = view.items[i]
      if (it?.kind !== 'tools') continue
      for (const call of it.calls) {
        const run = call.children?.find((r) => r.childId === childId)
        if (run) return { threadId: view.threadId, run }
      }
    }
  }
  return undefined
}
