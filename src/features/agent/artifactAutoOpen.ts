/**
 * When a generated file opens by itself. Every file of a turn gets a result card; at most one opens in the workspace,
 * once, when the turn finishes — the last file the turn produced, in the thread the user is looking at. A file per
 * tool call opening tabs mid-turn (or a scheduled run in the background, or history being replayed) took the
 * workspace away from whatever the user was reading. Pure — tested in artifactAutoOpen.test.ts.
 */
import type { ChannelKind, ThreadId, ToolArtifact, TurnId } from '@aiwc/protocol'
import type { ThreadViewState } from './model'

/** The newest file card of the turn that can be opened. */
export function artifactToOpen(view: ThreadViewState, turnId: TurnId): ToolArtifact | undefined {
  for (let i = view.items.length - 1; i >= 0; i--) {
    const item = view.items[i]
    if (item?.kind === 'artifact' && item.turnId === turnId && item.artifact.path) return item.artifact
  }
  return undefined
}

export interface AutoOpenContext {
  threadId: ThreadId
  activeThreadId: ThreadId | null
  /** The Agent panel is collapsed (the Agent window never is). */
  collapsed: boolean
  channel: ChannelKind | undefined
}

/** Only the desktop thread on screen: the user asked for this file just now and is watching for it. */
export const shouldAutoOpen = (ctx: AutoOpenContext): boolean =>
  ctx.channel === 'desktop' && ctx.activeThreadId === ctx.threadId && !ctx.collapsed
