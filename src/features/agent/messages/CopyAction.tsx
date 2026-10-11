import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t, useT } from '@/i18n'
import { cn, IconButton, toast, Tooltip } from '@/kit'

/** How long the copy button shows its ✓ after a successful copy. */
const COPIED_FLASH_MS = 1200

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text)
    toast.success(t('agent.message.copied'))
    return true
  } catch {
    toast.error(t('common.copyFailed'))
    return false
  }
}

/** Icon-only copy action for a message: the icon turns into a ✓ for a moment after the text is on the clipboard. */
export function CopyAction({ text, className }: { text: string; className?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const label = copied ? t('agent.message.copied') : t('common.copy')
  return (
    <Tooltip content={label}>
      <IconButton
        size="sm"
        icon={copied ? Check : Copy}
        label={label}
        className={cn(copied ? 'text-ok' : 'text-fg-3', className)}
        onClick={() =>
          void copyText(text).then((ok) => {
            if (!ok) return
            setCopied(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS)
          })
        }
      />
    </Tooltip>
  )
}
