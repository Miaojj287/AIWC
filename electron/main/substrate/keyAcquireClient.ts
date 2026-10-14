import { utilityProcess } from 'electron'
import {
  type WechatDatabaseReadySchema,
  WechatKeyHostOutputSchema,
  type WechatAcquireRequest,
  type WechatDbCredentialBundle,
  type KeyAcquireStep,
  type WechatKeyHostInput,
} from '@aiwc/protocol'
import type { AcquireKeysResult } from '@aiwc/substrate'

const ACQUIRE_TIMEOUT_MS = 110_000
const INSPECT_TIMEOUT_MS = 30_000
const TERMINATE_GRACE_MS = 2_000
type HostResult = AcquireKeysResult | { database: boolean; matched: number; total: number; missing: string[] }
type DatabaseReady = ReturnType<typeof WechatDatabaseReadySchema.parse>

/** All native acquisition and credential verification runs in a short-lived utility process. */
export function runKeyHost(options: {
  entry: string
  nativeDir: string
  request: WechatAcquireRequest
  operation: 'acquire' | 'inspect'
  dbKeyHex?: string
  dbCredentials?: WechatDbCredentialBundle
  signal?: AbortSignal
  onStep?: (step: KeyAcquireStep) => void
  onDatabase?: (database: DatabaseReady) => void | Promise<void>
}): Promise<HostResult> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(options.entry, [], { serviceName: 'AIWC Connection', stdio: 'ignore' })
    let settled = false,
      spawned = false,
      databasePending = false,
      databaseCommitted = false
    let stopping: Error | undefined
    let completed: HostResult | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', cancel)
      child.removeListener('spawn', onSpawn)
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
      if (options.signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
      else if (stopping ?? error) reject(stopping ?? error)
      else if (completed) resolve(completed)
      else reject(new Error('KEY_HOST_FAILED'))
    }
    const post = (message: WechatKeyHostInput): boolean => {
      try {
        child.postMessage(message)
        return true
      } catch {
        return false
      }
    }
    const waitForExit = () => {
      if (killTimer) return
      killTimer = setTimeout(() => {
        try {
          child.kill()
        } finally {
          finish()
        }
      }, TERMINATE_GRACE_MS)
    }
    const stop = (error: Error) => {
      if (settled) return
      stopping ??= error
      if (spawned) post({ type: 'cancel' })
      waitForExit()
    }
    const cancel = () => stop(new DOMException('aborted', 'AbortError'))
    const timer = setTimeout(
      () => stop(new Error('KEY_HOST_TIMEOUT')),
      options.operation === 'acquire' ? ACQUIRE_TIMEOUT_MS : INSPECT_TIMEOUT_MS,
    )
    const onSpawn = () => {
      spawned = true
      if (stopping || options.signal?.aborted) {
        cancel()
        return
      }
      if (
        !post({
          type: 'init',
          request: options.request,
          nativeDir: options.nativeDir,
          operation: options.operation,
          dbKeyHex: options.dbKeyHex,
          dbCredentials: options.dbCredentials,
        })
      )
        stop(new Error('KEY_HOST_FAILED'))
    }
    const commitDatabase = async (database: DatabaseReady) => {
      try {
        if (!options.onDatabase) throw new Error('KEY_HOST_FAILED')
        await options.onDatabase(database)
        if (settled || stopping || options.signal?.aborted) return
        databasePending = false
        databaseCommitted = true
        if (!post({ type: 'database_ack', accepted: true })) stop(new Error('KEY_HOST_FAILED'))
      } catch {
        databasePending = false
        if (!settled) {
          post({ type: 'database_ack', accepted: false })
          stop(new Error('KEY_HOST_SAVE_FAILED'))
        }
      }
    }
    const onMessage = (raw: unknown) => {
      if (settled) return
      const parsed = WechatKeyHostOutputSchema.safeParse(raw)
      if (!parsed.success) {
        stop(new Error('INVALID_KEY_HOST_RESULT'))
        return
      }
      const message = parsed.data
      if (stopping) {
        if (message.type === 'result' || message.type === 'coverage' || message.type === 'failed')
          post({ type: 'final_ack' })
        return
      }
      try {
        switch (message.type) {
          case 'database':
            if (
              options.operation !== 'acquire' ||
              options.request.scope === 'image' ||
              databasePending ||
              databaseCommitted ||
              (message.database.dbCredentials && message.database.dbCredentials.accountId !== options.request.wxid)
            )
              throw new Error('INVALID_KEY_HOST_RESULT')
            databasePending = true
            void commitDatabase(message.database)
            break
          case 'step':
            if (options.operation !== 'acquire') throw new Error('INVALID_KEY_HOST_RESULT')
            options.onStep?.(message.step)
            break
          case 'result':
            if (
              options.operation !== 'acquire' ||
              databasePending ||
              (message.result.dbKeyHex && !databaseCommitted) ||
              (message.result.dbCredentials && message.result.dbCredentials.accountId !== options.request.wxid)
            )
              throw new Error('INVALID_KEY_HOST_RESULT')
            completed = message.result
            post({ type: 'final_ack' })
            waitForExit()
            break
          case 'coverage':
            if (options.operation !== 'inspect') throw new Error('INVALID_KEY_HOST_RESULT')
            completed = message.result
            post({ type: 'final_ack' })
            waitForExit()
            break
          case 'failed':
            post({ type: 'final_ack' })
            stop(new Error('KEY_HOST_FAILED'))
            break
        }
      } catch {
        stop(new Error('INVALID_KEY_HOST_RESULT'))
      }
    }
    const onExit = () => finish(completed ? undefined : new Error('KEY_HOST_EXITED'))
    options.signal?.addEventListener('abort', cancel, { once: true })
    child.on('spawn', onSpawn)
    child.on('message', onMessage)
    child.on('exit', onExit)
    if (options.signal?.aborted) cancel()
  })
}
