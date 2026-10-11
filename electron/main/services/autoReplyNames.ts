/**
 * {昵称} / {群名} for auto-reply templates when the adapter did not supply display names: the
 * contact's remark or nickname, and the group's title. Shared by the auto-reply service and the
 * Jev dry run so both substitute the same way.
 */
import type { MessageEvent, SubstrateService } from '@aiwc/protocol'
import type { InboundNames } from '../prompts/inbound'

export type { InboundNames }

export function createInboundNameResolver(
  substrate: Pick<SubstrateService, 'getContact' | 'getSession'>,
): (event: MessageEvent) => Promise<InboundNames> {
  return async (event) => {
    try {
      const contact = await substrate.getContact(event.source.peerId)
      const group = event.source.chatType === 'group' ? await substrate.getSession(event.source.chatId) : undefined
      return { nickname: contact?.remark ?? contact?.nickname ?? event.source.displayName, groupName: group?.title }
    } catch {
      // Names are cosmetic: a failed lookup falls back to what the event already carries.
      return { nickname: event.source.displayName }
    }
  }
}
