/**
 * Image XOR / AES key derivation.
 *  - XOR key: the most common tail-byte pair across `_t.dat` template files (V2), validated by the
 *    invariant x = tail[-2]^0xFF must equal tail[-1]^0xD9.
 *  - Ciphertext sample: bytes 0x0f..0x1f of a V2 template (the first encrypted block).
 *  - AES key: derived from WeChat's kvcomm "codes" as md5(code + wxid)[:16], verified by decrypting
 *    the sample. When derivation fails the caller falls back to a memory scan.
 * All of this is pure fs + crypto; the memory scan is injected by acquireKeys.
 */
import { createHash } from 'node:crypto'
import { createDecipheriv } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { cleanAccountDirName } from '../wcdb/accountUtils'

const V2_SIGNATURE = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])

export interface TemplateScan {
  ciphertext: Buffer | null
  xorKey: number | null
  templateCount: number
}

function collectTemplateFiles(root: string, limit: number): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (files.length >= limit) return
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= limit) break
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('_t.dat')) files.push(full)
    }
  }
  if (existsSync(root)) walk(root)
  files.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  })
  return files
}

/** Compute XOR key + a ciphertext sample from `_t.dat` template files under an account dir. */
export function scanImageTemplates(accountDir: string, limit = 32): TemplateScan {
  const files = collectTemplateFiles(accountDir, limit)
  let ciphertext: Buffer | null = null
  const tailCounts = new Map<string, number>()
  let templateCount = 0
  for (const file of files.slice(0, limit)) {
    let data: Buffer
    try {
      data = readFileSync(file)
    } catch {
      continue
    }
    if (data.length < 8 || !data.subarray(0, 6).equals(V2_SIGNATURE)) continue
    templateCount += 1
    if (data.length >= 0x1f && !ciphertext) ciphertext = data.subarray(0x0f, 0x1f)
    const key = `${data[data.length - 2]}_${data[data.length - 1]}`
    tailCounts.set(key, (tailCounts.get(key) ?? 0) + 1)
  }
  let xorKey: number | null = null
  let maxCount = 0
  for (const [key, count] of tailCounts) {
    if (count <= maxCount) continue
    const [xStr, yStr] = key.split('_')
    const x = Number(xStr)
    const y = Number(yStr)
    const candidate = x ^ 0xff
    if (candidate === (y ^ 0xd9)) {
      maxCount = count
      xorKey = candidate
    }
  }
  return { ciphertext, xorKey, templateCount }
}

/** True when `aesKey` (16 ASCII bytes) decrypts the ciphertext sample to a known image header. */
export function verifyImageAesKey(aesKey: Buffer, ciphertext: Buffer): boolean {
  if (aesKey.length < 16 || ciphertext.length !== 16) return false
  try {
    const decipher = createDecipheriv('aes-128-ecb', aesKey.subarray(0, 16), null)
    decipher.setAutoPadding(false)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return (
      (plain[0] === 0xff && plain[1] === 0xd8 && plain[2] === 0xff) ||
      (plain[0] === 0x89 && plain[1] === 0x50 && plain[2] === 0x4e && plain[3] === 0x47) ||
      plain.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) ||
      plain.subarray(0, 4).equals(Buffer.from('wxgf', 'ascii')) ||
      plain.subarray(0, 3).equals(Buffer.from('GIF', 'ascii'))
    )
  } catch {
    return false
  }
}

/** kvcomm image key = md5(`${code}${cleanedWxid}`)[:16]; XOR key = code & 0xFF. */
export function deriveImageKeys(code: number, wxid: string): { xorKey: number; aesKey: string } {
  const cleaned = cleanAccountDirName(wxid)
  return { xorKey: code & 0xff, aesKey: createHash('md5').update(`${code}${cleaned}`).digest('hex').slice(0, 16) }
}

function kvcommDirs(accountDir: string): string[] {
  const dirs = new Set<string>()
  if (process.platform === 'darwin') {
    const home = homedir()
    const container = join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data')
    dirs.add(join(container, 'Documents', 'app_data', 'net', 'kvcomm'))
    dirs.add(join(container, 'Library', 'Application Support', 'com.tencent.xinWeChat', 'net', 'kvcomm'))
  } else if (process.platform === 'win32' && process.env.APPDATA) {
    const root = join(process.env.APPDATA, 'Tencent', 'xwechat')
    if (existsSync(root)) {
      for (const entry of safeDirs(root)) {
        if (/^net(?:_\d+)?$/i.test(entry)) dirs.add(join(root, entry, 'kvcomm'))
      }
    }
  }
  // Walk up from the account dir looking for net/kvcomm siblings.
  let cursor = accountDir
  for (let i = 0; i < 6; i += 1) {
    dirs.add(join(cursor, 'net', 'kvcomm'))
    const next = dirname(cursor)
    if (next === cursor) break
    cursor = next
  }
  return Array.from(dirs)
}

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/** Collect kvcomm "codes" from `key_<code>_*.statistic` files. */
export function collectKvcommCodes(accountDir: string): number[] {
  const codes = new Set<number>()
  const pattern = /^key_(\d+)_.+\.statistic$/i
  for (const dir of kvcommDirs(accountDir)) {
    if (!existsSync(dir)) continue
    try {
      for (const file of readdirSync(dir)) {
        const match = pattern.exec(file)
        if (!match) continue
        const code = Number(match[1])
        if (Number.isFinite(code) && code > 0 && code <= 0xffff_ffff) codes.add(code)
      }
    } catch {
      // unreadable kvcomm dir
    }
  }
  return Array.from(codes)
}

export interface ImageKeyResult {
  xorHex?: string
  aesHex?: string
  error?: string
}

export type ImageAesMemoryScan = (ciphertext: Buffer) => Promise<string | null>

/**
 * Resolve image keys for an account. XOR always comes from templates; AES tries kvcomm derivation
 * first, then (when a memory scan is supplied) the process memory.
 */
export async function resolveImageKeys(
  accountDir: string,
  wxidCandidates: readonly string[],
  memoryScan?: ImageAesMemoryScan,
): Promise<ImageKeyResult> {
  const template = scanImageTemplates(accountDir)
  if (template.xorKey === null) {
    const wider = scanImageTemplates(accountDir, 128)
    if (wider.xorKey !== null) {
      template.xorKey = wider.xorKey
      template.ciphertext = template.ciphertext ?? wider.ciphertext
    }
  }
  if (template.xorKey === null) return { error: '未找到图片模板文件，无法计算 XOR 密钥（请在微信中打开几张图片后重试）' }
  const xorHex = template.xorKey.toString(16).padStart(2, '0')
  if (!template.ciphertext) return { xorHex } // no V2 template → XOR only

  for (const code of collectKvcommCodes(accountDir)) {
    for (const wxid of wxidCandidates) {
      const { aesKey } = deriveImageKeys(code, wxid)
      if (verifyImageAesKey(Buffer.from(aesKey, 'ascii'), template.ciphertext)) {
        return { xorHex, aesHex: Buffer.from(aesKey, 'ascii').toString('hex') }
      }
    }
  }

  if (memoryScan) {
    const aesAscii = await memoryScan(template.ciphertext)
    if (aesAscii && verifyImageAesKey(Buffer.from(aesAscii.slice(0, 16), 'ascii'), template.ciphertext)) {
      return { xorHex, aesHex: Buffer.from(aesAscii.slice(0, 16), 'ascii').toString('hex') }
    }
  }
  return { xorHex, error: '未能获取图片 AES 密钥' }
}
