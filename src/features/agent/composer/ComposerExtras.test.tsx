// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerSendKey, DraftAttachment, Mention } from '@aiwc/protocol'
import { Composer } from '../Composer'
import { patchJsdomTopLayerMatches } from '../testUtils'

const unpatch = patchJsdomTopLayerMatches()
afterAll(unpatch)
afterEach(cleanup)

function Harness({
  onSubmit = () => {},
  onQueue,
  streaming = false,
  sendKey,
  warning,
}: {
  onSubmit?: () => void
  onQueue?: () => void
  streaming?: boolean
  sendKey?: ComposerSendKey
  warning?: string
}) {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<Mention[]>([])
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  return (
    <>
      <Composer
        value={text}
        onValueChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        attachmentWarning={warning}
        onSubmit={onSubmit}
        onQueue={onQueue}
        streaming={streaming}
        sendKey={sendKey}
      />
      <output data-testid="attachments">{attachments.map((a) => a.part.name).join(',')}</output>
    </>
  )
}

const textarea = () => screen.getByLabelText('给 Agent 的消息') as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(textarea(), { target: { value } })

describe('<Composer> attachments, send key and queue', () => {
  it('turns a long paste into a text attachment chip that can be removed', async () => {
    render(<Harness />)
    const long = 'line\n'.repeat(100)
    fireEvent.paste(textarea(), { clipboardData: { files: [], getData: () => long } })
    await waitFor(() => expect(screen.getByTestId('attachments').textContent).toBe('粘贴的文本 1.txt'))
    expect(textarea().value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '移除 粘贴的文本 1.txt' }))
    expect(screen.getByTestId('attachments').textContent).toBe('')
  })

  it('keeps a short paste as text (the browser inserts it)', () => {
    render(<Harness />)
    const event = fireEvent.paste(textarea(), { clipboardData: { files: [], getData: () => 'short' } })
    expect(event).toBe(true) // not prevented
    expect(screen.getByTestId('attachments').textContent).toBe('')
  })

  it('adds a dropped image and enables send with no text', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    const image = new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('composer'), { dataTransfer: { types: ['Files'], files: [image] } })
    await waitFor(() => expect(screen.getByTestId('attachments').textContent).toBe('shot.png'))
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy()
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows the vision warning and limit errors inline', async () => {
    render(<Harness warning="M 不支持图片输入" />)
    expect(screen.getByText('M 不支持图片输入')).toBeTruthy()
    const heic = new File([new Uint8Array(2)], 'x.heic', { type: 'image/heic' })
    fireEvent.drop(screen.getByTestId('composer'), { dataTransfer: { types: ['Files'], files: [heic] } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('x.heic'))
  })

  it('⌘↵ mode: Enter is a new line, ⌘Enter sends', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} sendKey="modEnter" />)
    type('hi')
    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    // ⌘ on macOS, Ctrl elsewhere (jsdom's user agent decides which one counts)
    fireEvent.keyDown(textarea(), { key: 'Enter', metaKey: true, ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('queues with ⌥↵ or the queue button while a turn runs', () => {
    const onQueue = vi.fn()
    const onSubmit = vi.fn()
    const { rerender } = render(<Harness onQueue={onQueue} onSubmit={onSubmit} />)
    expect(screen.queryByRole('button', { name: '排队，本轮结束后发送' })).toBeNull()
    rerender(<Harness onQueue={onQueue} onSubmit={onSubmit} streaming />)
    type('next')
    fireEvent.click(screen.getByRole('button', { name: '排队，本轮结束后发送' }))
    fireEvent.keyDown(textarea(), { key: 'Enter', altKey: true })
    expect(onQueue).toHaveBeenCalledTimes(2)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
