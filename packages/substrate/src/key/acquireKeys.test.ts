import { createCipheriv } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyAcquireStep, WechatDbCredentialBundle } from '@aiwc/protocol'
import { WcdbSourceReader } from '../wcdb/wcdbSourceReader'
import { encryptedAccountFixture } from '../wcdb/testing/encryptedAccountFixture'
import { acquireKeys } from './acquireKeys'

const native = vi.hoisted(() => ({
  codec: vi.fn(),
  image: vi.fn(),
  windowsDatabase: vi.fn(),
  windowsImage: vi.fn(),
  pid: vi.fn(),
}))
vi.mock('./macosCodecScanner', () => ({ scanMacCodecCredentials: native.codec }))
vi.mock('./macosMemoryScanner', () => ({ scanMacImageAesKey: native.image }))
vi.mock('./windowsMemoryScanner', () => ({
  scanWindowsImageAesKey: native.windowsImage,
}))
vi.mock('./windowsCredentialScanner', () => ({ scanWindowsCredentials: native.windowsDatabase }))
vi.mock('../discovery/processDetect', () => ({ findWeChatPidSync: native.pid }))

const ACCOUNT_ID = 'fictional-account'
const IMAGE_KEY = 'fixture-imagekey'
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-acquire-'))
  vi.resetAllMocks()
  vi.stubGlobal('process', Object.defineProperty(Object.create(process), 'platform', { value: 'darwin' }))
  vi.stubEnv('AIWC_WCDB_ENGINE', 'sqlcipher')
  native.pid.mockReturnValue(42)
  native.image.mockResolvedValue({ failure: 'not_found' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

const terminal = (steps: readonly KeyAcquireStep[]) => steps.every((s) => s.status === 'done' || s.status === 'failed')
const options = () => ({
  dbRoot: root,
  wxid: ACCOUNT_ID,
  strategy: 'memory_scan' as const,
  nativeDir: join(root, 'native'),
  onStep: vi.fn(),
})

function imageFixture(): void {
  const directory = join(root, ACCOUNT_ID, 'msg', 'attach')
  mkdirSync(directory, { recursive: true })
  const plain = Buffer.alloc(16)
  plain.set([0xff, 0xd8, 0xff])
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(IMAGE_KEY, 'ascii'), null)
  cipher.setAutoPadding(false)
  const image = Buffer.alloc(33)
  image.set([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])
  image.set(Buffer.concat([cipher.update(plain), cipher.final()]), 15)
  image[31] = 0x5a ^ 0xff
  image[32] = 0x5a ^ 0xd9
  writeFileSync(join(directory, 'fictional_t.dat'), image)
}

async function expectSavedDatabaseReadable(bundle: WechatDbCredentialBundle | undefined): Promise<void> {
  const reader = new WcdbSourceReader({ nativeDir: '' })
  try {
    await reader.open({
      dbRoot: root,
      wxid: ACCOUNT_ID,
      dbKeyHex: '',
      dbCredentials: bundle,
      cacheDir: join(root, 'cache'),
    })
    expect((await reader.messagesAfter('friend', 0, 20)).map((message) => message.seq)).toEqual([1, 2])
  } finally {
    await reader.close()
  }
}

describe('acquireKeys', () => {
  it('closes all four steps when the account directory is missing', async () => {
    const pushed: KeyAcquireStep[] = []
    const result = await acquireKeys({
      ...options(),
      dbRoot: join(root, 'nowhere'),
      onStep: (step) => pushed.push(step),
    })
    expect(result.steps.map((s) => s.id)).toEqual(['db_key', 'image_xor', 'image_aes', 'verify'])
    expect(terminal(result.steps)).toBe(true)
    expect(result.steps.slice(1).every((s) => s.failure === 'skipped')).toBe(true)
    expect(terminal([...new Map(pushed.map((s) => [s.id, s])).values()])).toBe(true)
  })

  it('ends a cancelled run with every open step marked cancelled', async () => {
    mkdirSync(join(root, ACCOUNT_ID, 'db_storage'), { recursive: true })
    const controller = new AbortController()
    const result = await acquireKeys({
      ...options(),
      signal: controller.signal,
      onStep: (step) => {
        if (step.id === 'db_key' && step.status !== 'doing') controller.abort()
      },
    })
    expect(result.cancelled).toBe(true)
    expect(terminal(result.steps)).toBe(true)
    expect(result.steps.filter((s) => s.id !== 'db_key').every((s) => s.failure === 'cancelled')).toBe(true)
    expect(result.dbKeyHex).toBeUndefined()
  })

  it.each(['needs_authorization', 'timeout', 'unsupported_version'] as const)(
    'retains the committed database and XOR when image AES fails with %s',
    async (failure) => {
      const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
      imageFixture()
      native.codec.mockResolvedValue({ bundle: fixture.bundle })
      native.image.mockResolvedValue({ failure })
      let saved: WechatDbCredentialBundle | undefined
      const result = await acquireKeys({
        ...options(),
        onDatabaseReady: async (database) => {
          saved = database.dbCredentials
        },
      })
      expect(result.steps.find((step) => step.id === 'image_aes')).toMatchObject({ status: 'failed', failure })
      expect(result.imageXorHex).toBe('5a')
      expect(result.dbCredentials).toBe(saved)
      await expectSavedDatabaseReadable(saved)
    },
  )

  it('keeps a database readable when the user cancels after the commit', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    imageFixture()
    native.codec.mockResolvedValue({ bundle: fixture.bundle })
    const controller = new AbortController()
    const saved = vi.fn(async () => {
      controller.abort()
    })
    const result = await acquireKeys({ ...options(), signal: controller.signal, onDatabaseReady: saved })
    expect(saved).toHaveBeenCalledOnce()
    expect(result.cancelled).toBe(true)
    expect(result.steps.find((step) => step.id === 'db_key')?.status).toBe('done')
    expect(result.steps.find((step) => step.id === 'verify')?.status).toBe('done')
    expect(native.image).not.toHaveBeenCalled()
    await expectSavedDatabaseReadable(result.dbCredentials)
  })

  it('does not begin optional image work before database persistence completes', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    imageFixture()
    native.codec.mockResolvedValue({ bundle: fixture.bundle })
    let commit: (() => void) | undefined
    let started: (() => void) | undefined
    const commitStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const committed = new Promise<void>((resolve) => {
      commit = resolve
    })
    const pending = acquireKeys({
      ...options(),
      onDatabaseReady: async () => {
        started?.()
        await committed
      },
    })
    await commitStarted
    expect(native.image).not.toHaveBeenCalled()
    commit?.()
    await pending
    expect(native.image).toHaveBeenCalledOnce()
  })

  it('does not report database success or scan images when database persistence fails', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    imageFixture()
    native.codec.mockResolvedValue({ bundle: fixture.bundle })
    const result = await acquireKeys({
      ...options(),
      onDatabaseReady: async () => {
        throw new Error(fixture.bundle.entries[0]?.keyHex)
      },
    })
    expect(result.dbCredentials).toBeUndefined()
    expect(result.dbKeyHex).toBeUndefined()
    expect(native.image).not.toHaveBeenCalled()
    expect(terminal(result.steps)).toBe(true)
    expect(result.steps.every((step) => step.detail === undefined)).toBe(true)
  })

  it('commits the full existing file inventory even when only some credentials matched', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    native.codec.mockResolvedValue({ bundle: { ...fixture.bundle, entries: fixture.bundle.entries.slice(0, 1) } })
    const saved = vi.fn()
    const result = await acquireKeys({ ...options(), scope: 'database', onDatabaseReady: saved })
    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.calls[0]?.[0].currentPaths.sort()).toEqual(
      fixture.bundle.entries.map((entry) => entry.relativePath).sort(),
    )
    expect(result).not.toHaveProperty('currentPaths')
    expect(native.image).not.toHaveBeenCalled()
  })

  it('acquires image-only material without a database scan or commit', async () => {
    mkdirSync(join(root, ACCOUNT_ID, 'db_storage'), { recursive: true })
    imageFixture()
    native.image.mockResolvedValue({ key: IMAGE_KEY })
    const saveDatabase = vi.fn()
    const result = await acquireKeys({ ...options(), scope: 'image', onDatabaseReady: saveDatabase })
    expect(result.steps.map((step) => step.id)).toEqual(['image_xor', 'image_aes'])
    expect(result.steps.every((step) => step.status === 'done')).toBe(true)
    expect(result.imageXorHex).toBe('5a')
    expect(result.imageAesHex).toBe(Buffer.from(IMAGE_KEY, 'ascii').toString('hex'))
    expect(native.codec).not.toHaveBeenCalled()
    expect(native.windowsDatabase).not.toHaveBeenCalled()
    expect(saveDatabase).not.toHaveBeenCalled()
  })

  it.each(['needs_authorization', 'timeout', 'unsupported_version'] as const)(
    'preserves database %s and ends the connection without scanning images',
    async (failure) => {
      encryptedAccountFixture(root, ACCOUNT_ID)
      imageFixture()
      native.codec.mockResolvedValue({ failure })
      const saveDatabase = vi.fn()
      const result = await acquireKeys({ ...options(), onDatabaseReady: saveDatabase })
      expect(result.steps.find((step) => step.id === 'db_key')).toMatchObject({ status: 'failed', failure })
      expect(result.steps.filter((step) => step.id !== 'db_key').every((step) => step.failure === 'skipped')).toBe(true)
      expect(native.image).not.toHaveBeenCalled()
      expect(saveDatabase).not.toHaveBeenCalled()
      expect(terminal(result.steps)).toBe(true)
    },
  )
})

