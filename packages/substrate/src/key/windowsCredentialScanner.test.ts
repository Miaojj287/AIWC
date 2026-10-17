import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptedAccountFixture, encryptedFixturePages } from '../wcdb/testing/encryptedAccountFixture'
import type { Kernel32Api } from './windowsProcessMemory'
import { scanWindowsCredentials } from './windowsCredentialScanner'
import * as matchers from './windowsCredentialMatcher'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-windows-bundle-'))
  directories.push(root)
  return encryptedAccountFixture(root, 'fictional-account')
}

function memoryApi(memory: Buffer): Kernel32Api {
  return {
    openProcess: vi.fn(() => 1n),
    closeHandle: vi.fn(() => 1),
    virtualQueryEx: vi.fn((_handle: bigint, address: bigint, info: Buffer) => {
      if (address > 0x10000n) return 0
      info.writeBigUInt64LE(0x10000n, 0)
      info.writeBigUInt64LE(BigInt(memory.length), 24)
      info.writeUInt32LE(0x1000, 32)
      info.writeUInt32LE(4, 36)
      return 48
    }),
    readProcessMemory: vi.fn((_handle: bigint, address: bigint, target: Buffer, size: number, read: Buffer) => {
      const start = Number(address - 0x10000n)
      const copied = memory.copy(target, 0, start, start + size)
      read.writeBigUInt64LE(BigInt(copied))
      return 1
    }),
  }
}

