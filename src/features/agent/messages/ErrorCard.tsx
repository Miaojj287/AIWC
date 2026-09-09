import { CircleAlert, Layers, RefreshCw, Settings, X } from 'lucide-react'
import type { ErrorAction } from '@aiwc/protocol'
import { Button, ICON_STROKE, IconButton, type IconComponent } from '@/kit'
import type { ThreadItem } from '../model'

export type ErrorItem = Extract<ThreadItem, { kind: 'error' }>

export interface ErrorCardProps {
  item: ErrorItem
  onAction: (action: ErrorAction, item: ErrorItem) => void
  onDismiss?: (item: ErrorItem) => void
}

const TITLE_BY_CODE: Record<string, string> = {
  auth: '模型请求失败',
  rate_limit: '请求过于频繁',
  context_overflow: '上下文超出模型上限',
  network: '网络连接失败',
  invalid_request: '请求无效',
  unsupported_tools: '模型不支持工具调用',
  unknown: '出错了',
}

const ACTION_ICON: Partial<Record<ErrorAction['action'], IconComponent>> = {
  open_settings_ai: Settings,
  open_settings_account: Settings,
  retry: RefreshCw,
  compact: Layers,
}

/**
 * ErrorCard — danger-tinted card: title by error code, message, and the kernel-provided actions as
 * buttons (去改 Key / 重试…). Never a bare error string (CLAUDE.md §5). Figma 150:1072.
 */
export function ErrorCard({ item, onAction, onDismiss }: ErrorCardProps) {
  const title = TITLE_BY_CODE[item.error.code] ?? '出错了'
  const actions = item.actions.filter((a) => a.action !== 'dismiss')
  const dismiss = item.actions.find((a) => a.action === 'dismiss')
  const detail = 'status' in item.error && item.error.status ? `${item.error.status} · ${item.error.message}` : item.error.message
  return (
    <div role="alert" data-item="error" className="relative flex w-full flex-col gap-2 rounded-window border border-danger/30 bg-danger/8 px-3 py-2.5">
      <div className="flex items-center gap-2 pr-6">
        <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-danger" />
        <span className="min-w-0 truncate text-body font-medium text-danger">{title}</span>
      </div>
      <p className="m-0 break-words text-caption leading-4 text-fg-2 select-text">{detail}</p>
      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {actions.map((a, i) => (
            <Button key={`${a.action}-${i}`} size="sm" variant={a.action === 'retry' ? 'primary' : 'ghost'} icon={ACTION_ICON[a.action]} onClick={() => onAction(a, item)}>
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
      {onDismiss ? (
        <IconButton size="xs" icon={X} label={dismiss?.label ?? '关闭'} onClick={() => onDismiss(item)} className="absolute right-2 top-2 text-fg-3" />
      ) : null}
    </div>
  )
}
