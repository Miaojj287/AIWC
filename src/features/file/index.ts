/**
 * File feature — the 文件 workspace Tab (kind 'file', objectId = absolute path). `tab.openFile` is wired by
 * the shell (src/app/tabCommands.ts); this module registers the renderer and exports the Markdown preview
 * used by other read-only surfaces (diary) until the Agent feature ships its own renderer.
 */
import { registerTab } from '@/workspace/tabRegistry'
import { FileTab } from './FileTab'

export function register(): void {
  registerTab({ kind: 'file', icon: 'file-text', component: FileTab })
}

export { Markdown } from './markdown'
