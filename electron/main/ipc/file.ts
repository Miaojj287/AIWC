/**
 * file:* — restricted to the allow-list (data root, cache dir, directories the user picked this
 * session); file:write additionally refuses the app's own stores (paths.ts protectedDataPaths).
 * Symlinks are resolved before the check (security/pathAllowList): reads follow them and re-check the
 * real path; writes refuse a symlink target outright and resolve the deepest existing ancestor. Text
 * files come back as UTF-8, binaries base64. file:saveExport never takes a path: it writes generated
 * text into the exports folder under a sanitized name.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { shell } from 'electron'
import { z } from 'zod'
import type { InvokeReq } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import {
  assertNotProtectedWrite,
  isTextMediaType,
  mediaTypeFor,
  resolveAllowedExisting,
  resolveAllowedWriteTarget,
} from '../security/pathAllowList'
import { writeExport } from '../services/exporter'
import { looksLikeText } from '../services/preview/sniff'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

const MAX_READ_BYTES = 32 * 1024 * 1024
/** What mediaTypeFor answers for an extension it does not know. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream'
const SNIFFED_TEXT_TYPE = 'text/plain; charset=utf-8'
/** Longest base name file:saveExport accepts; writeExport sanitizes and shortens it further. */
const MAX_EXPORT_NAME_CHARS = 120
/** Largest generated export the renderer may hand over, in UTF-8 bytes. */
const MAX_EXPORT_BYTES = 5 * 1024 * 1024
type ExportExt = InvokeReq<'file:saveExport'>['ext']
/** Keyed by extension, so an extension added to the IPC contract does not compile until it is accepted here. */
const EXPORT_EXTS = { csv: 'csv' } as const satisfies { [E in ExportExt]: E }
/** What each export starts with: Excel reads a CSV in the system code page (garbling Chinese) without a UTF-8 BOM. */
const EXPORT_PREFIX: Readonly<Record<ExportExt, string>> = { csv: '\uFEFF' }

const saveExportSchema = z.strictObject({
  name: z.string().max(MAX_EXPORT_NAME_CHARS),
  ext: z.enum(EXPORT_EXTS),
  content: z.string(),
}) satisfies z.ZodType<InvokeReq<'file:saveExport'>>

export function registerFileIpc(ctx: AppContext, _host: HostBridge, handle: Handle): void {
  const log = ctx.logger.child('ipc:file')

  handle('file:read', async ({ path }) => {
    const real = await resolveAllowedExisting(ctx.allowList, path)
    const st = await stat(real)
    if (!st.isFile()) throw new Error(t('main.files.notAFile'))
    if (st.size > MAX_READ_BYTES) throw new Error(t('main.files.tooLarge', { mb: 32 }))
    const mediaType = mediaTypeFor(real)
    const buf = await readFile(real)
    if (isTextMediaType(mediaType)) return { content: buf.toString('utf8'), mediaType }
    // An extension with no known type (.ts, .yaml, .log…) is still text when its bytes say so.
    if (mediaType === UNKNOWN_MEDIA_TYPE && looksLikeText(buf))
      return { content: buf.toString('utf8'), mediaType: SNIFFED_TEXT_TYPE }
    return { content: buf.toString('base64'), mediaType }
  })

  handle('file:write', async ({ path, content }) => {
    const target = await resolveAllowedWriteTarget(ctx.allowList, path)
    // The data root is an allowed root, but its stores (extensions.json, tasks, config, keys…) change what
    // the app runs or sends: they are written only through their own validated IPC.
    await assertNotProtectedWrite([path, target], ctx.protectedPaths())
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  })

  handle('file:reveal', async ({ path }) => {
    const real = await resolveAllowedExisting(ctx.allowList, path)
    shell.showItemInFolder(real)
  })

  handle('file:saveExport', (raw) => {
    const parsed = saveExportSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      log.warn('rejected malformed file:saveExport request', { where: first?.path.join('.') || first?.code })
      throw new Error(t('main.ipc.operationFailed'))
    }
    const { name, ext, content } = parsed.data
    if (Buffer.byteLength(content, 'utf8') > MAX_EXPORT_BYTES)
      throw new Error(t('main.files.tooLarge', { mb: MAX_EXPORT_BYTES / (1024 * 1024) }))
    const prefix = EXPORT_PREFIX[ext]
    const body = content.startsWith(prefix) ? content : `${prefix}${content}`
    return { path: writeExport(ctx.paths.exportsDir, name, ext, body) }
  })
}
