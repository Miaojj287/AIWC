import { setImmediate } from 'node:timers/promises'
import type { KeyAcquireFailure, WechatDbCredentialBundle } from '@aiwc/protocol'
import { loadKernel32, type Kernel32Api } from './windowsProcessMemory'
import { ASCII_RECORD_SIZE } from './memoryDbKeyPattern'
import { extractWindowsCredentialRecords } from './windowsCredentialRecords'
import { createWindowsCredentialMatcher } from './windowsCredentialMatcher'

const PROCESS_READ_ACCESS = 0x410
const MEMORY_INFORMATION_BYTES = 48
const MAX_USER_ADDRESS = 0x7fff_ffff_ffffn
const MEM_COMMIT = 0x1000
const PAGE_GUARD = 0x100
const READABLE_PROTECTION_MASK = 0xee
const CHUNK_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_CANDIDATES = 16_384

interface WindowsCredentialOptions {
  pid: number
  accountId: string
  dbStoragePath: string
  targets: string[]
  timeoutMs?: number
  signal?: AbortSignal
  logger?: (level: 'debug', message: string, meta?: unknown) => void
}

interface WindowsCredentialResult {
  bundle?: WechatDbCredentialBundle
  failure?: KeyAcquireFailure
  bytes: number
  candidates: number
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
}

type CredentialMatcher = ReturnType<typeof createWindowsCredentialMatcher>

interface MemoryScanContext {
  api: Kernel32Api
  handle: bigint
  matcher: CredentialMatcher
  result: WindowsCredentialResult
  deadline: number
  signal?: AbortSignal
}

function canContinue(context: MemoryScanContext): boolean {
  checkAbort(context.signal)
  return Date.now() < context.deadline
}

async function scanRegion(
  context: MemoryScanContext,
  base: bigint,
  size: bigint,
): Promise<KeyAcquireFailure | undefined> {
  let tail: Buffer = Buffer.alloc(0)
  try {
    for (let offset = 0n; offset < size && !context.matcher.complete; offset += BigInt(CHUNK_BYTES)) {
      if (!canContinue(context)) return 'timeout'
      const requested = Number(size - offset > BigInt(CHUNK_BYTES) ? BigInt(CHUNK_BYTES) : size - offset)
      const bytes = Buffer.alloc(requested)
      const read = Buffer.alloc(8)
      try {
        const ok = context.api.readProcessMemory(context.handle, base + offset, bytes, requested, read)
        if (!ok || read.readBigUInt64LE() !== BigInt(requested)) {
          tail.fill(0)
          tail = Buffer.alloc(0)
          continue
        }
        context.result.bytes += requested
        const searchable = Buffer.concat([tail, bytes])
        tail.fill(0)
        try {
          for (const candidate of extractWindowsCredentialRecords(searchable)) {
            // Each classification may run PBKDF; let cancellation arrive between candidates too.
            await setImmediate()
            if (!canContinue(context)) return 'timeout'
            context.result.candidates += 1
            if (context.result.candidates > MAX_CANDIDATES) return 'unexpected'
            context.matcher.offer(candidate)
          }
          tail = Buffer.from(searchable.subarray(Math.max(0, searchable.length - ASCII_RECORD_SIZE + 1)))
        } finally {
          searchable.fill(0)
        }
      } finally {
        bytes.fill(0)
        read.fill(0)
        // Empty and failed reads must also yield to the utility IPC loop.
        await setImmediate()
      }
    }
    return undefined
  } finally {
    tail.fill(0)
  }
}

async function scanProcess(context: MemoryScanContext): Promise<KeyAcquireFailure | undefined> {
  let address = 0n
  const info = Buffer.alloc(MEMORY_INFORMATION_BYTES)
  while (address < MAX_USER_ADDRESS && !context.matcher.complete) {
    if (!canContinue(context)) return 'timeout'
    info.fill(0)
    if (!Number(context.api.virtualQueryEx(context.handle, address, info, info.length))) break
    const base = info.readBigUInt64LE(0)
    const size = info.readBigUInt64LE(24)
    const protection = info.readUInt32LE(36)
    if (info.readUInt32LE(32) === MEM_COMMIT && !(protection & PAGE_GUARD) && protection & READABLE_PROTECTION_MASK) {
      const failure = await scanRegion(context, base, size)
      if (failure) return failure
    }
    const next = base + size
    if (next <= address) break
    address = next
    await setImmediate()
  }
  return canContinue(context) ? undefined : 'timeout'
}

/** Enumerate one read-only process candidate pool for all databases; never called during cached reads. */
export async function scanWindowsCredentials(
  options: WindowsCredentialOptions,
  injectedApi?: Kernel32Api,
): Promise<WindowsCredentialResult> {
  checkAbort(options.signal)
  const result: WindowsCredentialResult = { bytes: 0, candidates: 0 }
  if (!Number.isInteger(options.pid) || options.pid <= 0 || !options.targets.length)
    return { ...result, failure: 'not_found' }
  const api = injectedApi ?? loadKernel32()
  if (!api) return { ...result, failure: 'unsupported_version' }
  const matcher = createWindowsCredentialMatcher(options.dbStoragePath, options.targets, (code) =>
    options.logger?.('debug', '[key] database sample unavailable', { code }),
  )
  let handle = 0n
  try {
    handle = BigInt(api.openProcess(PROCESS_READ_ACCESS, 0, options.pid))
    if (!handle) return { ...result, failure: 'needs_authorization' }
    const failure = await scanProcess({
      api,
      handle,
      matcher,
      result,
      deadline: Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      signal: options.signal,
    })
    if (failure) return { ...result, failure }
    const bundle = matcher.bundle(options.accountId)
    return bundle ? { ...result, bundle } : { ...result, failure: 'not_found' }
  } finally {
    try {
      if (handle) api.closeHandle(handle)
    } finally {
      matcher.clear()
    }
  }
}
