import { expect, it } from 'vitest'
import type { WechatCredentialStatus } from '@aiwc/protocol'
import { classifyDatabaseCoverage } from './databaseCoverage'

const status = (missing: string[], database = true): WechatCredentialStatus => ({
  database,
  imageXor: false,
  imageAes: false,
  matched: 2,
  total: 2 + missing.length,
  missing,
  revision: 1,
})

it('separates a known icon store from complete coverage without hiding it', () => {
  expect(classifyDatabaseCoverage(status([]))).toBe('complete')
  expect(classifyDatabaseCoverage(status(['third_app_icon/third_app_icon.db']))).toBe('auxiliary')
})

it.each([
  'session/session.db',
  'contact/contact.db',
  'message/message_1.db',
  'message/msg_2.db',
  'biz_message/biz_message_0.db',
])('reports missing chat credentials even when an auxiliary file is also missing: %s', (path) => {
  expect(classifyDatabaseCoverage(status([path, 'third_app_icon/third_app_icon.db']))).toBe('chat')
})

it('keeps unknown paths, mismatched totals, and unavailable sessions conservative', () => {
  expect(classifyDatabaseCoverage(status(['unknown/unknown.db']))).toBe('other')
  expect(classifyDatabaseCoverage(status(['other/third_app_icon.db']))).toBe('other')
  expect(classifyDatabaseCoverage({ ...status([]), total: 3 })).toBe('other')
  expect(classifyDatabaseCoverage({ ...status(['third_app_icon/third_app_icon.db']), total: 4 })).toBe('other')
  expect(classifyDatabaseCoverage(status(['third_app_icon/third_app_icon.db'], false))).toBe('unavailable')
  expect(classifyDatabaseCoverage()).toBe('unavailable')
})
