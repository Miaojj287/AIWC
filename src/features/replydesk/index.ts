/**
 * Reply desk feature — registers the 回复台 Tab (kind 'replydesk', single instance), the
 * `tab.openReplyDesk` command, and starts the draft store so the shell badge is live from boot.
 */
import { onCommand } from '@/app/commands'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { ReplyDeskTab } from './ReplyDeskTab'
import { startReplyDesk } from './store'

export const REPLYDESK_TAB = { kind: 'replydesk', objectId: 'replydesk', title: '回复台' } as const

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'replydesk', icon: 'inbox', component: ReplyDeskTab })
  onCommand('tab.openReplyDesk', () => openReplyDesk())
  void startReplyDesk()
}

export function openReplyDesk(): string {
  return useTabsStore.getState().open({ ...REPLYDESK_TAB })
}

export { ReplyDeskTab } from './ReplyDeskTab'
export { DraftCard, type DraftCardProps } from './DraftCard'
export { useReplyDeskCount, useReplyDeskStore, startReplyDesk } from './store'
export * from './reducer'
