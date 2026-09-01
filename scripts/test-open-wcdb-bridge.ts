import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { OpenWcdbBridge } from '../electron/services/openWcdbBridge.ts'
import { WcdbCore } from '../electron/services/wcdbCore.ts'

const requireNative = createRequire(import.meta.url)

if (process.platform !== 'darwin' && !process.env.CT_OPEN_WCDB_LIBRARY) {
  console.log(JSON.stringify({ skipped: true, reason: 'open WCDB native bridge test requires macOS or CT_OPEN_WCDB_LIBRARY' }))
  process.exit(0)
}

const libraryPath = process.env.CT_OPEN_WCDB_LIBRARY || join(
  process.cwd(),
  'resources',
  'macos',
  'libWCDBOpen.dylib'
)
assert.ok(existsSync(libraryPath), `missing open WCDB library: ${libraryPath}`)

const dbPath = join(tmpdir(), `aiwc-open-wcdb-${process.pid}.db`)
rmSync(dbPath, { force: true })
const seed = spawnSync('/usr/bin/sqlite3', [
  dbPath,
  "create table sample(id integer, name text, payload blob, score real, missing text);" +
  "insert into sample values(7, 'test', X'010203', 1.5, null);"
], { encoding: 'utf8' })
assert.equal(seed.status, 0, seed.stderr)

try {
  const bridge = new OpenWcdbBridge()
  assert.deepEqual(bridge.initialize(libraryPath), { success: true })
  assert.equal(bridge.canOpen(dbPath), true)
  const result = bridge.execQuery(dbPath, 'select * from sample')
  assert.equal(result.success, true, result.error)
  assert.deepEqual(result.rows, [{
    id: 7,
    name: 'test',
    payload: '010203',
    score: 1.5,
    missing: null,
  }])
  bridge.dispose()
} finally {
  rmSync(dbPath, { force: true })
}

console.log('openWcdbBridge tests passed')

function seedEncryptedDatabase(path: string, key: string, value: string, wal = false): () => void {
  const koffi = requireNative('koffi')
  const lib = koffi.load(libraryPath)
  const Ref = koffi.struct(`OpenWcdbTestNativeRef${Math.random().toString(16).slice(2)}`, { innerValue: 'void *' })
  const create = lib.func('WCDBCoreCreateDatabase', Ref, ['str', 'bool', 'bool'])
  const configCipher = lib.func('WCDBDatabaseConfigCipher', 'void', [Ref, 'uint8_t *', 'int', 'int', 'int'])
  const getHandle = lib.func('WCDBDatabaseGetHandle', Ref, [Ref, 'bool'])
  const executeSql = lib.func('WCDBHandleExecuteSQL', 'bool', [Ref, 'str'])
  const close = lib.func('WCDBDatabaseClose', 'void', [Ref, 'void *', 'void *'])
  const release = lib.func('WCDBReleaseCPPObject', 'void', ['void *'])
  const purgeAll = lib.func('WCDBCorePurgeAllDatabase', 'void', [])

  const database = create(path, false, false)
  configCipher(database, Buffer.from(key, 'hex'), 32, 4096, 4)
  const handle = getHandle(database, true)
  if (wal) assert.equal(executeSql(handle, 'PRAGMA journal_mode=WAL'), true)
  assert.equal(executeSql(handle, 'create table secret(id integer, value text)'), true)
  assert.equal(executeSql(handle, `insert into secret values(9, '${value.replace(/'/g, "''")}')`), true)
  return () => {
    release(handle.innerValue)
    close(database, null, null)
    release(database.innerValue)
    purgeAll()
  }
}

function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

const encryptedDbPath = join(tmpdir(), `aiwc-open-wcdb-encrypted-${process.pid}.db`)
removeDatabaseFiles(encryptedDbPath)
const encryptedKey = '42'.repeat(32)

