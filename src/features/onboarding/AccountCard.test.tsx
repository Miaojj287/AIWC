import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TooltipProvider } from '@/kit'
import { AccountCard } from './AccountCard'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

afterEach(() => { cleanup(); __resetWizardStoreForTests() })

it('shows avatar and nickname above the smaller account ID in the selection and menu', () => {
  useWizardStore.setState({ dbRoot: '/root', wxid: 'wxid_a', accounts: [{ wxid: 'wxid_a', nickname: '测试昵称', avatarPath: '/avatar.png', dbRoot: '/root', verified: false }] })
  render(<TooltipProvider><AccountCard /></TooltipProvider>)
  const trigger = screen.getByRole('combobox', { name: '微信账号' })
  expect(trigger.textContent).toContain('测试昵称')
  expect(trigger.querySelector('img')?.getAttribute('src')).toBe('aiwc-media:///avatar.png')
  expect(trigger.querySelector('.text-micro')?.textContent).toBe('wxid_a')
  fireEvent.click(trigger)
  const option = screen.getByRole('option')
  expect(option.textContent).toContain('测试昵称')
  expect(option.querySelector('img')).toBeTruthy()
  expect(option.querySelector('.text-micro')?.textContent).toBe('wxid_a')
})
