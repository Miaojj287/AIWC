import type { Messages } from '../zh-CN'

export const file: Messages['file'] = {
  view: {
    label: 'View',
    split: 'Split',
    preview: 'Preview',
  },
  saved: 'Saved {name}',
  saveFailed: 'Save failed: {detail}',
  revealFailed: "Couldn't open the containing folder: {detail}",
  dirty: 'Modified · Unsaved',
  reveal: 'Show in folder',
  loading: 'Loading file…',
  loadFailed: "Couldn't read the file",
  editorLabel: 'Markdown editor',
  chars: '{n, plural, one {{count} character} other {{count} characters}}',
  lines: '{n, plural, one {{count} line} other {{count} lines}}',
  emptyFile: 'Empty file',
  emptyFileHint: 'Start typing on the left to see a live preview here',
  unsupported: "Preview isn't supported for this file type",
  unknownType: 'Unknown type',
  markdown: {
    link: 'link',
  },
}
