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
  nothingToSave: 'No unsaved changes',
  reveal: 'Show in folder',
  quoteSelection: 'Quote to Agent',
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
  openExternally: 'Open in default app',
  openTarget: 'file',
  zoom: {
    in: 'Zoom in',
    out: 'Zoom out',
    fit: 'Fit width',
    min: 'Already at the smallest size',
    max: 'Already at the largest size',
    isFit: 'Already fits the width',
  },
  pdf: {
    pages: '{n, plural, one {# page} other {# pages}}',
    pagesCapped: '{n} pages, previewing the first {shown}',
    page: 'Page {n}',
    pageFailed: "Page {n} can't be shown",
    failed: "Couldn't open this PDF",
  },
  table: {
    truncated: 'Showing the first {n} rows. Open in the default app to see everything.',
  },
  html: {},
  media: {
    failed: "Can't play this file",
    failedHint: 'The format may not be supported. Try the default app.',
  },
  docx: {
    image: 'Image (not shown in the preview)',
    truncated: 'Long document: only the beginning is shown',
  },
  xlsx: {
    sheet: 'Sheet',
    emptySheet: 'This sheet is empty',
  },
}
