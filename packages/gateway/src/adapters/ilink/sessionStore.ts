/**
 * Persistence for the iLink bot session: token + base url + ids + the long-poll cursor
 * (get_updates_buf), stored as JSON under stateDir/ilink-session.json.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ILINK_BASE_URL, type IlinkSession } from './protocol'

export const ILINK_SESSION_FILE = 'ilink-session.json'

export interface StoredIlinkSession extends IlinkSession {
  savedAt: string
  getUpdatesBuf?: string
}

export interface IlinkSessionStore {
  readonly path: string
  load(): StoredIlinkSession | undefined
  save(session: IlinkSession, extra?: { getUpdatesBuf?: string }): void
  saveCursor(getUpdatesBuf: string): void
  clear(): void
}

export function createIlinkSessionStore(stateDir: string, options: { persist?: boolean } = {}): IlinkSessionStore {
  const path = join(stateDir, ILINK_SESSION_FILE)
  const persist = options.persist !== false
  let cached: StoredIlinkSession | undefined

  if (!persist) {
    // Clean up a token cached by older builds. This adapter is intentionally session-only now.
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      /* best effort */
    }
  }

  const write = (data: StoredIlinkSession): void => {
    cached = data
    if (!persist) return
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, path)
  }

  return {
    path,
    load() {
      if (cached) return cached
      if (!persist) return undefined
      try {
        if (!existsSync(path)) return undefined
        const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredIlinkSession>
        if (!data || typeof data.token !== 'string' || !data.token) return undefined
        cached = {
          token: data.token,
          baseUrl: typeof data.baseUrl === 'string' && data.baseUrl ? data.baseUrl : ILINK_BASE_URL,
          botId: typeof data.botId === 'string' ? data.botId : '',
          userId: typeof data.userId === 'string' ? data.userId : '',
          savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date(0).toISOString(),
          getUpdatesBuf: typeof data.getUpdatesBuf === 'string' ? data.getUpdatesBuf : undefined,
        }
        return cached
      } catch {
        return undefined
      }
    },
    save(session, extra) {
      write({ ...session, savedAt: new Date().toISOString(), getUpdatesBuf: extra?.getUpdatesBuf ?? cached?.getUpdatesBuf })
    },
    saveCursor(getUpdatesBuf) {
      const current = cached ?? this.load()
      if (!current) return
      if (current.getUpdatesBuf === getUpdatesBuf) return
      write({ ...current, getUpdatesBuf })
    },
    clear() {
      cached = undefined
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        /* best effort */
      }
    },
  }
}
