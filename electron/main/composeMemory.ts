/**
 * 设置 › 记忆 policy wiring for the composition root (the switches are read per use, so a change applies at once):
 *  - 写入前需要确认: the `remember` tool files entries in the 待确认 list instead of writing (memoryTools options)
 *  - 自动写入记忆: idle desktop conversations are distilled into 待确认 proposals (services/memoryExtraction.ts)
 *  - 记忆条数上限: enforced by the memory store itself (createMemoryStore `maxEntries`)
 * It also owns how memory changes reach the user: the 'memoryReview:changed' push, a toast while proposals wait,
 * and the "Agent 已写入记忆" toast — raised from the store's own change feed, so a refused write never claims success.
 */
import type {
  AppConfig,
  MemoryProposalAcceptRequest,
  MemoryProposalAcceptResult,
  MemoryStore,
  ModelClient,
  ModelSelection,
  ToastPayload,
} from '@aiwc/protocol'
import { asThreadId } from '@aiwc/protocol'
import type { Kernel } from '@aiwc/kernel'
import { createMemoryProposalStore, type MemoryProposalStore, type MemoryToolOptions } from '@aiwc/memory'
import type { Broadcast } from './contracts'
import type { Logger } from './log'
import type { SecretStore } from './config/secretStore'
import { createLowEffortModelFactory } from './ai/lowEffortModel'
import { t } from './i18n'
import { createMemoryExtractor, type MemoryExtractor } from './services/memoryExtraction'

type PkgLogger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
const LOG_SCOPE = 'memory-review'

export interface ComposeMemoryReviewDeps {
  dir: string
  memory: MemoryStore
  config(): AppConfig
  broadcast: Broadcast
  toast(payload: ToastPayload): void
  logger: Logger
}

export interface MemoryReviewService {
  proposals: MemoryProposalStore
  /** Pass to memoryTools(): 写入前需要确认 turns `remember` into a proposal. */
  toolOptions: MemoryToolOptions
  accept(req: MemoryProposalAcceptRequest): Promise<MemoryProposalAcceptResult>
  dismiss(ids: readonly string[]): Promise<void>
  /** Start the idle extraction once the kernel exists. */
  start(deps: {
    kernel: Pick<Kernel, 'events' | 'getThread' | 'listThreads'>
    /** Provider keys for the extraction client; tests pass `model` instead. */
    secrets?: Pick<SecretStore, 'reveal'>
    model?(selection: ModelSelection | undefined): Promise<ModelClient>
  }): void
  dispose(): void
}

const openReview = () => ({
  label: t('main.memoryReview.review'),
  command: 'tab.openSettings',
  payload: { page: 'memory', highlight: 'memory.review' },
})

export function composeMemoryReview(deps: ComposeMemoryReviewDeps): MemoryReviewService {
  const child = deps.logger.child(LOG_SCOPE)
  const log: PkgLogger = (level, msg, meta) => child[level](msg, meta)
  const memoryConfig = () => deps.config().memory
  const proposals = createMemoryProposalStore({
    dir: deps.dir,
    onCorrupt: (detail) => log('warn', `memory proposals: ${detail}`),
  })
  let kernel: Pick<Kernel, 'getThread'> | undefined
  let extractor: MemoryExtractor | undefined
  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    proposals.subscribe((items, added) => {
      deps.broadcast('memoryReview:changed', { items })
      if (added.length === 0) return
      deps.toast({
        id: 'memory.review',
        kind: 'info',
        text: t('main.memoryReview.pending', { n: items.length }),
        action: openReview(),
      })
    }),
  )
  unsubscribers.push(
    deps.memory.subscribe((e) => {
      if (e.source !== 'agent') return
      deps.toast({
        id: 'memory.written',
        kind: 'success',
        text: t('main.agent.memoryWritten'),
        action: { label: t('main.clone.view'), command: 'tab.openSettings', payload: { page: 'memory' } },
      })
    }),
  )

  const titleOf = async (threadId: string | undefined): Promise<string | undefined> => {
    if (!threadId || !kernel) return undefined
    try {
      return (await kernel.getThread(asThreadId(threadId)))?.record.title || undefined
    } catch {
      return undefined // provenance is a nicety; the proposal stands without a title
    }
  }

  return {
    proposals,
    toolOptions: {
      review: {
        confirmBeforeWrite: () => memoryConfig().confirmBeforeWrite,
        propose: async (input) => {
          const threadTitle = await titleOf(input.threadId)
          return proposals.add({ ...input, ...(threadTitle ? { threadTitle } : {}) })
        },
      },
    },
    accept: (req) => proposals.accept(deps.memory, req),
    async dismiss(ids) {
      await proposals.remove(ids)
    },
    start(startDeps) {
      if (extractor) return
      kernel = startDeps.kernel
      extractor = createMemoryExtractor({
        kernel: startDeps.kernel,
        proposals,
        memory: deps.memory,
        enabled: () => memoryConfig().autoWrite,
        model:
          startDeps.model ??
          createLowEffortModelFactory({ config: deps.config, secrets: startDeps.secrets ?? { reveal: () => null } }),
        logger: log,
      })
      void extractor.catchUp().catch((e: unknown) => log('warn', 'memory extraction catch-up failed', e))
    },
    dispose() {
      extractor?.dispose()
      for (const off of unsubscribers) off()
    },
  }
}
