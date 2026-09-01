import assert from 'node:assert/strict'
import {
  extractWindowsMemoryKeyCandidates,
  extractWindowsRawV4KeyCandidates,
  findWindowsImageAesKey,
  parseWeChatTasklist,
  readEncryptedDbSalt,
  verifyWindowsDirectDbKey,
  verifyWindowsImageAesKey,
} from '../electron/services/windowsMemoryKeyScanner.ts'
import { createCipheriv, randomBytes } from 'node:crypto'
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

const rawV4Key = Buffer.alloc(32)
rawV4Key[6] = 0x40
rawV4Key[8] = 0x80
rawV4Key[22] = 0x40
rawV4Key[24] = 0x80
assert.deepEqual(extractWindowsRawV4KeyCandidates(rawV4Key, 0n), [rawV4Key])
assert.deepEqual(
  extractWindowsRawV4KeyCandidates(Buffer.concat([Buffer.alloc(5), rawV4Key]), 3n),
  [rawV4Key]
)
const invalidRawV4Key = Buffer.from(rawV4Key)
invalidRawV4Key[22] = 0x30
assert.deepEqual(extractWindowsRawV4KeyCandidates(invalidRawV4Key, 0n), [])

const tasklist = [
  '"Weixin.exe","1036","Console","1","22,028 K"',
  '"Weixin.exe","8556","Console","1","441,468 K"',
  '"not-weixin.exe","9999","Console","1","999,999 K"',
].join('\r\n')
assert.deepEqual(parseWeChatTasklist(tasklist), [
  { pid: 8556, workingSetKb: 441468 },
  { pid: 1036, workingSetKb: 22028 },
])

const imageKey = Buffer.from('a1B2c3D4e5F6g7H8', 'ascii')
const imagePlain = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(13, 0x42)])
const imageCipher = createCipheriv('aes-128-ecb', imageKey, null)
imageCipher.setAutoPadding(false)
const imageCiphertext = Buffer.concat([imageCipher.update(imagePlain), imageCipher.final()])
assert.equal(verifyWindowsImageAesKey(imageKey, imageCiphertext), true)
assert.equal(verifyWindowsImageAesKey(Buffer.from('wrong-key-0000000'), imageCiphertext), false)

const asciiImageRecord = Buffer.from(`prefix:${imageKey.toString('ascii')}1234567890ABCDEF:suffix`, 'ascii')
assert.equal(findWindowsImageAesKey(asciiImageRecord, imageCiphertext).key, imageKey.toString('ascii'))

const utf16ImageRecord = Buffer.from(`${imageKey.toString('ascii')}1234567890ABCDEF`, 'utf16le')
assert.equal(findWindowsImageAesKey(utf16ImageRecord, imageCiphertext).key, imageKey.toString('ascii'))

const isolatedImageRecord = Buffer.concat([
  Buffer.from([0]),
  imageKey,
  Buffer.from([0]),
])
assert.equal(findWindowsImageAesKey(isolatedImageRecord, imageCiphertext).key, imageKey.toString('ascii'))

const directKey = randomBytes(32)
const directIv = randomBytes(16)
const directPlain = Buffer.alloc(4000)
Buffer.from([0x10, 0x00, 0x01, 0x01, 0x50, 0x40, 0x20, 0x20]).copy(directPlain)
const directCipher = createCipheriv('aes-256-cbc', directKey, directIv)
directCipher.setAutoPadding(false)
const directEncrypted = Buffer.concat([directCipher.update(directPlain), directCipher.final()])
const directPage = Buffer.concat([randomBytes(16), directEncrypted, directIv, Buffer.alloc(64)])
assert.equal(verifyWindowsDirectDbKey(directKey, directPage), true)
assert.equal(verifyWindowsDirectDbKey(randomBytes(32), directPage), false)

const tempDir = mkdtempSync(join(tmpdir(), 'aiwc-key-scan-'))
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
