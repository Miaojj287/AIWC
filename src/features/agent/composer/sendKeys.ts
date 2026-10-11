/**
 * What Enter does in the composer (设置 › 常规 › 发送消息, ui.composerSendKey):
 *  - `enter`: ↵ sends, ⇧↵ is a new line (⌘↵ / Ctrl+Enter also sends);
 *  - `modEnter`: ⌘↵ (macOS) / Ctrl+Enter sends, ↵ and ⇧↵ are new lines.
 * ⌥↵ / Alt+Enter queues the message while a turn runs (sent when it ends); when idle it simply sends. Pure — tested
 * in sendKeys.test.ts; the shortcut sheet and the send button tooltip use the same labels.
 */
import type { ComposerSendKey } from '@aiwc/protocol'
import { formatShortcut } from '@/app/shortcuts'

export type ComposerKeyAction = 'send' | 'queue'

type EnterLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>

export function composerKeyAction(
  e: EnterLike,
  opts: { sendKey: ComposerSendKey; mac: boolean; streaming: boolean; canQueue: boolean },
): ComposerKeyAction | undefined {
  if (e.key !== 'Enter' || e.shiftKey) return undefined
  if (e.altKey) return opts.streaming && opts.canQueue ? 'queue' : 'send'
  const mod = opts.mac ? e.metaKey : e.ctrlKey
  if (opts.sendKey === 'enter') return 'send'
  return mod ? 'send' : undefined
}

/** ↵ / ⌘↵ / Ctrl+Enter for the send button tooltip and the shortcut sheet. */
export const sendKeyLabel = (sendKey: ComposerSendKey, mac: boolean): string =>
  formatShortcut({ key: 'Enter', mod: sendKey === 'modEnter' }, mac)

/** The new-line key for the current send key. */
export const newlineKeyLabel = (sendKey: ComposerSendKey, mac: boolean): string =>
  formatShortcut({ key: 'Enter', mod: false, shift: sendKey === 'enter' }, mac)

export const queueKeyLabel = (mac: boolean): string => formatShortcut({ key: 'Enter', mod: false, alt: true }, mac)
