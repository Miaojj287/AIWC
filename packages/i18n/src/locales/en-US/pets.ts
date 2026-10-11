import type { Messages } from '../zh-CN'

export const pets: Messages['pets'] = {
  mood: {
    idle: 'Idle',
    running: 'Working',
    waiting: 'Needs you',
    review: 'Done',
    failed: 'Something went wrong',
  },
  bubble: {
    running: 'Working',
    waiting: 'Needs your OK',
    review: 'Done',
    failed: 'Something went wrong',
    withDetail: '{title}: {detail}',
    dismiss: 'Click to dismiss',
  },
  pet: {
    label: '{name}: {status}',
    tooltip: '{detail} · Right-click for more',
    tooltipMini: '{detail} · Click to open the Agent panel',
    poke: 'Pat',
    change: 'Change pet…',
    hide: 'Hide pet',
    hidden: 'Pet hidden',
    hiddenDetail: 'Turn it back on in Settings › Pets',
    hideFailed: "Couldn't hide the pet",
  },
  status: {
    group: 'Agent status',
    waiting: '{n, plural, one {# chat needs} other {# chats need}} your OK',
    running: '{n, plural, one {# chat} other {# chats}} running',
    done: '{n, plural, one {# chat} other {# chats}} done, not viewed yet',
    failed: '{n, plural, one {# chat} other {# chats}} failed',
    unread:
      '{n, plural, one {# unread WeChat message} other {# unread WeChat messages}} ({chats, plural, one {# chat} other {# chats}})',
    unreadCapped: 'At least {n} unread WeChat messages',
    separator: '; ',
  },
  source: {
    builtin: 'Built-in',
    catalog: 'codex-pets.net',
    catalogBy: 'codex-pets.net · {author}',
    import: 'Imported',
  },
}
