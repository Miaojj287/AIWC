/**
 * Lazily resolve media for one message into `cacheDir/media/<sessionId>/<msgId>.<ext>`:
 *  - images: locate the `.dat` (hardlink.db → msg/attach/<d1>/<d2>/Img, or a cached scan of msg/attach)
 *    and decrypt it; `_h` (HD) preferred, `_t` thumbnail exposed as thumbPath.
 *  - voice: silk blob from media_N.db (VoiceInfo, matched by server id, else chat + create_time) → `.silk`.
 *  - video / file: not encrypted; resolved to their original path under msg/video, msg/file (hardlink tables first).
 */
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { WxMedia } from '@aiwc/protocol'
import { decryptImageDat } from '../decrypt/decryptImageDat'
import type { MediaLocator, MessageRawInfo } from './messageMapper'
import { parseEmojiInfo, parseImageDatNameFromRow } from './contentParsers'
import { quoteIdent, type WcdbQuery } from './query'
import { coerceRowNumber, decodeBlob, type Row } from './rowDecoders'

export interface MediaResolverContext {
  q: WcdbQuery
  accountDir: string
  cacheDir: string
  nativeDir: string
  hardlinkDbPath: string | null
  mediaDbPaths: string[]
  imageKeys?: { xorHex?: string; aesHex?: string }
  /** Name2Id candidates for self (voice lookup by chat id). */
  selfKeys: readonly string[]
}

export interface MediaTarget {
  sessionId: string
  messageId: string
  raw: MessageRawInfo
  row: Row
  locator: MediaLocator
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.wxgf']

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 120) || '_'
}

export function mediaCachePath(cacheDir: string, sessionId: string, messageId: string, suffix = ''): string {
  return join(cacheDir, 'media', safeSegment(sessionId), `${safeSegment(messageId)}${suffix}`)
}

function existingCached(base: string): string | undefined {
  for (const ext of IMAGE_EXTS) {
    const candidate = base + ext
    try {
      if (existsSync(candidate) && statSync(candidate).size > 0) return candidate
    } catch {
      // ignore
    }
  }
  return undefined
}

// ------------------------------------------------------------------------------------------------
// Image .dat lookup
// ------------------------------------------------------------------------------------------------

interface HardlinkTables {
  image?: string
  video?: string
  file?: string
  dir?: string
}

const hardlinkTableCache = new Map<string, HardlinkTables>()

function hardlinkTables(ctx: MediaResolverContext): HardlinkTables {
  if (!ctx.hardlinkDbPath) return {}
  const cached = hardlinkTableCache.get(ctx.hardlinkDbPath)
  if (cached) return cached
  const tables: HardlinkTables = {}
  try {
    const names = ctx.q.tables(ctx.hardlinkDbPath)
    const latest = (prefix: string) => names.filter((n) => n.toLowerCase().startsWith(prefix)).sort().reverse()[0]
    tables.image = latest('image_hardlink_info')
    tables.video = latest('video_hardlink_info')
    tables.file = latest('file_hardlink_info')
    tables.dir = names.find((n) => n.toLowerCase().startsWith('dir2id'))
  } catch {
    // hardlink.db unreadable: fall back to directory scans
  }
  hardlinkTableCache.set(ctx.hardlinkDbPath, tables)
  return tables
}

