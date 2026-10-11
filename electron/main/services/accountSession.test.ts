import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createPaths, ensureDirs } from '../paths'
import { createConfigService } from '../config/configService'
import { createSecretStore, SECRET_REFS } from '../config/secretStore'
import { openAccountProfile } from './accountProfiles'
import { createAccountSession } from './accountSession'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-session-'))
  roots.push(root)
  const base = createPaths({
    userData: root,
    appPath: root,
    resourcesPath: root,
    isPackaged: false,
    platform: 'darwin',
    arch: 'arm64',
  })
  ensureDirs(base)
  createConfigService({ file: base.configFile }).set({ account: { wxid: 'a', dbRoot: '/wechat' } })
  const profile = openAccountProfile(base)
  const config = createConfigService({ file: profile.paths.configFile })
  const secrets = createSecretStore({ file: profile.paths.secretsFile, safeStorage })
  const order: string[] = []
  const context = {
    config,
    secrets,
    tasks: { stop: () => order.push('tasks') },
    todo: { dispose: () => order.push('todo') },
    mobile: { dispose: () => order.push('mobile') },
  }
  const restart = vi.fn(() => order.push('restart'))
  const session = createAccountSession({ base, profile, context, safeStorage, restart })
  return { session, config, secrets, base, order, restart }
}
it('stages B keys without replacing A keys or selecting B', () => {
  const s = setup()
  s.secrets.set(SECRET_REFS.dbKey, 'a-key')
  const b = s.session.credentials({ wxid: 'b', dbRoot: '/wechat' })
  expect(b.secrets.has(SECRET_REFS.dbKey)).toBe(false)
  b.secrets.set(SECRET_REFS.dbKey, 'b-key')
  expect(s.secrets.reveal(SECRET_REFS.dbKey)).toBe('a-key')
  expect(openAccountProfile(s.base).wxid).toBe('a')
  expect(s.config.get().account.wxid).toBe('a')
})
it('stops old background work before restart and rejects repeated switches', () => {
  const s = setup()
  s.session.switch({ wxid: 'b', dbRoot: '/wechat' })
  expect(s.order).toEqual(['tasks', 'todo', 'mobile', 'restart'])
  expect(s.session.isSwitching()).toBe(true)
  expect(openAccountProfile(s.base).wxid).toBe('b')
  expect(() => s.session.switch({ wxid: 'a', dbRoot: '/wechat' })).toThrow()
  expect(s.restart).toHaveBeenCalledOnce()
})
