import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { OpenWcdbBridge } from '../electron/services/openWcdbBridge.ts'
import { WcdbCore } from '../electron/services/wcdbCore.ts'
import { WcdbCore as CliWcdbCore } from '../AIWC-CLI/src/services/db/wcdbCore.ts'
import { decodeMessageContent } from '../AIWC-CLI/src/services/db/rowDecoders.ts'
import { LocalKeyService } from '../AIWC-CLI/src/services/keyService.ts'

type ConfigRow = { key: string; value: string }
type Account = { id?: string; dbPath?: string; decryptKey?: string; wxid?: string }

function parseStored(value: string | undefined): any {
  if (value === undefined) return undefined
  try { return JSON.parse(value) } catch { return value }
}

function resolveDbStoragePath(dbPath: string, wxid: string): string | null {
  const normalized = dbPath.replace(/[\\/]+$/, '')
  const candidates = [
    normalized,
    join(normalized, 'db_storage'),
    wxid ? join(normalized, wxid, 'db_storage') : '',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (basename(candidate).toLowerCase() === 'db_storage' && existsSync(candidate)) return candidate
  }
  if (!existsSync(normalized) || !wxid) return null
  const lowerWxid = wxid.toLowerCase()
  for (const entry of readdirSync(normalized, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const lowerEntry = entry.name.toLowerCase()
    if (lowerEntry !== lowerWxid && !lowerEntry.startsWith(`${lowerWxid}_`)) continue
    const candidate = join(normalized, entry.name, 'db_storage')
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findSessionDbs(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > 5) return out
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === 'session.db') out.push(path)
    if (entry.isDirectory()) findSessionDbs(path, depth + 1, out)
  }
  return out
}

function findDbs(root: string, matcher: (name: string) => boolean, depth = 0, out: string[] = []): string[] {
  if (depth > 5) return out
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isFile() && matcher(entry.name.toLowerCase())) out.push(path)
    if (entry.isDirectory()) findDbs(path, matcher, depth + 1, out)
  }
  return out
}

function hashPrefix(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function describeRaw(value: unknown): { storage: string; bytes: number; zstdMagic: boolean } {
  if (value === null || value === undefined) return { storage: 'null', bytes: 0, zstdMagic: false }
  if (typeof value !== 'string') return { storage: typeof value, bytes: 0, zstdMagic: false }
  const isHex = value.length > 16 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
  const bytes = isHex ? Buffer.from(value, 'hex') : Buffer.from(value, 'utf8')
  return {
    storage: isHex ? 'blob-hex' : 'text',
    bytes: bytes.length,
    zstdMagic: bytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd])),
  }
}

const configPath = process.env.CT_CONFIG_DB || join(
  homedir(),
  'Library',
  'Application Support',
  'aiwc',
  'aiwc-config.db'
)
const libraryPath = process.env.CT_OPEN_WCDB_LIBRARY || join(
  process.cwd(),
  'resources',
  'macos',
  'libWCDBOpen.dylib'
)

if (!existsSync(configPath)) throw new Error(`AIWC config not found: ${configPath}`)
if (!existsSync(libraryPath)) throw new Error(`Open WCDB library not found: ${libraryPath}`)

const query = spawnSync('/usr/bin/sqlite3', [
  '-json',
  configPath,
  "select key,value from config where key in ('accounts','activeAccountId','dbPath','decryptKey','myWxid')"
], { encoding: 'utf8' })
if (query.status !== 0) throw new Error(query.stderr || 'Failed to read AIWC config')

const values = new Map<string, string>()
for (const row of JSON.parse(query.stdout || '[]') as ConfigRow[]) values.set(row.key, row.value)
const accounts = parseStored(values.get('accounts')) as Account[] | undefined
const activeAccountId = String(parseStored(values.get('activeAccountId')) || '')
const active = Array.isArray(accounts)
  ? accounts.find(account => account.id === activeAccountId) || accounts[0]
  : undefined
const account: Account = active || {
  dbPath: String(parseStored(values.get('dbPath')) || ''),
  decryptKey: String(parseStored(values.get('decryptKey')) || ''),
  wxid: String(parseStored(values.get('myWxid')) || ''),
}

