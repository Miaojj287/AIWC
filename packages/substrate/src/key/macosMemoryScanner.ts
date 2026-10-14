/** Read-only macOS image probing; database connection uses the version-bound codec helper. */
import { execFile } from 'node:child_process'
import { WechatImageScanResultSchema } from '@aiwc/protocol'
import type { KeyAcquireFailure } from '@aiwc/protocol'
import { resolveOptionalNative } from '../wcdb/nativeLib'

const MAX_OUTPUT_BYTES = 16 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const IMAGE_BLOCK_BYTES = 16

interface ImageScanResult {
  key?: string
  failure?: KeyAcquireFailure
}

function decodeImageResult(stdout: string): ImageScanResult {
  try {
    const result = WechatImageScanResultSchema.safeParse(JSON.parse(stdout))
    if (!result.success) return { failure: 'unexpected' }
    if (result.data.success) return { key: Buffer.from(result.data.aesKeyHex, 'hex').toString('ascii') }
    return { failure: result.data.attached === false && result.data.attachCode ? 'needs_authorization' : 'not_found' }
  } catch {
    // Malformed helper output is rejected without including private output in diagnostics.
    return { failure: 'unexpected' }
  }
}

/** Read only image AES material, reporting native outcomes through stable codes. */
export async function scanMacImageAesKey(
  pid: number,
  ciphertext: Buffer,
  nativeDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<ImageScanResult> {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const helper = resolveOptionalNative(nativeDir, 'wechat_memory_scan_helper', 'AIWC_WX_MEMORY_HELPER_PATH')
  if (!helper) return { failure: 'unsupported_version' }
  if (ciphertext.length < IMAGE_BLOCK_BYTES || pid <= 0) return { failure: 'not_found' }
  return new Promise<ImageScanResult>((resolve, reject) => {
    execFile(
      helper,
      ['--image', String(pid), ciphertext.subarray(0, IMAGE_BLOCK_BYTES).toString('hex')],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        signal,
      },
      (error, stdout) => {
        if (signal?.aborted || error?.code === 'ABORT_ERR') {
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
        const result = decodeImageResult(stdout)
        // Some helper failures also use nonzero exit codes; their valid status still describes the cause.
        resolve(error && result.key ? { failure: 'unexpected' } : result)
      },
    )
  })
}
