/**
 * Memory & relationship contracts.
 *  - MemoryStore: four bounded Markdown files the user can read and edit (settings › 记忆).
 *  - RelationshipStore: per-contact persona/relationship profiles (AI 克隆 data).
 *  - DiaryPipeline: nightly synthesis over the substrate.
 */
import type { Millis } from './ids'

export type MemoryFile = 'MEMORY' | 'USER' | 'SOUL' | 'AGENTS'

export interface MemoryEntry {
  index: number
  text: string
  addedAt?: Millis
  source?: 'user' | 'agent' | 'diary'
}

export interface MemoryBudget {
  file: MemoryFile
  usedChars: number
  limitChars: number
}

/** Frozen render used in the system prompt for the whole session (prompt-cache stability). */
export interface MemorySnapshot {
  takenAt: Millis
  files: Record<MemoryFile, string>
  budgets: MemoryBudget[]
}

export interface MemoryStore {
  read(file: MemoryFile): Promise<string>
  write(file: MemoryFile, markdown: string, opts?: { source?: MemoryEntry['source'] }): Promise<void>
  entries(file: MemoryFile): Promise<MemoryEntry[]>
  addEntry(file: MemoryFile, text: string, opts?: { source?: MemoryEntry['source'] }): Promise<{ ok: boolean; reason?: 'over_budget' | 'duplicate' | 'blocked' }>
  replaceEntry(file: MemoryFile, index: number, text: string): Promise<void>
  removeEntry(file: MemoryFile, index: number): Promise<void>
  budget(file: MemoryFile): Promise<MemoryBudget>
  snapshot(): Promise<MemorySnapshot>
  /** Cheap keyword recall across MEMORY/USER (no LLM). */
  search(query: string, limit?: number): Promise<Array<{ file: MemoryFile; entry: MemoryEntry; score: number }>>
  subscribe(listener: (e: { file: MemoryFile; source: MemoryEntry['source'] }) => void): () => void
}

/**
 * A clone reply may contain several WeChat bubbles. The model separates them with a line holding
 * only this marker; the renderer splits on it. It lives in the protocol because both the prompt
 * (@aiwc/memory) and the chat view (src/features/clone) must agree on the exact string.
 */
export const PERSONA_BURST_MARKER = '---wx-next---'

/**
 * Split one clone reply into bubbles.
 *
 * `streaming` matters: mid-stream the tail of the text can be a half-arrived marker ("\n---wx-"),
 * which is not yet a separator and would otherwise be shown to the user as literal text. While the
 * reply is still arriving that trailing fragment is dropped; once it completes it becomes a split.
 */
export function splitPersonaBubbles(text: string, streaming = false): string[] {
  const body = streaming ? text.replace(partialMarkerTail(), '') : text
  return body
    .split(new RegExp(`^\\s*${PERSONA_BURST_MARKER}\\s*$`, 'm'))
    .map((b) => b.trim())
    .filter(Boolean)
}

