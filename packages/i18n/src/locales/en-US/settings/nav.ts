import type { Messages } from '../../zh-CN'

export const nav: Messages['settings']['nav'] = {
  tabTitle: 'Settings',
  ariaLabel: 'Settings navigation',
  pages: {
    general: { label: 'General', title: 'General' },
    account: { label: 'Account', title: 'Account' },
    data: { label: 'Data', title: 'Local data' },
    ai: { label: 'AI integration', title: 'AI integration' },
    usage: { label: 'Usage & logs', title: 'Usage & logs' },
    pets: {
      label: 'Pets',
      title: 'Pets',
      description: 'Little companions that react to what the Agent is doing',
    },
    memory: {
      label: 'Memory',
      title: 'AI memory',
      description: 'Facts and rules the Agent remembers across chats, all kept as local Markdown files',
    },
    skills: {
      label: 'Skills',
      title: 'Skills',
      description: 'Steps the Agent can follow: view, turn on or off, and delete them',
    },
    todo: {
      label: 'Daily to-dos',
      title: 'Daily to-dos',
      description: 'Scan the group chats you pick on a schedule and collect summaries and to-dos',
    },
    extensions: {
      label: 'Extensions',
      title: 'Extensions',
      description: 'Connect tools to the Agent with MCP servers, and run commands on events with hooks',
    },
    about: { label: 'About & support', title: 'About & support' },
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
        notifications: {
          title: 'System notifications',
          description: 'Alerts while the window is in the background',
          keywords: 'notification, alert, banner, notification center',
        },
        sendKey: {
          title: 'Send messages with',
          description: 'Enter or ⌘/Ctrl+Enter sends from the Agent composer',
          keywords: 'send, enter, return, newline, shortcut, composer',
        },
        closeBehavior: {
          title: 'When closing the window',
          description: 'Quit / Minimize / Ask every time',
          keywords: 'close, quit, minimize, Dock, tray, ask',
        },
        layout: {
          title: 'Default view',
          description: 'Workbench / Agent window',
          keywords: 'layout, agent window, workbench, mode, view',
        },
      },
      data: {
        usage: {
          title: 'Disk usage',
          description: 'How much disk each kind of local data uses',
          keywords: 'storage, disk, space, size, cache',
        },
        plaintext: {
          title: 'Plaintext database copies',
          description: 'Decrypted copies made while reading WeChat data',
          keywords: 'plaintext, decrypted, copy, wcdb, clear',
        },
        media: {
          title: 'Image and file cache',
          description: 'Decrypted images and videos, and files staged for preview',
          keywords: 'cache, media, images, video, clear',
        },
        logs: {
          title: 'Old logs',
          description: 'Keeps only the log being written',
          keywords: 'logs, clear',
        },
        wipe: {
          title: 'Delete all data',
          description: 'Delete settings, keys and all local data, then start over',
          keywords: 'reset, wipe, delete all, factory reset',
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
        mobile: {
          title: 'My WeChat',
          description: 'Connect your own WeChat to receive scheduled task pushes',
          keywords: 'phone, mobile, wechat, push, bot, ilink, clawbot, qr, notification',
        },
        mobileRemote: {
          title: 'Phone control',
          description: 'Drive the Agent from WeChat on your phone',
          keywords: 'phone, remote, control, wechat, agent, status, stop',
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
          description: "The pet stands above the input box and changes its animation with the Agent's state",
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
        statusRunning: {
          title: 'Running chats',
          description: 'Count of Agent chats running or waiting for your OK, next to the pet',
          keywords: 'pet, status, running, working, approval, count',
        },
        statusDone: {
          title: 'Finished chats',
          description: 'Count of chats that finished or failed and you have not opened yet',
          keywords: 'pet, status, done, finished, failed, unseen',
        },
        statusUnread: {
          title: 'WeChat unread',
          description: 'Count of unread WeChat messages, next to the pet',
          keywords: 'pet, unread, messages, wechat',
        },
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
          description: "Stored only in this computer's keychain",
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
        permissions: {
          title: 'Permission rules',
          description: 'Tools and commands you chose to always allow; revocable',
          keywords: 'permission, approval, grant, allow always, revoke, allowlist',
        },
        jev: {
          title: 'Jev decision model',
          description: 'The TypeSafe model behind the Jev (beta) reply mode',
          keywords: 'jev, typesafe, system one, decision, auto reply, beta',
        },
        jevKey: {
          title: 'Jev API key',
          description: "Stored only in this computer's keychain",
          keywords: 'jev, key, api key, typesafe',
        },
        jevTest: {
          title: 'Jev connection',
          description: 'Test the key and endpoint',
          keywords: 'jev, test, test connection, endpoint, model',
        },
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
        proxy: {
          title: 'Proxy',
          description: 'System / manual / none',
          keywords: 'proxy, network, socks5, http, vpn, clash',
        },
        proxyBypass: {
          title: 'Bypass the proxy for',
          description: 'These addresses connect directly',
          keywords: 'bypass, no proxy, direct, exceptions',
        },
      },
      usage: {
        overview: {
          title: 'Usage',
          description: 'Tokens by day, feature and model',
          keywords: 'usage, tokens, statistics, consumption, cost',
        },
        calls: {
          title: 'Call log',
          description: 'Duration and result of each model call',
          keywords: 'log, calls, requests, history, latency',
        },
        recordContent: {
          title: 'Record content',
          description: 'Keep request and reply text, off by default',
          keywords: 'content, body, request, reply, record',
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
        review: {
          title: 'Pending memories',
          description: 'Distilled points, written only after you confirm',
          keywords: 'review, pending, suggestions, distill',
        },
        autoWrite: {
          title: 'Write memory automatically',
          description: 'Distill points about you from idle chats; written only after you confirm',
          keywords: 'auto, automatic, write, distill, policy',
        },
        confirmBeforeWrite: {
          title: 'Confirm before writing',
          description: 'When on, what the Agent remembers waits for your review first',
          keywords: 'confirm, approval, policy',
        },
        maxEntries: {
          title: 'Memory entry limit',
          description: 'Once a file reaches it, the Agent must delete old entries first',
          keywords: 'limit, max, entries, cap',
        },
        clear: {
          title: 'Clear all memory',
          description: 'Other memory files are not affected',
          keywords: 'clear, delete, wipe',
        },
      },
      extensions: {
        mcp: {
          title: 'MCP servers',
          description: "Give the Agent a local command's or remote URL's tools",
          keywords: 'mcp, model context protocol, tools, plugins, server, extensions',
        },
        hooks: {
          title: 'Hooks',
          description: 'Run commands around tool calls, when you send, or when an answer ends',
          keywords: 'hook, hooks, command, script, block, intercept',
        },
      },
      skills: {
        list: {
          title: 'Skill list',
          description: 'View, turn on or off, delete skills, or schedule them as tasks',
          keywords: 'skill, skills, slash, command, SKILL.md, scheduled task',
        },
      },
      todo: {
        enabled: {
          title: 'Turn on daily to-dos',
          description: 'Scan the picked group chats on a schedule and collect summaries and to-dos',
          keywords: 'todo, to-do, daily, digest, summary, diary',
        },
        sources: {
          title: 'Group chats to scan',
          description: 'Only the group chats picked here are scanned',
          keywords: 'group, chats, scope, scan',
        },
        maxMessages: {
          title: 'Messages read per group',
          description: 'Each scan reads only this many of the newest messages per group',
          keywords: 'messages, count, limit',
        },
        schedule: {
          title: 'Scan schedule',
          description: 'Every few hours / Daily / Manual only',
          keywords: 'schedule, frequency, hourly, daily, interval',
        },
        model: {
          title: 'Model',
          description: 'The default model when none is picked',
          keywords: 'model, provider, local',
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
          description: 'Export redacted logs, without chat content',
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
}
