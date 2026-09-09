import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEDIA_PATH_NOT_ABSOLUTE_ERROR, MEDIA_ROOTS_MISSING_ERROR, canonicalPath, checkOutboundMedia, isWithinRoot, isWithinRoots, resolveMediaRoots } from './mediaPolicy'

describe('mediaPolicy', () => {
  let base: string
  let root: string
  let file: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'aiwc-policy-'))
    root = join(base, 'cache')
    mkdirSync(join(root, 'media'), { recursive: true })
    file = join(root, 'media', 'a.jpg')
    writeFileSync(file, 'x')
    writeFileSync(join(base, 'secret'), 's')
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('resolveMediaRoots accepts a list or a getter and drops junk entries', () => {
    expect(resolveMediaRoots(undefined)).toEqual([])
    expect(resolveMediaRoots(['/a', '', '/b\0c'])).toEqual(['/a'])
    expect(resolveMediaRoots(() => ['/x'])).toEqual(['/x'])
  })

  it('isWithinRoot / isWithinRoots: containment, trailing slash, sibling-prefix and traversal', () => {
    expect(isWithinRoot('/data/aiwc/cache/a.jpg', '/data/aiwc/cache/')).toBe(true)
    expect(isWithinRoot('/data/aiwc/cache', '/data/aiwc/cache')).toBe(true)
    expect(isWithinRoot('/data/aiwc/cache-evil/a.jpg', '/data/aiwc/cache')).toBe(false)
    expect(isWithinRoot('/data/aiwc/cache/../secret', '/data/aiwc/cache')).toBe(false)
    expect(isWithinRoots('/data/aiwc/exports/x.csv', ['/data/aiwc/cache', '/data/aiwc/exports'])).toBe(true)
    expect(isWithinRoots('', ['/data'])).toBe(false)
    expect(isWithinRoots('/data/a\0', ['/data'])).toBe(false)
  })

  it('canonicalPath resolves symlinks for existing paths and for the existing ancestors of missing ones', () => {
    expect(canonicalPath(file)).toBe(realpathSync(file))
    expect(canonicalPath(join(root, 'media', '..', 'media', 'nope.jpg'))).toBe(join(realpathSync(join(root, 'media')), 'nope.jpg'))
    expect(canonicalPath(join(root, 'media', 'deep', 'er', 'nope.jpg'))).toBe(join(realpathSync(join(root, 'media')), 'deep', 'er', 'nope.jpg'))
  })

  it('checkOutboundMedia: refuses relative paths and missing roots before touching the filesystem', () => {
    expect(checkOutboundMedia('a.jpg', [root])).toEqual({ ok: false, error: MEDIA_PATH_NOT_ABSOLUTE_ERROR })
    expect(checkOutboundMedia(file, undefined)).toEqual({ ok: false, error: MEDIA_ROOTS_MISSING_ERROR })
    expect(checkOutboundMedia(file, [])).toEqual({ ok: false, error: MEDIA_ROOTS_MISSING_ERROR })
  })

  it('checkOutboundMedia: allows files under a root (even through /tmp-style symlinked roots) and returns the canonical path', () => {
    // `base` comes from os.tmpdir(), which on macOS is a symlink into /private — the check must survive that.
    expect(checkOutboundMedia(file, [root])).toEqual({ ok: true, path: realpathSync(file) })
    expect(checkOutboundMedia(file, () => [join(root, 'media')])).toEqual({ ok: true, path: realpathSync(file) })
    expect(checkOutboundMedia(realpathSync(file), [root])).toEqual({ ok: true, path: realpathSync(file) })
  })

  it('checkOutboundMedia: denies outside files, traversal and symlinks pointing out of the root, without echoing the path', () => {
    const secret = join(base, 'secret')
    const outside = checkOutboundMedia(secret, [root])
    expect(outside.ok).toBe(false)
    if (!outside.ok) {
      expect(outside.error).toContain('secret')
      expect(outside.error).not.toContain(base)
    }
    expect(checkOutboundMedia(join(root, '..', 'secret'), [root]).ok).toBe(false)
    symlinkSync(secret, join(root, 'media', 'link.jpg'))
    expect(checkOutboundMedia(join(root, 'media', 'link.jpg'), [root]).ok).toBe(false)
    // a file that does not exist yet is judged by its canonicalised parent
    expect(checkOutboundMedia(join(root, 'media', 'later.jpg'), [root])).toEqual({ ok: true, path: join(realpathSync(join(root, 'media')), 'later.jpg') })
    expect(checkOutboundMedia(join(root, '..', 'later.jpg'), [root]).ok).toBe(false)
  })
})