function dirName(ctx: MediaResolverContext, dirTable: string, rowid: number): string | undefined {
  try {
    const row = ctx.q.get(ctx.hardlinkDbPath as string, `SELECT username FROM ${quoteIdent(dirTable)} WHERE rowid = ? LIMIT 1`, [rowid])
    const value = row?.['username']
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

interface HardlinkHit {
  fileName: string
  dir1?: string
  dir2?: string
}

function hardlinkLookup(ctx: MediaResolverContext, table: string | undefined, md5: string | undefined): HardlinkHit | undefined {
  if (!table || !md5 || !ctx.hardlinkDbPath) return undefined
  try {
    const row = ctx.q.get(ctx.hardlinkDbPath, `SELECT * FROM ${quoteIdent(table)} WHERE lower(md5) = lower(?) LIMIT 1`, [md5])
    if (!row) return undefined
    const fileName = typeof row['file_name'] === 'string' ? row['file_name'] : ''
    if (!fileName) return undefined
    const tables = hardlinkTables(ctx)
    const d1 = coerceRowNumber(row['dir1'], -1)
    const d2 = coerceRowNumber(row['dir2'], -1)
    const hit: HardlinkHit = { fileName }
    if (tables.dir && d1 >= 0) hit.dir1 = dirName(ctx, tables.dir, d1)
    if (tables.dir && d2 >= 0) hit.dir2 = dirName(ctx, tables.dir, d2)
    return hit
  } catch {
    return undefined
  }
}

const datIndexCache = new Map<string, { builtAt: number; byBase: Map<string, string[]> }>()
const DAT_INDEX_TTL_MS = 5_000
const datIndexPending = new Map<string, Promise<Map<string, string[]>>>()

/** base name without `_h` / `_t` suffix and `.dat` */
export function datBaseName(fileName: string): string {
  return basename(fileName).toLowerCase().replace(/\.dat$/, '').replace(/(?:_h|_t|_hd|_thumb|\.t)$/, '')
}

export function isThumbDat(fileName: string): boolean {
  return /(?:_t|\.t)\.dat$/i.test(fileName) || /_thumb\.dat$/i.test(fileName)
}

async function datIndex(root: string): Promise<Map<string, string[]>> {
  const pending = datIndexPending.get(root)
  if (pending) return pending
  const task = buildDatIndex(root)
  datIndexPending.set(root, task)
  try { return await task } finally { datIndexPending.delete(root) }
}

async function buildDatIndex(root: string): Promise<Map<string, string[]>> {
  const cached = datIndexCache.get(root)
  if (cached && Date.now() - cached.builtAt < DAT_INDEX_TTL_MS) return cached.byBase
  const byBase = new Map<string, string[]>()
  const queue = [root]
  let visited = 0
  while (queue.length > 0 && visited < 200_000) {
    const dir = queue.shift() as string
    let entries: Dirent[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dat')) {
        visited += 1
        const base = datBaseName(entry.name)
        const list = byBase.get(base)
        if (list) list.push(full)
        else byBase.set(base, [full])
      }
    }
  }
  datIndexCache.set(root, { builtAt: Date.now(), byBase })
  return byBase
}

/** Rank candidates: HD > plain > thumbnail. */
export function rankDatCandidates(paths: string[]): { best?: string; thumb?: string } {
  const score = (p: string) => (/_h(d)?\.dat$/i.test(p) ? 3 : isThumbDat(p) ? 1 : 2)
  const sorted = [...paths].sort((a, b) => score(b) - score(a))
  const best = sorted.find((p) => !isThumbDat(p))
  const thumb = sorted.find((p) => isThumbDat(p))
  return { best: best ?? thumb, thumb }
}

async function locateImageDat(ctx: MediaResolverContext, locator: MediaLocator, row: Row): Promise<{ best?: string; thumb?: string }> {
  const attachRoot = join(ctx.accountDir, 'msg', 'attach')
  const md5 = locator.imageMd5
  const datName = parseImageDatNameFromRow(row) ?? locator.imageDatName
  if (!md5 && !datName) return {}
  const hit = hardlinkLookup(ctx, hardlinkTables(ctx).image, md5)
  if (hit && hit.dir1 && hit.dir2) {
    const dir = join(attachRoot, hit.dir1, hit.dir2)
    const candidates: string[] = []
    for (const sub of ['Img', 'mg', 'Image', '']) {
      const folder = sub ? join(dir, sub) : dir
      const base = datBaseName(hit.fileName)
      for (const variant of [`${base}_h.dat`, `${base}.dat`, `${base}_t.dat`, hit.fileName]) {
        const full = join(folder, variant)
        if (existsSync(full) && !candidates.includes(full)) candidates.push(full)
      }
    }
    if (candidates.length > 0) return rankDatCandidates(candidates)
  }
  if (!existsSync(attachRoot)) return {}
  const index = await datIndex(attachRoot)
  for (const key of [md5, datName, hit ? datBaseName(hit.fileName) : undefined]) {
    if (!key) continue
    const list = index.get(datBaseName(key))
    if (list && list.length > 0) return rankDatCandidates(list)
  }
  return {}
}

async function resolveImage(ctx: MediaResolverContext, target: MediaTarget): Promise<WxMedia | undefined> {
  const base = mediaCachePath(ctx.cacheDir, target.sessionId, target.messageId)
  const thumbBase = `${base}_t`
  const cachedMain = existingCached(base)
  const cachedThumb = existingCached(thumbBase)
  if (cachedMain) return { kind: 'image', path: cachedMain, thumbPath: cachedThumb, sizeBytes: statSync(cachedMain).size }

  const { best, thumb } = await locateImageDat(ctx, target.locator, target.row)
  if (!best) return cachedThumb ? { kind: 'image', thumbPath: cachedThumb } : undefined
  const keys = { xorKey: ctx.imageKeys?.xorHex, aesKey: ctx.imageKeys?.aesHex, nativeDir: ctx.nativeDir }
  const media: WxMedia = { kind: 'image' }
  try {
    const main = await decryptImageDat({ src: best, dst: isThumbDat(best) ? thumbBase : base, ...keys })
    if (isThumbDat(best)) media.thumbPath = main.path
    else {
      media.path = main.path
      media.sizeBytes = main.bytes
    }
  } catch (error) {
    if (!thumb || thumb === best) throw error
  }
  if (thumb && thumb !== best && !media.thumbPath) {
    try {
      const t = await decryptImageDat({ src: thumb, dst: thumbBase, ...keys })
      media.thumbPath = t.path
    } catch {
      // thumbnail is optional
    }
  }
  return media.path || media.thumbPath ? media : undefined
}

// ------------------------------------------------------------------------------------------------
// Voice
// ------------------------------------------------------------------------------------------------

interface VoiceTableShape {
  table: string
  dataCol: string
  svrIdCol?: string
  chatIdCol?: string
  timeCol?: string
  name2Id?: string
}

const voiceShapeCache = new Map<string, VoiceTableShape | null>()

function voiceShape(ctx: MediaResolverContext, dbPath: string): VoiceTableShape | null {
  const cached = voiceShapeCache.get(dbPath)
  if (cached !== undefined) return cached
  let shape: VoiceTableShape | null = null
  try {
    const tables = ctx.q.tables(dbPath, 'VoiceInfo%')
    const table = tables[0]
    if (table) {
      const cols = ctx.q.columns(dbPath, table).map((c) => c.toLowerCase())
      const dataCol = cols.find((c) => c === 'voice_data' || c === 'buf' || c === 'voicebuf' || c === 'data')
      if (dataCol) {
        shape = {
          table,
          dataCol,
          svrIdCol: cols.find((c) => ['msg_svr_id', 'msgsvrid', 'svr_id', 'svrid', 'server_id', 'serverid'].includes(c)),
          chatIdCol: cols.find((c) => ['chat_name_id', 'chatnameid', 'chat_nameid'].includes(c)),
          timeCol: cols.find((c) => ['create_time', 'createtime', 'time'].includes(c)),
          name2Id: ctx.q.tables(dbPath, 'Name2Id%')[0],
        }
      }
    }
  } catch {
    shape = null
  }
  voiceShapeCache.set(dbPath, shape)
  return shape
}

function findVoiceBlob(ctx: MediaResolverContext, target: MediaTarget): Buffer | null {
  const { serverId, createTime } = target.raw
  for (const dbPath of ctx.mediaDbPaths) {
    const shape = voiceShape(ctx, dbPath)
    if (!shape) continue
    const t = quoteIdent(shape.table)
    const data = quoteIdent(shape.dataCol)
    try {
      if (shape.svrIdCol && serverId > 0) {
        const row = ctx.q.get(dbPath, `SELECT ${data} AS d FROM ${t} WHERE ${quoteIdent(shape.svrIdCol)} = ? LIMIT 1`, [serverId])
        const blob = decodeBlob(row?.['d'])
        if (blob && blob.length > 0) return blob
      }
      if (shape.chatIdCol && shape.timeCol && shape.name2Id && createTime > 0) {
        for (const candidate of [target.sessionId, ...ctx.selfKeys]) {
          const n2i = ctx.q.get(dbPath, `SELECT rowid AS rid FROM ${quoteIdent(shape.name2Id)} WHERE user_name = ?`, [candidate])
          const rid = coerceRowNumber(n2i?.['rid'], 0)
          if (!rid) continue
          const rows = ctx.q.all(dbPath, `SELECT ${data} AS d FROM ${t} WHERE ${quoteIdent(shape.chatIdCol)} = ? AND ${quoteIdent(shape.timeCol)} = ? ORDER BY rowid ASC LIMIT 4`, [rid, createTime])
          const blob = decodeBlob(rows[0]?.['d'])
          if (blob && blob.length > 0) return blob
        }
      }
      if (shape.timeCol && createTime > 0) {
        const rows = ctx.q.all(dbPath, `SELECT ${data} AS d FROM ${t} WHERE ${quoteIdent(shape.timeCol)} = ? ORDER BY rowid ASC LIMIT 2`, [createTime])
        if (rows.length === 1) {
          const blob = decodeBlob(rows[0]?.['d'])
          if (blob && blob.length > 0) return blob
        }
      }
    } catch {
      // try next media shard
    }
  }
  return null
}

async function resolveVoice(ctx: MediaResolverContext, target: MediaTarget): Promise<WxMedia | undefined> {
  const path = mediaCachePath(ctx.cacheDir, target.sessionId, target.messageId, '.silk')
  const durationMs = target.locator.durationMs
  if (existsSync(path) && statSync(path).size > 0) return { kind: 'voice', path, durationMs, sizeBytes: statSync(path).size }
  const blob = findVoiceBlob(ctx, target)
  if (!blob) return undefined
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, blob)
  return { kind: 'voice', path, durationMs, sizeBytes: blob.length }
}

