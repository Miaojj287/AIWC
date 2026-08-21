import { spawn } from 'node:child_process'
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
  console.log(JSON.stringify({
    success: true,
    matchedImageFixtureKey: true,
    matchedDbFixtureKey: true,
    keyExposed: false
  }))
} finally {
  fixture.kill('SIGTERM')
  rmSync(dbFixtureDir, { recursive: true, force: true })
}
