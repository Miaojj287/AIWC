// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabDescriptor } from '@/workspace/tabRegistry'
import { FileTab } from './FileTab'
import { listMarkers } from './FilePreviews'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(channel: string, req: unknown) => Promise<unknown>>(),
}))
vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, error: undefined, loading: false, reload: () => {} }),
}))

afterEach(() => {
  cleanup()
  invokeMock.mockReset()
})

const tab = (path: string): TabDescriptor => ({ id: `file:${path}`, kind: 'file', objectId: path, title: path })

function renderTab(path: string) {
  return render(<FileTab tab={tab(path)} active update={() => {}} requestClose={() => {}} />)
}

describe('FileTab previews', () => {
  it('shows an image that file:read returned as bare base64 (it used to say "unsupported")', async () => {
    invokeMock.mockResolvedValue({ content: 'iVBORw0KGgo=', mediaType: 'image/png' })
    renderTab('/data/cache/pic.png')
    const img = await screen.findByRole('img', { name: 'pic.png' })
    expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('renders a CSV file as a table', async () => {
    invokeMock.mockResolvedValue({ content: 'name,qty\napple,3\n', mediaType: 'text/csv' })
    renderTab('/data/exports/t.csv')
    expect(await screen.findByRole('columnheader', { name: 'qty' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'apple' })).toBeTruthy()
  })

  it('shows HTML in an empty sandbox', async () => {
    invokeMock.mockResolvedValue({ content: '<h1>Hi</h1><script>alert(1)</script>', mediaType: 'text/html' })
    const { container } = renderTab('/data/exports/page.html')
    await screen.findByTitle('page.html')
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toContain("default-src 'none'")
  })

  it('asks main to parse Word / Excel files instead of reading raw bytes', async () => {
    invokeMock.mockResolvedValue({
      kind: 'docx',
      truncated: false,
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: '周报' }] },
        { type: 'paragraph', runs: [{ text: '正文', bold: true }] },
      ],
    })
    renderTab('/data/exports/w.docx')
    expect(await screen.findByRole('heading', { name: '周报' })).toBeTruthy()
    expect(invokeMock).toHaveBeenCalledWith('file:previewDocument', { path: '/data/exports/w.docx' })
  })

  it('streams audio / video without reading the file', () => {
    const { container } = renderTab('/data/cache/clip.mp4')
    expect(container.querySelector('video')?.getAttribute('src')).toBe('aiwc-media:///data/cache/clip.mp4')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('listMarkers', () => {
  it('numbers ordered items per level and restarts after other blocks', () => {
    const item = (level: number, ordered = true) => ({ type: 'listItem' as const, level, ordered, runs: [] })
    expect(
      listMarkers([item(0), item(0), item(1), item(0), { type: 'paragraph', runs: [] }, item(0), item(0, false)]),
    ).toEqual(['1.', '2.', '1.', '3.', undefined, '1.', '•'])
  })
})
