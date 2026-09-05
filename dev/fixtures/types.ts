/**
 * Shape of dev/fixtures/demo-dataset.json.
 *
 * Kept in sync with packages/substrate/src/demo/fixtureSchema.ts (owned by the substrate-core
 * agent). If that file changes, update this type and re-run the generator. The renderer-side copy
 * lives in src/platform/mock/types.ts (the renderer may only import @aiwc/protocol).
 */
import type { WxAccount, WxContact, WxMessage, WxSession } from '@aiwc/protocol'

export interface DemoFixture {
  version: 1
  account: WxAccount
  sessions: WxSession[]
  contacts: WxContact[]
  /** groupId → member usernames (includes the account's own wxid). */
  groupMembers: Record<string, string[]>
  messages: WxMessage[]
}
