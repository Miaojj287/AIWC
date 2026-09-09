/**
 * Global keyboard shortcuts (DESIGN-SPEC §6, CLAUDE.md §4.8). One table drives three things:
 * the keydown → command dispatch, the labels shown in menus / tooltips (`shortcutLabel`), and the
 * tests. `mod` = ⌘ on macOS, Ctrl elsewhere.
 */
import { bridge } from '@/platform/bridge'
import { runCommand, type CommandMap, type CommandName } from './commands'

export interface ShortcutBinding {
  /** KeyboardEvent.key, lower-case for letters; ',' for ⌘, */
  key: string
  mod: boolean
  shift?: boolean
  alt?: boolean
  command: CommandName
  payload?: unknown
  /** Only active when the renderer runs in a plain browser (mock bridge). */
  webOnly?: boolean
}

export const SHORTCUTS: readonly ShortcutBinding[] = [
  { key: '1', mod: true, command: 'rail.select', payload: { fn: 'chat' } },
  { key: '2', mod: true, command: 'rail.select', payload: { fn: 'autoreply' } },
  { key: '3', mod: true, command: 'rail.select', payload: { fn: 'clone' } },
  { key: ',', mod: true, command: 'tab.openSettings', payload: {} },
  { key: 'k', mod: true, command: 'search.sessions' },
  { key: 'f', mod: true, command: 'search.inPage' },
  { key: 'n', mod: true, command: 'agent.newThread', payload: {} },
  { key: 'w', mod: true, command: 'tab.closeActive' },
  { key: 't', mod: true, shift: true, command: 'tab.reopenClosed' },
  { key: 'a', mod: true, shift: true, command: 'agent.quoteActiveTab' },
  { key: 'b', mod: true, shift: true, command: 'objectList.toggleCollapsed' },
  { key: 'j', mod: true, shift: true, command: 'agent.toggleCollapsed' },
  { key: 'k', mod: true, shift: true, command: 'tab.openKit', webOnly: true },
]

export interface ShortcutEnv {
  /** true → ⌘ is the modifier and labels use symbols; false → Ctrl. */
  mac: boolean
  /** true when running in a plain browser (enables `webOnly` bindings). Omitted → read from the bridge. */
  web?: boolean
}

/**
 * Fill in `web` when the caller did not decide: `webOnly` bindings (⌘⇧K kit gallery) are live exactly
 * when `bridge().runtime === 'web'`. Before the bridge is initialised (unit tests) they stay off.
 */
export function resolveShortcutEnv(env: ShortcutEnv): Required<ShortcutEnv> {
  if (env.web !== undefined) return { mac: env.mac, web: env.web }
  let web = false
  try {
    web = bridge().runtime === 'web'
  } catch {
    /* bridge not initialised → electron semantics */
  }
  return { mac: env.mac, web }
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

function normaliseKey(key: string): string {
  if (key.length === 1) return key.toLowerCase()
  return key
}

/** Find the binding a key event maps to (or undefined). Pure — used by the listener and by tests. */
export function matchShortcut(e: KeyLike, env: ShortcutEnv): ShortcutBinding | undefined {
  const mod = env.mac ? e.metaKey : e.ctrlKey
  const otherMod = env.mac ? e.ctrlKey : e.metaKey
  if (otherMod) return undefined
  const key = normaliseKey(e.key)
  return SHORTCUTS.find(
    (b) =>
      b.key === key &&
      b.mod === mod &&
      Boolean(b.shift) === e.shiftKey &&
      Boolean(b.alt) === e.altKey &&
      (!b.webOnly || Boolean(env.web)),
  )
}

/** Dispatch a matched binding through the command bus. */
export function dispatchShortcut(binding: ShortcutBinding): void {
  const run = runCommand as unknown as (name: CommandName, payload?: unknown) => void
  run(binding.command, binding.payload)
}

/**
 * Install the window-level keydown listener. Handled events are consumed (preventDefault) so the
 * browser / Electron default (⌘W closing the window, ⌘F find bar) never fires.
 */
export function installShortcuts(env: ShortcutEnv, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const resolved = resolveShortcutEnv(env)
  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent
    if (e.defaultPrevented || e.isComposing) return
    const binding = matchShortcut(e, resolved)
    if (!binding) return
    e.preventDefault()
    e.stopPropagation()
    dispatchShortcut(binding)
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

const KEY_GLYPH: Record<string, string> = { ',': ',', arrowup: '↑', arrowdown: '↓', enter: '↵', escape: 'Esc', backspace: '⌫' }

/** Human label for a binding: ⌘⇧T on macOS, Ctrl+Shift+T elsewhere. */
export function formatShortcut(binding: Pick<ShortcutBinding, 'key' | 'mod' | 'shift' | 'alt'>, mac: boolean): string {
  const key = KEY_GLYPH[binding.key.toLowerCase()] ?? binding.key.toUpperCase()
  if (mac) return `${binding.mod ? '⌘' : ''}${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${key}`
  const parts: string[] = []
  if (binding.mod) parts.push('Ctrl')
  if (binding.alt) parts.push('Alt')
  if (binding.shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** Label for the first binding of a command (menus, tooltips). Undefined when the command has none. */
export function shortcutLabel<K extends CommandName>(command: K, mac: boolean, payload?: CommandMap[K]): string | undefined {
  const binding = SHORTCUTS.find((b) => b.command === command && (payload === undefined || JSON.stringify(b.payload) === JSON.stringify(payload)))
  return binding ? formatShortcut(binding, mac) : undefined
}

/** Platform detection shared by menus and the listener; prefers the bridge, falls back to the UA. */
export function detectMac(platform?: string): boolean {
  if (platform) return platform === 'darwin'
  if (typeof navigator === 'undefined') return true
  return /Mac|iPhone|iPad/.test(`${navigator.platform} ${navigator.userAgent}`)
}
