import { describe, expect, it } from 'vitest'
import {
  WechatDbCredentialBundleSchema,
  WechatAcquireRequestSchema,
  WechatDatabaseReadySchema,
} from './wechatCredentials'

describe('database credential contracts', () => {
  it.each(['../session.db', '/session.db', 'a/../../session.db', 'a\\session.db', './session.db'])(
    'rejects unsafe relative path %s',
    (relativePath) => {
      expect(
        WechatDbCredentialBundleSchema.safeParse({
          version: 1,
          accountId: 'fictional',
          entries: [
            {
              relativePath,
              saltHex: 'a'.repeat(32),
              keyHex: 'b'.repeat(64),
              form: 'direct',
            },
          ],
        }).success,
      ).toBe(false)
    },
  )
  it('defaults ordinary connection to database-only and rejects unknown strategies', () => {
    expect(WechatAcquireRequestSchema.parse({ wxid: 'fictional', dbRoot: '/fictional' }).scope).toBe('database')
    expect(
      WechatAcquireRequestSchema.safeParse({ wxid: 'fictional', dbRoot: '/fictional', strategy: 'relaunch' }).success,
    ).toBe(false)
  })
  it('preserves and validates the private inventory on database commit', () => {
    const payload = { dbKeyHex: 'a'.repeat(64), currentPaths: ['session/session.db', 'message/message_0.db'] }
    expect(WechatDatabaseReadySchema.parse(payload).currentPaths).toEqual(payload.currentPaths)
    expect(WechatDatabaseReadySchema.safeParse({ ...payload, currentPaths: ['../other.db'] }).success).toBe(false)
  })
})
