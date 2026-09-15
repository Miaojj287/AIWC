/**
 * @aiwc/memory — bounded Markdown memory, relationship (clone) profiles, diary pipeline, fragment
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
export { createDiaryStore } from './diary/diaryStore'
export { createDiaryPipeline } from './diary/pipeline'
export { memoryFragmentProvider, type MemoryFragmentProvider } from './fragments/memoryFragmentProvider'
export { relationshipFragmentProvider } from './fragments/relationshipFragmentProvider'
export { personaFragmentProvider, personaIdentityProvider } from './fragments/personaFragmentProvider'

export { reflectConversation, renderTranscript, MAX_TRANSCRIPT_CHARS } from './clone/reflect'

export { memoryTools } from './tools/memoryTools'
export { relationshipTools } from './tools/relationshipTools'
export { createCloneBuilder } from './clone/cloneBuilder'
export { profileEditCorrections } from './clone/corrections'

// Fragment provider contracts are the protocol's; re-exported so the composition root keeps one import site.
