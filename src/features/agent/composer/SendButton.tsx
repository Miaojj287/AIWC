/**
 * Send / stop — the 28px square-ish control at the end of the composer toolbar. While the agent runs and the draft
 * is empty it is 停止生成 (neutral ground, filled square, Esc); as soon as there is something to send it turns back
 * into 发送 — mid-turn that message steers the running turn. Empty and idle = a neutral send (no accent until there
 * is something to send, so an empty composer carries no blue). Not a kit Button
 * variant on purpose: it is the one icon-only accent control and lives only in the composer.
 */
import { ArrowUp, Square } from 'lucide-react'
import { useT } from '@/i18n'
import { cn, ICON_STROKE, Tooltip } from '@/kit'

export interface SendButtonProps {
  mode: 'send' | 'stop'
  disabled?: boolean
  /** Sending now steers the running turn (tooltip says so). */
  steer?: boolean
  onSend: () => void
  onStop?: () => void
  /** The send key as the tooltip shows it (↵, ⌘↵ or Ctrl+Enter — 设置 › 常规 › 发送消息). */
  sendKey?: string
}

export function SendButton({ mode, disabled = false, steer = false, onSend, onStop, sendKey = '↵' }: SendButtonProps) {
  const t = useT()
  const stop = mode === 'stop'
  const label = stop
    ? t('agent.turn.stop')
    : disabled
      ? t('agent.composer.typeToSend')
      : steer
        ? t('agent.composer.steer')
        : t('common.send')
  return (
    <Tooltip content={label} kbd={stop ? 'Esc' : disabled ? undefined : sendKey} side="top">
      <button
        type="button"
        aria-label={label}
        aria-disabled={!stop && disabled ? true : undefined}
        aria-keyshortcuts={stop ? 'Escape' : undefined}
        data-mode={mode}
        onClick={() => {
          if (stop) onStop?.()
          else if (!disabled) onSend()
        }}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-item outline-none transition-colors',
          stop
            ? 'bg-(--fill-13) text-fg hover:bg-(--fill-20)'
            : disabled
              ? 'cursor-not-allowed bg-(--fill-13) text-fg-3'
              : 'bg-accent text-(--fg-on-accent) hover:bg-accent-hover active:bg-accent-active',
        )}
      >
        {stop ? (
          <Square size={12} strokeWidth={ICON_STROKE} fill="currentColor" aria-hidden />
        ) : (
          <ArrowUp size={16} strokeWidth={2} aria-hidden />
        )}
      </button>
    </Tooltip>
  )
}
