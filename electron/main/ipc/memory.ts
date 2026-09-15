import { isMemoryFile, type MemoryFile } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

export function registerMemoryIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const { memory } = ctx
  // The store refuses unknown names too; checking here first gives the renderer a clear error and keeps
  // an untrusted string from ever reaching path code.
  const memoryFile = (value: unknown): MemoryFile => {
    if (!isMemoryFile(value)) throw new Error(t('main.files.unknownMemoryFile'))
    return value
  }
  handle('memory:read', ({ file }) => memory.read(memoryFile(file)))
  handle('memory:write', ({ file, markdown }) => memory.write(memoryFile(file), markdown, { source: 'user' }))
  handle('memory:entries', ({ file }) => memory.entries(memoryFile(file)))
  handle('memory:budget', ({ file }) => memory.budget(memoryFile(file)))
  handle('memory:clear', async ({ file }) => {
    const checked = memoryFile(file)
    await memory.write(checked, '', { source: 'user' })
    ctx.toast({ kind: 'success', text: t('main.files.memoryCleared', { file: checked }) })
  })
}
