/**
 * WeChat substrate tools. `substrateTools()` returns the full set; the composition root registers
 * them with the kernel registry, which derives prompts / timeouts / approval from the definitions.
 */
import type { SubstrateService, ToolDefinition } from '@aiwc/protocol'
import { chatStats } from './chatStats'
import { getContext } from './getContext'
import { getTimeline } from './getTimeline'
import { groupMemberRanking, groupMembers, listGroups } from './groups'
import { listContacts } from './listContacts'
import { listSessions } from './listSessions'
import { querySql } from './querySql'
import { searchMessages, semanticSearch } from './search'
import { searchMedia } from './searchMedia'
import { transcribeVoiceMessage } from './transcribeVoiceMessage'

export type { SubstrateTool, SubstrateToolServices, CompactMessage, CompactSession, CompactContact, CompactHit, Coverage } from './shared'
export { compactMessage, compactSession, compactContact, compactHit, fmtTime, clampLimit, describeCoverage, MessageAnchorSchema } from './shared'
export { assertReadOnlySql } from './querySql'

export {
  listSessions,
  listContacts,
  searchMessages,
  semanticSearch,
  getContext,
  getTimeline,
  chatStats,
  listGroups,
  groupMembers,
  groupMemberRanking,
  transcribeVoiceMessage,
  searchMedia,
  querySql,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function substrateTools(): ToolDefinition<any, { substrate: SubstrateService }>[] {
  return [
    listSessions,
    listContacts,
    searchMessages,
    semanticSearch,
    getContext,
    getTimeline,
    chatStats,
    listGroups,
    groupMembers,
    groupMemberRanking,
    transcribeVoiceMessage,
    searchMedia,
    querySql,
  ]
}
