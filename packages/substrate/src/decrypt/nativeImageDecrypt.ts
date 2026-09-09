/**
 * Optional native accelerator (`aiwc-image-native-<macos|win32>-<arch>.node`, Rust). Handles the
 * `wxgf` container that pure TS cannot convert. Loaded lazily with createRequire; any failure → null
 * and callers fall back to the TypeScript path.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const requireNative = createRequire(import.meta.url)

export interface NativeDecryptResult {
  data: Buffer
  ext: string
  isWxgf: boolean
}

interface NativeAddon {
  decryptDatNative: (inputPath: string, xorKey: number, aesKey?: string) => { data: Buffer; ext?: string; isWxgf?: boolean; is_wxgf?: boolean }
}

let cached: { dir: string; addon: NativeAddon | null } | undefined

function platformLabel(): string {
  if (process.platform === 'darwin') return 'macos'
  return process.platform
}

export function nativeImageAddonCandidates(nativeDir: string): string[] {
  const fileName = `aiwc-image-native-${platformLabel()}-${process.arch}.node`
  const override = String(process.env.AIWC_IMAGE_NATIVE_PATH || '').trim()
  const list = [join(nativeDir, `${process.platform}-${process.arch}`, fileName), join(nativeDir, fileName)]
  if (override) list.unshift(override)
  return Array.from(new Set(list))
}

export function nativeImageDecryptEnabled(): boolean {
  return process.env.AIWC_IMAGE_NATIVE !== '0'
}

export function loadNativeImageAddon(nativeDir: string): NativeAddon | null {
  if (!nativeImageDecryptEnabled()) return null
  if (cached && cached.dir === nativeDir) return cached.addon
  let addon: NativeAddon | null = null
  for (const candidate of nativeImageAddonCandidates(nativeDir)) {
    if (!existsSync(candidate)) continue
    try {
      const loaded = requireNative(candidate) as Partial<NativeAddon>
      if (loaded && typeof loaded.decryptDatNative === 'function') {
        addon = loaded as NativeAddon
        break
      }
    } catch {
      // try the next candidate; the TS path remains available
    }
  }
  cached = { dir: nativeDir, addon }
  return addon
}

/** Returns null when the addon is unavailable or fails, so callers can fall back. */
export function decryptDatViaNative(nativeDir: string, inputPath: string, xorKey: number, aesKeyAscii?: string): NativeDecryptResult | null {
  const addon = loadNativeImageAddon(nativeDir)
  if (!addon) return null
  try {
    const result = addon.decryptDatNative(inputPath, xorKey, aesKeyAscii)
    if (!result || !Buffer.isBuffer(result.data) || result.data.length === 0) return null
    const rawExt = typeof result.ext === 'string' ? result.ext.trim().toLowerCase() : ''
    const ext = rawExt ? (rawExt.startsWith('.') ? rawExt : `.${rawExt}`) : ''
    return { data: result.data, ext, isWxgf: Boolean(result.isWxgf ?? result.is_wxgf) }
  } catch {
    return null
  }
}

/** Test hook. */
export function resetNativeImageAddonCache(): void {
  cached = undefined
}
