import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRootCandidates, scoreRootCandidates } from './dbRoots'
import { parseWindowsRootMetadata, windowsConfiguredRootCandidates } from './windowsRoots'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function fixture(contents?: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-windows-roots-'))
  roots.push(root)
  if (contents) {
    const config = join(root, 'Tencent', 'WeChat', 'All Users', 'config')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, '3ebffe94.ini'), contents)
  }
  return root
}

describe('Windows custom root metadata', () => {
  it('parses a local drive path with spaces using strict UTF-8', () => {
    expect(parseWindowsRootMetadata(Buffer.from('D:\\Chat Data\\WeChat Files'))).toBe('D:\\Chat Data\\WeChat Files')
    expect(parseWindowsRootMetadata(Buffer.from('D:/Chat Data/WeChat Files'))).toBe('D:\\Chat Data\\WeChat Files')
  })
  it.each([
    '',
    'MyDocument:',
    'relative',
    'C:relative',
    '\\\\server\\share',
    '\\\\?\\C:\\chat',
    'C:\\chat\\..\\other',
    'C:\\chat\\.. \\other',
    'C:\\chat\u0000',
    'C:\\chat\n',
    'C:\\chat\r\nother',
    'C:\\chat\t',
    'C:\\chat:stream',
  ])('rejects an unsafe or sentinel metadata value (%j)', (value) => {
    expect(parseWindowsRootMetadata(Buffer.from(value))).toBeUndefined()
  })
  it('rejects malformed UTF-8 and oversized input', () => {
    expect(parseWindowsRootMetadata(Buffer.from([0x43, 0x3a, 0x5c, 0xc3, 0x28]))).toBeUndefined()
    expect(parseWindowsRootMetadata(Buffer.alloc(4097, 0x61))).toBeUndefined()
  })
  it('reads only the known metadata file and emits the bounded candidate family', () => {
    const appData = fixture(Buffer.from('D:\\custom\\WeChat Files'))
    expect(windowsConfiguredRootCandidates(appData)).toEqual([
      'D:\\custom\\WeChat Files',
      'D:\\custom\\WeChat Files\\xwechat_files',
      'D:\\custom\\WeChat Files\\WeChat Files',
      'D:\\custom\\xwechat_files',
    ])
  })
  it.each([undefined, Buffer.from('MyDocument:'), Buffer.alloc(4097, 0x61)])(
    'retains document defaults when metadata is absent, sentinel, or oversized',
    (contents) => {
      const appData = fixture(contents)
      const defaults = defaultRootCandidates({ platform: 'win32', home: appData, appData, userProfile: appData })
      expect(defaults).toContain(join(appData, 'Documents', 'xwechat_files'))
      expect(defaults).toContain(join(appData, 'Documents', 'WeChat Files'))
      expect(windowsConfiguredRootCandidates(appData)).toEqual([])
    },
  )
  it.skipIf(platform() !== 'win32')('requires a real account tree before selecting the configured sibling', () => {
    const appData = fixture()
    const base = win32.join(appData, 'custom', 'WeChat Files')
    const config = join(appData, 'Tencent', 'WeChat', 'All Users', 'config')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, '3ebffe94.ini'), base)
    const candidates = defaultRootCandidates({ platform: 'win32', home: appData, appData })
    expect(scoreRootCandidates(candidates, 'win32')).toEqual([])
    const storage = win32.join(appData, 'custom', 'xwechat_files', 'fictional-account', 'db_storage')
    mkdirSync(storage, { recursive: true })
    expect(scoreRootCandidates(candidates, 'win32')[0]?.path).toBe(win32.join(appData, 'custom', 'xwechat_files'))
  })
})
