/**
 * Under the last prompt when nothing answered it: the app quit or crashed mid-turn, so the kernel recorded the prompt
 * but no reply, no stop marker and no error. Offers 重新发送 (a new turn with the same text and mentions) or 忽略;
 * dismissals are kept per viewer in localStorage, best effort.
 */
import { CircleAlert, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { Button, ICON_STROKE } from '@/kit'
import type { ThreadItem } from '../model'

type UserItem = Extract<ThreadItem, { kind: 'user' }>

const DISMISSED_KEY = 'aiwc.agent.unansweredDismissed'
/** Item ids are unique across threads; the oldest dismissals fall off. */
const DISMISSED_MAX = 200

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    // storage blocked or corrupt: nothing was dismissed
    return []
  }
}

function rememberDismissed(id: string): void {
  try {
    const next = [...readDismissed().filter((v) => v !== id), id].slice(-DISMISSED_MAX)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
  } catch {
    // storage blocked: the notice is hidden for this session only
  }
}

export interface UnansweredNoticeProps {
  item: UserItem
  onResend: (item: UserItem) => void
}

export function UnansweredNotice({ item, onResend }: UnansweredNoticeProps) {
  const t = useT()
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(item.id))
  if (dismissed) return null
  return (
    <div role="status" data-item="unanswered" className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex min-w-0 items-center gap-1.5 text-caption text-fg-3">
        <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-warn" />
        <span className="min-w-0 truncate">{t('agent.unanswered.title')}</span>
      </span>
      <span className="flex items-center gap-1">
        <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => onResend(item)}>
          {t('agent.message.resend')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            rememberDismissed(item.id)
            setDismissed(true)
          }}
        >
          {t('agent.unanswered.dismiss')}
        </Button>
      </span>
    </div>
  )
}
