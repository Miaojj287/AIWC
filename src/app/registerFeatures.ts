/**
 * Renderer composition: every feature registers its Tab renderers / object lists exactly once.
 * Features never import each other — they meet through tabRegistry, objectListRegistry and commands.
 */
import { register as registerAgent } from '@/features/agent'
import { register as registerAutoReply } from '@/features/autoreply'
import { register as registerChat } from '@/features/chat'
import { register as registerClone } from '@/features/clone'
import { register as registerDiary } from '@/features/diary'
import { register as registerFile } from '@/features/file'
import { register as registerKit } from '@/features/kit'
import { register as registerOnboarding } from '@/features/onboarding'
import { register as registerReplyDesk } from '@/features/replydesk'
import { register as registerSettings } from '@/features/settings'
import { registerShellLists } from '@/shell/registerShellLists'

let done = false

export function registerFeatures(): void {
  if (done) return
  done = true
  registerShellLists()
  registerAgent()
  registerChat()
  registerOnboarding()
  registerFile()
  registerDiary()
  registerSettings()
  registerAutoReply()
  registerClone()
  registerReplyDesk()
  registerKit()
}
