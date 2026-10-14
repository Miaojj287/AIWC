import { readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { findSessionDbCandidates } from '../wcdb/dbFiles'

const MAX_DATABASES = 128
const MAX_DEPTH = 5

/** Database files in this account only, with sessions first and no symlink traversal. */
export function credentialDatabaseFiles(storage: string): string[] {
  const root = realpathSync(storage)
  const paths: string[] = []
  const visit = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH) return
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) visit(path, depth + 1)
      else if (item.isFile() && item.name.endsWith('.db')) {
        const inside = relative(root, realpathSync(path))
        if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('../')) paths.push(path)
      }
      if (paths.length > MAX_DATABASES) throw new Error('WECHAT_TOO_MANY_DATABASES')
    }
  }
  visit(root, 0)
  const sessions = findSessionDbCandidates(root).filter((path) => paths.includes(path))
  return [...sessions, ...paths.filter((path) => !sessions.includes(path)).sort()]
}
