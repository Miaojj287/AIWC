/**
 * Commands the owner can send from their phone to the Agent (我的微信 › 遥控): `/状态`, `/停止`, `/新会话`,
 * `/帮助` (English aliases too), and a bare digit that answers the pending approval. Everything else is a message
 * for the Agent — another `/name` included, so `/<技能>` reaches the kernel's skill invocation. Pure; full-width
 * digits and slashes (Chinese IME) count as their ASCII forms.
 */
import type { ApprovalDecision } from '@aiwc/protocol'

export type RemoteCommand =
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'new' }
  | { type: 'help' }
  /** A bare number 1–9: an answer to the pending approval when there is one, otherwise a plain message. */
  | { type: 'choice'; n: number }
  | { type: 'message'; text: string }

const ALIASES: Readonly<Record<string, 'status' | 'stop' | 'new' | 'help'>> = {
  状态: 'status',
  status: 'status',
  停止: 'stop',
  stop: 'stop',
  新会话: 'new',
  新建: 'new',
  new: 'new',
  帮助: 'help',
  help: 'help',
}

/** Full-width ASCII (U+FF01–U+FF5E) → ASCII, so `／状态` and `１` work from a Chinese keyboard. */
const toHalfWidth = (text: string): string =>
  text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))

export function parseRemoteCommand(raw: string): RemoteCommand {
  const text = raw.trim()
  const normalised = toHalfWidth(text).trim()
  const digit = /^([1-9])[.。、)]?$/.exec(normalised)
  if (digit?.[1]) return { type: 'choice', n: Number(digit[1]) }
  if (!normalised.startsWith('/')) return { type: 'message', text }
  const name = normalised.slice(1).split(/\s+/)[0] ?? ''
  const command = ALIASES[name.toLowerCase()]
  if (command) return { type: command }
  // `／周报` from a Chinese keyboard reaches the kernel as `/周报`, which is what skill invocation reads
  return { type: 'message', text: text.startsWith('／') ? `/${text.slice(1)}` : text }
}

/** Fixed numbering on the phone, mirroring the desktop approval card: 1 允许一次 / 2 总是允许 / 3 拒绝. */
export const APPROVAL_CHOICES = { allowOnce: 1, allowAlways: 2, deny: 3 } as const

/**
 * The decision a numbered reply stands for. `unavailable` = "2" for a call that cannot be allowed always (send /
 * destructive, or the gate would not honour it); `undefined` = not an approval choice at all.
 */
export function decisionForChoice(n: number, canAllowAlways: boolean): ApprovalDecision | 'unavailable' | undefined {
  switch (n) {
    case APPROVAL_CHOICES.allowOnce:
      return 'allow_once'
    case APPROVAL_CHOICES.allowAlways:
      return canAllowAlways ? 'allow_always' : 'unavailable'
    case APPROVAL_CHOICES.deny:
      return 'deny'
    default:
      return undefined
  }
}
