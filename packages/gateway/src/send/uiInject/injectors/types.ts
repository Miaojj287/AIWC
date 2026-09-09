/**
 * Keyboard-injection port for the WeChat desktop client. Implementations only move focus, paste and
 * press Enter — they never decide *whether* to send; that is the sender's job (verify + halt).
 */
export type InjectFailure = 'unsupported' | 'no-window' | 'focus-failed' | 'busy' | 'no-permission'

export class InjectorError extends Error {
  constructor(
    public readonly reason: InjectFailure,
    message?: string,
  ) {
    super(message ?? reason)
    this.name = 'InjectorError'
  }
}

export interface WeChatInjector {
  /** Bring WeChat to the front and open the chat named `name` (search box → first result). */
  focusSession(name: string): Promise<void>
  /** Put `text` into the composer of the currently open chat WITHOUT sending. */
  fill(text: string): Promise<void>
  /** Press Enter once. Must be a no-op when the composer is empty. */
  commit(): Promise<void>
}

export const INJECT_FAILURE_TEXT: Record<InjectFailure, string> = {
  unsupported: '当前系统不支持自动发送',
  'no-window': '找不到微信窗口',
  'focus-failed': '微信窗口没能激活',
  busy: '输入通道一直被占用',
  'no-permission': '未授予辅助功能权限，请在「系统设置 → 隐私与安全性 → 辅助功能」中勾选 AIWC',
}
