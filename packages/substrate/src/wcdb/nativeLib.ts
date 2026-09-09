/**
 * Locates the bundled native artifacts under `resources/native/<platform>-<arch>/`.
 * Importing this module never loads koffi or any native code.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class NativeMissingError extends Error {
  readonly code = 'NATIVE_MISSING' as const
  readonly searched: string[]
  constructor(what: string, searched: string[]) {
    super(`缺少原生组件 ${what}（当前平台 ${process.platform}-${process.arch}）。已查找：${searched.join('；')}`)
    this.name = 'NativeMissingError'
    this.searched = searched
  }
}

export function platformArchDir(): string {
  return `${process.platform}-${process.arch}`
}

/** WCDB bridge library name per platform. */
export function wcdbLibraryName(): string {
  if (process.platform === 'win32') return 'wcdb_open.dll'
  if (process.platform === 'darwin') return 'libWCDBOpen.dylib'
  return 'libWCDBOpen.so'
}

/** Candidates: env override → nativeDir/<platform-arch>/lib → nativeDir/lib. */
export function wcdbLibraryCandidates(nativeDir: string): string[] {
  const list: string[] = []
  const override = String(process.env.AIWC_WCDB_LIBRARY || '').trim()
  if (override) list.push(override)
  const name = wcdbLibraryName()
  list.push(join(nativeDir, platformArchDir(), name), join(nativeDir, name))
  return Array.from(new Set(list))
}

export function resolveWcdbLibrary(nativeDir: string): string {
  const candidates = wcdbLibraryCandidates(nativeDir)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new NativeMissingError(wcdbLibraryName(), candidates)
  return found
}

/** Optional helper binaries; return null instead of throwing (callers degrade gracefully). */
export function resolveOptionalNative(nativeDir: string, fileName: string, envOverride?: string): string | null {
  const override = envOverride ? String(process.env[envOverride] || '').trim() : ''
  if (override && existsSync(override)) return override
  for (const candidate of [join(nativeDir, platformArchDir(), fileName), join(nativeDir, fileName)]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
