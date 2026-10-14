import type { ExecFileException } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanMacImageAesKey } from './macosMemoryScanner'

const native = vi.hoisted(() => ({ execute: vi.fn(), helper: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: native.execute }))
vi.mock('../wcdb/nativeLib', () => ({ resolveOptionalNative: native.helper }))

type Callback = (error: ExecFileException | null, stdout: string, stderr: string) => void
interface RunOptions {
  timeout: number
  maxBuffer: number
  signal?: AbortSignal
}
const IMAGE_KEY = 'fixture-imagekey'
const ciphertext = Buffer.alloc(16, 0x11)

beforeEach(() => {
  vi.resetAllMocks()
  native.helper.mockReturnValue('/fictional/native/image-helper')
})
afterEach(() => vi.restoreAllMocks())

function output(payload: unknown, error: ExecFileException | null = null): void {
  native.execute.mockImplementation((_file: string, _args: string[], _options: RunOptions, callback: Callback) => {
    callback(error, JSON.stringify(payload), '')
  })
}
const scan = (signal?: AbortSignal) => scanMacImageAesKey(42, ciphertext, '/fictional/native', 250, signal)

describe('read-only image helper boundary', () => {
  it('validates a private success payload and bounds the helper call', async () => {
    output({ success: true, attached: true, aesKeyHex: Buffer.from(IMAGE_KEY, 'ascii').toString('hex') })
    expect(await scan()).toEqual({ key: IMAGE_KEY })
    expect(native.execute).toHaveBeenCalledWith(
      '/fictional/native/image-helper',
      ['--image', '42', ciphertext.toString('hex')],
      expect.objectContaining({ timeout: 250, maxBuffer: 16 * 1024, encoding: 'utf8' }),
      expect.any(Function),
    )
  })
  it.each([null, Object.assign(new Error('FICTIONAL_DENIED'), { code: 1 })])(
    'preserves denied status even with a nonzero exit code %#',
    async (error) => {
      output({ success: false, attached: false, attachCode: 5 }, error)
      expect(await scan()).toEqual({ failure: 'needs_authorization' })
    },
  )
  it('reports a deadline separately from denied access', async () => {
    output(
      { success: false, attached: false, attachCode: 5 },
      Object.assign(new Error('FICTIONAL_TIMEOUT'), { killed: true }),
    )
    expect(await scan()).toEqual({ failure: 'timeout' })
  })
  it('reports missing native support without starting a process', async () => {
    native.helper.mockReturnValue(null)
    expect(await scan()).toEqual({ failure: 'unsupported_version' })
    expect(native.execute).not.toHaveBeenCalled()
  })
  it('reports an exhausted scan without treating it as denied', async () => {
    output({ success: false, attached: true })
    expect(await scan()).toEqual({ failure: 'not_found' })
  })
  it.each([{}, { success: true, attached: true, aesKeyHex: 'private-invalid-value' }])(
    'rejects malformed payloads without echoing them %#',
    async (payload) => {
      output(payload)
      expect(await scan()).toEqual({ failure: 'unexpected' })
    },
  )
  it('rejects malformed JSON and oversized output', async () => {
    native.execute.mockImplementation((_file: string, _args: string[], _options: RunOptions, callback: Callback) => {
      callback(null, 'private-invalid-json', '')
    })
    expect(await scan()).toEqual({ failure: 'unexpected' })
    output(
      { success: true, attached: true, aesKeyHex: 'a'.repeat(32) },
      Object.assign(new Error('FICTIONAL_TOO_LARGE'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }),
    )
    expect(await scan()).toEqual({ failure: 'unexpected' })
  })
  it('never accepts successful material from a failed process', async () => {
    output(
      { success: true, attached: true, aesKeyHex: 'a'.repeat(32) },
      Object.assign(new Error('FICTIONAL_FAILED'), { code: 1 }),
    )
    expect(await scan()).toEqual({ failure: 'unexpected' })
  })
  it('does not launch when cancellation has already happened', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(scan(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.execute).not.toHaveBeenCalled()
  })
  it('propagates cancellation while the helper is running', async () => {
    const controller = new AbortController()
    native.execute.mockImplementation((_file: string, _args: string[], options: RunOptions, callback: Callback) => {
      expect(options.signal).toBe(controller.signal)
      controller.abort()
      callback(Object.assign(new Error('FICTIONAL_ABORT'), { code: 'ABORT_ERR' }), '', '')
    })
    await expect(scan(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
