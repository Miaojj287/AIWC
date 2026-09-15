import { createCipheriv } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { deriveEmoticonKey } from '../decrypt/decryptEmoticon'
import { convertWxgf } from '../decrypt/convertWxgf'
import { resolveMediaFor, type MediaResolverContext, type MediaTarget } from './mediaResolver'
import type { WcdbQuery } from './query'

vi.mock('../key/imageKeys', () => ({ collectKvcommCodes: () => [123456789] }))
vi.mock('../decrypt/convertWxgf', () => ({ convertWxgf: vi.fn(async () => undefined) }))
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const md5 = '0123456789abcdef0123456789abcdef'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.clearAllMocks()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aiwc-sticker-test-'))
  roots.push(root)
  // Stickers resolve from files alone; any database access here is a regression.
  const q = new Proxy(
    {},
    {
      get: (_t, name) => () => {
        throw new Error(`unexpected WCDB query: ${String(name)}`)
      },
    },
  ) as WcdbQuery
  const ctx: MediaResolverContext = {
    q,
    accountDir: join(root, 'wxid_fixture_1234'),
    cacheDir: join(root, 'cache'),
    selfKeys: ['wxid_fixture'],
    nativeDir: '/unused',
    hardlinkDbPath: null,
    mediaDbPaths: [],
  }
  const target = {
    locator: { kind: 'sticker' },
    raw: { content: `<emoji md5="${md5}" cdnurl="https://invalid.example/expired"/>` },
  } as MediaTarget
  const put = async (store: string, suffix: string, plain: Buffer) => {
    const dir = join(ctx.accountDir, 'business', 'emoticon', store, '01')
    await mkdir(dir, { recursive: true })
    const key = deriveEmoticonKey(123456789, 'wxid_fixture')
    const cipher = createCipheriv('aes-128-cbc', key, key)
    await writeFile(join(dir, md5 + suffix), Buffer.concat([cipher.update(plain), cipher.final()]))
  }
  return { ctx, target, put }
}
it('resolves own sent stickers locally even with an expired CDN, and reuses the decoded cache', async () => {
  const { ctx, target, put } = await fixture()
  await put('Persist', '', gif)
  const media = await resolveMediaFor(ctx, target)
  expect(media?.path).toMatch(/\.gif$/)
  expect(await readFile(media!.path!)).toEqual(gif)
  await rm(ctx.accountDir, { recursive: true })
  expect(await resolveMediaFor(ctx, target)).toEqual(media)
})
it('falls back to a decoded local thumbnail if wxgf conversion is unavailable', async () => {
  const { ctx, target, put } = await fixture()
  await put('Persist', '', Buffer.concat([Buffer.from('wxgf'), Buffer.alloc(80)]))
  await put('Thumb', '.thumb', gif)
  const [first, second] = await Promise.all([resolveMediaFor(ctx, target), resolveMediaFor(ctx, target)])
  expect(first).toEqual(second)
  expect(first?.path).toBeUndefined()
  expect(await readFile(first!.thumbPath!)).toEqual(gif)
  expect(convertWxgf).toHaveBeenCalledTimes(1)
})
it('handles store stickers and does not permanently cache misses', async () => {
  const { ctx, target, put } = await fixture()
  expect((await resolveMediaFor(ctx, target))?.path).toMatch(/^https:/)
  await put('PersistStore', '', gif)
  expect((await resolveMediaFor(ctx, target))?.path).toMatch(/\.gif$/)
})