describe('Windows bundle connection', () => {
  beforeEach(() => {
    vi.stubGlobal('process', Object.defineProperty(Object.create(process), 'platform', { value: 'win32' }))
  })

  it('scans the actual inventory once and privately commits the per-file bundle', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    native.windowsDatabase.mockResolvedValue({ bundle: fixture.bundle })
    const saved = vi.fn()
    const result = await acquireKeys({ ...options(), scope: 'database', onDatabaseReady: saved })
    expect(native.windowsDatabase).toHaveBeenCalledOnce()
    expect(native.windowsDatabase.mock.calls[0]?.[0].targets.sort()).toEqual(
      fixture.files.map((file) => file.path).sort(),
    )
    expect(saved).toHaveBeenCalledWith({
      dbKeyHex: fixture.bundle.entries[0]?.keyHex,
      dbCredentials: fixture.bundle,
      currentPaths: fixture.bundle.entries.map((entry) => entry.relativePath),
    })
    expect(result.dbCredentials).toEqual(fixture.bundle)
    expect(native.codec).not.toHaveBeenCalled()
    expect(native.windowsImage).not.toHaveBeenCalled()
  })

  it('commits partial session coverage and the complete inventory for supplement merging', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    const partial = { ...fixture.bundle, entries: fixture.bundle.entries.slice(0, 1) }
    native.windowsDatabase.mockResolvedValue({ bundle: partial })
    const saved = vi.fn()
    const result = await acquireKeys({ ...options(), scope: 'database', onDatabaseReady: saved })
    expect(result.dbCredentials).toEqual(partial)
    expect(saved.mock.calls[0]?.[0].currentPaths).toHaveLength(fixture.files.length)
  })

  it.each(['needs_authorization', 'timeout', 'not_found'] as const)('does not commit after %s', async (failure) => {
    encryptedAccountFixture(root, ACCOUNT_ID)
    native.windowsDatabase.mockResolvedValue({ failure })
    const saved = vi.fn()
    const result = await acquireKeys({ ...options(), scope: 'database', onDatabaseReady: saved })
    expect(result.steps.find((step) => step.id === 'db_key')?.failure).toBe(failure)
    expect(saved).not.toHaveBeenCalled()
  })

  it('does not commit a late result after cancellation', async () => {
    const fixture = encryptedAccountFixture(root, ACCOUNT_ID)
    const controller = new AbortController()
    native.windowsDatabase.mockImplementation(() => {
      controller.abort()
      return { bundle: fixture.bundle }
    })
    const saved = vi.fn()
    const result = await acquireKeys({
      ...options(),
      scope: 'database',
      signal: controller.signal,
      onDatabaseReady: saved,
    })
    expect(result.cancelled).toBe(true)
    expect(saved).not.toHaveBeenCalled()
  })
})
