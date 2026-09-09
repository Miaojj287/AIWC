/** Collect the 16-byte SQLCipher salts of every encrypted .db under an account (for key matching). */
import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { readEncryptedDbSalt } from './sqlcipherPage'

export function collectEncryptedDbSalts(dbStoragePath: string, maxFiles = 2000): Set<string> {
  const salts = new Set<string>()
  let visited = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || visited >= maxFiles) return
    let entries: Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= maxFiles) break
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.db')) continue
      visited += 1
      try {
        if (statSync(full).size < 4096) continue
      } catch {
        continue
      }
      const salt = readEncryptedDbSalt(full)
      if (salt) salts.add(salt)
    }
  }
  walk(dbStoragePath, 0)
  return salts
}
