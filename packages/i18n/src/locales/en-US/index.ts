/**
 * English catalog. Typed against the zh-CN reference: a missing or extra key is a compile error.
 * Keep the tone of DESIGN-SPEC copy — short, sentence case, no trailing periods on labels.
 */
import type { Messages } from '../zh-CN'
import { agent } from './agent'
import { app } from './app'
import { autoreply } from './autoreply'
import { chat } from './chat'
import { clone } from './clone'
import { common } from './common'
import { todo } from './todo'
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
import { search } from './search'
import { settings } from './settings'
import { shell } from './shell'
import { tasks } from './tasks'
import { mobile } from './mobile'
import { workspace } from './workspace'

export const enUS: Messages = {
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
  search,
  clone,
  todo,
  file,
  onboarding,
  pets,
  settings,
  legal,
  office,
  tasks,
  mobile,
}
