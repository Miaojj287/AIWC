/**
 * Send button — 28px round accent control with four states: default / hover / disabled (empty
 * input) / stop (streaming). Figma 150:902. Not a kit Button variant on purpose: it is the one
 * round control in the app and lives only in the composer.
 */
import { ArrowUp, Square } from 'lucide-react'
import { cn, ICON_STROKE, Tooltip } from '@/kit'

export interface SendButtonProps {
  mode: 'send' | 'stop'
  disabled?: boolean
  onSend: () => void
  onStop?: () => void
}

export function SendButton({ mode, disabled = false, onSend, onStop }: SendButtonProps) {
  const stop = mode === 'stop'
  const label = stop ? '停止生成' : disabled ? '输入内容后发送' : '发送'
  return (
    <Tooltip content={label} kbd={stop || disabled ? undefined : '↵'} side="top">
      <button
        type="button"
        aria-label={label}
        aria-disabled={!stop && disabled ? true : undefined}
        data-mode={mode}
        onClick={() => {
          if (stop) onStop?.()
          else if (!disabled) onSend()
        }}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-chip outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-accent/70',
          stop || !disabled ? 'bg-accent text-(--fg-on-accent) hover:bg-accent-hover active:bg-accent-active' : 'cursor-not-allowed bg-line-8 text-fg-3',
        )}
      >
        {stop ? <Square size={11} strokeWidth={ICON_STROKE} fill="currentColor" aria-hidden /> : <ArrowUp size={14} strokeWidth={2} aria-hidden />}
      </button>
    </Tooltip>
  )
}
