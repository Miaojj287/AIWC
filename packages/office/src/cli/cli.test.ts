import { describe, expect, it } from 'vitest'
import { cliErrorMessage, extractUrls, findString, parseJsonOutput } from './output'
import { envelopeFailed, parseVersion } from './runner'

describe('output parsing', () => {
  it('finds the JSON document inside mixed CLI output', () => {
    const text = '████ QR ████\nOK: 应用配置成功! App ID: cli_1\n{\n  "appId": "cli_1",\n  "brand": "feishu"\n}\n'
    expect(parseJsonOutput(text)).toEqual({ appId: 'cli_1', brand: 'feishu' })
    expect(parseJsonOutput('{"a":"{not}"}')).toEqual({ a: '{not}' })
    expect(parseJsonOutput('no json here')).toBeUndefined()
  })

  it('extracts URLs without trailing punctuation or CJK text', () => {
    const text =
      '请打开二维码链接扫码: \nhttps://work.weixin.qq.com/ai/qc/gen?source=x&scode=abc。然后（https://open.feishu.cn/page/cli?user_code=AB-12）'
    expect(extractUrls(text)).toEqual([
      'https://work.weixin.qq.com/ai/qc/gen?source=x&scode=abc',
      'https://open.feishu.cn/page/cli?user_code=AB-12',
    ])
  })

  it('reads the error sentence out of each vendor envelope', () => {
    expect(cliErrorMessage('', '{"ok":false,"error":{"type":"api","code":99991672,"message":"no permission"}}')).toBe(
      'no permission（99991672）',
    )
    expect(cliErrorMessage('{"errcode":851003,"errmsg":"no authority"}', '')).toBe('no authority（851003）')
    expect(cliErrorMessage('{"success":false,"message":"未登录"}', '')).toBe('未登录')
    expect(cliErrorMessage('line 1\nfatal: boom\n', '')).toBe('fatal: boom')
  })

  it('detects failure envelopes', () => {
    expect(envelopeFailed({ ok: true, data: {} })).toBe(false)
    expect(envelopeFailed({ ok: false })).toBe(true)
    expect(envelopeFailed({ errcode: 0, url: 'x' })).toBe(false)
    expect(envelopeFailed({ errcode: 40001 })).toBe(true)
    expect(envelopeFailed({ error: { message: 'x' } })).toBe(true)
  })

  it('finds nested strings and versions', () => {
    expect(findString({ data: { base: { base_token: 'bas1' } } }, ['base_token'])).toBe('bas1')
    expect(parseVersion('lark-cli version 1.0.94')).toBe('1.0.94')
    expect(parseVersion('wecom-cli 0.3.1 (npm 2026-03-30T00:00:00Z abc)')).toBe('0.3.1')
  })
})

