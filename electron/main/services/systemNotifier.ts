/**
 * System notifications for things that wait on the user while AIWC is in the background: an Agent approval, a reply
 * draft, a paused auto reply, a finished scheduled task. Inside the app the same events already show a toast or a
 * card; the OS notification only exists for the user who is in WeChat or elsewhere. So it is shown only when no AIWC
 * window has focus, once per key within a short window, and a click brings the window back before running the
 * notice's command (CLAUDE.md §12: the command opens the right tab in either layout).
 *
 * The Electron Notification is injected (`show`), which keeps this module testable.
 */

/** Same key within this window → shown once (a burst of drafts for one chat, an event delivered twice). */
export const NOTICE_DEDUPE_MS = 3_000

export interface AttentionNotice {
  /** Dedupe key: one notice per key within NOTICE_DEDUPE_MS. */
  key: string
  title: string
  body?: string
  /** Renderer command run once the window is in front (the same `app:command` the menu uses). */
  action?: { command: string; payload?: unknown }
}

export interface NativeNotification {
  close(): void
}

export interface ShowRequest {
  title: string
  body?: string
  onClick(): void
  onClose(): void
}

export interface SystemNotifierDeps {
  /** Notification.isSupported(). */
  isSupported(): boolean
  /** Any AIWC window has focus: the in-app toast is enough. */
  isAppFocused(): boolean
  /** 设置 › 常规 › 系统通知. */
  enabled(): boolean
  show(request: ShowRequest): NativeNotification | undefined
  /** Show, restore and focus the main window (creating it if it was closed to the tray / Dock). */
  reveal(): void
  runCommand(command: string, payload?: unknown): void
  now?: () => number
  logger?: (level: 'debug' | 'warn', msg: string, meta?: unknown) => void
}

export interface SystemNotifier {
  notify(notice: AttentionNotice): void
  /** Close what is still on screen. */
  dispose(): void
}

export interface NotifyDecisionInput {
  enabled: boolean
  supported: boolean
  focused: boolean
  /** When a notice with the same key was last shown. */
  lastShownAt: number | undefined
  now: number
}

/** Pure policy: is this notice worth a system notification right now? */
export function shouldNotify(input: NotifyDecisionInput): boolean {
  if (!input.enabled || !input.supported || input.focused) return false
  return input.lastShownAt === undefined || input.now - input.lastShownAt >= NOTICE_DEDUPE_MS
}

export function createSystemNotifier(deps: SystemNotifierDeps): SystemNotifier {
  const now = deps.now ?? Date.now
  const lastShown = new Map<string, number>()
  // Electron drops click handlers of a Notification that was garbage collected: keep each one until it is done.
  const live = new Set<NativeNotification>()

  return {
    notify(notice) {
      const at = now()
      const decide = shouldNotify({
        enabled: deps.enabled(),
        supported: deps.isSupported(),
        focused: deps.isAppFocused(),
        lastShownAt: lastShown.get(notice.key),
        now: at,
      })
      if (!decide) return
      lastShown.set(notice.key, at)
      for (const [key, shownAt] of lastShown) if (at - shownAt >= NOTICE_DEDUPE_MS) lastShown.delete(key)
      try {
        // The OS calls back after show() returned, so `handle` is set by then.
        const handle: NativeNotification | undefined = deps.show({
          title: notice.title,
          body: notice.body,
          onClick: () => {
            if (handle) live.delete(handle)
            deps.reveal()
            if (notice.action) deps.runCommand(notice.action.command, notice.action.payload)
          },
          onClose: () => {
            if (handle) live.delete(handle)
          },
        })
        if (handle) live.add(handle)
      } catch (err) {
        // A notification is a courtesy: the in-app toast has already been shown.
        deps.logger?.('warn', 'system notification failed', { err: String(err) })
      }
    },
    dispose() {
      for (const n of live) {
        try {
          n.close()
        } catch {
          // already gone
        }
      }
      live.clear()
    },
  }
}
