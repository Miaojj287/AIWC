import { execFile } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import { WechatCodecResultSchema } from '@aiwc/protocol'
import type { KeyAcquireFailure, WechatDbCredentialBundle } from '@aiwc/protocol'
import { resolveOptionalNative } from '../wcdb/nativeLib'
import { readFirstPage } from './sqlcipherPage'
import { resolvePageCipher } from '../wcdb/sqlcipherCodec'

const MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 48_000
const WECHAT_CORE_PATH = '/Applications/WeChat.app/Contents/Resources/wechat.dylib'

interface CodecScanOptions {
  pid: number
  nativeDir: string
  dbStoragePath: string
  accountId: string
  targets: string[]
  timeoutMs?: number
  signal?: AbortSignal
}
interface CodecScanResult {
  bundle?: WechatDbCredentialBundle
  failure?: KeyAcquireFailure
}

/** Validate a private payload without incorporating its secret values in error messages. */
export function decodeCodecResult(stdout: string, targetCount: number) {
  try {
    const parsed = WechatCodecResultSchema.parse(JSON.parse(stdout))
    if (parsed.entries.some((entry) => entry.index >= targetCount)) throw new Error('invalid index')
    if (parsed.status !== 'ok' && parsed.entries.length) throw new Error('invalid status')
    return parsed
  } catch {
    throw new Error('INVALID_CODEC_RESULT')
  }
}

function verifyCodecResult(stdout: string, options: CodecScanOptions): CodecScanResult {
  let result: ReturnType<typeof decodeCodecResult>
  try {
    result = decodeCodecResult(stdout, options.targets.length)
  } catch {
    // Reject malformed private output without echoing it in diagnostics.
    return { failure: 'unexpected' }
  }
  if (result.status !== 'ok') return { failure: result.status === 'process_exited' ? 'wechat_exited' : result.status }
  const entries: WechatDbCredentialBundle['entries'] = []
  for (const entry of result.entries) {
    const path = options.targets[entry.index]
    if (!path) continue
    const relativePath = relative(options.dbStoragePath, path).split('\\').join('/')
    if (isAbsolute(relativePath) || relativePath.split('/').some((part) => part === '..' || part === '.')) continue
    const page = readFirstPage(path)
    const cipher = page && resolvePageCipher(page, entry.keyHex)
    if (!cipher?.hmacKey || cipher.form !== 'direct' || cipher.saltHex !== entry.saltHex) continue
    entries.push({ relativePath, saltHex: entry.saltHex, keyHex: entry.keyHex, form: entry.form })
  }
  return entries.length ? { bundle: { version: 1, accountId: options.accountId, entries } } : { failure: 'not_found' }
}

/** Run only inside the substrate utility process after a user connection request. */
export async function scanMacCodecCredentials(options: CodecScanOptions): Promise<CodecScanResult> {
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const helper = resolveOptionalNative(options.nativeDir, 'wechat_codec_helper')
  if (!helper) return { failure: 'unsupported_version' }
  return new Promise<CodecScanResult>((resolve, reject) => {
    execFile(
      helper,
      [String(options.pid), WECHAT_CORE_PATH, ...options.targets],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (error, stdout) => {
        if (options.signal?.aborted || error?.code === 'ABORT_ERR') {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve({ failure: 'unexpected' })
          return
        }
        if (error?.killed) {
          resolve({ failure: 'timeout' })
          return
        }
        const result = verifyCodecResult(stdout, options)
        // A nonzero helper exit may still carry a validated denial or version status.
        resolve(error && result.bundle ? { failure: 'unexpected' } : result)
      },
    )
  })
}
