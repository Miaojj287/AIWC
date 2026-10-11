import type { Messages } from '../../zh-CN'

export const data: Messages['settings']['data'] = {
  sections: { usage: 'Disk usage', clean: 'Caches you can clear', danger: 'Delete all data' },
  total: '{size} in total',
  partial: 'Too many files: only part was counted',
  refresh: 'Measure again',
  openFolder: 'Open data folder',
  loadFailed: "Couldn't measure local data",
  categories: {
    index: { title: 'Chat index', description: 'Local index of chats, contacts and messages for search and the Agent' },
    plaintext: {
      title: 'Plaintext database copies',
      description: 'Decrypted copies made while reading WeChat data; rebuilt when needed',
    },
    media: {
      title: 'Image and file cache',
      description: 'Decrypted images and videos, and files staged for preview; rebuilt when needed',
    },
    conversations: { title: 'Agent chats', description: 'Every conversation with the Agent' },
    memory: { title: 'Memory and AI clones', description: 'The four memory files and clone profiles' },
    features: {
      title: 'Feature records',
      description: 'Auto reply records, model usage, scheduled tasks, daily to-dos and channel state',
    },
    skills: { title: 'Skills', description: 'Skills added by you and the Agent' },
    pets: { title: 'Pets', description: 'Adopted and imported pets' },
    workspace: { title: 'Agent workspace', description: 'The folder the Agent reads and writes when it runs commands' },
    exports: { title: 'Exports', description: 'Exported chat history, tables and logs' },
    logs: { title: 'Logs', description: 'Run logs, without chat content' },
    other: { title: 'Settings and other', description: 'Settings, the encrypted key store and other files' },
  },
  clear: {
    action: 'Clear',
    empty: 'Nothing to clear',
    done: 'Freed {size}',
    failed: "Couldn't clear",
    confirm: 'Clear',
    plaintext: {
      title: 'Clear plaintext database copies?',
      description: 'WeChat data disconnects briefly and reconnects; the copies are rebuilt the next time data is read.',
    },
    media: {
      title: 'Clear the image and file cache?',
      description: 'Images and files are decrypted or copied again the next time you open them.',
    },
    logs: { title: 'Clear old logs?', description: 'The log being written is kept.' },
  },
  wipe: {
    title: 'Delete all data',
    description: 'Delete settings, keys and all local data, then restart and start over',
    action: 'Delete all data…',
    dialogTitle: 'Delete all data?',
    dialogDescription:
      "Deletes settings, decryption keys, the chat index, Agent chats, memory and clones, auto reply records and all other local data. This can't be undone. WeChat's own data is not affected. The app restarts afterwards.",
    word: 'DELETE',
    confirm: 'Delete and restart',
    failed: "Couldn't delete the data",
  },
}
