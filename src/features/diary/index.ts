/**
 * Diary feature — the 日记 workspace Tab (kind 'diary', single instance objectId 'diary').
 * `tab.openDiary {date?}` is wired by the shell (src/app/tabCommands.ts), which merges `date` into tab.state.
 */
import { registerTab } from '@/workspace/tabRegistry'
import { DiaryTab } from './DiaryTab'

export const DIARY_TAB = { kind: 'diary', objectId: 'diary', title: '日记' } as const

export function register(): void {
  registerTab({ kind: 'diary', icon: 'book-open', component: DiaryTab })
}

export { DiaryTab } from './DiaryTab'
export { groupByMonth, splitCues, diaryDateLabel, diaryTitle, todayKey, type MonthGroup } from './diaryModel'
