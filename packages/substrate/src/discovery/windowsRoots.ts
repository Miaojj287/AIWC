import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join, win32 } from 'node:path'

const MAX_METADATA_BYTES = 4096
const OPTIONAL_FILE_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EBUSY', 'EIO'])

/** Accept only bounded UTF-8 metadata naming an absolute local Windows directory. */
export function parseWindowsRootMetadata(bytes: Uint8Array): string | undefined {
  if (!bytes.length || bytes.length > MAX_METADATA_BYTES) return undefined
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Invalid optional metadata cannot supply a trustworthy filesystem candidate.
    return undefined
  }
  if (!/^[A-Za-z]:[\\/]/.test(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return undefined
  if (/[<>:"|?*]/.test(value.slice(2))) return undefined
  const components = value.slice(3).split(/[\\/]/)
  if (components.some((part) => part === '.' || part === '..' || /[ .]$/.test(part))) return undefined
  const normalized = win32.normalize(value)
  return normalized === win32.parse(normalized).root ? normalized : normalized.replace(/[\\/]+$/, '')
}

function readConfiguredRoot(appData: string): string | undefined {
  const path = join(appData, 'Tencent', 'WeChat', 'All Users', 'config', '3ebffe94.ini')
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size <= 0 || before.size > MAX_METADATA_BYTES) return undefined
    const bytes = Buffer.alloc(MAX_METADATA_BYTES)
    const count = readSync(descriptor, bytes, 0, bytes.length, 0)
    const after = fstatSync(descriptor)
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return undefined
    return parseWindowsRootMetadata(bytes.subarray(0, count))
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (typeof code !== 'string' || !OPTIONAL_FILE_CODES.has(code)) throw error
    // Missing or inaccessible optional metadata is harmless; document-directory discovery still runs.
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** Weixin 4.1.15.53 observed metadata supplies candidates only; account-tree scoring stays authoritative. */
export function windowsConfiguredRootCandidates(appData?: string): string[] {
  if (!appData) return []
  const configured = readConfiguredRoot(appData)
  if (!configured) return []
  return [
    ...new Set([
      configured,
      win32.join(configured, 'xwechat_files'),
      win32.join(configured, 'WeChat Files'),
      win32.join(win32.dirname(configured), 'xwechat_files'),
    ]),
  ]
}
