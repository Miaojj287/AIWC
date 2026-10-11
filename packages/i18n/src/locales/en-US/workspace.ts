import type { Messages } from '../zh-CN'

export const workspace: Messages['workspace'] = {
  ariaLabel: 'Workspace',
  tabError: "Can't display this tab",
  closeTab: 'Close tab',
  empty: {
    chat: { title: 'Select a chat on the left' },
    autoreply: { title: 'Select a chat to set up auto reply' },
    clone: { title: 'Select a contact to start cloning' },
    tasks: { title: 'Pick a scheduled task' },
    todo: { title: 'Turn on the group chats to scan on the left' },
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
