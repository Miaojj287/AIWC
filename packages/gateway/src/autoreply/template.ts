/**
 * Fixed-text templates for auto-reply rules: {昵称} {时间} {群名}.
 */
import type { MessageEvent } from '@aiwc/protocol'

export interface TemplateVars {
  nickname: string
  time: string
  groupName: string
}

export function formatClock(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function templateVars(event: MessageEvent, names: { nickname?: string; groupName?: string } = {}, now = Date.now()): TemplateVars {
  const nickname = names.nickname ?? event.source.displayName ?? event.source.peerId
  const groupName = names.groupName ?? (event.source.chatType === 'group' ? event.source.displayName ?? event.source.chatId : '')
  return { nickname, time: formatClock(now), groupName }
}

const VAR_RE = /\{(昵称|时间|群名|nickname|time|group)\}/g

export function substituteTemplate(template: string, vars: TemplateVars): string {
  return template.replace(VAR_RE, (_m, key: string) => {
    switch (key) {
      case '昵称':
      case 'nickname':
        return vars.nickname
      case '时间':
      case 'time':
        return vars.time
      case '群名':
      case 'group':
        return vars.groupName
      default:
        return ''
    }
  })
}
