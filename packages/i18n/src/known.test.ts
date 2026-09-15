/**
 * known.ts reverses the zh-CN `known` templates onto package output, so every template must still
 * match text that actually exists in the package sources. When a package message changes, this test
 * names the stale entry: update packages/i18n/src/locales/{zh-CN,en-US}/known.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { leafKeys, localizeKnown, lookup } from './index'
import { zhCN } from './locales/zh-CN'

const ROOT = join(__dirname, '..', '..', '..')
const SOURCES = [
  'packages/kernel/src',
  'packages/substrate/src',
  'packages/gateway/src',
  'packages/memory/src',
  'packages/protocol/src',
]

function sourceText(): string {
  const chunks: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) chunks.push(readFileSync(path, 'utf8'))
    }
  }
  for (const dir of SOURCES) walk(join(ROOT, dir))
  return chunks.join('\n')
}

describe('known package messages', () => {
  it('every zh-CN template still appears in the package sources', () => {
    const corpus = sourceText()
    const stale: string[] = []
    for (const key of leafKeys(zhCN.known)) {
      const template = lookup(zhCN.known, key) ?? ''
      // Every literal fragment between placeholders (split at punctuation, since packages often compose
      // messages from constants such as CLONE_STEPS.read) must exist verbatim in some package file.
      const fragments = template
        .split(/\{[A-Za-z_]\w*\}/)
        .flatMap((chunk) => chunk.split(/[（）()：:，,；;「」“”\s]+/))
        .filter((fragment) => fragment.length >= 2)
      const missing = fragments.filter((fragment) => !corpus.includes(fragment))
      if (missing.length) stale.push(`known.${key}: ${missing.map((m) => `"${m}"`).join(', ')}`)
    }
    expect(stale).toEqual([])
  })

  it('translates exact and templated messages, recursively, and leaves unknown text alone', () => {
    expect(localizeKnown('发送校验失败', 'en-US')).toBe('Send verification failed')
    expect(localizeKnown('已熔断：发送校验失败', 'en-US')).toBe('Stopped: Send verification failed')
    expect(
      localizeKnown('与「老王」的消息只有 12 条（至少需要 50 条），不足以克隆；可扩大范围或强制继续', 'en-US'),
    ).toBe(
      'Only 12 messages with "老王" (at least 50 needed), which is not enough to clone. Widen the range or continue anyway.',
    )
    expect(localizeKnown('读取聊天记录：300 条消息，2/5 段语音已转写，另加 40 条群聊发言', 'en-US')).toBe(
      'Reading chat history: 300 messages, 2/5 voice messages transcribed, plus 40 group chat messages',
    )
    expect(localizeKnown('规则已暂停或删除', 'en-US')).toBe('Rule paused or deleted') // from the main namespace
    expect(localizeKnown('今晚一起吃饭吗', 'en-US')).toBe('今晚一起吃饭吗')
    expect(localizeKnown('401 Unauthorized', 'en-US')).toBe('401 Unauthorized')
    expect(localizeKnown('发送校验失败', 'zh-CN')).toBe('发送校验失败')
    expect(localizeKnown(undefined, 'en-US')).toBeUndefined()
  })
})
