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
  source: {
    builtin: 'Built-in',
    catalog: 'codex-pets.net',
    catalogBy: 'codex-pets.net · {author}',
    import: 'Imported',
  },
}
