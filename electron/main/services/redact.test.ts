import { describe, expect, it } from 'vitest'
import { createRedactor, REDACTED } from './redact'
import { buildDiagnosticsText, exportDiagnostics } from './diagnostics'

const redact = createRedactor({ home: '/Users/alice', username: 'alice' })

describe('createRedactor', () => {
  it('replaces the home folder (both slash styles) and the user name', () => {
    expect(redact('opened /Users/alice/Library/x.db')).toBe('opened ~/Library/x.db')
    const win = createRedactor({ home: 'C:\\Users\\alice', username: 'alice' })
    expect(win('path C:\\Users\\alice\\AppData\\x and C:/Users/alice/y')).toBe('path ~\\AppData\\x and ~/y')
    expect(redact('user=alice ok; malice stays')).toBe(`user=${REDACTED.user} ok; malice stays`)
  })

  it('hides WeChat account ids, data folders and group ids', () => {
    expect(redact('dbRoot=/Volumes/x/xwechat_files/my_alias_8f2c/db_storage')).toBe(
      `dbRoot=/Volumes/x/xwechat_files/${REDACTED.account}/db_storage`,
    )
    expect(redact('D:\\WeChat Files\\wxid_abc123\\Msg')).toBe(`D:\\WeChat Files\\${REDACTED.account}\\Msg`)
    expect(redact('session wxid_a8k9xx_12 failed')).toBe(`session ${REDACTED.wxid} failed`)
    expect(redact('group 1234567@chatroom and 99@im.chatroom')).toBe(
      `group ${REDACTED.group}@chatroom and ${REDACTED.group}@im.chatroom`,
    )
  })

  it('hides emails and phone numbers but keeps timestamps and counts', () => {
    expect(redact('mail bob.smith@example.com')).toBe(`mail ${REDACTED.email}`)
    expect(redact('call 13812345678 or +86 138-1234-5678 or +14155550123')).toBe(
      `call ${REDACTED.phone} or ${REDACTED.phone} or ${REDACTED.phone}`,
    )
    const line = '2026-10-11T01:02:03.456Z [info] synced 1728600000000 rows in 13800ms'
    expect(redact(line)).toBe(line)
  })

  it('hides keys, tokens and signed URL parameters', () => {
    const key = 'a'.repeat(64)
    expect(redact(`dbKey=${key}`)).toBe(`dbKey=${REDACTED.secret}`)
    expect(redact(`raw ${'0f'.repeat(16)} hex`)).toBe(`raw ${REDACTED.hex} hex`)
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toBe(`Authorization: ${REDACTED.secret}`)
    expect(redact('key sk-ant-api03-abcdefghijklmnopqrstuv used')).toBe(`key ${REDACTED.secret} used`)
    expect(redact('{"apiKey": "zzzz-1234-yyyy"}')).toBe(`{"apiKey": "${REDACTED.secret}"}`)
    expect(redact('GET https://api.example.com/x?access_token=abc123&page=2&sig=ffee')).toBe(
      `GET https://api.example.com/x?access_token=${REDACTED.secret}&page=2&sig=${REDACTED.secret}`,
    )
    expect(redact('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop end')).toBe(
      `jwt ${REDACTED.secret} end`,
    )
  })

  it('handles JSON-escaped Windows paths, as the log writes metadata with JSON.stringify', () => {
    const win = createRedactor({ home: 'C:\\Users\\li', username: 'li' })
    const meta = JSON.stringify({
      dbRoot: 'D:\\xwechat_files\\zhangsan88_8f2a\\db_storage',
      file: 'C:\\Users\\li\\x.db',
    })
    const out = win(meta)
    expect(out).not.toContain('zhangsan88_8f2a')
    expect(out).not.toMatch(/Users\\\\li/)
    expect(out).toContain(`xwechat_files\\\\${REDACTED.account}`)
    // A sibling home folder is not mistaken for the user's own.
    expect(createRedactor({ home: '/Users/li' })('/Users/lisa/x')).toBe('/Users/lisa/x')
  })

  it('replaces a short user name only where it is a whole path segment', () => {
    const short = createRedactor({ username: 'li' })
    expect(short('D:\\\\li\\\\data and /home/li/ and /srv/li')).toBe(
      `D:\\\\${REDACTED.user}\\\\data and /home/${REDACTED.user}/ and /srv/${REDACTED.user}`,
    )
    expect(short('linux client lists /lib/x')).toBe('linux client lists /lib/x')
  })

  it('masks token / password / cookie / secret fields, including a whole cookie header', () => {
    expect(redact('{"password":"hunter22","token":"t0k3n-abc"}')).toBe(
      `{"password":"${REDACTED.secret}","token":"${REDACTED.secret}"}`,
    )
    expect(redact('Cookie: sid=abcdef; uin=12345; skey=@xyz')).toBe(`Cookie: ${REDACTED.secret}`)
  })

  it('replaces known secret values verbatim', () => {
    const withSecret = createRedactor({ secrets: ['hunter2-value'] })
    expect(withSecret('leaked hunter2-value here')).toBe(`leaked ${REDACTED.secret} here`)
  })
})

describe('diagnostics bundle', () => {
  it('redacts every log file and names files without their folder', () => {
    const files = ['/Users/alice/Library/Logs/aiwc/main.1.log', '/Users/alice/Library/Logs/aiwc/main.log']
    const contents: Record<string, string> = {
      [files[0] as string]: 'newest wxid_zz9 /Users/alice/x\n',
      [files[1] as string]: 'oldest alice@corp.cn\n',
    }
    const text = buildDiagnosticsText({
      appVersion: '1.2.3',
      files,
      exportsDir: '/out',
      redaction: { home: '/Users/alice', username: 'alice' },
      platform: 'darwin',
      arch: 'arm64',
      electronVersion: '38',
      readFile: (path) => {
        const value = contents[path]
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
    })
    expect(text).not.toMatch(/alice|wxid_zz9|\/Users\//)
    // Oldest first.
    expect(text.indexOf('oldest')).toBeLessThan(text.indexOf('newest'))
    expect(text).toContain('===== main.log =====')
  })

  it('writes into the exports folder and reports read failures without the path', () => {
    let written = ''
    const out = exportDiagnostics({
      appVersion: '1',
      files: ['/Users/alice/logs/gone.log'],
      exportsDir: '/out',
      stamp: '20261011',
      redaction: { home: '/Users/alice' },
      readFile: () => {
        throw new Error('ENOENT /Users/alice/logs/gone.log')
      },
      writeFile: (_path, text) => {
        written = text
      },
    })
    expect(out).toBe('/out/aiwc-logs-20261011.log')
    expect(written).toContain('gone.log (read failed: ENOENT ~/logs/gone.log)')
  })
})
