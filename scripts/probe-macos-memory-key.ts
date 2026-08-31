import { spawnSync } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { scanMacosMemoryForDbKey } from '../electron/services/macosMemoryKeyScanner.ts'

type ConfigRow = { key: string; value: string }
type Account = { id?: string; dbPath?: string; decryptKey?: string }

function parseStored(value: string | undefined): any {
  if (value === undefined) return undefined
  try { return JSON.parse(value) } catch { return value }
}

const configPath = process.env.CT_CONFIG_DB || join(
  homedir(), 'Library', 'Application Support', 'aiwc', 'aiwc-config.db'
)
if (!existsSync(configPath)) throw new Error('AIWC config not found')

const query = spawnSync('/usr/bin/sqlite3', [
  '-json', configPath,
  "select key,value from config where key in ('accounts','activeAccountId','dbPath','decryptKey')"
], { encoding: 'utf8' })
if (query.status !== 0) throw new Error('Failed to read AIWC config')
const values = new Map<string, string>()
for (const row of JSON.parse(query.stdout || '[]') as ConfigRow[]) values.set(row.key, row.value)
const accounts = parseStored(values.get('accounts')) as Account[] | undefined
const activeId = String(parseStored(values.get('activeAccountId')) || '')
const active = Array.isArray(accounts)
  ? accounts.find(account => account.id === activeId) || accounts[0]
  : undefined
const dbPath = String(active?.dbPath || parseStored(values.get('dbPath')) || '')
const configuredKey = String(active?.decryptKey || parseStored(values.get('decryptKey')) || '')
if (!dbPath || !/^[0-9a-fA-F]{64}$/.test(configuredKey)) throw new Error('No usable active account configuration')

const pidQuery = spawnSync('/usr/bin/pgrep', ['-x', 'WeChat'], { encoding: 'utf8' })
const pid = Math.max(...pidQuery.stdout.split(/\s+/).map(Number).filter(value => Number.isFinite(value) && value > 0))
if (!Number.isFinite(pid)) throw new Error('WeChat is not running')

const scan = await scanMacosMemoryForDbKey(pid, dbPath)
const matchedConfiguredKey = !!scan.key && timingSafeEqual(
  Buffer.from(scan.key, 'hex'),
  Buffer.from(configuredKey, 'hex')
)
console.log(JSON.stringify({
  success: !!scan.key,
  attached: scan.attached,
  dbSaltCount: scan.saltCount,
  regionsScanned: scan.regions,
  bytesScanned: scan.bytes,
  matchedConfiguredKey,
  keyExposed: false,
  chatContentRead: false,
  errorCategory: scan.error ? scan.error.split(':')[0] : null,
}, null, 2))
