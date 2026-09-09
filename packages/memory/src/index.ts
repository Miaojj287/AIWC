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
 */
export { createMemoryStore, MemoryDriftError, type MemoryStoreExt, type MemoryStoreOptions } from './store/memoryStore'
export { DEFAULT_MEMORY_LIMITS, ENTRY_DELIMITER, MEMORY_FILES, MEMORY_FILE_LABELS, isMemoryFile, parseEntries, serializeEntries } from './store/format'
export { createRelationshipStore, type RelationshipStoreExt, type RelationshipCorrection } from './relationship/relationshipStore'
export { createDiaryStore, type DiaryStoreExt } from './diary/diaryStore'
export { createDiaryPipeline, type DiaryPipelineDeps, type DiaryPipelineExt, type DiarySchedule, type RolloutSearchFn } from './diary/pipeline'
export {
  memoryFragmentProvider,
  memoryAudience,
  memoryFilesFor,
  memoryPolicyFragment,
  MEMORY_FRAGMENT_TOKEN_CAP,
  MEMORY_FRAGMENT_KIND,
  MEMORY_POLICY_FRAGMENT_KIND,
  MEMORY_POLICY_TOKEN_CAP,
  type MemoryAudience,
  type MemoryAudienceContext,
  type MemoryFragmentProvider,
  type MemoryFragmentProviderOptions,
} from './fragments/memoryFragmentProvider'
export { relationshipFragmentProvider, RELATIONSHIP_FRAGMENT_TOKEN_CAP, type RelationshipFragmentProvider } from './fragments/relationshipFragmentProvider'
export {
  personaFragmentProvider,
  personaIdentityProvider,
  PERSONA_IDENTITY_KIND,
  PERSONA_NOTES_KIND,
  PERSONA_RECALL_KIND,
  type PersonaFragmentDeps,
  type PersonaFragmentProvider,
  type PersonaIdentityProvider,
} from './fragments/personaFragmentProvider'
export { BURST_MARKER, splitBubbles, renderPersonaIdentity, renderPersonaTurn } from './clone/personaPrompt'
export { searchPairs, PAIR_TOP_K, type PersonaPairHit } from './clone/pairs'
export { reflectConversation, renderTranscript, MAX_TRANSCRIPT_CHARS } from './clone/reflect'
export { collectGroupCorpus, type GroupCorpus } from './clone/groupCorpus'
export { memoryTools, type MemoryToolServices } from './tools/memoryTools'
export { relationshipTools, type RelationshipToolServices } from './tools/relationshipTools'
export { createCloneBuilder, CLONE_STEPS, type CloneBuilder, type CloneBuilderDeps, type CloneBuildOptions } from './clone/cloneBuilder'
export { applyCorrections } from './clone/corrections'
export { MIN_MESSAGES as CLONE_MIN_MESSAGES, MAX_MESSAGES as CLONE_MAX_MESSAGES, MAX_SAMPLES as CLONE_MAX_SAMPLES, MAX_PAIRS as CLONE_MAX_PAIRS } from './clone/corpus'
export { sampleText, extractJson, generateValidated, ModelSampleError } from './internal/model'
export type { AnyToolDefinition } from './types'
// Fragment provider contracts are the protocol's; re-exported so the composition root keeps one import site.
export type { FragmentProvider, FragmentProviderContext } from '@aiwc/protocol'
