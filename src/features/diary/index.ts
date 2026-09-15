/**
 * Diary feature — the 日记 workspace Tab (kind 'diary', single instance objectId 'diary').
 * `tab.openDiary {date?}` is wired by the shell (src/app/tabCommands.ts), which merges `date` into tab.state.
 */
import { t } from '@/i18n'
import { registerTab } from '@/workspace/tabRegistry'
import { DiaryTab } from './DiaryTab'

export function register(): void {
  registerTab({ kind: 'diary', icon: 'book-open', component: DiaryTab, title: () => t('diary.tab.title') })
}
