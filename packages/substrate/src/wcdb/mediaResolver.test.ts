import { describe, expect, it } from 'vitest'
import { datBaseName, isThumbDat, rankDatCandidates, resolveMediaFor, type MediaResolverContext, type MediaTarget } from './mediaResolver'

describe('media resolution', () => {
  it('recognizes dot-t thumbnails used by WeChat', () => {
    expect(datBaseName('abcd.t.dat')).toBe('abcd')
    expect(isThumbDat('abcd.t.dat')).toBe(true)
    expect(rankDatCandidates(['abcd.t.dat', 'abcd_h.dat']).best).toBe('abcd_h.dat')
  })
  it('resolves sticker CDN URLs and decodes XML entities', async () => {
    const target = { locator: { kind: 'sticker' }, raw: { content: '<emoji cdnurl="https://example.com/emoji?a=1&amp;b=2" />' } } as MediaTarget
    expect(await resolveMediaFor({} as MediaResolverContext, target)).toEqual({ kind: 'sticker', path: 'https://example.com/emoji?a=1&b=2' })
  })
  it('does not treat a missing or unsafe sticker URL as resolved media', async () => {
    for (const content of ['<emoji />', '<emoji cdnurl="file:///etc/passwd" />']) {
      expect(await resolveMediaFor({} as MediaResolverContext, { locator: { kind: 'sticker' }, raw: { content } } as MediaTarget)).toBeUndefined()
    }
  })
})
