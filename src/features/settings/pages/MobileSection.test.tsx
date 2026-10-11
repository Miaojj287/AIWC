import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, expect, it } from 'vitest'
import { patchJsdomTopLayerMatches } from '@/features/agent/testUtils'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { createMockBridge } from '@/platform/mockBridge'
import { MobileSection } from './MobileSection'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
})

function renderSection() {
  const bridge = createMockBridge({ timeScale: 0, storage: null })
  __setBridgeForTests(bridge)
  render(
    <TooltipProvider>
      <MobileSection />
    </TooltipProvider>,
  )
  return bridge
}

it('connects by QR, then lets the owner turn on phone control and disconnect after confirming', async () => {
  const bridge = renderSection()
  const connect = await screen.findByRole('button', { name: '扫码连接' })
  // Phone control cannot be switched on before an owner is bound.
  expect(screen.getByRole('switch', { name: '在手机微信里遥控 Agent' })).toHaveProperty('disabled', true)

  fireEvent.click(connect)
  await screen.findByText(/绑定的微信号/)
  expect(screen.getByText('已连接')).toBeTruthy()

  const toggle = screen.getByRole('switch', { name: '在手机微信里遥控 Agent' })
  await waitFor(() => expect(toggle).toHaveProperty('disabled', false))
  fireEvent.click(toggle)
  await waitFor(async () => expect((await bridge.invoke('mobile:status', undefined)).remote.enabled).toBe(true))

  // Autopilot is not offered for the phone thread.
  const modes = screen.getByRole('radiogroup', { name: '手机会话的权限模式' })
  expect(within(modes).queryByText('Autopilot')).toBeNull()
  fireEvent.click(within(modes).getByText('Bypass'))
  await waitFor(async () =>
    expect((await bridge.invoke('mobile:status', undefined)).remote.permissionMode).toBe('bypass'),
  )

  fireEvent.click(screen.getByRole('button', { name: '断开' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '断开' }))
  await screen.findByRole('button', { name: '扫码连接' })
  expect((await bridge.invoke('mobile:status', undefined)).owner).toBeUndefined()
})

it('opens the phone thread only once one exists', async () => {
  renderSection()
  const open = await screen.findByRole('button', { name: '打开手机会话' })
  expect(open.getAttribute('aria-disabled') === 'true' || (open as HTMLButtonElement).disabled).toBe(true)
})
