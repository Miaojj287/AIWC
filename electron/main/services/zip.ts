/**
 * Minimal ZIP reader for pet packages (`pet.json` + `spritesheet.webp`), so importing a download from
 * codex-pets.net needs no native / third-party dependency. Supports stored (0) and deflated (8) entries,
 * refuses ZIP64 and anything that would inflate past the size caps (a pet package is a few MB).
 */
import { inflateRawSync } from 'node:zlib'
import { t, type MessageKey, type MessageParams } from '../i18n'

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  /** Offset of the local file header. */
  offset: number
  isDirectory: boolean
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_MIN = 22
const MAX_ENTRIES = 512
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const ZIP64_MARK = 0xffffffff

type ZipReason = Extract<MessageKey, `main.pets.zip.${string}`>

const invalid = (reason: ZipReason, params?: MessageParams): Error =>
  new Error(t('main.pets.zipInvalid', { reason: t(reason, params) }))

/** Parse the central directory. Throws for a non-zip / truncated / ZIP64 archive. */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_MIN) throw invalid('main.pets.zip.tooSmall')
  // The EOCD record sits at the very end, followed only by an optional comment (≤ 64 KiB).
  const floor = Math.max(0, buf.length - EOCD_MIN - 0xffff)
  let eocd = -1
  for (let i = buf.length - EOCD_MIN; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw invalid('main.pets.zip.noEndRecord')
  const count = buf.readUInt16LE(eocd + 10)
  const dirSize = buf.readUInt32LE(eocd + 12)
  const dirOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || dirSize === ZIP64_MARK || dirOffset === ZIP64_MARK) throw invalid('main.pets.zip.zip64')
  if (count > MAX_ENTRIES) throw invalid('main.pets.zip.tooManyEntries', { n: count })
  if (dirOffset + dirSize > buf.length) throw invalid('main.pets.zip.directoryOutOfRange')

  const entries: ZipEntry[] = []
  let p = dirOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw invalid('main.pets.zip.entryCorrupt')
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const offset = buf.readUInt32LE(p + 42)
    if (compressedSize === ZIP64_MARK || size === ZIP64_MARK || offset === ZIP64_MARK)
      throw invalid('main.pets.zip.zip64')
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.push({ name, method, compressedSize, size, offset, isDirectory: name.endsWith('/') })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Extract one entry (stored or deflated). */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.isDirectory) return Buffer.alloc(0)
  if (entry.size > MAX_ENTRY_BYTES) throw invalid('main.pets.zip.entryTooLarge', { name: entry.name })
  const h = entry.offset
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== SIG_LOCAL)
    throw invalid('main.pets.zip.headerCorrupt', { name: entry.name })
  const nameLen = buf.readUInt16LE(h + 26)
  const extraLen = buf.readUInt16LE(h + 28)
  const start = h + 30 + nameLen + extraLen
  const end = start + entry.compressedSize
  if (end > buf.length) throw invalid('main.pets.zip.entryOutOfRange', { name: entry.name })
  const raw = buf.subarray(start, end)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) {
    const out = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })
    if (out.length !== entry.size) throw invalid('main.pets.zip.sizeMismatch', { name: entry.name })
    return out
  }
  throw invalid('main.pets.zip.unsupportedMethod', { method: entry.method, name: entry.name })
}

/** Base name of an entry regardless of the folder it sits in inside the archive. */
export const zipBaseName = (entry: Pick<ZipEntry, 'name'>): string => entry.name.split('/').filter(Boolean).pop() ?? ''
