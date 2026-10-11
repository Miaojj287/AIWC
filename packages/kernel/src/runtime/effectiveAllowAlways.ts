import type { ChannelKind, ThreadSettings } from '@aiwc/protocol'

/**
 * The allow-list a call is judged by: the thread's own grants, plus the global ones only on desktop-chat threads the
 * user drives at the computer — a scheduled task runs with exactly the grants its definition lists, bot threads never
 * honour grants, and the phone thread (origin 'wechat-remote', desktop toolset) builds its own list from the phone.
 */
export function effectiveAllowAlways(
  settings: ThreadSettings,
  global: readonly string[],
  channel: ChannelKind,
): readonly string[] {
  if (settings.profile !== 'desktop-chat' || channel !== 'desktop' || global.length === 0) return settings.allowAlways
  return [...settings.allowAlways, ...global.filter((key) => !settings.allowAlways.includes(key))]
}
