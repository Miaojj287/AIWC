import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { AccountPage } from './AccountPage'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  __resetConfigStoreForTests()
})

it('shows the connected account avatar when saved config disagrees, and groups directories above keys', async () => {
  useConfigStore.setState({
    config: {
      ...defaultConfig(),
      account: { ...defaultConfig().account, wxid: 'saved_b', dbRoot: '/root', verifiedAt: 1 },
    },
    hydrated: true,
  })
  __setBridgeForTests({
    runtime: 'web',
    platform: 'darwin',
    on: () => () => {},
    invoke: (async (channel: string) => {
      if (channel === 'substrate:status')
        return {
          connection: 'ready',
          account: {
            wxid: 'active_a',
            nickname: '当前微信',
            avatarPath: '/avatars/a.png',
            dbRoot: '/root',
            verified: true,
          },
        }
      if (channel === 'substrate:listAccounts')
        return [
          { wxid: 'active_a', dbRoot: '/root', verified: false },
          { wxid: 'saved_b', dbRoot: '/root', verified: false },
        ]
      if (channel === 'secret:has') return false
      if (channel === 'substrate:credentialStatus')
        return { database: false, imageXor: false, imageAes: false, matched: 0, total: 0, missing: [], revision: 0 }
      throw new Error(channel)
    }) as AiwcBridge['invoke'],
  })
  const { container } = render(
    <TooltipProvider>
      <AccountPage />
    </TooltipProvider>,
  )
  await screen.findByText('当前微信')
  const card = container.querySelector('[data-setting-row="account.current"]')!
  expect(card.querySelector('img')?.getAttribute('src')).toBe('aiwc-media:///avatars/a.png')
  expect(screen.getByText('配置账号与当前连接不一致，请在上方选择要连接的账号。')).toBeTruthy()
  expect(
    Array.from(container.querySelectorAll('[data-setting-row]')).map((row) => row.getAttribute('data-setting-row')),
  ).toEqual([
    'account.current',
    'account.dbRoot',
    'account.cacheDir',
    'account.verify',
    'account.dbKey',
    'account.imageKeys',
  ])
  expect(screen.queryByLabelText('解密密钥')).toBeNull()
  expect(screen.queryByLabelText('XOR 密钥')).toBeNull()
  expect(screen.queryByLabelText('AES 密钥')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '高级选项 · 手动输入' }))
  expect(screen.getByLabelText('解密密钥')).toBeTruthy()
  expect(screen.getByLabelText('XOR 密钥')).toBeTruthy()
  expect(screen.getByLabelText('AES 密钥')).toBeTruthy()
})
