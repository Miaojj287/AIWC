/**
 * Unsent composer drafts survive a restart (composer:loadDrafts / composer:saveDraft). Each thread with kernel history
 * keeps its draft under its id; the conversation that does not exist yet — the scratch slot or a new local thread — is
 * kept under one `new` key. Writes are debounced per key and flushed when the window goes away.
 *
 * On start the saved drafts fill the slots that are still empty (typing during the load is never overwritten); a
 * saved `new` draft reopens as a new conversation tab once the thread list is known.
 */
import { NEW_THREAD_DRAFT_KEY, type ComposerDraftRecord, type ThreadId } from '@aiwc/protocol'
import { invoke } from '@/platform/hooks'
import { useAgentStore } from './agentStore'
import { addMention } from './mentions'
import { emptyDraft, SCRATCH_DRAFT_KEY, type ComposerDraft } from './model'

/** Typing pause before a draft is written. */
export const DRAFT_SAVE_DELAY_MS = 600

const isEmptyDraft = (d: ComposerDraft | undefined): boolean =>
  !d || (!d.text.trim() && d.mentions.length === 0 && !d.attachments?.length)

const toRecord = (d: ComposerDraft): ComposerDraftRecord => ({
  text: d.text,
  mentions: d.mentions,
  attachments: d.attachments ?? [],
})

/** The persisted key a store draft slot maps to: `new` for the scratch slot and threads the kernel has not created. */
export function persistedKey(slot: string, localIds: readonly string[]): string {
  return slot === SCRATCH_DRAFT_KEY || localIds.includes(slot) ? NEW_THREAD_DRAFT_KEY : slot
}

/** The draft to keep under `new`: the slot just edited when it has content, else any other unsent new-thread draft. */
export function newThreadDraft(
  drafts: Record<string, ComposerDraft>,
  localIds: readonly string[],
  changed: string,
): ComposerDraft | undefined {
  if (!isEmptyDraft(drafts[changed])) return drafts[changed]
  for (const slot of [SCRATCH_DRAFT_KEY, ...localIds]) if (!isEmptyDraft(drafts[slot])) return drafts[slot]
  return undefined
}

let installed: (() => void) | undefined

/** Load saved drafts and keep saving them; idempotent (both Agent surfaces call it). */
export function installDraftPersistence(): void {
  if (installed) return
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pending = new Map<string, ComposerDraftRecord | null>()
  let restoring = true

  const write = (key: string) => {
    timers.delete(key)
    if (!pending.has(key)) return
    const draft = pending.get(key) ?? null
    pending.delete(key)
    // Best effort: a failed write only loses the latest keystrokes of an unsent draft; the next edit retries.
    void invoke('composer:saveDraft', { key, draft }).catch(() => undefined)
  }
  const schedule = (key: string, draft: ComposerDraft | undefined) => {
    pending.set(key, isEmptyDraft(draft) || !draft ? null : toRecord(draft))
    const old = timers.get(key)
    if (old) clearTimeout(old)
    timers.set(
      key,
      setTimeout(() => write(key), DRAFT_SAVE_DELAY_MS),
    )
  }
  const flush = () => {
    for (const key of [...timers.keys()]) {
      clearTimeout(timers.get(key))
      write(key)
    }
  }

  const unsubscribe = useAgentStore.subscribe((s, prev) => {
    if (restoring || s.drafts === prev.drafts) return
    for (const slot of new Set([...Object.keys(s.drafts), ...Object.keys(prev.drafts)])) {
      if (s.drafts[slot] === prev.drafts[slot]) continue
      const key = persistedKey(slot, s.localIds)
      schedule(key, key === NEW_THREAD_DRAFT_KEY ? newThreadDraft(s.drafts, s.localIds, slot) : s.drafts[slot])
    }
  })
  window.addEventListener('pagehide', flush)
  installed = () => {
    unsubscribe()
    window.removeEventListener('pagehide', flush)
    for (const timer of timers.values()) clearTimeout(timer)
  }

  void invoke('composer:loadDrafts', undefined)
    .then((rows) => restore(rows))
    .catch(() => undefined)
    .finally(() => {
      restoring = false
    })
}

function restore(rows: Array<{ key: string; draft: ComposerDraftRecord }>): void {
  const store = useAgentStore.getState()
  let fresh: ComposerDraftRecord | undefined
  for (const { key, draft } of rows) {
    if (key === NEW_THREAD_DRAFT_KEY) fresh = draft
    else if (isEmptyDraft(store.drafts[key])) store.setDraft(key as ThreadId, draft)
  }
  if (fresh) void reopenNewThread(fresh)
}

/** The unsent new conversation comes back as the active tab (or fills the empty one the panel just opened). */
async function reopenNewThread(draft: ComposerDraftRecord): Promise<void> {
  await whenHydrated()
  const store = useAgentStore.getState()
  const active = store.activeThreadId
  const target =
    active && store.localIds.includes(active) && isEmptyDraft(store.drafts[active])
      ? active
      : await store.createThread({ focus: false }).catch(() => undefined)
  if (!target) {
    if (isEmptyDraft(useAgentStore.getState().drafts[SCRATCH_DRAFT_KEY])) store.setDraft(SCRATCH_DRAFT_KEY, draft)
    return
  }
  const current = useAgentStore.getState().drafts[target]
  // createThread seeds a context chip; keep it in front of the restored draft.
  useAgentStore.getState().setDraft(target, {
    ...draft,
    mentions: draft.mentions.reduce((list, m) => addMention(list, m), (current ?? emptyDraft()).mentions),
  })
}

/** Resolves once the thread list has loaded (or failed to), so the active tab is known. */
function whenHydrated(): Promise<void> {
  if (useAgentStore.getState().hydrated) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = useAgentStore.subscribe((s) => {
      if (!s.hydrated) return
      stop()
      resolve()
    })
  })
}

/** Stop saving and forget the install (tests). */
export function __resetDraftPersistenceForTests(): void {
  installed?.()
  installed = undefined
}
