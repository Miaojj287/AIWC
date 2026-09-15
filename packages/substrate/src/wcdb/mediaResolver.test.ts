import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  datBaseName,
  isThumbDat,
  mediaCachePath,
  rankDatCandidates,
  resolveMediaFor,
  type MediaResolverContext,
  type MediaTarget,
} from './mediaResolver'

describe('media cache paths', () => {
  it('keeps dot-only session and message ids inside cacheDir/media/<session>/', () => {
    const cacheDir = join(tmpdir(), 'aiwc-cache')
    const mediaRoot = join(cacheDir, 'media')
    for (const [sessionId, messageId] of [
      ['..', '..'],
      ['.', '.'],
      ['chat', '..'],
      ['...', ''],
    ] as const) {
      const rel = relative(mediaRoot, mediaCachePath(cacheDir, sessionId, messageId))
      const segments = rel.split(sep)
      expect(isAbsolute(rel) || rel.startsWith('..'), `${sessionId}/${messageId}`).toBe(false)
      expect(segments, `${sessionId}/${messageId}`).toHaveLength(2)
      expect(
        segments.some((segment) => /^\.*$/.test(segment)),
        `${sessionId}/${messageId}`,
      ).toBe(false)
    }
    expect(mediaCachePath(cacheDir, 'room@chatroom', 'wx:12:3', '.silk')).toBe(
      join(mediaRoot, 'room@chatroom', 'wx_12_3.silk'),
    )
  })
})

describe('media resolution', () => {
  it('recognizes dot-t thumbnails used by WeChat', () => {
    expect(datBaseName('abcd.t.dat')).toBe('abcd')
    expect(isThumbDat('abcd.t.dat')).toBe(true)
    expect(rankDatCandidates(['abcd.t.dat', 'abcd_h.dat']).best).toBe('abcd_h.dat')
  })
  it('finds and decodes a locally present Mac thumbnail without hardlink metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aiwc-media-'))
    try {
      const folder = join(root, 'msg', 'attach', 'chat', '2026-09', 'Img')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'abcdef0123456789_t_M.dat'), Buffer.from('ffd8ffe000104a464946000101000048', 'hex'))
      const media = await resolveMediaFor(
        { accountDir: root, cacheDir: join(root, 'cache'), hardlinkDbPath: null } as MediaResolverContext,
        {
          sessionId: 'chat',
          messageId: '1',
          row: {},
          locator: { kind: 'image', imageMd5: 'abcdef0123456789' },
        } as MediaTarget,
      )
      expect(media?.thumbPath).toBe(join(root, 'cache', 'media', 'chat', '1_t.jpg'))
      expect(media?.path).toBeUndefined()
      expect(datBaseName('abcdef_t_M.dat')).toBe('abcdef')
      expect(isThumbDat('abcdef_t_M.dat')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('resolves sticker CDN URLs and decodes XML entities', async () => {
    const target = {
      locator: { kind: 'sticker' },
      raw: { content: '<emoji cdnurl="https://example.com/emoji?a=1&amp;b=2" />' },
    } as MediaTarget
    expect(await resolveMediaFor({} as MediaResolverContext, target)).toEqual({
      kind: 'sticker',
      path: 'https://example.com/emoji?a=1&b=2',
    })
  })
  it('does not treat a missing or unsafe sticker URL as resolved media', async () => {
    for (const content of ['<emoji />', '<emoji cdnurl="file:///etc/passwd" />']) {
      expect(
        await resolveMediaFor(
          {} as MediaResolverContext,
          { locator: { kind: 'sticker' }, raw: { content } } as MediaTarget,
        ),
      ).toBeUndefined()
    }
  })
})
