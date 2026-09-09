/**
 * TabRegistration.icon is a lucide icon name (kebab-case). We map the names features are expected to
 * use to components explicitly — importing lucide's full `icons` table would pull the whole set into
 * the renderer bundle. Unknown names fall back to the icon of the tab kind.
 */
import {
  BookOpen,
  Bot,
  Brain,
  Calendar,
  File,
  FileText,
  Inbox,
  Key,
  LayoutGrid,
  Mail,
  MessageSquare,
  NotebookPen,
  Palette,
  Reply,
  Settings,
  Shield,
  Sparkles,
  User,
  Users,
} from 'lucide-react'
import type { IconComponent } from '@/kit'
import type { TabKind } from './tabRegistry'

const BY_NAME: Record<string, IconComponent> = {
  'message-square': MessageSquare,
  reply: Reply,
  bot: Bot,
  settings: Settings,
  'file-text': FileText,
  file: File,
  'book-open': BookOpen,
  'notebook-pen': NotebookPen,
  inbox: Inbox,
  palette: Palette,
  sparkles: Sparkles,
  mail: Mail,
  calendar: Calendar,
  users: Users,
  user: User,
  brain: Brain,
  key: Key,
  shield: Shield,
  'layout-grid': LayoutGrid,
}

export const KIND_ICON: Record<TabKind, IconComponent> = {
  chat: MessageSquare,
  autoreply: Reply,
  clone: Bot,
  settings: Settings,
  file: FileText,
  diary: BookOpen,
  replydesk: Inbox,
  kit: Palette,
}

export function tabIcon(kind: TabKind, name?: string): IconComponent {
  if (name) {
    const found = BY_NAME[name.toLowerCase()]
    if (found) return found
  }
  return KIND_ICON[kind]
}
