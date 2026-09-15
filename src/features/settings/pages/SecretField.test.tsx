import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/kit'
import { SecretField } from './AccountKeys'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@/platform/hooks', () => ({ invoke: invokeMock, useBridgeEvent: () => {} }))
beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel: string) => (channel === 'secret:has' ? true : { ok: true }))
})
afterEach(cleanup)

it('edits an existing masked key in place, rejects invalid input and saves valid input on blur', async () => {
  const onSaved = vi.fn()
  render(
    <TooltipProvider>
      <SecretField kind="db_key" secretRef="test-key" label="Database key" onSaved={onSaved} />
    </TooltipProvider>,
  )
  const field = screen.getByLabelText('Database key') as HTMLInputElement
  await waitFor(() => expect(field.value.length).toBeGreaterThan(0))
  expect(field.readOnly).toBe(false)
  fireEvent.change(field, { target: { value: 'invalid' } })
  fireEvent.blur(field)
  expect(invokeMock.mock.calls.filter(([channel]) => channel === 'substrate:setManualKey')).toHaveLength(0)
  fireEvent.change(field, { target: { value: 'a'.repeat(64) } })
  fireEvent.blur(field)
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  expect(invokeMock).toHaveBeenCalledWith('substrate:setManualKey', { kind: 'db_key', hex: 'a'.repeat(64) })
})

it('discards a draft with Escape without writing a key', async () => {
  render(
    <TooltipProvider>
      <SecretField kind="image_xor" secretRef="test-xor" label="XOR" />
    </TooltipProvider>,
  )
  const field = screen.getByLabelText('XOR') as HTMLInputElement
  await waitFor(() => expect(field.value.length).toBeGreaterThan(0))
  fireEvent.change(field, { target: { value: 'ff' } })
  fireEvent.keyDown(field, { key: 'Escape' })
  fireEvent.blur(field)
  expect(invokeMock.mock.calls.filter(([channel]) => channel === 'substrate:setManualKey')).toHaveLength(0)
})
