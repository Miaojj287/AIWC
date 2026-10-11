import type { Messages } from '../../zh-CN'

export const general: Messages['settings']['general'] = {
  sections: { appearance: 'Appearance', preferences: 'Preferences' },
  language: { title: 'Interface language' },
  layout: {
    title: 'Default view',
    workbench: 'Workbench',
    agent: 'Agent window',
  },
  launchAtLogin: 'Launch at login',
  sendKey: {
    title: 'Send messages with',
    description: 'The other combination inserts a new line',
    enter: 'Enter',
    modEnter: '{mac, select, true {⌘ Enter} other {Ctrl+Enter}}',
  },
  notifications: {
    title: 'System notifications',
    help: 'Approvals, auto-reply drafts, a paused auto reply and scheduled task results raise a system notification; click it to go straight there. While the window is in front, alerts stay inside the app.',
    showNames: 'Show contact names in notifications',
    showNamesDescription: 'The lock screen and notification center keep notification text',
  },
  closeBehavior: 'When closing the window',
  close: {
    quit: 'Quit',
    quitDescription: 'Auto reply and push stop too',
    minimize: '{tray, select, dock {Keep in Dock} other {Minimize to tray}}',
    minimizeDescription: 'Keeps running in the background',
    ask: 'Ask every time',
    askDescription: 'Choose when you close',
  },
  appearance: {
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    transparency: {
      title: 'Transparency',
      help: 'When on, the left sidebar and lists turn into frosted glass that shows your wallpaper and the windows behind; the workspace and Agent panel stay opaque.',
      unsupported: 'Transparency is not supported on this platform',
    },
    custom: {
      title: 'Custom colors',
      help: 'Light and dark are saved separately; the defaults match Codex. Background sets the content area, foreground sets the sidebar and cards, and text sets body text and derives secondary text.',
      mode: 'Color mode to edit',
    },
    colors: { accent: 'Accent', background: 'Background', surface: 'Foreground', foreground: 'Text' },
    colorLabels: {
      light: {
        accent: 'Light accent',
        background: 'Light background',
        surface: 'Light foreground',
        foreground: 'Light text',
      },
      dark: {
        accent: 'Dark accent',
        background: 'Dark background',
        surface: 'Dark foreground',
        foreground: 'Dark text',
      },
    },
    contrast: { title: 'Contrast', description: 'Strength of secondary text and dividers' },
    preview: {
      title: { light: 'Light preview', dark: 'Dark preview' },
      ratio: 'Body text contrast {ratio}:1',
      ratioLow: 'Body text contrast {ratio}:1 · 4.5:1 or higher recommended',
      body: 'This is body text {secondary}',
      secondary: 'and caption text',
      secondaryAction: 'Secondary action',
      primaryAction: 'Primary action',
    },
    reset: {
      title: 'Restore default appearance',
      description:
        '{mode, select, light {Resets the light colors} other {Resets the dark colors}} and turns transparency back on',
      action: 'Restore defaults',
    },
  },
}
