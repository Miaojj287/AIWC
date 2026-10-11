/**
 * Persistence for 我的微信 under `<dataRoot>/mobile`:
 *  - state.json: the remote-control switch, its permission mode and the phone's Agent thread (zod-checked; a bad
 *    file falls back to "off" rather than throwing);
 *  - sends.jsonl: the audit log of every message sent to the owner (kind, result, size — never the text);
 *  - the iLink login itself lives in the encrypted secret store (`mobile.ilink.session`), never in plain JSON.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  asThreadId,
  MobileRemoteModeSchema,
  type MobileRemoteSettings,
  type MobileSendRecord,
  type ThreadId,
} from '@aiwc/protocol'
import type { IlinkSessionStore, StoredIlinkSession } from '@aiwc/gateway'
import type { SecretStore } from '../config/secretStore'

export const MOBILE_SESSION_SECRET_REF = 'mobile.ilink.session'
/** Audit records kept on disk; older ones are dropped when the log is opened. */
const AUDIT_KEEP = 1000
const AUDIT_TRIM_AT = 2000

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void

const StateSchema = z.object({
  remote: z
    .object({ enabled: z.boolean().default(false), permissionMode: MobileRemoteModeSchema.default('ask') })
    .default({ enabled: false, permissionMode: 'ask' }),
  threadId: z.string().min(1).max(128).optional(),
})

export interface MobileStateStore {
  remote(): MobileRemoteSettings
  setRemote(next: MobileRemoteSettings): void
  threadId(): ThreadId | undefined
  setThreadId(id: ThreadId | undefined): void
}

export function createMobileStateStore(dir: string, log: Log): MobileStateStore {
  const file = join(dir, 'state.json')
  let state: z.infer<typeof StateSchema> = { remote: { enabled: false, permissionMode: 'ask' } }
  if (existsSync(file)) {
    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
      if (parsed.success) state = parsed.data
      else log('warn', 'mobile: state.json invalid; remote control stays off')
    } catch (err) {
      log('warn', 'mobile: state.json unreadable; remote control stays off', err)
    }
  }
  const persist = (): void => {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
  }
  return {
    remote: () => ({ ...state.remote }),
    setRemote(next) {
      state = { ...state, remote: { enabled: next.enabled, permissionMode: next.permissionMode } }
      persist()
    },
    threadId: () => (state.threadId ? asThreadId(state.threadId) : undefined),
    setThreadId(id) {
      state = { ...state, threadId: id }
      persist()
    },
  }
}

const RecordSchema = z.object({
  at: z.number(),
  kind: z.enum(['task', 'reply', 'approval', 'notice']),
  ok: z.boolean(),
  error: z.string().max(500).optional(),
  chars: z.number().int().min(0),
  taskId: z.string().max(128).optional(),
  threadId: z.string().max(128).optional(),
})

export interface MobileAudit {
  append(record: MobileSendRecord): void
  recent(limit: number): MobileSendRecord[]
}

export function createMobileAudit(dir: string, log: Log): MobileAudit {
  const file = join(dir, 'sends.jsonl')
  let records: MobileSendRecord[] = []
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = RecordSchema.safeParse(JSON.parse(line))
        if (parsed.success) records.push(parsed.data)
        else log('debug', 'mobile: skipped an invalid audit line')
      } catch {
        log('debug', 'mobile: skipped an unreadable audit line')
      }
    }
    if (records.length > AUDIT_TRIM_AT) {
      records = records.slice(-AUDIT_KEEP)
      writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    }
  }
  return {
    append(record) {
      records.push(record)
      if (records.length > AUDIT_TRIM_AT) records = records.slice(-AUDIT_KEEP)
      try {
        mkdirSync(dir, { recursive: true })
        appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')
      } catch (err) {
        log('warn', 'mobile: audit record not written', err)
      }
    },
    recent(limit) {
      return records.slice(-Math.max(1, limit)).reverse()
    },
  }
}

const SessionSchema = z.object({
  token: z.string().min(1),
  baseUrl: z.string().min(1),
  botId: z.string(),
  userId: z.string(),
  savedAt: z.string(),
  getUpdatesBuf: z.string().optional(),
})

/**
 * iLink login in the encrypted secret store. Without OS encryption the login is kept for this run only
 * (`persisted` = false) — a bot token is never written in plain text.
 */
export function createSecretIlinkSessionStore(
  secrets: SecretStore,
  log: Log,
): IlinkSessionStore & { readonly persisted: boolean } {
  let cached: StoredIlinkSession | undefined
  let loaded = false
  const write = (data: StoredIlinkSession | undefined): void => {
    cached = data
    if (!secrets.available()) return
    try {
      if (data) secrets.set(MOBILE_SESSION_SECRET_REF, JSON.stringify(data))
      else secrets.delete(MOBILE_SESSION_SECRET_REF)
    } catch (err) {
      log('warn', 'mobile: login not persisted', err)
    }
  }
  return {
    path: `secret:${MOBILE_SESSION_SECRET_REF}`,
    get persisted() {
      return secrets.available()
    },
    load() {
      if (cached || loaded) return cached
      loaded = true
      const raw = secrets.reveal(MOBILE_SESSION_SECRET_REF)
      if (!raw) return undefined
      try {
        const parsed = SessionSchema.safeParse(JSON.parse(raw))
        if (parsed.success) cached = parsed.data
        else log('warn', 'mobile: stored login invalid; a new QR login is needed')
      } catch {
        log('warn', 'mobile: stored login unreadable; a new QR login is needed')
      }
      return cached
    },
    save(session, extra) {
      write({
        token: session.token,
        baseUrl: session.baseUrl,
        botId: session.botId,
        userId: session.userId,
        savedAt: new Date().toISOString(),
        getUpdatesBuf: extra?.getUpdatesBuf ?? cached?.getUpdatesBuf,
      })
    },
    saveCursor(getUpdatesBuf) {
      const current = cached ?? this.load()
      if (!current || current.getUpdatesBuf === getUpdatesBuf) return
      write({ ...current, getUpdatesBuf })
    },
    clear() {
      loaded = true
      write(undefined)
    },
  }
}
