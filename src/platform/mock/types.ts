/**
 * Renderer-side copy of the demo fixture shape (dev/fixtures/types.ts). The renderer may only
 * import @aiwc/protocol, so the type is repeated here; both are composed purely from protocol types.
 */
import type { WxAccount, WxContact, WxMessage, WxSession } from '@aiwc/protocol'

export interface DemoFixture {
  version: 1
  account: WxAccount
  sessions: WxSession[]
  contacts: WxContact[]
  groupMembers: Record<string, string[]>
  messages: WxMessage[]
}