// ------------------------------------------------------------------------------------------------
// Video / file
// ------------------------------------------------------------------------------------------------

function findUnderMonthDirs(root: string, predicate: (name: string) => boolean): string | undefined {
  if (!existsSync(root)) return undefined
  let dirs: string[] = []
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
  } catch {
    return undefined
  }
  for (const dir of [root, ...dirs.map((d) => join(root, d))]) {
    try {
      const hit = readdirSync(dir).find(predicate)
      if (hit) return join(dir, hit)
    } catch {
      // skip
    }
  }
  return undefined
}

function resolveVideo(ctx: MediaResolverContext, target: MediaTarget): WxMedia | undefined {
  const root = join(ctx.accountDir, 'msg', 'video')
  const md5 = target.locator.videoMd5
  const hit = hardlinkLookup(ctx, hardlinkTables(ctx).video, md5)
  const stem = hit ? basename(hit.fileName).replace(/\.[^.]+$/, '') : md5
  if (!stem) return undefined
  const lowerStem = stem.toLowerCase()
  let path: string | undefined
  if (hit?.dir1 && hit.dir2) {
    const direct = join(root, hit.dir1, hit.dir2, hit.fileName)
    if (existsSync(direct)) path = direct
  }
  path = path ?? findUnderMonthDirs(root, (name) => name.toLowerCase() === `${lowerStem}.mp4` || (name.toLowerCase().startsWith(lowerStem) && name.toLowerCase().endsWith('.mp4')))
  if (!path) return undefined
  const dir = dirname(path)
  const thumb = [`${stem}_thumb.jpg`, `${stem}.jpg`, `${stem}_thumb.png`].map((n) => join(dir, n)).find((p) => existsSync(p))
  const media: WxMedia = { kind: 'video', path, thumbPath: thumb, durationMs: target.locator.durationMs }
  try {
    media.sizeBytes = statSync(path).size
  } catch {
    // size optional
  }
  return media
}

