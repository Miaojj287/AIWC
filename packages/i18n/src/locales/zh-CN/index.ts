/**
 * Reference catalog (简体中文). Its shape is the type every other catalog must match — add a key here
 * and en-US stops compiling until it has the same key. Namespaces mirror the source tree:
 * one file per feature so parallel edits never collide.
 */
import { agent } from './agent'
import { app } from './app'
import { autoreply } from './autoreply'
import { chat } from './chat'
import { clone } from './clone'
import { common } from './common'
import { diary } from './diary'
import { file } from './file'
import { format } from './format'
import { kit } from './kit'
import { known } from './known'
import { legal } from './legal'
import { main } from './main'
import { menu } from './menu'
import { office } from './office'
import { onboarding } from './onboarding'
import { pets } from './pets'
import { replydesk } from './replydesk'
import { settings } from './settings'
import { shell } from './shell'
import { tasks } from './tasks'
import { workspace } from './workspace'

export const zhCN = {
  common,
  format,
  kit,
  app,
  shell,
  workspace,
  menu,
  main,
  known,
  chat,
  agent,
  autoreply,
  replydesk,
  clone,
  diary,
  file,
  onboarding,
  pets,
  settings,
  legal,
  office,
  tasks,
}

/** Shape of every catalog (leaves are `string`). */
export type Messages = typeof zhCN
