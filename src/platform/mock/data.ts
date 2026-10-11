/**
 * storage:*, update:*, app:checkUpdate and the Office / chat-file preview channels for the mock bridge.
 * The web preview behaves like a development build: updating is unavailable (never a fake "up to date").
 */
import { STORAGE_CATEGORIES, type DocumentPreview, type StorageUsage } from '@aiwc/protocol'
import type { Handlers, MockContext } from './core'

type DataChannel =
  | 'storage:usage'
  | 'storage:clear'
  | 'storage:wipeAll'
  | 'file:previewDocument'
  | 'file:stageChatFile'
  | 'update:getState'
  | 'update:download'
  | 'update:install'
  | 'app:checkUpdate'

const MB = 1024 * 1024
const SIZES: Record<string, number> = {
  index: 412 * MB,
  plaintext: 1840 * MB,
  media: 236 * MB,
  conversations: 18 * MB,
  memory: 0.2 * MB,
  features: 3 * MB,
  skills: 1.2 * MB,
  pets: 6 * MB,
  workspace: 12 * MB,
  exports: 2 * MB,
  logs: 9 * MB,
  other: 0.4 * MB,
}

const DEMO_DOCX: DocumentPreview = {
  kind: 'docx',
  truncated: false,
  blocks: [
    { type: 'heading', level: 1, runs: [{ text: 'Weekly report' }] },
    { type: 'paragraph', runs: [{ text: 'Shipped: ' }, { text: 'file previews', bold: true }] },
    { type: 'listItem', level: 0, ordered: false, runs: [{ text: 'PDF, CSV, audio, video' }] },
    {
      type: 'table',
      rows: [
        ['Owner', 'Status'],
        ['Data', 'Done'],
      ],
    },
  ],
}

const DEMO_XLSX: DocumentPreview = {
  kind: 'xlsx',
  sheets: [
    {
      name: 'Sheet1',
      truncated: false,
      rows: [
        ['Name', 'Qty'],
        ['Apple', '3'],
      ],
    },
  ],
}

export function dataHandlers(ctx: MockContext): Pick<Handlers, DataChannel> {
  const sizes = { ...SIZES }
  const usage = (): StorageUsage => {
    const categories = STORAGE_CATEGORIES.map((id) => ({
      id,
      bytes: Math.round(sizes[id] ?? 0),
      files: Math.round((sizes[id] ?? 0) / 40_000),
      path: `/demo/aiwc/${id}`,
    }))
    return {
      dataRoot: '/demo/aiwc',
      totalBytes: categories.reduce((s, c) => s + c.bytes, 0),
      categories,
      measuredAt: Date.now(),
    }
  }
  return {
    'storage:usage': async () => {
      await ctx.delay(400)
      return usage()
    },
    'storage:clear': async ({ category }) => {
      await ctx.delay(700)
      const freedBytes = Math.round(sizes[category] ?? 0)
      sizes[category] = 0
      return { freedBytes }
    },
    'storage:wipeAll': async () => {
      await ctx.delay(300)
    },
    'file:previewDocument': async ({ path }) => {
      await ctx.delay(200)
      return path.toLowerCase().endsWith('.xlsx') ? DEMO_XLSX : DEMO_DOCX
    },
    'file:stageChatFile': async ({ messageId }) => {
      await ctx.delay(200)
      return { path: `/demo/aiwc/cache/previews/${messageId}.pdf`, fileName: `${messageId}.pdf` }
    },
    'update:getState': () => ({ status: { state: 'idle' }, unavailable: 'dev_build' }),
    'update:download': () => {
      throw new Error('[mockBridge] updates are unavailable in the web preview')
    },
    'update:install': () => {
      throw new Error('[mockBridge] updates are unavailable in the web preview')
    },
    'app:checkUpdate': () => {
      throw new Error('[mockBridge] updates are unavailable in the web preview')
    },
  }
}