function resolveFile(ctx: MediaResolverContext, target: MediaTarget): WxMedia | undefined {
  const root = join(ctx.accountDir, 'msg', 'file')
  const { fileName, fileMd5, fileSize } = target.locator
  const hit = hardlinkLookup(ctx, hardlinkTables(ctx).file, fileMd5)
  let path: string | undefined
  if (hit) {
    if (hit.dir1 && hit.dir2) {
      const direct = join(root, hit.dir1, hit.dir2, hit.fileName)
      if (existsSync(direct)) path = direct
    }
    path = path ?? findUnderMonthDirs(root, (name) => name === basename(hit.fileName))
  }
  if (!path && fileName) path = findUnderMonthDirs(root, (name) => name === fileName)
  if (!path && fileName) {
    const ext = extname(fileName).toLowerCase()
    const stem = fileName.slice(0, fileName.length - ext.length)
    path = findUnderMonthDirs(root, (name) => name.startsWith(stem) && name.toLowerCase().endsWith(ext) && (fileSize === undefined || safeSize(join(root, name)) === fileSize))
  }
  if (!path) return fileName ? { kind: 'file', fileName, sizeBytes: fileSize } : undefined
  return { kind: 'file', path, fileName: fileName ?? basename(path), sizeBytes: safeSize(path) ?? fileSize }
}

function safeSize(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------------------------------------------

export async function resolveMediaFor(ctx: MediaResolverContext, target: MediaTarget): Promise<WxMedia | undefined> {
  switch (target.locator.kind) {
    case 'image':
      return resolveImage(ctx, target)
    case 'voice':
      return resolveVoice(ctx, target)
    case 'video':
      return resolveVideo(ctx, target)
    case 'file':
      return resolveFile(ctx, target)
    case 'sticker': {
      const info = parseEmojiInfo(target.raw.content)
      const url = info.cdnUrl
      if (url && /^https?:\/\//i.test(url)) return { kind: 'sticker', path: url }
      return undefined
    }
    default:
      return undefined
  }
}

/** Copy an already-plain media file into the cache (used when callers want a stable cached path). */
export async function cacheCopy(ctx: MediaResolverContext, sessionId: string, messageId: string, src: string): Promise<string> {
  const dst = mediaCachePath(ctx.cacheDir, sessionId, messageId, extname(src))
  if (!existsSync(dst)) {
    await mkdir(dirname(dst), { recursive: true })
    await copyFile(src, dst)
  }
  return dst
}

/** Test hook: drop cached hardlink/voice shapes and dat indexes. */
export function resetMediaResolverCaches(): void {
  hardlinkTableCache.clear()
  voiceShapeCache.clear()
  datIndexCache.clear()
}
