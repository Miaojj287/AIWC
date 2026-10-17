import { describe, expect, it } from 'vitest'
import { extractWindowsCredentialRecords } from './windowsCredentialRecords'

const KEY = '0123456789abcdef'.repeat(4)
const SALT = 'fedcba9876543210'.repeat(2)
const MASK = Buffer.from('d2c7442458020000004889442450488b450048844c2448488944254048584c24', 'hex')

describe('Windows credential record formats', () => {
  it('retains the salt and the entire masked direct keyspec', () => {
    const record = Buffer.from(`x'${KEY}${SALT}'`)
    const masked = Buffer.from(record.map((byte, index) => byte ^ (MASK[index % MASK.length] ?? 0)))
    expect(extractWindowsCredentialRecords(Buffer.concat([Buffer.alloc(17), masked, Buffer.alloc(19)]))).toEqual([
      { key: KEY, salt: SALT },
    ])
  })

  it('rejects truncated and unknown credential formats', () => {
    expect(extractWindowsCredentialRecords(Buffer.from(`x'${KEY}'`))).toEqual([])
    expect(extractWindowsCredentialRecords(Buffer.from(`x'${KEY}${SALT.slice(0, -1)}'`))).toEqual([])
  })
})
