import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { WxMedia } from '@aiwc/protocol'
import { detectImageExtension, isWxgf } from '../decrypt/datDecryptCore'
import { decryptEmoticon, deriveEmoticonKey } from '../decrypt/decryptEmoticon'
import { convertWxgf } from '../decrypt/convertWxgf'
import { collectKvcommCodes } from '../key/imageKeys'
import { cleanAccountDirName } from './accountUtils'
import { parseEmojiInfo } from './contentParsers'
import type { MediaResolverContext, MediaTarget } from './mediaResolver'

const pending = new Map<string, Promise<WxMedia | undefined>>()
const extensions = ['.gif', '.png', '.jpg', '.webp', '.bmp']

async function readImage(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

async function cached(base: string): Promise<string | undefined> {
  for (const ext of extensions) {
    const path = base + ext
    const data = await readImage(path)
    if (data && !isWxgf(data) && detectImageExtension(data) === ext) return path
  }
  return undefined
}

async function save(base: string, data: Buffer): Promise<string | undefined> {
  if (isWxgf(data)) return undefined
  const ext = detectImageExtension(data)
  if (!ext) return undefined
  const path = base + ext
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, data, { mode: 0o600 })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
  return path
}

export async function resolveSticker(ctx: MediaResolverContext, target: MediaTarget): Promise<WxMedia | undefined> {
  const info = parseEmojiInfo(target.raw.content)
  const md5 = info.md5
  if (!md5 || !/^[a-f0-9]{32}$/.test(md5) || !ctx.accountDir || !ctx.cacheDir) {
    return info.cdnUrl && /^https?:\/\//i.test(info.cdnUrl) ? { kind: 'sticker', path: info.cdnUrl } : undefined
  }
  // Same sticker in different conversations shares a conversion; accounts remain isolated.
  const account = createHash('sha256').update(ctx.accountDir).digest('hex').slice(0, 16)
  const base = join(ctx.cacheDir, 'media', `stickers-${account}`, md5)
  const running = pending.get(base)
  if (running) return running
  const task = resolveLocalSticker(ctx, md5, base, info.cdnUrl)
  pending.set(base, task)
  try {
    return await task
  } finally {
    pending.delete(base)
  }
}

async function resolveLocalSticker(
  ctx: MediaResolverContext,
  md5: string,
  base: string,
  cdnUrl?: string,
): Promise<WxMedia | undefined> {
  const main = await cached(base)
  const thumb = await cached(`${base}_t`)
  if (main) return { kind: 'sticker', path: main, thumbPath: thumb }
  const root = join(ctx.accountDir, 'business', 'emoticon')
  const wxids = new Set([basename(ctx.accountDir), ...(ctx.selfKeys ?? [])].map(cleanAccountDirName))
  const keys = collectKvcommCodes(ctx.accountDir).flatMap((uin) =>
    [...wxids].map((wxid) => deriveEmoticonKey(uin, wxid)),
  )
  const load = async (store: string, suffix: string): Promise<Buffer | undefined> => {
    const path = join(root, store, md5.slice(0, 2), md5 + suffix)
    if (!existsSync(path)) return undefined
    const data = await readImage(path)
    return data ? decryptEmoticon(data, keys) : undefined
  }
  let thumbPath = thumb
  if (!thumbPath) {
    for (const [store, suffix] of [
      ['Thumb', '.thumb'],
      ['ThumbStore', '.icon'],
      ['ThumbStore', ''],
    ]) {
      const data = await load(store!, suffix!)
      if (data) thumbPath = await save(`${base}_t`, data)
      if (thumbPath) break
    }
  }
  for (const store of ['Persist', 'PersistStore']) {
    const data = await load(store, '')
    if (!data) continue
    const display = isWxgf(data) ? await convertWxgf(data, ctx.nativeDir) : data
    const path = display ? await save(base, display) : undefined
    if (path) return { kind: 'sticker', path, thumbPath }
  }
  // Never send encrypted bytes or a wxgf/hevc container to <img>.
  if (thumbPath) return { kind: 'sticker', thumbPath }
  if (!cdnUrl && ctx.emoticonDbPath) {
    try {
      const row = ctx.q.get(
        ctx.emoticonDbPath,
        'SELECT cdn_url, thumb_url FROM kNonStoreEmoticonTable WHERE md5 = ? LIMIT 1',
        [md5],
      )
      cdnUrl = String(row?.['cdn_url'] || row?.['thumb_url'] || '')
    } catch {
      /* Optional index, unavailable on some WeChat versions. */
    }
  }
  return cdnUrl && /^https?:\/\//i.test(cdnUrl) ? { kind: 'sticker', path: cdnUrl } : undefined
}
