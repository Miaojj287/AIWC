import { describe, it, expect } from 'vitest'
import { acquireKeys } from './'

const ROOT = process.env.AIWC_TEST_ROOT || ''
const WXID = process.env.AIWC_TEST_WXID || ''
const NATIVE = process.env.AIWC_TEST_NATIVE || ''
const run = ROOT && WXID ? describe : describe.skip

run('acquireKeys (real machine)', () => {
  it('acquires db key + image keys', async () => {
    const steps: any[] = []
    const res = await acquireKeys({ dbRoot: ROOT, wxid: WXID, strategy: 'auto', nativeDir: NATIVE, onStep: (s) => { steps.push({ id: s.id, status: s.status, detail: s.detail }); console.log('STEP', s.id, s.status, s.detail || '') } })
    console.log('RESULT dbKey:', res.dbKeyHex ? res.dbKeyHex.slice(0, 12) + '… (len ' + res.dbKeyHex.length + ')' : 'NONE')
    console.log('RESULT imageXor:', res.imageXorHex, 'imageAes:', res.imageAesHex ? res.imageAesHex.slice(0,8)+'…' : 'NONE')
    expect(steps.length).toBeGreaterThan(0)
  }, 120_000)
})
