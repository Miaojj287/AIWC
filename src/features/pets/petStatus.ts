/**
 * The pet's status readout (Codex-style): how many Agent threads are running, waiting for the user, finished or
 * failed unseen, and how many WeChat messages are unread. Pure — the agent feature computes the counts
 * (PetFleet), this module decides which readouts show, in what order, and what they say.
 */
import type { PetConfig } from '@aiwc/protocol'
import { t } from '@/i18n'

/** Counts across every Agent thread plus WeChat unread (computed by the agent feature). */
export interface PetFleet {
  /** Generating, not waiting for anyone. */
  running: number
  /** An approval or a question is waiting for the user. */
  waiting: number
  /** Finished while the user was not looking; cleared once the thread is opened. */
  done: number
  /** Ended in an error, a timeout, the step cap or the loop guard while the user was not looking. */
  failed: number
  /** Thread to open for each count (most recent first, the thread already on screen skipped). */
  targets: Partial<Record<PetThreadStatus, string>>
  /** Unread WeChat messages; undefined while unknown (not connected). */
  unread?: { messages: number; chats: number; capped: boolean }
}

export type PetThreadStatus = 'waiting' | 'running' | 'done' | 'failed'
export type PetStatusKind = PetThreadStatus | 'unread'

export interface PetStatusItem {
  kind: PetStatusKind
  count: number
  /** Short count as shown (99+). */
  text: string
  /** Full sentence for the tooltip and screen readers. */
  label: string
  /** Thread to open on click; undefined for unread (opens the chat list) or when nothing new would open. */
  threadId?: string
  /** Clicking does something (opens a thread, or the unread chats). */
  actionable: boolean
}

export type PetStatusToggles = Pick<PetConfig, 'showRunning' | 'showDone' | 'showUnread'>

const MAX_SHOWN = 99

const short = (n: number, capped = false): string =>
  n > MAX_SHOWN || capped ? `${Math.min(n, MAX_SHOWN)}+` : String(n)

/** Order: needs you > working > finished > failed > WeChat — the most urgent reads first. */
export function petStatusItems(fleet: PetFleet | undefined, toggles: PetStatusToggles): PetStatusItem[] {
  if (!fleet) return []
  const items: PetStatusItem[] = []
  const thread = (kind: PetThreadStatus, count: number) => {
    if (count <= 0) return
    const threadId = fleet.targets[kind]
    items.push({
      kind,
      count,
      text: short(count),
      label: t(`pets.status.${kind}`, { n: count }),
      threadId,
      actionable: threadId !== undefined,
    })
  }
  if (toggles.showRunning) {
    thread('waiting', fleet.waiting)
    thread('running', fleet.running)
  }
  if (toggles.showDone) {
    thread('done', fleet.done)
    thread('failed', fleet.failed)
  }
  const unread = fleet.unread
  if (toggles.showUnread && unread && unread.messages > 0) {
    items.push({
      kind: 'unread',
      count: unread.messages,
      text: short(unread.messages, unread.capped),
      label: unread.capped
        ? t('pets.status.unreadCapped', { n: unread.messages })
        : t('pets.status.unread', { n: unread.messages, chats: unread.chats }),
      actionable: true,
    })
  }
  return items
}

/** One sentence for the whole readout (pet tooltip, the readout's group label). */
export function petStatusSummary(items: readonly PetStatusItem[]): string | undefined {
  if (items.length === 0) return undefined
  return items.map((item) => item.label).join(t('pets.status.separator'))
}

/** A sample readout for 设置 › 宠物, so the toggles show what they do before anything is running. */
export const PREVIEW_FLEET: PetFleet = {
  running: 2,
  waiting: 0,
  done: 1,
  failed: 0,
  targets: {},
  unread: { messages: 5, chats: 2, capped: false },
}
