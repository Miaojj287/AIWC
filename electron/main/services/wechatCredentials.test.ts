import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WechatDbCredentialBundle } from '@aiwc/protocol'
import { createConfigService } from '../config/configService'
import { createSecretStore, SECRET_REFS } from '../config/secretStore'
import { readWechatCredentials, saveWechatDatabase } from './wechatCredentials'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-credentials-'))
  roots.push(root)
  const config = createConfigService({ file: join(root, 'config.json') })
  const secrets = createSecretStore({
    file: join(root, 'secrets.bin'),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(Array.from(Buffer.from(value), (byte) => byte ^ 0xa5)),
      decryptString: (value) => Buffer.from(Array.from(Buffer.from(value), (byte) => byte ^ 0xa5)).toString(),
    },
  })
  return { root, config, secrets }
}
const entry = (path: string): WechatDbCredentialBundle['entries'][number] => ({
  relativePath: path,
  saltHex: 'a'.repeat(32),
  keyHex: 'b'.repeat(64),
  form: 'direct',
})
describe('account private database credentials', () => {
  it('stores only a safeStorage ref in config, restores offline, and denies another account', () => {
    const saved = setup()
    const target = { wxid: 'fictional-account', dbRoot: '/fictional' }
    const bundle: WechatDbCredentialBundle = {
      version: 1,
      accountId: target.wxid,
      entries: [entry('session/session.db')],
    }
    saveWechatDatabase(saved, target, { dbKeyHex: 'b'.repeat(64), dbCredentials: bundle })
    expect(readWechatCredentials(saved, target.wxid).dbCredentials).toEqual(bundle)
    expect(readWechatCredentials(saved, 'another-account')).toEqual({})
    expect(saved.config.get().account).toMatchObject({
      dbCredentialsRef: SECRET_REFS.dbCredentials,
      credentialRevision: 1,
    })
    expect(readFileSync(join(saved.root, 'config.json'), 'utf8')).not.toContain('b'.repeat(64))
    expect(readFileSync(join(saved.root, 'secrets.bin'), 'utf8')).not.toContain('b'.repeat(64))
  })
  it('merges later authenticated shards while retaining existing offline keys', () => {
    const saved = setup()
    const target = { wxid: 'fictional-account', dbRoot: '/fictional' }
    for (const path of ['session/session.db', 'message/message_0.db'])
      saveWechatDatabase(saved, target, {
        dbKeyHex: 'b'.repeat(64),
        dbCredentials: { version: 1, accountId: target.wxid, entries: [entry(path)] },
      })
    expect(readWechatCredentials(saved, target.wxid).dbCredentials?.entries).toHaveLength(2)
    expect(saved.config.get().account.credentialRevision).toBe(2)
  })
  it('drops removed shards before saving their replacement at the entry limit', () => {
    const saved = setup()
    const target = { wxid: 'fictional-account', dbRoot: '/fictional' }
    const paths = Array.from({ length: 128 }, (_, index) => `message/message_${index}.db`)
    saveWechatDatabase(saved, target, {
      dbKeyHex: 'b'.repeat(64),
      dbCredentials: { version: 1, accountId: target.wxid, entries: paths.map(entry) },
    })
    const currentPaths = [...paths.slice(1), 'message/message_128.db']
    saveWechatDatabase(saved, target, {
      dbKeyHex: 'b'.repeat(64),
      dbCredentials: { version: 1, accountId: target.wxid, entries: [entry('message/message_128.db')] },
      currentPaths,
    })
    expect(readWechatCredentials(saved, target.wxid).dbCredentials?.entries.map((value) => value.relativePath)).toEqual(
      currentPaths,
    )
  })
  it('leaves refs and revision unchanged when system encryption fails', () => {
    const saved = setup()
    const target = { wxid: 'fictional-account', dbRoot: '/fictional' }
    const credentials = {
      ...saved,
      secrets: {
        ...saved.secrets,
        set: () => {
          throw new Error('fictional storage failure')
        },
      },
    }
    expect(() =>
      saveWechatDatabase(credentials, target, {
        dbKeyHex: 'b'.repeat(64),
        dbCredentials: { version: 1, accountId: target.wxid, entries: [entry('session/session.db')] },
      }),
    ).toThrow()
    expect(saved.config.get().account).toEqual({})
  })
  it('does not treat corrupt or wrongly owned encrypted material as usable', () => {
    const saved = setup()
    saved.config.set({ account: { wxid: 'fictional-account', dbCredentialsRef: SECRET_REFS.dbCredentials } })
    saved.secrets.set(SECRET_REFS.dbCredentials, 'bad-json')
    expect(readWechatCredentials(saved, 'fictional-account')).toEqual({ dbKeyHex: undefined })
    expect(() =>
      saveWechatDatabase(
        saved,
        { wxid: 'fictional-account', dbRoot: '/fictional' },
        { dbKeyHex: 'b'.repeat(64), dbCredentials: { version: 1, accountId: 'another-account', entries: [] } },
      ),
    ).toThrow('WECHAT_CREDENTIAL_ACCOUNT_MISMATCH')
  })
})
