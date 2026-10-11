import { describe, expect, it } from 'vitest'
import { redactSecrets } from './redact'

describe('call log redaction', () => {
  it('masks the same credential fields as the diagnostics redactor', () => {
    const text = JSON.stringify({
      token: 'abcd-efgh',
      password: 'hunter22',
      secret: 'shh-1234',
      authorization: 'Basic dXNlcjpwYXNz',
      cookie: 'sid=abcdef; uin=12345',
      max_tokens: 1000,
    })
    const out = redactSecrets(text)
    for (const value of ['abcd-efgh', 'hunter22', 'shh-1234', 'dXNlcjpwYXNz', 'sid=abcdef', 'uin=12345'])
      expect(out).not.toContain(value)
    expect(out).toContain('"max_tokens":1000')
    expect(out).toContain('"password":"[REDACTED]"')
  })
})
