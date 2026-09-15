import type { Messages } from '../zh-CN'

export const diary: Messages['diary'] = {
  tab: { title: 'Diary' },
  nav: {
    title: 'Diary',
    count: '{n, plural, one {# entry} other {# entries}}',
    loadFailed: "Couldn't load diary entries",
    emptyHint: 'Entries are listed here by month once generated',
    regenerateToday: 'Regenerate today',
  },
  empty: {
    title: 'No diary entries yet',
    description: 'Compiles your chats and Agent chats every day and saves cues to memory',
  },
  generateToday: "Generate today's diary",
  settings: 'Diary settings',
  quote: 'Add to Agent',
  regenerate: 'Regenerate',
  degraded: 'Basic',
  degradedEntry: 'Basic version',
  header: {
    title: 'Diary',
    schedule: 'Compiled automatically every day',
  },
  reader: {
    loading: 'Loading diary…',
    loadFailed: "Couldn't load this day's diary",
    missing: 'No diary for this day yet',
    generateDay: 'Generate diary for this day',
    nothing: 'Nothing to compile for this day',
    cues: 'Memory cues',
    cuesSaved: 'Saved to MEMORY',
  },
  generation: {
    preparing: 'Preparing',
    title: 'Generating the diary for {date}',
    titleGeneric: 'Generating diary',
    description: 'Content only travels between this computer and the model you chose',
    done: 'Generated the diary for {date}{degraded, select, true { (basic version)} other {}}',
    failed: 'Generation failed: {detail}',
  },
  regenerateConfirm: {
    title: 'Regenerate the diary for {date}?',
    description: 'This replaces the current content and updates the memory cues.',
  },
  quoteLabel: 'Diary {date}',
  quoted: 'Added the diary for {date} to the current Agent chat',
  date: {
    weekdays: { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' },
    label:
      '{weekday}, {month, select, 1 {Jan} 2 {Feb} 3 {Mar} 4 {Apr} 5 {May} 6 {Jun} 7 {Jul} 8 {Aug} 9 {Sep} 10 {Oct} 11 {Nov} 12 {Dec} other {{month}}} {day}',
    title:
      '{weekday}, {month, select, 1 {Jan} 2 {Feb} 3 {Mar} 4 {Apr} 5 {May} 6 {Jun} 7 {Jul} 8 {Aug} 9 {Sep} 10 {Oct} 11 {Nov} 12 {Dec} other {{month}}} {day}, {year}',
    month:
      '{month, select, 1 {January} 2 {February} 3 {March} 4 {April} 5 {May} 6 {June} 7 {July} 8 {August} 9 {September} 10 {October} 11 {November} 12 {December} other {{month}}} {year}',
  },
  sources: {
    generatedAt: 'Generated at {time}',
    messages: '{n, plural, one {# message} other {# messages}}',
    sessions: '{n, plural, one {# chat} other {# chats}}',
    agentTurns: '{n, plural, one {# Agent turn} other {# Agent turns}}',
  },
}
