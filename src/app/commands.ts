/**
 * Cross-feature command bus. Features never import each other; they dispatch commands and the shell
 * (or the owning feature) handles them. Also the target for keyboard shortcuts and menu actions.
 */
export type CommandMap = {
  /** Put a session / messages / file / contact into the Agent composer as an @ reference. */
  'agent.quote': { kind: 'session' | 'file' | 'contact' | 'memory'; id: string; label: string; messageIds?: string[] }
  'agent.newThread': { contextRef?: { kind: 'session' | 'file' | 'contact'; id: string; label: string } }
  'agent.toggleCollapsed': void
  'objectList.toggleCollapsed': void
  'rail.select': { fn: 'chat' | 'autoreply' | 'clone' }
  'tab.openSettings': { page?: 'general' | 'account' | 'ai' | 'memory' | 'about'; highlight?: string }
  'tab.openChat': { sessionId: string; title: string; focusMessageId?: string }
  'tab.openAutoReply': { sessionId: string; title: string }
  'tab.openClone': { contactId: string; title: string }
  'tab.openFile': { path: string; title: string }
  'tab.openDiary': { date?: string }
  'tab.openReplyDesk': void
  'tab.closeActive': void
  'tab.reopenClosed': void
  'search.sessions': void
  'search.inPage': void
  /** Quote the object behind the active workspace tab (session / file / contact) into the Agent composer (⌘⇧A). */
  'agent.quoteActiveTab': void
  /** Dev-only: the kit gallery tab (⌘⇧K in web mode). */
  'tab.openKit': void
  'toast': { kind: 'success' | 'info' | 'warning' | 'error' | 'progress'; text: string; action?: { label: string; command: keyof CommandMap; payload?: unknown }; sticky?: boolean }
}

export type CommandName = keyof CommandMap
type Handler<K extends CommandName> = (payload: CommandMap[K]) => void

const handlers = new Map<CommandName, Set<Handler<CommandName>>>()

export function onCommand<K extends CommandName>(name: K, handler: Handler<K>): () => void {
  const set = handlers.get(name) ?? new Set()
  set.add(handler as Handler<CommandName>)
  handlers.set(name, set)
  return () => set.delete(handler as Handler<CommandName>)
}

export function runCommand<K extends CommandName>(name: K, ...args: CommandMap[K] extends void ? [] : [CommandMap[K]]): void {
  const set = handlers.get(name)
  if (!set || set.size === 0) {
    console.warn(`[commands] no handler for ${name}`)
    return
  }
  const payload = (args as unknown[])[0] as CommandMap[K]
  for (const h of set) h(payload)
}
