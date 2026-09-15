import type { Messages } from '../../zh-CN'

export const memory: Messages['settings']['memory'] = {
  sections: { files: 'Memory files', policy: 'Memory policy' },
  files: {
    memory: {
      label: 'Long-term memory',
      description: 'Facts and preferences the Agent remembers across conversations',
    },
    user: { label: 'User profile', description: 'How to address you, who you are, frequent groups and contacts' },
    soul: { label: 'Persona and tone', description: 'Reply style and how to address people' },
    agents: { label: 'Working rules', description: 'Confirm before pushing, never read private groups, etc.' },
  },
  entries: '{n, plural, one {# entry} other {# entries}}',
  used: '{used} / {limit} chars used',
  loading: 'Loading…',
  editing: 'Editing',
  editingUnsaved: 'Editing · Unsaved',
  editor: {
    section: 'Edit {file}',
    label: '{file} content',
    placeholder: '(Empty file) Start a line with `- ` to add a memory',
    modified: 'Modified · Unsaved',
    capacity: 'Capacity used',
    overBudget: 'Over the capacity limit. Shorten it before saving',
    noChanges: 'No unsaved changes',
    tooLong: 'Content exceeds the capacity limit',
    saved: 'Saved {file}',
  },
  discard: {
    title: 'Discard unsaved changes?',
    description: '{file} will revert to its last saved content.',
    confirm: 'Discard changes',
    cancel: 'Keep editing',
  },
  autoWrite: {
    title: 'Write memory automatically',
    description: 'Distill key points into MEMORY.md when a conversation ends',
  },
  confirmBeforeWrite: {
    title: 'Confirm before writing',
    description: 'When off, the Agent can edit memory files directly',
  },
  maxEntries: {
    title: 'Memory entry limit',
    description: 'Least recently used entries are removed past the limit',
    unit: 'entries',
    integer: 'Enter a whole number',
    range: 'Range {min} – {max}',
  },
  clear: {
    title: 'Clear {file}',
    description: 'Other memory files are not affected',
    dialogTitle: 'Clear {file}?',
    dialogDescription:
      '{n, plural, one {# memory} other {# memories}} will be permanently deleted, and the Agent will forget the facts and preferences recorded here.',
    cleared: 'Cleared {file}',
    failed: 'Failed to clear',
  },
}
