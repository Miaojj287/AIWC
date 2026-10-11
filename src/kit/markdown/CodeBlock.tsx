import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { cn } from '../cn'
import { IconButton } from '../IconButton'
import { toast } from '../toast/toastStore'
import { writeClipboard } from './clipboard'
import { MARKDOWN_CLASS } from './styles'

/** How long the copy button shows its ✓ after the code is on the clipboard. */
const COPIED_FLASH_MS = 1500

/** Fenced code with a 复制代码 button revealed on hover / keyboard focus (CLAUDE.md §4.1). */
export function MarkdownCodeBlock({ lang, code }: { lang?: string; code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await writeClipboard(code)
    } catch {
      toast.error(t('kit.markdown.copyFailed'))
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS)
  }

  return (
    <div className="group/code relative min-w-0">
      <pre className={MARKDOWN_CLASS.codeBlock}>
        <code data-lang={lang}>{code}</code>
      </pre>
      <IconButton
        size="xs"
        icon={copied ? Check : Copy}
        label={copied ? t('kit.markdown.copied') : t('kit.markdown.copyCode')}
        onClick={() => void copy()}
        className={cn(
          'absolute right-1 top-1 text-fg-3 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100',
          copied && 'opacity-100 text-ok',
        )}
      />
    </div>
  )
}
