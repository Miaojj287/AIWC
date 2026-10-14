import type { ExecFileException } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptedAccountFixture } from '../wcdb/testing/encryptedAccountFixture'
import { decodeCodecResult, scanMacCodecCredentials } from './macosCodecScanner'

const native = vi.hoisted(() => ({ execute: vi.fn(), helper: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: native.execute }))
vi.mock('../wcdb/nativeLib', () => ({ resolveOptionalNative: native.helper }))

type Callback = (error: ExecFileException | null, stdout: string, stderr: string) => void
interface RunOptions {
  timeout: number
  maxBuffer: number
  signal?: AbortSignal
}
let root = ''
beforeEach(() => {
  vi.resetAllMocks()
  root = mkdtempSync(join(tmpdir(), 'aiwc-codec-scan-'))
  native.helper.mockReturnValue('/fictional/native/codec-helper')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function output(payload: unknown, error: ExecFileException | null = null): void {
  native.execute.mockImplementation((_file: string, _args: string[], _options: RunOptions, callback: Callback) => {
    callback(error, JSON.stringify(payload), '')
  })
}
const options = (signal?: AbortSignal) => ({
  pid: 42,
  nativeDir: '/fictional/native',
  accountId: 'fictional-account',
  dbStoragePath: root,
  targets: [join(root, 'session.db')],
  timeoutMs: 250,
  signal,
})

describe('private codec helper boundary', () => {
  it('accepts only the requested index and authenticated material shape', () => {
    const entry = { index: 0, saltHex: 'a'.repeat(32), keyHex: 'b'.repeat(64), form: 'direct' }
    expect(decodeCodecResult(JSON.stringify({ version: 1, status: 'ok', entries: [entry] }), 1).entries).toHaveLength(1)
    expect(() =>
      decodeCodecResult(JSON.stringify({ version: 1, status: 'ok', entries: [{ ...entry, index: 1 }] }), 1),
    ).toThrow('INVALID_CODEC_RESULT')
  })
  it('rejects duplicates and malformed material without echoing its value', () => {
    const entry = { index: 0, saltHex: 'a'.repeat(32), keyHex: 'private-invalid-value', form: 'direct' }
    expect(() => decodeCodecResult(JSON.stringify({ version: 1, status: 'ok', entries: [entry, entry] }), 1)).toThrow(
      'INVALID_CODEC_RESULT',
    )
    expect(() => decodeCodecResult('not-json-secret', 1)).toThrow('INVALID_CODEC_RESULT')
  })

  it.each(['needs_authorization', 'unsupported_version', 'timeout', 'not_found'] as const)(
    'preserves native %s independently of the exit code',
    async (status) => {
      output({ version: 1, status, entries: [] }, Object.assign(new Error('FICTIONAL_HELPER_FAILURE'), { code: 1 }))
      expect(await scanMacCodecCredentials(options())).toEqual({ failure: status })
    },
  )
  it('maps an exited WeChat process without treating it as timeout', async () => {
    output({ version: 1, status: 'process_exited', entries: [] })
    expect(await scanMacCodecCredentials(options())).toEqual({ failure: 'wechat_exited' })
  })
  it('classifies the child deadline without reading an error message', async () => {
    output({}, Object.assign(new Error('arbitrary text'), { killed: true }))
    expect(await scanMacCodecCredentials(options())).toEqual({ failure: 'timeout' })
  })
  it('classifies malformed and oversized output as unexpected', async () => {
    output({ version: 1, status: 'invalid', entries: [] })
    expect(await scanMacCodecCredentials(options())).toEqual({ failure: 'unexpected' })
    output(
      {},
      Object.assign(new Error('FICTIONAL_TOO_LARGE'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }),
    )
    expect(await scanMacCodecCredentials(options())).toEqual({ failure: 'unexpected' })
  })
  it('does not launch a helper when its native build is unavailable', async () => {
    native.helper.mockReturnValue(null)
    expect(await scanMacCodecCredentials(options())).toEqual({ failure: 'unsupported_version' })
    expect(native.execute).not.toHaveBeenCalled()
  })
  it('authenticates independent database pages before accepting private credentials', async () => {
    const fixture = encryptedAccountFixture(root, 'fictional-account')
    output({
      version: 1,
      status: 'ok',
      entries: fixture.bundle.entries.map((entry, index) => ({
        index,
        saltHex: entry.saltHex,
        keyHex: entry.keyHex,
        form: entry.form,
      })),
    })
    const request = {
      ...options(),
      dbStoragePath: fixture.dbStoragePath,
      targets: fixture.files.map((file) => file.path),
    }
    expect(await scanMacCodecCredentials(request)).toEqual({ bundle: fixture.bundle })
    expect(native.execute).toHaveBeenCalledWith(
      '/fictional/native/codec-helper',
      expect.any(Array),
      expect.objectContaining({ timeout: 250, maxBuffer: 64 * 1024 }),
      expect.any(Function),
    )
    output({
      version: 1,
      status: 'ok',
      entries: [{ index: 0, saltHex: 'a'.repeat(32), keyHex: 'b'.repeat(64), form: 'direct' }],
    })
    expect(await scanMacCodecCredentials(request)).toEqual({ failure: 'not_found' })
  })
  it('does not launch a helper after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(scanMacCodecCredentials(options(controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.execute).not.toHaveBeenCalled()
  })
  it('cancels a running helper through the supplied signal', async () => {
    const controller = new AbortController()
    native.execute.mockImplementation((_file: string, _args: string[], request: RunOptions, callback: Callback) => {
      expect(request.signal).toBe(controller.signal)
      controller.abort()
      callback(Object.assign(new Error('FICTIONAL_ABORT'), { code: 'ABORT_ERR' }), '', '')
    })
    await expect(scanMacCodecCredentials(options(controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
  })
})
