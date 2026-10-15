import type { WechatCredentialStatus } from '@aiwc/protocol'

const AUXILIARY_DATABASE_PATH = 'third_app_icon/third_app_icon.db'
const CHAT_DATABASE_PATH = /(?:^|\/)(?:session|contact|(?:msg|message)_\d+|biz_message_\d+)\.db$/i

/** Classify authenticated coverage; unknown files never imply complete chat availability. */
export function classifyDatabaseCoverage(credentials?: WechatCredentialStatus) {
  if (!credentials?.database) return 'unavailable'
  if (!credentials.missing.length) return credentials.total === credentials.matched ? 'complete' : 'other'
  if (credentials.missing.some((path) => CHAT_DATABASE_PATH.test(path))) return 'chat'
  if (credentials.matched + credentials.missing.length !== credentials.total) return 'other'
  // WeChat 4.1.15 registers this icon store separately; AIWC does not query it (research §8.4).
  if (credentials.missing.every((path) => path === AUXILIARY_DATABASE_PATH)) return 'auxiliary'
  return 'other'
}
