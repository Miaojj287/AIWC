/**
 * @aiwc/memory — bounded Markdown memory, relationship (clone) profiles, the 每日待办 scanner, fragment
 * providers and tools. Public surface per docs/PACKAGE-API.md; everything else is internal.
 */
/**
 * Memory store. `replaceEntry` / `removeEntry` keep the protocol signature (`Promise<void>`) and never fail
 * with a bare Error on drift: when the on-disk file was edited externally in a way a rewrite could not
 * preserve, the mutation is refused, a `<file>.md.bak.<ts>` copy is taken and the promise rejects with
 * `MemoryDriftError` (`.file`, `.bakPath`). Hosts catch it by `instanceof` and surface `.bakPath`; re-saving
 * the file in settings › 记忆 is the remediation. `addEntry` reports the same condition as `reason: 'blocked'`.
 * `removeEntry(file, index, expectedText)` also rejects with `MemoryEntryMismatchError` (nothing removed) when
 * the entry at `index` no longer reads `expectedText`.
 */
export { createMemoryStore } from './store/memoryStore'

export { createRelationshipStore, type RelationshipStoreExt } from './relationship/relationshipStore'
export { createTodoStore, TodoNotFoundError, type TodoStore } from './todo/todoStore'
export { createTodoScanner, type TodoScanner } from './todo/pipeline'
export { memoryFragmentProvider, type MemoryFragmentProvider } from './fragments/memoryFragmentProvider'
export { relationshipFragmentProvider } from './fragments/relationshipFragmentProvider'
export { personaFragmentProvider, personaIdentityProvider } from './fragments/personaFragmentProvider'

export { reflectConversation, renderTranscript, MAX_TRANSCRIPT_CHARS } from './clone/reflect'

export { memoryTools, type MemoryToolOptions } from './tools/memoryTools'
/** 设置 › 记忆 › 待确认: proposals held for the user, and the idle-conversation extraction that fills them. */
export { createMemoryProposalStore, type MemoryProposalStore } from './review/proposalStore'
export { extractMemoryProposals, renderReviewTranscript } from './review/extract'
export { relationshipTools } from './tools/relationshipTools'
export { createCloneBuilder } from './clone/cloneBuilder'
export { profileEditCorrections } from './clone/corrections'

// Fragment provider contracts are the protocol's; re-exported so the composition root keeps one import site.
