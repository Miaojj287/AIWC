import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createAutoReplyRecordStore } from '@aiwc/gateway'
import { platform, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createPaths, ensureDirs, defaultAllowedRoots, substrateCacheDir } from '../paths'
import { createConfigService } from '../config/configService'
import { composeFileAccess } from '../composeFileAccess'
import { nullLogger } from '../log'
import { resolveAllowedExisting } from '../security/pathAllowList'
import { openAccountProfile, prepareAccountProfile } from './accountProfiles'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-profiles-'))
  roots.push(root)
  const paths = createPaths({
    userData: root,
    appPath: root,
    resourcesPath: root,
    isPackaged: false,
    platform: 'darwin',
    arch: 'arm64',
  })
  ensureDirs(paths)
  const config = createConfigService({ file: paths.configFile })
  config.set({ account: { credentialRevision: 0, wxid: 'account-a', dbRoot: '/wechat' }, todo: { enabled: true } })
  writeFileSync(paths.composerDraftsFile, 'legacy private content')
  return paths
}
it('never adopts ambiguous legacy history or automation settings', () => {
  const base = setup()
  const profile = openAccountProfile(base)
  expect(profile.paths.dataRoot).not.toBe(base.dataRoot)
  expect(readFileSync(base.composerDraftsFile, 'utf8')).toBe('legacy private content')
  expect(createConfigService({ file: profile.paths.configFile }).get().todo.enabled).toBe(false)
  expect(defaultAllowedRoots(profile.paths)).not.toContain(base.dataRoot)
})
it('isolates every mutable store and restores the original profile on A → B → A', () => {
  const base = setup()
  const a = openAccountProfile(base)
  const config = createConfigService({ file: a.paths.configFile })
  writeFileSync(a.paths.composerDraftsFile, 'account a draft')
  a.select({ ...config.get(), account: { credentialRevision: 0, wxid: 'account-b', dbRoot: '/wechat' } })
  const b = openAccountProfile(base)
  for (const key of [
    'recordsDb',
    'tasksDir',
    'memoryDir',
    'rolloutsDir',
    'indexDb',
    'mirrorDb',
    'secretsFile',
    'mediaCacheDir',
    'usageDb',
    'workspaceDir',
    'mobileDir',
    'composerDraftsFile',
  ] as const) {
    expect(b.paths[key]).not.toBe(a.paths[key])
  }
  b.select({ ...config.get(), account: { credentialRevision: 0, wxid: 'account-a', dbRoot: '/wechat' } })
  expect(openAccountProfile(base).paths.dataRoot).toBe(a.paths.dataRoot)
  expect(readFileSync(a.paths.composerDraftsFile, 'utf8')).toBe('account a draft')
})
it('hashes untrusted account identifiers instead of using them as path segments', () => {
  const base = setup()
  const profile = openAccountProfile(base)
  const config = createConfigService({ file: profile.paths.configFile })
  profile.select({ ...config.get(), account: { credentialRevision: 0, wxid: '../../outside', dbRoot: '/wechat' } })
  const next = openAccountProfile(base)
  expect(dirname(next.paths.dataRoot)).toBe(join(base.dataRoot, 'accounts'))
  expect(next.paths.dataRoot).not.toContain('outside')
})

it('denies another profile even after a parent directory grant and resolves symlinks before reading', async () => {
  const base = setup()
  const a = openAccountProfile(base)
  const config = createConfigService({ file: a.paths.configFile })
  const access = composeFileAccess({ paths: a.paths, config: config.get, log: nullLogger })
  access.allowList.addRoot(base.dataRoot)
  const b = prepareAccountProfile(base, {
    ...config.get(),
    account: { credentialRevision: 0, wxid: 'account-b', dbRoot: '/wechat' },
  })
  writeFileSync(b.composerDraftsFile, 'private draft')
  expect(access.allowList.isAllowed(b.composerDraftsFile)).toBe(false)
  expect(access.allowList.isAllowed(base.composerDraftsFile)).toBe(false)
  const link = join(a.paths.workspaceDir, 'linked-draft')
  // A directory junction tests the same realpath escape without Windows file-symlink privileges.
  symlinkSync(b.dataRoot, link, platform() === 'win32' ? 'junction' : 'dir')
  const linkedDraft = join(link, relative(b.dataRoot, b.composerDraftsFile))
  await expect(resolveAllowedExisting(access.allowList, linkedDraft)).rejects.toThrow()
  expect(access.protectedPaths()).toContain(b.dataRoot)
})

it('keeps actual auto-reply rules and audit records scoped to the selected account', () => {
  const base = setup()
  const a = openAccountProfile(base)
  const config = createConfigService({ file: a.paths.configFile })
  const b = prepareAccountProfile(base, {
    ...config.get(),
    account: { credentialRevision: 0, wxid: 'account-b', dbRoot: '/wechat' },
  })
  const storeA = createAutoReplyRecordStore({ dbPath: a.paths.recordsDb })
  const storeB = createAutoReplyRecordStore({ dbPath: b.recordsDb })
  try {
    storeA.saveRule({
      id: 'rule-a',
      sessionId: 'shared-contact',
      enabled: true,
      source: 'ai',
      prompt: 'private rule',
      historyCount: 10,
      sendMode: 'confirm',
      updatedAt: 1,
    })
    storeA.addRecord({
      id: 'record-a',
      ruleId: 'rule-a',
      sessionId: 'shared-contact',
      triggerMessage: { id: 'message-a', text: 'private trigger', at: 1 },
      replyText: 'private reply',
      at: 1,
      status: 'sent',
    })
    expect(storeB.listRules()).toEqual([])
    expect(storeB.listRecords({})).toEqual([])
    expect(storeA.listRules()).toHaveLength(1)
    expect(storeA.listRecords({})).toHaveLength(1)
  } finally {
    storeA.close()
    storeB.close()
  }
})

it('isolates custom cache locations, including an explicit grant of their parent', () => {
  const base = setup()
  const a = openAccountProfile(base)
  const config = createConfigService({ file: a.paths.configFile })
  const sharedCache = join(base.dataRoot, '..', 'shared-cache')
  const b = prepareAccountProfile(base, {
    ...config.get(),
    account: { credentialRevision: 0, wxid: 'account-b', dbRoot: '/wechat', cacheDir: sharedCache },
  })
  const access = composeFileAccess({ paths: a.paths, config: config.get, log: nullLogger })
  access.allowList.addRoot(sharedCache)
  const own = substrateCacheDir(a.paths, sharedCache)
  const foreign = substrateCacheDir(b, sharedCache)
  expect(own).not.toBe(foreign)
  expect(access.allowList.isAllowed(join(own, 'media', 'photo.png'))).toBe(true)
  expect(access.allowList.isAllowed(join(foreign, 'media', 'photo.png'))).toBe(false)
  expect(access.protectedPaths()).toContain(foreign)
})

it('refuses to open a profile whose persisted identity no longer matches its directory', () => {
  const base = setup()
  const a = openAccountProfile(base)
  createConfigService({ file: a.paths.configFile }).set({ account: { credentialRevision: 0, wxid: 'account-b' } })
  expect(() => openAccountProfile(base)).toThrow()
})
