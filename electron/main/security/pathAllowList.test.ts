import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PATH_DENIED_MESSAGE,
  PATH_NOT_FOUND_MESSAGE,
  PATH_SYMLINK_MESSAGE,
  createAllowList,
  isForbiddenRoot,
  isWithinRoot,
  isWithinRoots,
  mediaTypeFor,
  parseMediaUrl,
  resolveAllowedExisting,
  resolveAllowedWriteTarget,
  toMediaUrl,
} from './pathAllowList'

describe('path allow-list', () => {
  const roots = ['/data/aiwc', '/data/aiwc/cache/']

  it('accepts files under a root (including the root itself) and rejects everything else', () => {
    expect(isWithinRoots('/data/aiwc/cache/media/a.jpg', roots)).toBe(true)
    expect(isWithinRoots('/data/aiwc', roots)).toBe(true)
    expect(isWithinRoots('/data/aiwc/cache', roots)).toBe(true)
    expect(isWithinRoots('/data/aiwcX/a.jpg', roots)).toBe(false)
    expect(isWithinRoots('/data/aiwc/../secret.txt', roots)).toBe(false)
    expect(isWithinRoots('/etc/passwd', roots)).toBe(false)
    expect(isWithinRoots('', roots)).toBe(false)
    expect(isWithinRoots('/data/aiwc/a\0.jpg', roots)).toBe(false)
  })

  it('normalises dot segments before comparing', () => {
    expect(isWithinRoot('/data/aiwc/cache/../cache/media/x.png', '/data/aiwc')).toBe(true)
    expect(isWithinRoot('/data/aiwc/cache/../../other', '/data/aiwc')).toBe(false)
  })

  it('createAllowList lets a session add picked directories', () => {
    const al = createAllowList(['/data/aiwc'], { home: '/Users/me' })
    expect(al.isAllowed('/Users/me/Downloads/x.md')).toBe(false)
    expect(al.addRoot('/Users/me/Downloads/')).toBe(true)
    expect(al.isAllowed('/Users/me/Downloads/x.md')).toBe(true)
    expect(al.roots()).toContain('/Users/me/Downloads')
  })

  it('refuses the filesystem root and the home directory as roots (initial and added)', () => {
    const al = createAllowList(['/', '/Users/me', '/data/aiwc'], { home: '/Users/me' })
    expect(al.roots()).toEqual(['/data/aiwc'])
    expect(al.addRoot('/')).toBe(false)
    expect(al.addRoot('/Users/me/')).toBe(false)
    expect(al.addRoot('/Users/me/../me')).toBe(false)
    expect(al.addRoot('')).toBe(false)
    expect(al.isAllowed('/etc/passwd')).toBe(false)
    expect(al.isAllowed('/Users/me/.ssh/id_rsa')).toBe(false)
    expect(al.roots()).toEqual(['/data/aiwc'])
    expect(isForbiddenRoot('/', '/Users/me')).toBe(true)
    expect(isForbiddenRoot('/Users/me', '/Users/me')).toBe(true)
    expect(isForbiddenRoot('/Users/me/Documents', '/Users/me')).toBe(false)
  })
})

describe('aiwc-media URL parsing', () => {
  it('round-trips posix paths', () => {
    const url = toMediaUrl('/data/aiwc/cache/media/中文 图.jpg')
    expect(url.startsWith('aiwc-media:///data/aiwc/cache/media/')).toBe(true)
    expect(parseMediaUrl(url, 'darwin')).toBe('/data/aiwc/cache/media/中文 图.jpg')
    expect(parseMediaUrl('aiwc-media://media/%2Fdata%2Fa.png', 'darwin')).toBe('/data/a.png')
    expect(parseMediaUrl('aiwc-media:///data/a.png?x=1#frag', 'darwin')).toBe('/data/a.png')
  })

  it('handles windows drive letters and rejects garbage', () => {
    expect(parseMediaUrl('aiwc-media:///C:/Users/me/a.jpg', 'win32')).toBe('C:\\Users\\me\\a.jpg')
    expect(parseMediaUrl('aiwc-media://relative/a.jpg', 'win32')).toBeNull()
    expect(parseMediaUrl('http://evil/a.jpg', 'darwin')).toBeNull()
    expect(parseMediaUrl('aiwc-media:///%E0%A4%A', 'darwin')).toBeNull()
  })

  it('maps media types by extension', () => {
    expect(mediaTypeFor('/x/a.JPG')).toBe('image/jpeg')
    expect(mediaTypeFor('/x/a.mp4')).toBe('video/mp4')
    expect(mediaTypeFor('/x/a.unknown')).toBe('application/octet-stream')
  })
})

describe('symlink-aware resolution (app:openPath / file:*)', () => {
  let root: string
  let outside: string
  beforeAll(() => {
    // realpath: on macOS tmpdir is /var/… which itself is a symlink to /private/var/…
    root = realpathSync(mkdtempSync(join(tmpdir(), 'aiwc-allow-')))
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'aiwc-outside-')))
    writeFileSync(join(root, 'inside.txt'), 'ok')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    mkdirSync(join(root, 'sub'))
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link-file'))
    symlinkSync(outside, join(root, 'link-dir'))
    symlinkSync(join(root, 'inside.txt'), join(root, 'link-inside'))
    symlinkSync(join(root, 'sub'), join(root, 'link-sub'))
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
  const al = () => createAllowList([root], { home: '/Users/nobody' })

  it('openPath / read: follows symlinks and refuses when the real path leaves the allow-list', async () => {
    await expect(resolveAllowedExisting(al(), join(root, 'inside.txt'))).resolves.toBe(join(root, 'inside.txt'))
    await expect(resolveAllowedExisting(al(), join(root, 'link-inside'))).resolves.toBe(join(root, 'inside.txt'))
    await expect(resolveAllowedExisting(al(), join(root, 'link-file'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedExisting(al(), join(root, 'link-dir', 'secret.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedExisting(al(), join(outside, 'secret.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedExisting(al(), join(root, 'missing.txt'))).rejects.toThrow(PATH_NOT_FOUND_MESSAGE)
  })

  it('write: refuses a symlink target outright, even one pointing inside the allow-list', async () => {
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-file'))).rejects.toThrow(PATH_SYMLINK_MESSAGE)
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-inside'))).rejects.toThrow(PATH_SYMLINK_MESSAGE)
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-dir'))).rejects.toThrow(PATH_SYMLINK_MESSAGE)
  })

  it('write: refuses when the real parent (deepest existing ancestor) leaves the allow-list', async () => {
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-dir', 'new.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-dir', 'deep', 'er', 'new.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedWriteTarget(al(), join(outside, 'new.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
    await expect(resolveAllowedWriteTarget(al(), join(root, '..', 'x.txt'))).rejects.toThrow(PATH_DENIED_MESSAGE)
  })

  it('write: allows regular files, new files and new nested directories under the allow-list', async () => {
    await expect(resolveAllowedWriteTarget(al(), join(root, 'inside.txt'))).resolves.toBe(join(root, 'inside.txt'))
    await expect(resolveAllowedWriteTarget(al(), join(root, 'new.txt'))).resolves.toBe(join(root, 'new.txt'))
    await expect(resolveAllowedWriteTarget(al(), join(root, 'sub', 'a', 'b', 'new.txt'))).resolves.toBe(join(root, 'sub', 'a', 'b', 'new.txt'))
    // a symlinked directory that resolves inside the allow-list is fine; the write lands on the real path
    await expect(resolveAllowedWriteTarget(al(), join(root, 'link-sub', 'new.txt'))).resolves.toBe(join(root, 'sub', 'new.txt'))
  })
})