describe('Windows credential acquisition', () => {
  it('authenticates logical database pages without treating Windows preallocated capacity as used pages', async () => {
    const account = fixture()
    const sources = account.files.map((file) => {
      const bytes = Buffer.concat([readFileSync(file.path), Buffer.alloc(8 * 4096)])
      writeFileSync(file.path, bytes)
      return bytes
    })
    const memory = Buffer.from(account.bundle.entries.map((entry) => `x'${entry.keyHex}${entry.saltHex}'`).join('\0'))
    const api = memoryApi(memory)
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: account.files.map((file) => file.path),
      },
      api,
    )
    expect(result.bundle).toEqual(account.bundle)
    expect(api.openProcess).toHaveBeenCalledOnce()
    for (const [index, file] of account.files.entries()) expect(readFileSync(file.path)).toEqual(sources[index])
  })

  it('still locks a damaged logical last page when the physical file also has an unused zero tail', async () => {
    const account = fixture()
    const file = account.files[0]!
    const bytes = readFileSync(file.path)
    const offset = bytes.length - 4096 + 100
    bytes[offset] = (bytes[offset] ?? 0) ^ 1
    writeFileSync(file.path, Buffer.concat([bytes, Buffer.alloc(8 * 4096)]))
    const entry = account.bundle.entries[0]!
    const result = await scanWindowsCredentials(
      { pid: 42, accountId: account.bundle.accountId, dbStoragePath: account.dbStoragePath, targets: [file.path] },
      memoryApi(Buffer.from(`x'${entry.keyHex}${entry.saltHex}'`)),
    )
    expect(result.bundle).toBeUndefined()
    expect(result.failure).toBe('not_found')
  })

  it('does not trust an obsolete header count to skip unauthenticated physical pages', async () => {
    const account = fixture()
    const file = account.files[0]!
    const pages = file.pages.map((page) => Buffer.from(page))
    const header = pages[0]!
    header.writeUInt32BE(1, 28)
    header.writeUInt32BE((header.readUInt32BE(24) + 1) >>> 0, 92)
    writeFileSync(file.path, Buffer.concat([encryptedFixturePages({ ...file, pages }), Buffer.alloc(8 * 4096)]))
    const entry = account.bundle.entries[0]!
    const result = await scanWindowsCredentials(
      { pid: 42, accountId: account.bundle.accountId, dbStoragePath: account.dbStoragePath, targets: [file.path] },
      memoryApi(Buffer.from(`x'${entry.keyHex}${entry.saltHex}'`)),
    )
    expect(result.bundle).toBeUndefined()
    expect(result.failure).toBe('not_found')
  })

  it('processes cancellation between candidates in the same memory chunk', async () => {
    const account = fixture()
    const controller = new AbortController()
    const entry = account.bundle.entries[0]!
    const memory = Buffer.from(`x'${'0'.repeat(64)}${entry.saltHex}'\0x'${'1'.repeat(64)}${entry.saltHex}'`)
    const create = matchers.createWindowsCredentialMatcher
    let offered = 0
    vi.spyOn(matchers, 'createWindowsCredentialMatcher').mockImplementation((...args) => {
      const matcher = create(...args)
      return {
        ...matcher,
        offer(candidate) {
          offered += 1
          if (offered > 1) throw new Error('Candidate processing did not yield')
          matcher.offer(candidate)
          setImmediate(() => controller.abort())
        },
      }
    })
    await expect(
      scanWindowsCredentials(
        {
          pid: 42,
          accountId: account.bundle.accountId,
          dbStoragePath: account.dbStoragePath,
          targets: account.files.map((file) => file.path),
          signal: controller.signal,
        },
        memoryApi(memory),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(offered).toBe(1)
  })

  it('keeps matching other databases when one inventory file disappears', async () => {
    const account = fixture()
    const missing = account.files[3]!
    rmSync(missing.path)
    const memory = Buffer.from(account.bundle.entries.map((entry) => `x'${entry.keyHex}${entry.saltHex}'`).join('\0'))
    const logger = vi.fn()
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: account.files.map((file) => file.path),
        logger,
      },
      memoryApi(memory),
    )
    expect(result.bundle?.entries).toEqual(account.bundle.entries.slice(0, 3))
    expect(logger).toHaveBeenCalledWith('debug', '[key] database sample unavailable', { code: 'ENOENT' })
  })

  it('scrubs the read buffer when the native read throws', async () => {
    const account = fixture()
    const api = memoryApi(Buffer.alloc(200))
    let captured: Buffer | undefined
    vi.mocked(api.readProcessMemory).mockImplementation((_handle, _address, buffer: Buffer) => {
      captured = buffer
      buffer.fill(0xa5)
      throw new Error('Read failed')
    })
    await expect(
      scanWindowsCredentials(
        {
          pid: 42,
          accountId: account.bundle.accountId,
          dbStoragePath: account.dbStoragePath,
          targets: account.files.map((file) => file.path),
        },
        api,
      ),
    ).rejects.toThrow('Read failed')
    expect(captured?.every((byte) => byte === 0)).toBe(true)
    expect(api.closeHandle).toHaveBeenCalledOnce()
  })

  it.each(['open', 'close'] as const)('clears matcher material even if native %s throws', async (operation) => {
    const account = fixture()
    const api = memoryApi(Buffer.alloc(200))
    vi.mocked(operation === 'open' ? api.openProcess : api.closeHandle).mockImplementation(() => {
      throw new Error('Native boundary failure')
    })
    const create = matchers.createWindowsCredentialMatcher
    const clear = vi.fn()
    vi.spyOn(matchers, 'createWindowsCredentialMatcher').mockImplementation((...args) => {
      const matcher = create(...args)
      clear.mockImplementation(() => matcher.clear())
      return { ...matcher, clear }
    })
    await expect(
      scanWindowsCredentials(
        {
          pid: 42,
          accountId: account.bundle.accountId,
          dbStoragePath: account.dbStoragePath,
          targets: account.files.map((file) => file.path),
        },
        api,
      ),
    ).rejects.toThrow('Native boundary failure')
    expect(clear).toHaveBeenCalledOnce()
  })
  it('keeps keyspec records crossing memory chunk boundaries', async () => {
    const account = fixture()
    const entry = account.bundle.entries[0]!
    const memory = Buffer.alloc(2 * 1024 * 1024 + 200)
    Buffer.from(`x'${entry.keyHex}${entry.saltHex}'`).copy(memory, 2 * 1024 * 1024 - 50)
    const api = memoryApi(memory)
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: [account.files[0]!.path],
      },
      api,
    )
    expect(result.bundle?.entries).toEqual([entry])
    expect(api.readProcessMemory).toHaveBeenCalledTimes(2)
  })

  it('closes the read-only handle and discards partial material on mid-scan cancellation', async () => {
    const account = fixture()
    const controller = new AbortController()
    const api = memoryApi(Buffer.alloc(200))
    vi.mocked(api.readProcessMemory).mockImplementation(() => {
      controller.abort()
      return 0
    })
    await expect(
      scanWindowsCredentials(
        {
          pid: 42,
          accountId: account.bundle.accountId,
          dbStoragePath: account.dbStoragePath,
          targets: account.files.map((file) => file.path),
          signal: controller.signal,
        },
        api,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.closeHandle).toHaveBeenCalledOnce()
  })

  it('reports an exhausted deadline as failure and releases the handle', async () => {
    const account = fixture()
    const api = memoryApi(Buffer.alloc(200))
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: account.files.map((file) => file.path),
        timeoutMs: 0,
      },
      api,
    )
    expect(result.failure).toBe('timeout')
    expect(result.bundle).toBeUndefined()
    expect(api.closeHandle).toHaveBeenCalledOnce()
    expect(api.readProcessMemory).not.toHaveBeenCalled()
  })
  it('matches all independent database records with one process traversal and read-only access', async () => {
    const account = fixture()
    const memory = Buffer.from(account.bundle.entries.map((entry) => `x'${entry.keyHex}${entry.saltHex}'`).join('\0'))
    const api = memoryApi(memory)
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: account.files.map((file) => file.path),
      },
      api,
    )
    expect(result.bundle).toEqual(account.bundle)
    expect(api.openProcess).toHaveBeenCalledExactlyOnceWith(0x410, 0, 42)
    expect(api.closeHandle).toHaveBeenCalledExactlyOnceWith(1n)
    expect(api.readProcessMemory).toHaveBeenCalledTimes(1)
  })

  it('leaves a database locked when a later page fails authentication', async () => {
    const account = fixture()
    const target = account.files[0]!
    const bytes = readFileSync(target.path)
    bytes[4096 + 100] = (bytes[4096 + 100] ?? 0) ^ 1
    writeFileSync(target.path, bytes)
    const entry = account.bundle.entries[0]!
    const result = await scanWindowsCredentials(
      { pid: 42, accountId: account.bundle.accountId, dbStoragePath: account.dbStoragePath, targets: [target.path] },
      memoryApi(Buffer.from(`x'${entry.keyHex}${entry.saltHex}'`)),
    )
    expect(result.bundle).toBeUndefined()
    expect(result.failure).toBe('not_found')
  })

  it('reports access denial without acquiring another handle', async () => {
    const account = fixture()
    const api = memoryApi(Buffer.alloc(128))
    vi.mocked(api.openProcess).mockReturnValue(0n)
    const result = await scanWindowsCredentials(
      {
        pid: 42,
        accountId: account.bundle.accountId,
        dbStoragePath: account.dbStoragePath,
        targets: account.files.map((file) => file.path),
      },
      api,
    )
    expect(result.failure).toBe('needs_authorization')
    expect(api.readProcessMemory).not.toHaveBeenCalled()
    expect(api.closeHandle).not.toHaveBeenCalled()
  })

  it('does not open a process after cancellation', async () => {
    const account = fixture()
    const api = memoryApi(Buffer.alloc(128))
    await expect(
      scanWindowsCredentials(
        {
          pid: 42,
          accountId: account.bundle.accountId,
          dbStoragePath: account.dbStoragePath,
          targets: account.files.map((file) => file.path),
          signal: AbortSignal.abort(),
        },
        api,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(api.openProcess).not.toHaveBeenCalled()
  })
})