try {
  const finishSeed = seedEncryptedDatabase(encryptedDbPath, encryptedKey, 'encrypted')
  finishSeed()

  const bridge = new OpenWcdbBridge()
  assert.deepEqual(bridge.initialize(libraryPath), { success: true })
  assert.equal(bridge.canOpen(encryptedDbPath, '43'.repeat(32)), false)
  assert.equal(bridge.canOpen(encryptedDbPath, encryptedKey), true)
  const encryptedResult = bridge.execQuery(encryptedDbPath, 'select * from secret', encryptedKey)
  assert.equal(encryptedResult.success, true, encryptedResult.error)
  assert.deepEqual(encryptedResult.rows, [{ id: 9, value: 'encrypted' }])
  const parameterized = bridge.execQueryWithParams(
    encryptedDbPath,
    'select * from secret where id = ? and value = ?',
    [9, 'encrypted'],
    encryptedKey
  )
  assert.equal(parameterized.success, true, parameterized.error)
  assert.deepEqual(parameterized.rows, [{ id: 9, value: 'encrypted' }])
  bridge.dispose()
} finally {
  removeDatabaseFiles(encryptedDbPath)
}

console.log('openWcdbBridge encrypted database tests passed')

const walDbPath = join(tmpdir(), `aiwc-open-wcdb-wal-${process.pid}.db`)
removeDatabaseFiles(walDbPath)
try {
  const finishSeed = seedEncryptedDatabase(walDbPath, encryptedKey, 'wal-visible', true)
  assert.ok(existsSync(`${walDbPath}-wal`))
  assert.ok(statSync(`${walDbPath}-wal`).size > 0)
  const bridge = new OpenWcdbBridge()
  assert.deepEqual(bridge.initialize(libraryPath), { success: true })
  const result = bridge.execQuery(walDbPath, 'select value from secret where id = 9', encryptedKey)
  assert.equal(result.success, true, result.error)
  assert.deepEqual(result.rows, [{ value: 'wal-visible' }])
  bridge.dispose()
  finishSeed()
} finally {
  removeDatabaseFiles(walDbPath)
}

console.log('openWcdbBridge WAL visibility tests passed')

const accountRoot = join(tmpdir(), `aiwc-open-wcdb-accounts-${process.pid}`)
rmSync(accountRoot, { recursive: true, force: true })
const accountA = join(accountRoot, 'account-a')
const accountB = join(accountRoot, 'account-b')
const accountADb = join(accountA, 'db_storage', 'session', 'session.db')
const accountBDb = join(accountB, 'db_storage', 'session', 'session.db')
const accountAKey = '51'.repeat(32)
const accountBKey = '62'.repeat(32)
mkdirSync(join(accountA, 'db_storage', 'session'), { recursive: true })
mkdirSync(join(accountB, 'db_storage', 'session'), { recursive: true })

try {
  seedEncryptedDatabase(accountADb, accountAKey, 'account-a')()
  seedEncryptedDatabase(accountBDb, accountBKey, 'account-b')()
  delete process.env.CT_OPEN_WCDB
  delete process.env.CT_WCDB_BACKEND
  process.env.CT_OPEN_WCDB_LIBRARY = libraryPath
  const core = new WcdbCore()
  core.setPaths(join(process.cwd(), 'resources'), join(accountRoot, 'userdata'), 'test')

  assert.equal(await core.open(accountA, accountAKey, 'wxid-a'), true)
  assert.deepEqual((await core.execQuery('session', accountADb, 'select value from secret')).rows, [{ value: 'account-a' }])
  assert.equal(await core.open(accountB, accountBKey, 'wxid-b'), true)
  assert.deepEqual((await core.execQuery('session', accountBDb, 'select value from secret')).rows, [{ value: 'account-b' }])
  assert.equal(await core.open(accountA, accountAKey, 'wxid-a'), true)
  assert.deepEqual((await core.execQuery('session', accountADb, 'select value from secret')).rows, [{ value: 'account-a' }])
  core.close()
} finally {
  rmSync(accountRoot, { recursive: true, force: true })
}

console.log('WcdbCore account switching tests passed')
