import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'

export function registerMemoryIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { memory } = ctx
  handle('memory:read', ({ file }) => memory.read(file))
  handle('memory:write', ({ file, markdown }) => memory.write(file, markdown, { source: 'user' }))
  handle('memory:entries', ({ file }) => memory.entries(file))
  handle('memory:budget', ({ file }) => memory.budget(file))
  handle('memory:clear', async ({ file }) => {
    await memory.write(file, '', { source: 'user' })
    ctx.toast({ kind: 'success', text: `${file}.md 已清空` })
  })
}