/** Matches a trailing, still-incomplete prefix of the marker (including the newline before it). */
function partialMarkerTail(): RegExp {
  const prefixes = Array.from({ length: PERSONA_BURST_MARKER.length }, (_, i) => PERSONA_BURST_MARKER.slice(0, i + 1))
    .reverse()
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\n[ \\t]*(?:${prefixes.join('|')})[ \\t]*$`)
}

export interface PersonaCard {
  tone: string[]
  traits: string[]
  catchphrases: string[]
  punctuation: string
  addressing: { self?: string; other?: string }
  topics: string[]
  replyHabits: Record<string, string>
}

export interface PersonaDeep {
  facts: string[]
  relationship: string
  reactionPatterns: string[]
  boundaries: string[]
  sharedEvents: Array<{ when?: string; what: string }>
}

export interface PersonaSample {
  prompt: string
  reply: string
  at?: Millis
  /** true when the user hand-corrected this sample */
  corrected?: boolean
}

/**
 * One real turn pair mined from history: what the other side said → how the subject answered.
 * Unlike PersonaSample (a curated handful shown in the editor) these are kept in bulk and looked up
 * by similarity at chat time, so the clone answers with what this person actually said last time.
 */
export interface PersonaPair {
  /** start of the subject's reply turn */
  at: Millis
  /** the other side's turn */
  prompt: string
  /** the subject's reply, one entry per message of the burst */
  replies: string[]
  /** the turn before `prompt` — callback / running-joke replies are nonsense without it */
  context?: string
}

/**
 * Director's notes: what the user told the clone to do differently ('correction') and one-line
 * summaries of past test chats ('episode', the clone's own episodic memory).
 */
export interface PersonaNote {
  at: Millis
  kind: 'correction' | 'episode'
  text: string
}

/** Local statistics (no model) used to constrain reply length / bursts / voice habits in the prompt. */
export interface PersonaStats {
  /** messages read while building */
  messageCount: number
  /** of those, the profiled person's */
  subjectMessageCount: number
  /** mean characters per message of the profiled person */
  avgSubjectChars: number
  /** mean messages the profiled person sends per turn */
  avgSubjectBurst: number
  voiceCount: number
  transcribedVoiceCount: number
  /** voice / (text + voice) for the profiled person — how much they like voice notes */
  voiceRatio?: number
  /** group-chat lines pulled in when the DM corpus was too thin (style only, never pairs) */
  groupMessageCount?: number
  groupSessionCount?: number
}

export type CloneStatus =
  | { state: 'none'; messageCount: number }
  | { state: 'building'; progress: { done: number; total: number; step: string; startedAt: Millis; etaMs?: number } }
  | { state: 'ready'; version: number; sampleCount: number; builtAt: Millis }
  | { state: 'failed'; error: string; kind: 'model' | 'too_few_messages' | 'unknown' }

export interface RelationshipProfile {
  contactId: string
  displayName: string
  card: PersonaCard
  deep: PersonaDeep
  samples: PersonaSample[]
  version: number
  updatedAt: Millis
  /** 'self' clones the user themself. */
  role: 'contact' | 'self'
  /** Manual corrections are kept when re-cloning unless the user opts out. */
  corrections: RelationshipCorrection[]
  /** Local corpus statistics; absent on profiles built before stats existed. */
  stats?: PersonaStats
}

export interface RelationshipCorrection {
  at: Millis
  field: string
  from: string
  to: string
}

export interface RelationshipStore {
  list(): Promise<Array<{ contactId: string; status: CloneStatus; displayName: string }>>
  get(contactId: string): Promise<RelationshipProfile | undefined>
  status(contactId: string): Promise<CloneStatus>
  upsert(profile: RelationshipProfile): Promise<void>
  remove(contactId: string): Promise<void>
  subscribe(listener: (e: { contactId: string; status: CloneStatus }) => void): () => void
  /** Optional extras used by the clone builder to persist building/failed states and corrections. */
  setStatus?(contactId: string, status: CloneStatus, displayName?: string): Promise<void>
  appendCorrection?(contactId: string, correction: RelationshipCorrection): Promise<void>
  listCorrections?(contactId: string): Promise<RelationshipCorrection[]>
  clearCorrections?(contactId: string): Promise<void>
  /** Bulk retrieval corpus: replaced on every rebuild, read back by similarity at chat time. */
  replacePairs?(contactId: string, pairs: readonly PersonaPair[]): Promise<void>
  listPairs?(contactId: string): Promise<PersonaPair[]>
  /** Director's notes (corrections the user gave in the test chat + episode summaries). */
  addNotes?(contactId: string, notes: readonly Omit<PersonaNote, 'at'>[], at?: Millis): Promise<void>
  listNotes?(contactId: string): Promise<PersonaNote[]>
  /** How many transcript messages of `threadId` have already been reflected on. */
  getReflected?(contactId: string, threadId: string): Promise<number>
  setReflected?(contactId: string, threadId: string, count: number): Promise<void>
}

export interface DiaryEntry {
  date: string /** YYYY-MM-DD */
  markdown: string
  /** 3–8 retrieval cues written for the agent, stored in a dedicated section. */
  cues: string[]
  sources: { sessions: string[]; messageCount: number; agentTurns: number }
  generatedAt: Millis
  degraded?: boolean
}

export interface DiaryStore {
  list(): Promise<Array<Pick<DiaryEntry, 'date' | 'generatedAt' | 'degraded'>>>
  get(date: string): Promise<DiaryEntry | undefined>
  put(entry: DiaryEntry): Promise<void>
}

export interface DiaryPipeline {
  /** Build (or rebuild) the entry for a day. Emits progress via the callback. */
  run(date: string, opts?: { force?: boolean; onProgress?: (step: string, fraction: number) => void; signal?: AbortSignal }): Promise<DiaryEntry>
  nextScheduledAt(): Millis | undefined
}
