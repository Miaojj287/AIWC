import type { Messages } from '../../zh-CN'

export const general: Messages['settings']['general'] = {
  sections: { appearance: 'Appearance', startup: 'Startup' },
  language: { section: 'Language', title: 'Interface language' },
  layout: {
    section: 'Layout',
    title: 'Default view',
    description: 'The four-column workbench, or a full-window Agent chat',
    workbench: 'Workbench',
    agent: 'Agent window',
  },
  launchAtLogin: 'Launch at login',
  closeBehavior: 'When closing the window',
  close: {
    quit: 'Quit',
    quitDescription: 'Auto reply and push stop too',
    minimize: 'Minimize to menu bar',
    minimizeDescription: 'Keeps running in the background',
    ask: 'Ask every time',
    askDescription: 'Choose when you close',
  },
  appearance: {
    theme: 'Theme',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    transparency: {
      title: 'Transparency',
      description: 'Sidebar and lists show the desktop behind them',
      help: 'When on, the left sidebar and lists turn into frosted glass that shows your wallpaper and the windows behind; the workspace and Agent panel stay opaque. Available in the desktop app on macOS and Windows 11.',
      unsupported: 'Transparency is not supported on this platform',
    },
    custom: {
      title: 'Custom colors',
      description: 'Light and dark are saved separately',
      help: 'The default colors match Codex. Background sets the content area, foreground sets the sidebar and cards, and text sets body text and derives secondary text.',
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
      reset: 'Restore default appearance',
    },
  },
}
