import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultConfig, type AiwcBridge } from '@aiwc/protocol'
import { TooltipProvider } from '@/kit'
import { __setBridgeForTests } from '@/platform/bridge'
import { __resetConfigStoreForTests, useConfigStore } from '@/platform/configStore'
import { KeysCard } from './KeysCard'
import { __resetWizardStoreForTests, useWizardStore } from './wizardStore'

afterEach(() => { cleanup(); __setBridgeForTests(undefined); __resetConfigStoreForTests(); __resetWizardStoreForTests() })

it('reveals all three automatically acquired keys before config refs reach the renderer, and hides them again', async () => {
  useConfigStore.setState({ config: defaultConfig(), hydrated: true })
  useWizardStore.setState({ keys: { db_key: { status: 'acquired', source: 'cached' }, image_xor: { status: 'acquired', source: 'cached' }, image_aes: { status: 'acquired', source: 'cached' } } })
  const secrets: Record<string, string> = { 'account:dbKey': 'a'.repeat(64), 'account:imageXorKey': '53', 'account:imageAesKey': 'b'.repeat(32) }
  const invoke = vi.fn(async (_channel: string, req: { ref: string }) => secrets[req.ref])
  __setBridgeForTests({ invoke, on: () => () => {} } as unknown as AiwcBridge)
  const { container } = render(<TooltipProvider><KeysCard /></TooltipProvider>)
  for (const button of screen.getAllByRole('button', { name: '显示' })) fireEvent.click(button)
  await waitFor(() => expect(Array.from(container.querySelectorAll('input')).map(i => i.value)).toEqual(Object.values(secrets)))
  for (const button of screen.getAllByRole('button', { name: '隐藏' })) fireEvent.click(button)
  expect(Array.from(container.querySelectorAll('input')).every(i => /^•+$/.test(i.value))).toBe(true)
})
