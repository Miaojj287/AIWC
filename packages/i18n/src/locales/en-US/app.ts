import type { Messages } from '../zh-CN'

export const app: Messages['app'] = {
  bootFailed: 'Local data service unavailable',
  configError: "Couldn't read settings",
  starting: 'Starting',
  onboardingSaveFailed: "Couldn't finish setup",
  bridgeUnavailable: "Couldn't connect to the local WeChat data service. Open the desktop app or restart it.",
  closeDialog: {
    title: 'Close window',
    description:
      'Minimize to the {tray, select, menuBar {menu bar} other {system tray}} to keep syncing and sending auto replies',
    remember: 'Remember my choice',
    rememberHint: 'You can change this in Settings',
    quit: 'Quit',
    minimize: 'Minimize to {tray, select, menuBar {menu bar} other {system tray}}',
  },
  tabs: {
    task: 'Scheduled task',
    diary: 'Diary',
    replyDesk: 'Reply desk',
    settings: 'Settings',
    kit: 'Component gallery',
  },
  quote: {
    noTarget: 'Nothing in this tab can be added to the Agent',
    noTargetHint: 'Open a chat, contact or file and try again',
  },
  layout: { switchFailed: "Couldn't switch layout" },
  open: {
    linkFailed: "Couldn't open link",
    pathFailed: "Couldn't open {what}",
    file: 'file',
    revealFailed: "Couldn't show in folder",
  },
}
