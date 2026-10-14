import {
  WechatKeyHostInputSchema,
  WechatKeyHostOutputSchema,
  type WechatKeyHostInput,
  type WechatKeyHostOutput,
} from '@aiwc/protocol'
import type { acquireKeys, AcquireKeysResult } from '@aiwc/substrate'

const ACK_TIMEOUT_MS = 5_000
type HostInit = Extract<WechatKeyHostInput, { type: 'init' }>
type FinalMessage = Extract<WechatKeyHostOutput, { type: 'result' | 'coverage' | 'failed' }>
type AcquireOptions = Parameters<typeof acquireKeys>[0]

/** Runtime ports keep the utility lifecycle independently testable without importing Electron. */
export interface KeyAcquireRuntimeDeps {
  post(message: WechatKeyHostOutput): void
  acquire(options: AcquireOptions): Promise<AcquireKeysResult>
  inspect(options: HostInit): { database: boolean; matched: number; total: number; missing: string[] }
  exit(): void
}

/** A one-request utility waits for persistence and delivery ACKs before progressing or exiting. */
export function createKeyAcquireRuntime(deps: KeyAcquireRuntimeDeps) {
  let controller: AbortController | undefined
  let started = false
  let cancelled = false
  let finished = false
  let failed = false
  let running = false
  let databaseAck: ((accepted: boolean) => void) | undefined
  let finalAck: (() => void) | undefined
  let finalTimer: ReturnType<typeof setTimeout> | undefined

  const exit = () => {
    if (finished) return
    finished = true
    if (finalTimer) clearTimeout(finalTimer)
    deps.exit()
  }
  const cancel = () => {
    cancelled = true
    controller?.abort()
    databaseAck?.(false)
    if (!started) exit()
  }
  const post = (message: WechatKeyHostOutput) => deps.post(WechatKeyHostOutputSchema.parse(message))
  const deliverFinal = (message: FinalMessage) => {
    if (finished || finalAck) return
    finalAck = exit
    finalTimer = setTimeout(exit, ACK_TIMEOUT_MS)
    try {
      post(message)
    } catch {
      exit()
    }
  }
  const persistDatabase = (database: Parameters<NonNullable<AcquireOptions['onDatabaseReady']>>[0]) =>
    new Promise<void>((resolve, reject) => {
      const signal = controller?.signal
      const complete = (accepted: boolean) => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        databaseAck = undefined
        if (accepted && !cancelled) resolve()
        else {
          controller?.abort()
          reject(new DOMException('aborted', 'AbortError'))
        }
      }
      const abort = () => complete(false)
      databaseAck = complete
      const timeout = setTimeout(() => complete(false), ACK_TIMEOUT_MS)
      signal?.addEventListener('abort', abort, { once: true })
      if (cancelled || signal?.aborted) {
        complete(false)
        return
      }
      try {
        post({ type: 'database', database })
      } catch {
        complete(false)
      }
    })

  const run = async (input: HostInit) => {
    if (input.operation === 'inspect') {
      deliverFinal({ type: 'coverage', result: deps.inspect(input) })
      return
    }
    const result = await deps.acquire({
      ...input.request,
      nativeDir: input.nativeDir,
      signal: controller?.signal,
      onStep: (step) => {
        if (!cancelled) post({ type: 'step', step })
      },
      onDatabaseReady: persistDatabase,
    })
    deliverFinal(failed ? { type: 'failed' } : { type: 'result', result })
  }
  const fail = () => {
    failed = true
    cancel()
    if (!running) deliverFinal({ type: 'failed' })
  }
  const receive = (raw: unknown) => {
    if (finished) return
    const parsed = WechatKeyHostInputSchema.safeParse(raw)
    if (!parsed.success) {
      fail()
      return
    }
    const message = parsed.data
    switch (message.type) {
      case 'init':
        if (started || cancelled) {
          fail()
          return
        }
        started = true
        running = true
        controller = new AbortController()
        void run(message)
          .catch(() => {
            cancel()
            deliverFinal({ type: 'failed' })
          })
          .finally(() => {
            running = false
          })
        break
      case 'cancel':
        cancel()
        break
      case 'database_ack':
        if (databaseAck) databaseAck(message.accepted)
        else {
          fail()
        }
        break
      case 'final_ack':
        if (finalAck) finalAck()
        else {
          fail()
        }
        break
    }
  }
  const disconnect = () => {
    cancel()
    if (finalAck) exit()
  }
  return { receive, disconnect }
}
