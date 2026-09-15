import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { detectImageExtension, isWxgf } from './datDecryptCore'

const execFileAsync = promisify(execFile)

/** WXGF partitions carry a big-endian byte length immediately before the Annex-B start code. */
export function wxgfPartitions(data: Buffer): Buffer[] {
  if (!isWxgf(data) || data.length < 15) return []
  for (const startCode of [Buffer.from([0, 0, 0, 1]), Buffer.from([0, 0, 1])]) {
    const parts: Buffer[] = []
    let offset = Math.max(5, data[4] ?? 0)
    while (offset + startCode.length + 2 < data.length) {
      const start = data.indexOf(startCode, offset)
      if (start < 0) break
      const length = data.readUInt32BE(start - 4)
      const nal = start + startCode.length
      // Ignore start-code-shaped container metadata (temporal_id_plus1 cannot be zero).
      if (
        length >= startCode.length + 2 &&
        length <= data.length - start &&
        (data[nal]! & 0x80) === 0 &&
        (data[nal + 1]! & 7) !== 0
      ) {
        parts.push(data.subarray(start, start + length))
        offset = start + length
      } else offset = start + 1
    }
    if (parts.length) return parts
  }
  return []
}

function ffmpegPath(nativeDir: string): string {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return (
    [
      process.env.AIWC_FFMPEG_PATH,
      join(nativeDir, `${process.platform}-${process.arch}`, name),
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
    ].find((path): path is string => Boolean(path && existsSync(path))) ?? name
  )
}

/** A failed/missing converter leaves the caller free to use the local PNG/JPEG thumbnail. */
let active = 0
const waiting: Array<() => void> = []
export async function convertWxgf(data: Buffer, nativeDir: string): Promise<Buffer | undefined> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
  try {
    return await convert(data, nativeDir)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

async function convert(data: Buffer, nativeDir: string): Promise<Buffer | undefined> {
  const parts = wxgfPartitions(data)
  if (!parts.length) return undefined
  const dir = await mkdtemp(join(tmpdir(), 'aiwc-sticker-'))
  try {
    const input = join(dir, 'color.hevc')
    const output = join(dir, 'output.gif')
    const largest = parts.reduce((a, b) => (a.length > b.length ? a : b))
    const animated = parts.length > 1 && largest.length / data.length < 0.6
    const hasParameters = (part: Buffer) => part.includes(Buffer.from([0, 0, 1, 0x40, 1]))
    const hasMask = animated && parts.length % 2 === 0 && hasParameters(parts[1]!)
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-f', 'hevc', '-i', input]
    if (hasMask) {
      const mask = join(dir, 'mask.hevc')
      await writeFile(input, Buffer.concat(parts.filter((_, i) => i % 2 === 1)))
      await writeFile(mask, Buffer.concat(parts.filter((_, i) => i % 2 === 0)))
      args.push(
        '-threads',
        '1',
        '-f',
        'hevc',
        '-i',
        mask,
        '-filter_complex_threads',
        '1',
        '-filter_complex',
        '[0:v][1:v]alphamerge,split[a][b];[a]palettegen[p];[b][p]paletteuse',
      )
    } else {
      await writeFile(input, animated ? Buffer.concat(parts) : largest)
      if (!animated) args.push('-frames:v', '1')
      else args.push('-filter_complex_threads', '1', '-filter_complex', 'split[a][b];[a]palettegen[p];[b][p]paletteuse')
    }
    args.push('-t', '30', '-fs', '16777216', '-y', output)
    await execFileAsync(ffmpegPath(nativeDir), args, { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true })
    const converted = await readFile(output)
    return detectImageExtension(converted) === '.gif' && converted.at(-1) === 0x3b ? converted : undefined
  } catch {
    return undefined
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