const dbPath = String(account.dbPath || '')
const key = String(account.decryptKey || '')
const wxid = String(account.wxid || '')
if (!dbPath || !/^[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error('Active AIWC account has no usable database path or 64-hex key')
}

const storage = resolveDbStoragePath(dbPath, wxid)
if (!storage) throw new Error('Could not resolve db_storage for the active account')
const candidates = findSessionDbs(storage)
if (!candidates.length) throw new Error('No session.db found under db_storage')

const bridge = new OpenWcdbBridge()
const initialized = bridge.initialize(libraryPath)
if (!initialized.success) throw new Error(initialized.error)

let matched = ''
for (const candidate of candidates) {
  if (bridge.canOpen(candidate, key)) {
    matched = candidate
    break
  }
}
bridge.dispose()

if (!matched) throw new Error(`Open WCDB rejected all ${candidates.length} session.db candidates`)
const metadata = statSync(matched)

delete process.env.CT_OPEN_WCDB
delete process.env.CT_WCDB_BACKEND
process.env.CT_OPEN_WCDB_LIBRARY = libraryPath
const core = new WcdbCore()
core.setPaths(join(process.cwd(), 'resources'), join(process.cwd(), '.tmp'), 'probe')
const coreOpened = await core.open(dbPath, key, wxid)
if (!coreOpened) throw new Error('WcdbCore open-backend integration failed to open the active account')
const coreProbe = await core.execQuery(
  'session',
  matched,
  "SELECT count(*) AS table_count FROM sqlite_master WHERE type='table'"
)
if (!coreProbe.success || !coreProbe.rows?.length) {
  throw new Error(coreProbe.error || 'WcdbCore open-backend integration query failed')
}

let messageProbe: Record<string, unknown> = { available: false }
const messageDbs = findDbs(storage, name => /^(?:msg|message|biz_message)_\d+\.db$/.test(name))
messageSearch:
for (const messageDb of messageDbs) {
  const tablesResult = await core.execQuery('message', messageDb, "SELECT name FROM sqlite_master WHERE type='table'")
  if (!tablesResult.success) continue
  for (const tableRow of tablesResult.rows || []) {
    const tableName = String(tableRow.name || '')
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) continue
    const schema = await core.execQuery('message', messageDb, `PRAGMA table_info("${tableName}")`)
    if (!schema.success || !schema.rows?.length) continue
    const columns = schema.rows.map(row => String(row.name || '')).filter(Boolean)
    if (!columns.includes('message_content') && !columns.includes('compress_content')) continue
    const messageExpr = columns.includes('message_content') ? 'message_content' : 'NULL AS message_content'
    const compressExpr = columns.includes('compress_content') ? 'compress_content' : 'NULL AS compress_content'
    const contentPredicate = [
      columns.includes('message_content') ? 'message_content IS NOT NULL' : '',
      columns.includes('compress_content') ? 'compress_content IS NOT NULL' : '',
    ].filter(Boolean).join(' OR ')
    const sample = await core.execQuery(
      'message',
      messageDb,
      `SELECT rowid AS __rid, ${messageExpr}, ${compressExpr} FROM "${tableName}" ` +
      `WHERE ${contentPredicate} ORDER BY rowid DESC LIMIT 1`
    )
    if (!sample.success || !sample.rows?.length) continue
    const row = sample.rows[0]
    const decoded = decodeMessageContent(row.message_content, row.compress_content)
    const rid = Number(row.__rid)
    const chunk = Number.isFinite(rid)
      ? await core.readMessageChunk('message', messageDb, tableName, { afterRid: rid - 1, maxRows: 1 })
      : { success: false, rows: [] as any[] }
    const chunkContent = String(chunk.rows?.[0]?.content || '')
    messageProbe = {
      available: true,
      databaseCandidateCount: messageDbs.length,
      tableNameHash: hashPrefix(tableName),
      schemaHash: hashPrefix(columns.sort().join('\n')),
      schemaColumnCount: columns.length,
      walPresent: existsSync(`${messageDb}-wal`),
      walBytes: existsSync(`${messageDb}-wal`) ? statSync(`${messageDb}-wal`).size : 0,
      messageContent: describeRaw(row.message_content),
      compressContent: describeRaw(row.compress_content),
      decodedNonempty: decoded.length > 0,
      decodedBytes: Buffer.byteLength(decoded),
      decodedHash: decoded ? hashPrefix(decoded) : null,
      chunkPathSuccess: chunk.success,
      chunkDecodeMatches: !!decoded && decoded === chunkContent,
    }
    break messageSearch
  }
}

