/**
 * File feature — the 文件 workspace Tab (kind 'file', objectId = absolute path). `tab.openFile` is wired by
 * the shell (src/app/tabCommands.ts); this module registers the renderer.
 */
import { registerTab } from '@/workspace/tabRegistry'
import { FileTab } from './FileTab'

export function register(): void {
  registerTab({ kind: 'file', icon: 'file-text', component: FileTab })
}
