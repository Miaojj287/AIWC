/**
 * Reply desk feature — registers the 回复台 Tab (kind 'replydesk', single instance), the
 * `tab.openReplyDesk` command, and starts the draft store so the shell badge is live from boot.
 */
import { onCommand } from '@/app/commands'
import { t } from '@/i18n'
import { registerTab } from '@/workspace/tabRegistry'
import { useTabsStore } from '@/workspace/tabsStore'
import { ReplyDeskTab } from './ReplyDeskTab'
import { startReplyDesk } from './store'

/** `title` is only a stored fallback; the strip shows the localized title registered in `register()`. */
export const REPLYDESK_TAB = { kind: 'replydesk', objectId: 'replydesk', title: 'replydesk' } as const

let registered = false

export function register(): void {
  if (registered) return
  registered = true
  registerTab({ kind: 'replydesk', icon: 'inbox', component: ReplyDeskTab, title: () => t('replydesk.tab.title') })
  onCommand('tab.openReplyDesk', () => openReplyDesk())
  void startReplyDesk()
}

export function openReplyDesk(): string {
  return useTabsStore.getState().open({ ...REPLYDESK_TAB })
}

export * from './reducer'
