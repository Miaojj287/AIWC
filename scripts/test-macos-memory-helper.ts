import { spawn } from 'node:child_process'
import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log(JSON.stringify({ skipped: true, reason: 'macOS only' }))
  process.exit(0)
}

const fixtureSource = String.raw`
  const crypto = require('node:crypto')
  const key = Buffer.from('OpenImageKey1234', 'ascii')
  const held = Buffer.from('OpenImageKey1234OpenImageKey1234', 'ascii')
  const dbRecord = Buffer.from("x'" + '11'.repeat(32) + '22'.repeat(16) + "'", 'ascii')
  const plain = Buffer.alloc(16); Buffer.from([0x89,0x50,0x4e,0x47]).copy(plain)
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null); cipher.setAutoPadding(false)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  global.fixture = [held, dbRecord]
  process.stdout.write(JSON.stringify({ pid: process.pid, ciphertext: ciphertext.toString('hex') }) + '\n')
  setInterval(() => void global.fixture[0].length, 1000)
`

const rawKeyHex = '00112233445546778899aabbccddeeff102132435465467798a9bacbdcedfe0f'
const rawFixtureSource = String.raw`
  const rawKey = Buffer.from('${rawKeyHex}', 'hex')
  global.fixture = [rawKey]
  process.stdout.write(JSON.stringify({ pid: process.pid }) + '\n')
  setInterval(() => void global.fixture[0].length, 1000)
`

function createEncryptedV4FirstPage(rawKey: Buffer): Buffer {
  const page = Buffer.alloc(4096)
  const salt = Buffer.from('31415926535897932384626433832795', 'hex')
  salt.copy(page, 0)
  const plain = Buffer.alloc(4000)
  Buffer.from([0x10, 0x00, 0x01, 0x01, 0x50, 0x40, 0x20, 0x20]).copy(plain)
  const iv = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  iv.copy(page, 4016)
  const derived = pbkdf2Sync(rawKey, salt, 256_000, 32, 'sha512')
  const cipher = createCipheriv('aes-256-cbc', derived, iv)
  cipher.setAutoPadding(false)
  Buffer.concat([cipher.update(plain), cipher.final()]).copy(page, 16)
  return page
}

const fixture = spawn(process.execPath, ['-e', fixtureSource], { stdio: ['ignore', 'pipe', 'ignore'] })
const dbFixtureDir = mkdtempSync(join(tmpdir(), 'ciphertalk-open-helper-test-'))
try {
  let firstLine = ''
  for await (const chunk of fixture.stdout!) {
    firstLine += chunk.toString()
    if (firstLine.includes('\n')) break
  }
  const metadata = JSON.parse(firstLine.split(/\r?\n/)[0])
  const helperPath = join(process.cwd(), 'resources', 'macos', 'wechat_memory_scan_helper')
  const helper = spawn(helperPath, ['--image', String(metadata.pid), metadata.ciphertext], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  helper.stdout.on('data', chunk => { stdout += chunk.toString() })
  await once(helper, 'close')
  const payload = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}')
  const expectedHex = Buffer.from('OpenImageKey1234', 'ascii').toString('hex')
  if (!payload.success || payload.aesKeyHex !== expectedHex) {
    throw new Error(`open image helper fixture failed (attached=${payload.attached === true})`)
  }
  writeFileSync(join(dbFixtureDir, 'fixture.db'), Buffer.from('22'.repeat(16), 'hex'))
  const dbHelper = spawn(helperPath, [String(metadata.pid), dbFixtureDir], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let dbStdout = ''
  dbHelper.stdout.on('data', chunk => { dbStdout += chunk.toString() })
  await once(dbHelper, 'close')
  const dbPayload = JSON.parse(dbStdout.trim().split(/\r?\n/).at(-1) || '{}')
  if (!dbPayload.success || dbPayload.key !== '11'.repeat(32)) {
    throw new Error(`open DB helper fixture failed (attached=${dbPayload.attached === true})`)
  }

  const rawFixture = spawn(process.execPath, ['-e', rawFixtureSource], { stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    let rawFirstLine = ''
    for await (const chunk of rawFixture.stdout!) {
      rawFirstLine += chunk.toString()
      if (rawFirstLine.includes('\n')) break
    }
    const rawMetadata = JSON.parse(rawFirstLine.split(/\r?\n/)[0])
    writeFileSync(join(dbFixtureDir, 'fixture.db'), createEncryptedV4FirstPage(Buffer.from(rawKeyHex, 'hex')))
    const rawHelper = spawn(helperPath, [String(rawMetadata.pid), join(dbFixtureDir, 'fixture.db')], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let rawStdout = ''
    rawHelper.stdout.on('data', chunk => { rawStdout += chunk.toString() })
    await once(rawHelper, 'close')
    const rawPayload = JSON.parse(rawStdout.trim().split(/\r?\n/).at(-1) || '{}')
    if (!rawPayload.success || rawPayload.key !== rawKeyHex) {
      throw new Error(`open raw v4 DB helper fixture failed (attached=${rawPayload.attached === true})`)
    }

    const dumpFixturePath = join(dbFixtureDir, 'wechat-fixture.dmp')
    writeFileSync(dumpFixturePath, Buffer.concat([
      Buffer.alloc(37, 0x5a),
      Buffer.from(rawKeyHex, 'hex'),
      Buffer.alloc(71, 0xa5),
    ]))
    const dumpHelper = spawn(helperPath, ['--dump', dumpFixturePath, join(dbFixtureDir, 'fixture.db')], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let dumpStdout = ''
    dumpHelper.stdout.on('data', chunk => { dumpStdout += chunk.toString() })
    await once(dumpHelper, 'close')
    const dumpPayload = JSON.parse(dumpStdout.trim().split(/\r?\n/).at(-1) || '{}')
    if (!dumpPayload.success || dumpPayload.key !== rawKeyHex || dumpPayload.source !== 'wechat-crash-dump') {
      throw new Error('open crash dump DB helper fixture failed')
    }
  } finally {
    rawFixture.kill('SIGTERM')
  }
  console.log(JSON.stringify({
    success: true,
    matchedImageFixtureKey: true,
    matchedDbFixtureKey: true,
    matchedRawV4DbFixtureKey: true,
    matchedCrashDumpDbFixtureKey: true,
    keyExposed: false
  }))
} finally {
  fixture.kill('SIGTERM')
  rmSync(dbFixtureDir, { recursive: true, force: true })
}
