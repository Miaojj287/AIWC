import { describe, expect, it, vi } from 'vitest'
import { ProxyConfigSchema, type ProxyConfig } from '@aiwc/protocol'
import type { Dispatcher } from 'undici'
import { createModelFetch, type ProxyAuth } from './modelFetch'

function setup(proxy: Partial<ProxyConfig>, systemAnswer = 'DIRECT') {
  const directFetch = vi.fn<typeof fetch>(async () => new Response('direct'))
  const dispatchingFetch = vi.fn(async () => new Response('proxied'))
  const created: Array<{ url: string; auth?: ProxyAuth }> = []
  const createDispatcher = (url: string, auth?: ProxyAuth) => {
    created.push({ url, auth })
    return { close: async () => undefined } as unknown as Dispatcher
  }
  const net = createModelFetch({
    proxy: () => ProxyConfigSchema.parse(proxy),
    password: () => 'pw',
    resolveSystemProxy: async () => systemAnswer,
    directFetch,
    dispatchingFetch,
    createDispatcher,
  })
  return { net, directFetch, dispatchingFetch, created }
}

describe('model request routing', () => {
  it('follows the system proxy, but never for loopback', async () => {
    const { net, directFetch, dispatchingFetch, created } = setup({ mode: 'system' }, 'PROXY 127.0.0.1:7890')
    await net.fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST' })
    expect(dispatchingFetch).toHaveBeenCalledTimes(1)
    expect(created).toEqual([{ url: 'http://127.0.0.1:7890', auth: undefined }])
    await net.fetch('http://127.0.0.1:11434/v1/chat/completions')
    expect(directFetch).toHaveBeenCalledTimes(1)
  })

  it('uses the manual proxy with its credentials and honours bypass rules', async () => {
    const { net, directFetch, created } = setup({
      mode: 'manual',
      url: 'socks5://10.0.0.2:1080',
      username: 'me',
      bypass: ['*.aliyuncs.com'],
    })
    await net.fetch('https://api.openai.com/v1/models')
    expect(created).toEqual([{ url: 'socks5://10.0.0.2:1080', auth: { username: 'me', password: 'pw' } }])
    await net.fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models')
    expect(directFetch).toHaveBeenCalledTimes(1)
    expect(await net.route('https://dashscope.aliyuncs.com')).toEqual({ kind: 'direct' })
  })

  it('fails closed on an invalid manual proxy instead of going direct', async () => {
    const { net, directFetch } = setup({ mode: 'manual', url: 'ftp://nope' })
    await expect(net.fetch('https://api.openai.com/v1/models')).rejects.toMatchObject({ code: 'proxy_invalid' })
    expect(directFetch).not.toHaveBeenCalled()
  })

  it('connects directly when proxying is off or the system has no proxy', async () => {
    expect(await setup({ mode: 'off' }).net.route('https://api.openai.com')).toEqual({ kind: 'direct' })
    expect(await setup({ mode: 'system' }, 'DIRECT').net.route('https://api.openai.com')).toEqual({ kind: 'direct' })
  })

  it('reuses one dispatcher per proxy until reset', async () => {
    const { net, created } = setup({ mode: 'manual', url: 'http://proxy:3128' })
    await net.fetch('https://a.example/x')
    await net.fetch('https://b.example/y')
    expect(created).toHaveLength(1)
    net.reset()
    await net.fetch('https://a.example/x')
    expect(created).toHaveLength(2)
  })
})
