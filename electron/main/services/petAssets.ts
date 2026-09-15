/**
 * Sprite-sheet inspection without an image decoder: read the pixel size from the PNG / WebP header
 * and map it onto a Codex Pets sheet version. Pure (Buffer in, numbers out) so it is unit-testable and
 * safe to run on untrusted downloads / zip contents before anything is written to disk.
 */
import { PET_SHEET_HEIGHT, PET_SHEET_WIDTH, type PetSpriteVersion } from '@aiwc/protocol'
import { t } from '../i18n'

export interface ImageSize {
  width: number
  height: number
  format: 'png' | 'webp'
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPng(buf: Buffer): ImageSize | undefined {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
}

function readWebp(buf: Buffer): ImageSize | undefined {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP')
    return undefined
  const chunk = buf.toString('latin1', 12, 16)
  if (chunk === 'VP8X') {
    // extended format: canvas size is stored as (width - 1) / (height - 1) in 24-bit little-endian
    const width = buf.readUIntLE(24, 3) + 1
    const height = buf.readUIntLE(27, 3) + 1
    return { width, height, format: 'webp' }
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return undefined
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, format: 'webp' }
  }
  if (chunk === 'VP8 ') {
    // lossy: 3-byte frame tag, then the 9d 01 2a start code, then 14-bit width / height
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return undefined
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' }
  }
  return undefined
}

/** Pixel size of a PNG or WebP file; undefined for anything else (or a truncated header). */
export function readImageSize(buf: Buffer): ImageSize | undefined {
  return readPng(buf) ?? readWebp(buf)
}

/** Which Codex Pets sheet layout the image is — undefined when it is not a valid sheet. */
export function spriteVersionForSize(size: Pick<ImageSize, 'width' | 'height'>): PetSpriteVersion | undefined {
  if (size.width !== PET_SHEET_WIDTH) return undefined
  if (size.height === PET_SHEET_HEIGHT[1]) return 1
  if (size.height === PET_SHEET_HEIGHT[2]) return 2
  return undefined
}

/**
 * Validate a downloaded / unzipped sheet. Returns the version; throws a user-facing message for a
 * non-image, a wrong size, or a mismatch with the manifest's `spriteVersionNumber`.
 */
export function inspectSpriteSheet(
  buf: Buffer,
  declaredVersion?: number,
): { version: PetSpriteVersion; size: ImageSize } {
  const size = readImageSize(buf)
  if (!size) throw new Error(t('main.pets.sheetNotImage'))
  const version = spriteVersionForSize(size)
  if (!version)
    throw new Error(
      t('main.pets.sheetWrongSize', {
        width: PET_SHEET_WIDTH,
        v1Height: PET_SHEET_HEIGHT[1],
        v2Height: PET_SHEET_HEIGHT[2],
        actualWidth: size.width,
        actualHeight: size.height,
      }),
    )
  if (declaredVersion !== undefined && declaredVersion !== version) {
    throw new Error(
      t('main.pets.sheetVersionMismatch', {
        declared: declaredVersion,
        actual: version,
        actualWidth: size.width,
        actualHeight: size.height,
      }),
    )
  }
  return { version, size }
}
