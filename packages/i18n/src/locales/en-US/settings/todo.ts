import type { Messages } from '../../zh-CN'

export const todo: Messages['settings']['todo'] = {
  sections: {
    main: 'Daily to-dos',
    scope: 'What to scan',
    schedule: 'Schedule',
    model: 'Model',
  },
  enabled: {
    title: 'Turn on daily to-dos',
  },
  dashboard: {
    title: 'To-do board',
    open: 'Open',
  },
  sources: {
    title: 'Group chats to scan',
    none: 'None picked yet; only picked group chats are read',
    count: '{n} picked, up to {max}',
    pick: 'Pick group chats',
    remove: 'Stop scanning "{name}"',
  },
  maxMessages: {
    title: 'Messages read per group',
    description: 'Each scan reads only this many of the newest messages per group',
    option: '{n, plural, one {# message} other {# messages}}',
  },
  schedule: {
    title: 'Scan schedule',
    kinds: { hourly: 'Every few hours', daily: 'Daily', manual: 'Manual only' },
    interval: 'Interval',
    intervalOption: '{n, plural, one {Every hour} other {Every # hours}}',
    time: 'Time',
    invalidTime: 'Enter a time between 00:00 and 23:59',
    next: 'Next scan: {time}',
    manualHint: 'Scans only when you press Scan now',
    offHint: "Scans on this schedule once it's on and group chats are picked",
    help: 'Only messages since the last scan are read. A scan missed while the app was closed runs once, about a minute after the next launch.',
  },
  model: {
    title: 'Model',
    description: 'Uses the default model when none is picked',
  },
}
