import type { Messages } from '../zh-CN'

type Extras = Pick<Messages['agent'], 'attachments' | 'queue'>

export const agentComposer: Extras = {
  attachments: {
    label: 'Attachments',
    image: 'Image',
    remove: 'Remove {name}',
    pick: 'Upload images or files',
    pickDescription: 'You can also paste a screenshot or drop files on the composer',
    pastedName: 'Pasted text {n}.txt',
    pastedMeta: '{chars} chars · {lines, plural, one {# line} other {# lines}}',
    noVision: "{model} can't read images; they will be replaced by a short note",
    dropHint: 'Drop to attach',
    error: {
      tooMany: 'A message can carry at most {max} attachments',
      imageTooLarge: '"{name}" is over {max}; images must be {max} or smaller',
      fileTooLarge: '"{name}" is over {max}; files must be {max} or smaller',
      totalTooLarge: 'Attachments must add up to {max} or less',
      unsupportedType: '"{name}" is not a supported image format. Use PNG, JPEG, GIF or WebP',
      readFailed: 'Couldn\'t read "{name}"',
    },
  },
  queue: {
    add: 'Queue for when this turn ends',
    label: 'Queued messages',
    title: '{n, plural, one {# queued message} other {# queued messages}}',
    paused: 'The turn stopped, so queued messages are on hold',
    sendNow: 'Send now',
    edit: 'Edit in composer',
    remove: 'Remove',
    attachments: '{n, plural, one {# attachment} other {# attachments}}',
  },
}
