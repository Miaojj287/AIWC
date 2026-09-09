import { afterEach, expect, it } from 'vitest'
import { getBridge, __setBridgeForTests } from './bridge'

afterEach(() => __setBridgeForTests(undefined))
it('fails explicitly when desktop preload is missing and never installs a demo bridge', async () => {
  __setBridgeForTests(undefined)
  await expect(getBridge()).rejects.toThrow('无法连接本地微信数据服务')
  expect(window.aiwc).toBeUndefined()
})
