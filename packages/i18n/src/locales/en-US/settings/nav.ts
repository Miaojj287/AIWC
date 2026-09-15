import type { Messages } from '../../zh-CN'

export const nav: Messages['settings']['nav'] = {
  tabTitle: 'Settings',
  ariaLabel: 'Settings navigation',
  pages: {
    general: { label: 'General', title: 'General', description: 'Appearance and startup behavior' },
    account: { label: 'Account', title: 'Account', description: 'WeChat account, database and decryption keys' },
    ai: { label: 'AI integration', title: 'AI integration', description: 'Agent models and speech transcription' },
    pets: {
      label: 'Pets',
      title: 'Pets',
      description:
        'Little companions for your Agent: they run while it thinks, wave when it needs you, and celebrate when it’s done',
    },
    memory: {
      label: 'Memory',
      title: 'AI memory',
      description: 'Facts and rules the Agent remembers across conversations, all kept as local Markdown files',
    },
    about: { label: 'About & support', title: 'About & support', description: 'Version info, terms and logs' },
  },
  groups: { common: 'Basics', ai: 'AI', about: 'About' },
  account: { loading: 'Loading account…', disconnected: 'No account connected', configureHint: 'Set up under Account' },
  search: {
    placeholder: 'Search settings',
    results: 'Matching settings',
    count: '{n, plural, one {# match} other {# matches}}',
    empty: 'No matching settings',
    emptyHint: 'Try another keyword, such as "key", "model" or "memory"',
    groups: {
      currentAccount: 'Current account',
      editor: 'Edit',
      version: 'Version',
    },
    rows: {
      general: {
        appearance: {
          title: 'Custom colors',
          description: 'Accent, background, foreground, text and contrast',
          keywords: 'accent, background, foreground, text, font, contrast, colors, palette',
        },
        theme: {
          title: 'Theme',
          description: 'System / Light / Dark',
          keywords: 'theme, dark, light, system, appearance, dark mode',
        },
        transparency: {
          title: 'Transparency',
          description: 'Sidebar and lists show the desktop behind them',
          keywords: 'transparent, glass, frosted, translucent, vibrancy, acrylic, blur',
        },
        language: {
          title: 'Interface language',
          description: '简体中文 / English',
          keywords: 'language, i18n, english, chinese, locale',
        },
        launchAtLogin: {
          title: 'Launch at login',
          description: 'Start automatically after you log in',
          keywords: 'launch, login, startup, auto start',
        },
        closeBehavior: {
          title: 'When closing the window',
          description: 'Quit / Minimize / Ask every time',
          keywords: 'close, quit, minimize, menu bar, ask',
        },
        layout: {
          title: 'Default view',
          description: 'Workbench / Agent window',
          keywords: 'layout, agent window, workbench, mode, view',
        },
      },
      account: {
        current: {
          title: 'Switch account',
          description: 'Every wxid found on this computer and its verification status',
          keywords: 'wxid, account, rescan, switch',
        },
        dbKey: {
          title: 'Database decryption key',
          description: '64 hex digits, can be fetched automatically',
          keywords: 'key, hex, decrypt, automatic, manual',
        },
        dbRoot: {
          title: 'Database root folder',
          description: 'The WeChat data folder that contains db_storage',
          keywords: 'path, db_storage, folder, directory',
        },
        verify: {
          title: 'Account verification',
          description: 'Check that the wxid matches the folder',
          keywords: 'verify, verification, test connection',
        },
        cacheDir: {
          title: 'Cache folder',
          description: 'Leave empty to use the default folder',
          keywords: 'cache, folder, directory',
        },
        imageKeys: {
          title: 'Image decryption keys',
          description: 'XOR / AES keys, can be fetched automatically',
          keywords: 'xor, aes, image, key',
        },
      },
      pets: {
        current: {
          title: 'Current pet',
          description: 'Preview animations and see where it comes from',
          keywords: 'pet, pets, codex pets, companion, buddy, desktop pet',
        },
        enabled: {
          title: 'Show a pet in the Agent panel',
          description: 'The pet stands above the input box and changes its animation with the Agent’s state',
          keywords: 'pet, show, hide',
        },
        bubbles: {
          title: 'Status bubble',
          description: 'A short note beside the pet when it needs your approval, finishes, or hits an error',
          keywords: 'pet, bubble, hint, notification',
        },
        motion: {
          title: 'Pet animation',
          description: 'When off, the pet holds a still pose',
          keywords: 'pet, animation, motion, reduce motion',
        },
        idleFlair: {
          title: 'Idle moves',
          description: 'Waves or hops now and then while idle',
          keywords: 'pet, idle, wave, hop',
        },
        size: { title: 'Pet size', description: 'Small / Medium / Large', keywords: 'pet, size, scale' },
        installed: {
          title: 'My pets',
          description: 'Choose, delete, or import a downloaded pet archive',
          keywords: 'pet, import, zip, archive, delete, choose',
        },
        catalog: {
          title: 'Pet gallery',
          description: 'Browse community pets on codex-pets.net and adopt one',
          keywords: 'pet, gallery, adopt, download, codex-pets',
        },
      },
      ai: {
        providers: {
          title: 'Model providers',
          description: 'DeepSeek / Kimi / GLM / Qwen / OpenAI / Anthropic / Ollama and more, or a custom endpoint',
          keywords:
            'provider, vendor, deepseek, kimi, glm, qwen, minimax, hunyuan, openai, anthropic, gemini, ollama, custom, connect',
        },
        apiKey: {
          title: 'API key',
          description: 'Stored only in this computer’s keychain',
          keywords: 'key, api key, token, edit key',
        },
        models: {
          title: 'Model list',
          description: 'Enable / disable, reasoning effort, fast mode',
          keywords: 'model, models, enable, reasoning effort, fast, context, fetch models',
        },
        status: {
          title: 'Test connection',
          description: 'Latency and tool call support',
          keywords: 'test, status, connection, disconnect, latency',
        },
        defaultModel: { title: 'Default model', description: 'Used for new chats', keywords: 'default, model' },
        sttMode: {
          title: 'Transcription mode',
          description: 'Local / Online',
          keywords: 'stt, whisper, voice, speech to text, transcription, local, online',
        },
        sttLocal: {
          title: 'Local models',
          description: 'Download, delete and set as default',
          keywords: 'stt, voice, local model, download, parameters',
        },
        sttOnline: {
          title: 'Online transcription API',
          description: 'Provider, URL, key, model ID',
          keywords: 'stt, online, transcription, api, endpoint',
        },
      },
      memory: {
        files: {
          title: 'Memory files',
          description: 'Four Markdown files: MEMORY / USER / SOUL / AGENTS',
          keywords: 'memory, markdown, profile, persona, rules',
        },
        editor: {
          title: 'Edit memory files',
          description: 'Built-in Markdown editor, save or reset',
          keywords: 'edit, editor, save, reset',
        },
        autoWrite: {
          title: 'Write memory automatically',
          description: 'Distill key points into MEMORY.md when a conversation ends',
          keywords: 'auto, automatic, write, policy',
        },
        confirmBeforeWrite: {
          title: 'Confirm before writing',
          description: 'When off, the Agent can edit memory files directly',
          keywords: 'confirm, approval, policy',
        },
        maxEntries: {
          title: 'Memory entry limit',
          description: 'Least recently used entries are removed past the limit',
          keywords: 'limit, max, entries, cap',
        },
        clear: {
          title: 'Clear all memory',
          description: 'Other memory files are not affected',
          keywords: 'clear, delete, wipe',
        },
      },
      about: {
        update: {
          title: 'Check for updates',
          description: 'Version and updates',
          keywords: 'update, upgrade, version',
        },
        terms: { title: 'Terms of Service', description: 'Full terms', keywords: 'terms, agreement' },
        privacy: { title: 'Privacy Policy', description: 'Full policy', keywords: 'privacy, policy' },
        logs: {
          title: 'Logs',
          description: 'Export logs, without chat content',
          keywords: 'log, logs, export, diagnostics',
        },
      },
    },
  },
  unsaved: {
    title: 'Discard unsaved changes?',
    description: '"{page}" has unsaved changes. They will be lost if you leave.',
    confirm: 'Discard and leave',
    cancel: 'Keep editing',
  },
  config: { saveFailed: 'Failed to save settings', loadFailed: "Couldn't read settings" },
  closeDialog: {
    title: 'Close AIWC?',
    description: 'Auto reply and push will stop after closing',
    behavior: 'Close action',
    minimize: 'Minimize to the menu bar and keep running in the background',
    quit: 'Quit completely',
    remember: "Remember my choice and don't ask again",
    rememberHint: 'You can change this in Settings',
  },
}
