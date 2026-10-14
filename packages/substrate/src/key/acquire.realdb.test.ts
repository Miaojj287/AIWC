import { describe, it, expect } from 'vitest'
import type { KeyAcquireStep } from '@aiwc/protocol'
import { acquireKeys } from './'

const ROOT = process.env.AIWC_TEST_ROOT || ''
const WXID = process.env.AIWC_TEST_WXID || ''
const NATIVE = process.env.AIWC_TEST_NATIVE || ''
const run = ROOT && WXID ? describe : describe.skip

run('acquireKeys (real machine)', () => {
  it('acquires db key + image keys', async () => {
    const steps: Array<Pick<KeyAcquireStep, 'id' | 'status' | 'detail'>> = []
    const res = await acquireKeys({
      dbRoot: ROOT,
      wxid: WXID,
      strategy: 'auto',
      nativeDir: NATIVE,
      onStep: (s) => {
        steps.push({ id: s.id, status: s.status, detail: s.detail })
        console.log('STEP', s.id, s.status, s.detail || '')
      },
    })
    console.log('RESULT', {
      database: Boolean(res.dbKeyHex),
      matched: res.dbCredentials?.entries.length ?? 0,
      imageXor: Boolean(res.imageXorHex),
      imageAes: Boolean(res.imageAesHex),
    })
    expect(steps.length).toBeGreaterThan(0)
  }, 120_000)
})
