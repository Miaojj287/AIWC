/**
 * file:* — restricted to the allow-list (data root, cache dir, directories the user picked this
 * session). Symlinks are resolved before the check (security/pathAllowList): reads follow them and
 * re-check the real path; writes refuse a symlink target outright and resolve the deepest existing
 * ancestor. Text files come back as UTF-8, binaries base64.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { shell } from 'electron'
import type { AppContext } from '../contracts'
import { isTextMediaType, mediaTypeFor, resolveAllowedExisting, resolveAllowedWriteTarget } from '../security/pathAllowList'
import type { Handle, HostBridge } from './register'

const MAX_READ_BYTES = 32 * 1024 * 1024

export function registerFileIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  handle('file:read', async ({ path }) => {
    const real = await resolveAllowedExisting(ctx.allowList, path)
    const st = await stat(real)
    if (!st.isFile()) throw new Error('不是文件')
    if (st.size > MAX_READ_BYTES) throw new Error('文件过大（超过 32 MB）')
    const mediaType = mediaTypeFor(real)
    const buf = await readFile(real)
    return { content: isTextMediaType(mediaType) ? buf.toString('utf8') : buf.toString('base64'), mediaType }
  })

  handle('file:write', async ({ path, content }) => {
    const target = await resolveAllowedWriteTarget(ctx.allowList, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  })

  handle('file:reveal', async ({ path }) => {
    const real = await resolveAllowedExisting(ctx.allowList, path)
    shell.showItemInFolder(real)
  })
}