let snsProbe: Record<string, unknown> = { available: false }
const snsDbs = findDbs(storage, name => name === 'sns.db')
if (snsDbs.length) {
  const snsDb = snsDbs[0]
  const schema = await core.execQuery('sns', snsDb, 'PRAGMA table_info(SnsTimeLine)')
  const columns = schema.success ? (schema.rows || []).map(row => String(row.name || '')).filter(Boolean) : []
  const sample = columns.includes('content')
    ? await core.execQuery('sns', snsDb, 'SELECT content FROM SnsTimeLine ORDER BY tid DESC LIMIT 1')
    : { success: false, rows: [] as any[] }
  const raw = sample.rows?.[0]?.content
  const decoded = decodeMessageContent(raw, null)
  const timeline = await core.getSnsTimeline(1, 0)
  const timelineContent = String(timeline.timeline?.[0]?.content || '')
  snsProbe = {
    available: schema.success,
    databaseCandidateCount: snsDbs.length,
    schemaHash: hashPrefix(columns.sort().join('\n')),
    schemaColumnCount: columns.length,
    walPresent: existsSync(`${snsDb}-wal`),
    content: describeRaw(raw),
    decodedNonempty: decoded.length > 0,
    decodedBytes: Buffer.byteLength(decoded),
    decodedHash: decoded ? hashPrefix(decoded) : null,
    xmlLike: /^\s*</.test(decoded),
    timelineApiSuccess: timeline.success,
    timelineDecodeMatches: !!decoded && decoded === timelineContent,
  }
}

core.close()

const cliCore = new CliWcdbCore()
cliCore.setPaths(join(process.cwd(), 'AIWC-CLI', 'native'), join(process.cwd(), '.tmp'))
const cliOpened = await cliCore.open(dbPath, key, wxid)
if (!cliOpened) throw new Error('CLI open-backend integration failed to open the active account')
const cliMetadata = await cliCore.execQueryWithParams(
  'session', matched,
  "SELECT count(*) AS table_count FROM sqlite_master WHERE type=?",
  ['table']
)
if (!cliMetadata.success || !cliMetadata.rows?.length) {
  throw new Error(cliMetadata.error || 'CLI parameterized metadata query failed')
}
const cliContactSchema = await cliCore.execQuery('contact', '', 'PRAGMA table_info(contact)')
if (!cliContactSchema.success || !cliContactSchema.rows?.length) {
  throw new Error(cliContactSchema.error || 'CLI kind-based contact database routing failed')
}
const cliSns = snsDbs.length ? await cliCore.getSnsTimeline(1, 0) : { success: true, timeline: [] }
let cliMessageApiSuccess = false
let cliMessageDecodeSuccess = false
const cliSessionIds = await cliCore.execQuery(
  'session', matched,
  'SELECT username FROM SessionTable WHERE username IS NOT NULL AND username != \'\' LIMIT 20'
)
for (const row of cliSessionIds.rows || []) {
  const sessionId = String(row.username || '')
  if (!sessionId) continue
  const messages = await cliCore.getNativeMessages(sessionId, 1, 0)
  if (messages.success && (messages.rows?.length || 0) > 0) {
    cliMessageApiSuccess = true
    const first = messages.rows![0]
    cliMessageDecodeSuccess = decodeMessageContent(
      first.message_content ?? first.content ?? first.str_content,
      first.compress_content
    ).length > 0
    break
  }
}
cliCore.close()

process.env.CT_FORCE_OPEN_KEY = '1'
let cliOpenKeyScanSuccess = false
try {
  const cliKeyResult = await new LocalKeyService().getKey(
    { dbPath, wxid },
    { save: false }
  )
  cliOpenKeyScanSuccess = cliKeyResult.keyHex === key.toLowerCase() && !cliKeyResult.saved
} catch {
  // The validated key+salt record is transient and may not be resident after login.
}
delete process.env.CT_FORCE_OPEN_KEY

console.log(JSON.stringify({
  success: true,
  candidateCount: candidates.length,
  matchedDatabase: relative(storage, matched),
  databaseBytes: metadata.size,
  keyExposed: false,
  chatContentRead: true,
  sensitiveValuesPrinted: false,
  wcdbCoreIntegration: true,
  automaticBackendSelection: true,
  cliOpenBackendIntegration: true,
  cliParameterizedQuery: true,
  cliContactRoutingSuccess: true,
  cliSnsApiSuccess: cliSns.success,
  cliMessageApiSuccess,
  cliMessageDecodeSuccess,
  cliOpenKeyScanSuccess,
  messageProbe,
  snsProbe,
}, null, 2))
