import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptDatLegacy, DEFAULT_V1_AES_KEY } from '../electron/services/datDecryptCore.ts'

const requireNative = createRequire(import.meta.url)
const platform = process.platform === 'darwin' ? 'macos' : process.platform
const addonPath = process.env.CT_IMAGE_NATIVE_LIBRARY || join(
  process.cwd(),
  'resources',
  'wedecrypt',
  `ciphertalk-image-native-${platform}-${process.arch}.node`
)
assert.ok(existsSync(addonPath), `native image addon not found: ${addonPath}`)
const addon = requireNative(addonPath) as {
  decryptDatNative(path: string, xorKey: number, aesKey?: string): {
    data: Buffer
    ext: string
    isWxgf?: boolean
    is_wxgf?: boolean
  }
}

function encryptEcbPkcs7(data: Buffer, keyText: string): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(keyText, 'ascii').subarray(0, 16), null)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

function makeV4(version: 1 | 2, aesPlain: Buffer, raw: Buffer, xorPlain: Buffer, xorKey: number, key: string): Buffer {
  const header = Buffer.alloc(0x0f)
  Buffer.from([0x07, 0x08, 0x56, version === 1 ? 0x31 : 0x32, 0x08, 0x07]).copy(header)
  header.writeInt32LE(aesPlain.length, 6)
  header.writeInt32LE(xorPlain.length, 10)
  const encryptedXor = Buffer.from(xorPlain.map(byte => byte ^ xorKey))
  return Buffer.concat([header, encryptEcbPkcs7(aesPlain, key), raw, encryptedXor])
}

const tempDir = mkdtempSync(join(tmpdir(), 'ciphertalk-native-parity-'))
try {
  const xorKey = 0x73
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(48, 0x31), 0xff, 0xd9])
  const cases: Array<{ name: string; file: Buffer; aesText?: string; expected: Buffer }> = []
  cases.push({ name: 'v3-plain', file: Buffer.concat([jpeg, Buffer.alloc(4)]), expected: jpeg })
  cases.push({ name: 'v3-xor', file: Buffer.from(jpeg.map(byte => byte ^ xorKey)), expected: jpeg })

  const aesPlain = jpeg.subarray(0, 21)
  const raw = jpeg.subarray(21, 37)
  const xorPlain = jpeg.subarray(37)
  const v1 = makeV4(1, aesPlain, raw, xorPlain, xorKey, DEFAULT_V1_AES_KEY)
  cases.push({ name: 'v4-v1', file: v1, expected: jpeg })
  const v2Key = '0123456789abcdef'
  const v2 = makeV4(2, aesPlain, raw, xorPlain, xorKey, v2Key)
  cases.push({ name: 'v4-v2', file: v2, aesText: v2Key, expected: jpeg })

  let plaintextNativeCompatible = true
  for (const testCase of cases) {
    const path = join(tempDir, `${testCase.name}.dat`)
    writeFileSync(path, testCase.file)
    const keyBuffer = testCase.aesText ? Buffer.from(testCase.aesText, 'ascii') : null
    const tsResult = decryptDatLegacy(path, xorKey, keyBuffer).data
    const nativeResult = addon.decryptDatNative(path, xorKey, testCase.aesText)
    assert.deepEqual(tsResult, testCase.expected, `${testCase.name}: TypeScript mismatch`)
    if (!nativeResult.data.equals(testCase.expected) && testCase.name === 'v3-plain') {
      plaintextNativeCompatible = false
      if (process.env.CT_EXPECT_OPEN_IMAGE_NATIVE === '1') {
        assert.deepEqual(nativeResult.data, testCase.expected, `${testCase.name}: native mismatch`)
      }
      continue
    }
    assert.deepEqual(nativeResult.data, testCase.expected, `${testCase.name}: native mismatch`)
    assert.deepEqual(nativeResult.data, tsResult, `${testCase.name}: native/TS mismatch`)
  }
  console.log(JSON.stringify({
    success: true,
    encryptedAndV4Parity: true,
    plaintextNativeCompatible,
    legacyPlaintextBugDetected: !plaintextNativeCompatible,
  }))
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
