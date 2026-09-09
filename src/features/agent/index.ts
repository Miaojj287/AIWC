/**
 * Agent panel feature (DESIGN-SPEC §1.3, CLAUDE.md §5).
 *
 *   register()     — command handlers 'agent.quote' / 'agent.newThread' (nothing else)
 *   AgentPanel     — the right column (collapsed strip / tabs + messages + composer)
 *   MessageList    — transcript renderer, reused by the clone page
 *   Composer       — input card with @ / / popovers, reused by the clone page
 */
import { onCommand } from '@/app/commands'
import { useAgentStore } from './agentStore'

export function register(): void {
  onCommand('agent.quote', (payload) => void useAgentStore.getState().quote(payload))
  onCommand('agent.newThread', (payload) => void useAgentStore.getState().newThread(payload ?? {}))
}

export { AgentPanel, type AgentPanelProps } from './AgentPanel'
export { MessageList, type MessageListProps } from './MessageList'
export { Composer, COMPOSER_PLACEHOLDER, type ComposerProps } from './Composer'
export { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
export { Markdown, type MarkdownProps } from './MarkdownView'
export { parseMarkdown, parseInline, inlineToText, type Block, type Inline } from './markdownParser'
export { MARKDOWN_CLASS, MARKDOWN_HEADING_CLASS, type MarkdownClassKey, type MarkdownHeadingLevel } from './markdownStyles'
export { ContextRing, type ContextRingProps } from './composer/ContextRing'
export { PermissionSelect, PERMISSION_MODES, type PermissionSelectProps } from './composer/PermissionSelect'
export { ModelSelect, modelLabelFor, type ModelSelectProps } from './composer/ModelSelect'
export { SendButton, type SendButtonProps } from './composer/SendButton'
export { useAgentStore, subscribeAgentEvents, selectActiveView, selectActiveSummary, selectOpenThreads, type AgentState, type ModelOption } from './agentStore'
export { reduceEvent, reduceEvents, itemsFromHistory, viewFromHistory, findUserInput, humanizeToolName } from './reducer'
export { detectTrigger, applyTrigger, addMention, removeMention, buildUserInput, matchesQuery, MENTION_KIND_LABEL, type Trigger, type TriggerKind } from './mentions'
export { defaultMentionSources, MENTION_TABS, type MentionSources, type MentionCandidate } from './mentionSources'
export { contextRefFromTab, activeTabContextRef, mentionFromContextRef, type ContextRef } from './contextRef'
export {
  createThreadView,
  emptyDraft,
  SCRATCH_DRAFT_KEY,
  userItemText,
  usageRatio,
  formatTokens,
  formatSeconds,
  USAGE_WARN_RATIO,
  type ThreadItem,
  type ThreadItemKind,
  type ThreadViewState,
  type ToolCallView,
  type ApprovalRequest,
  type ComposerDraft,
  type PlanStep,
  type PlanStepStatus,
  type ThreadError,
} from './model'
export type { AssistantItem, FeedbackVerdict } from './messages/AssistantMessage'
export type { UserItem } from './messages/UserMessage'
export type { ArtifactItem } from './messages/ArtifactCard'
export type { ErrorItem } from './messages/ErrorCard'
