/**
 * decryptImageDat({ src, dst, xorKey?, aesKey? }) — decrypt one `.dat` into `dst`.
 * `dst` may omit the extension: the sniffed image extension is appended and the final path returned.
 * Native addon first (when `nativeDir` is given and the file is a V4/wxgf), pure TS otherwise.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { decryptDatBuffer, getDatVersion, normalizeAesKey, normalizeXorKey, stripTrailingNulBytes } from './datDecryptCore'
import { decryptDatViaNative } from './nativeImageDecrypt'

export interface DecryptImageDatOptions {
  src: string
  dst: string
  /** 0-255, "73" / "0x73" hex, or decimal string */
  xorKey?: number | string
  /** 16 ASCII chars or 32 hex chars */
  aesKey?: string
  /** resources/native root; enables the native addon when present */
  nativeDir?: string
}

export interface DecryptImageDatResult {
  path: string
  ext: string
  bytes: number
  source: 'native' | 'ts'
  /** true when the payload is WeChat's wxgf container (needs the native converter to become a viewable image) */
  wxgf: boolean
}

const KNOWN_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.wxgf'])

function finalPath(dst: string, ext: string): string {
  const current = extname(dst).toLowerCase()
  if (current && KNOWN_IMAGE_EXT.has(current)) return dst
  if (current === '.dat' || current === '.bin' || current === '.tmp') return dst.slice(0, -current.length) + ext
  return dst + ext
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export async function decryptImageDat(opts: DecryptImageDatOptions): Promise<DecryptImageDatResult> {
  const xorKey = opts.xorKey === undefined ? undefined : normalizeXorKey(opts.xorKey)
  const aesKey = opts.aesKey ? normalizeAesKey(opts.aesKey) : undefined
  const bytes = await readFile(opts.src)
  const version = getDatVersion(bytes)

  if (opts.nativeDir && xorKey !== undefined) {
    const aesAscii = aesKey ? aesKey.toString('latin1') : undefined
    const native = decryptDatViaNative(opts.nativeDir, opts.src, xorKey, version === 2 ? aesAscii : undefined)
    if (native) {
      const ext = native.ext || (native.isWxgf ? '.wxgf' : '.jpg')
      const path = finalPath(opts.dst, ext)
      await writeAtomic(path, native.data)
      return { path, ext, bytes: native.data.length, source: 'native', wxgf: native.isWxgf && ext === '.wxgf' }
    }
  }

  const output = decryptDatBuffer(bytes, { xorKey: xorKey ?? null, aesKey: aesKey ?? null })
  const data = output.version === 0 ? stripTrailingNulBytes(output.data) : output.data
  const ext = output.wxgf && !output.ext ? '.wxgf' : output.ext ?? '.jpg'
  const path = finalPath(opts.dst, ext)
  await writeAtomic(path, data)
  return { path, ext, bytes: data.length, source: 'ts', wxgf: ext === '.wxgf' }
}
