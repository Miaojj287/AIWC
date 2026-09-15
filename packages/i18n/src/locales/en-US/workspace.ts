import type { Messages } from '../zh-CN'

export const workspace: Messages['workspace'] = {
  ariaLabel: 'Workspace',
  tabError: "Can't display this tab",
  closeTab: 'Close tab',
  empty: {
    chat: { title: 'Select a chat on the left', description: 'Browse, search, export or add it to the Agent' },
    autoreply: {
      title: 'Select a chat to set up auto reply',
      description: 'One rule per chat; once on, it replies as configured',
    },
    clone: {
      title: 'Select a contact to start cloning',
      description: 'Learns their speaking style from your chat history',
    },
    tasks: { title: 'Pick a scheduled task', description: 'or create one and let the Agent work on a timer' },
    search: '{kbd} to search',
  },
  discard: {
    title: 'Discard changes?',
    description: 'Changes to "{title}" haven\'t been saved and will be lost when you close it.',
    confirm: 'Discard changes',
  },
  tabStrip: {
    ariaLabel: 'Workspace tabs',
    manage: 'Manage tabs',
    close: 'Close',
    closeOthers: 'Close others',
    closeRight: 'Close tabs to the right',
    pin: 'Pin tab',
    unpin: 'Unpin tab',
    reopen: 'Reopen closed tab',
    count: 'Tabs · {n}',
    none: 'No open tabs',
    current: 'Current',
  },
}
