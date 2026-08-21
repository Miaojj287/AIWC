import assert from 'node:assert/strict'
import {
  extractWindowsMemoryKeyCandidates,
  readEncryptedDbSalt,
} from '../electron/services/windowsMemoryKeyScanner.ts'
import { extractMemoryDbKeyCandidates } from '../electron/services/memoryDbKeyPattern.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const key = 'a1'.repeat(32)
const salt = 'b2'.repeat(16)
const record = Buffer.from(`prefix x'${key}${salt}' suffix`, 'ascii')
const candidates = extractWindowsMemoryKeyCandidates(record)
assert.deepEqual(candidates, [{ key, salt }])
assert.deepEqual(extractMemoryDbKeyCandidates(record), candidates)

const invalid = Buffer.from(`x'${key}${salt.slice(0, -1)}z'`, 'ascii')
assert.deepEqual(extractWindowsMemoryKeyCandidates(invalid), [])

const splitRecord = Buffer.concat([
  Buffer.from('x\''.padEnd(40, '0')),
  Buffer.from(`${key}${salt}'`, 'ascii'),
])
assert.equal(extractWindowsMemoryKeyCandidates(splitRecord).length, 0)

const tempDir = mkdtempSync(join(tmpdir(), 'ciphertalk-key-scan-'))
try {
  const encrypted = join(tempDir, 'encrypted.db')
  writeFileSync(encrypted, Buffer.concat([Buffer.from(salt, 'hex'), Buffer.alloc(32)]))
  assert.equal(readEncryptedDbSalt(encrypted), salt)

  const plaintext = join(tempDir, 'plaintext.db')
  writeFileSync(plaintext, Buffer.from('SQLite format 3\0more data'))
  assert.equal(readEncryptedDbSalt(plaintext), null)
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

console.log('windowsMemoryKeyScanner tests passed')
