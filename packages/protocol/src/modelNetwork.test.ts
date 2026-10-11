import { describe, expect, it } from 'vitest'
import { bypassesProxy, isLoopbackHost, parseBypassList, parseProxyUrl, proxyFromPacResult } from './modelNetwork'

describe('proxy URL validation', () => {
  it('accepts http / https / socks5 with default ports and bare host:port', () => {
    expect(parseProxyUrl('127.0.0.1:7890')).toMatchObject({ ok: true, normalized: 'http://127.0.0.1:7890' })
    expect(parseProxyUrl('socks5://proxy.lan')).toMatchObject({ ok: true, port: 1080 })
    expect(parseProxyUrl('https://proxy.example.com')).toMatchObject({ ok: true, port: 443 })
  })
  it('rejects other schemes, credentials in the URL, paths and empty input', () => {
    expect(parseProxyUrl('ftp://x:21')).toEqual({ ok: false, code: 'scheme' })
    expect(parseProxyUrl('http://user:pw@proxy:8080')).toEqual({ ok: false, code: 'credentials' })
    expect(parseProxyUrl('http://proxy:8080/path')).toEqual({ ok: false, code: 'invalid' })
    expect(parseProxyUrl('  ')).toEqual({ ok: false, code: 'empty' })
  })
})

describe('bypass rules', () => {
  const rules = parseBypassList('*.internal.corp, .example.com\nexact.host:8443; 10.0.0.0/8 <local>')
  it('splits on commas, semicolons, spaces and new lines', () => {
    expect(rules).toEqual(['*.internal.corp', '.example.com', 'exact.host:8443', '10.0.0.0/8', '<local>'])
  })
  it('always sends loopback direct (Ollama)', () => {
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(bypassesProxy('http://127.0.0.1:11434/api/tags', [])).toBe(true)
    expect(bypassesProxy('http://localhost:11434/v1', [])).toBe(true)
  })
  it('matches suffixes, exact host:port, CIDR and plain host names', () => {
    expect(bypassesProxy('https://a.internal.corp/v1', rules)).toBe(true)
    expect(bypassesProxy('https://example.com', rules)).toBe(true)
    expect(bypassesProxy('https://api.example.com', rules)).toBe(true)
    expect(bypassesProxy('https://exact.host:8443/x', rules)).toBe(true)
    expect(bypassesProxy('https://exact.host/x', rules)).toBe(false)
    expect(bypassesProxy('http://10.2.3.4:8000', rules)).toBe(true)
    expect(bypassesProxy('http://gpu-box:8000', rules)).toBe(true)
    expect(bypassesProxy('https://api.deepseek.com', rules)).toBe(false)
  })
})

describe('system proxy answers', () => {
  it('takes the first usable PAC entry, skipping SOCKS4', () => {
    expect(proxyFromPacResult('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890')
    expect(proxyFromPacResult('SOCKS 1.2.3.4:1080; SOCKS5 1.2.3.4:1081')).toBe('socks5://1.2.3.4:1081')
    expect(proxyFromPacResult('DIRECT')).toBeUndefined()
  })
})
