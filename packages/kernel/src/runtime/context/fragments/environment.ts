import type { ChannelKind, ContextFragment, PermissionMode, ThreadOrigin } from '@aiwc/protocol'
import { createFragment } from './base'

export interface EnvironmentInput {
  platform: string
  /** Any Date; only the calendar day is rendered so the fragment stays cache-friendly within a day. */
  date: Date
  channel: ChannelKind
  origin?: ThreadOrigin
  permissionMode: PermissionMode
}

export const dayString = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MODE_LABEL: Record<PermissionMode, string> = {
  ask: 'Ask（写入前询问；发送 / 删除必须确认）',
  bypass: 'Bypass（读写放行；发送 / 删除仍需确认）',
}

export function environmentFragment(input: EnvironmentInput): ContextFragment {
  return createFragment('environment', '<environment>', 400, () => {
    const lines = [`平台：${input.platform}`, `日期：${dayString(input.date)}`, `通道：${input.channel}`]
    if (input.origin?.chatId) lines.push(`来源会话：${input.origin.chatId}`)
    lines.push(`权限模式：${MODE_LABEL[input.permissionMode]}`)
    return lines.join('\n')
  })
}
