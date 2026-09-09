/**
 * `aiwc-media://` — serves decrypted media / cached files to the renderer WITHOUT enabling
 * file:// access. Only paths under the allow-list (cache/media, the data root, and directories the
 * user picked this session) are served; symlinks are resolved before the check.
 */
import { realpath, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import type { Logger } from '../log'
import { mediaTypeFor, parseMediaUrl, type AllowList } from '../security/pathAllowList'

export const MEDIA_SCHEME = 'aiwc-media'

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: false },
    },
  ])
}

const deny = (status: number, text: string) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export function registerMediaProtocol(deps: { allowList: AllowList; logger: Logger }): void {
  const log = deps.logger.child('media')
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const requested = parseMediaUrl(request.url)
    if (!requested) return deny(400, 'Bad Request')
    if (!deps.allowList.isAllowed(requested)) {
      log.warn('blocked media path (allow-list)', { path: requested })
      return deny(403, 'Forbidden')
    }
    let real: string
    try {
      real = await realpath(requested)
    } catch {
      return deny(404, 'Not Found')
    }
    if (!deps.allowList.isAllowed(real)) {
      log.warn('blocked media path (symlink escaped allow-list)', { path: requested, real })
      return deny(403, 'Forbidden')
    }
    let size: number
    try {
      const st = await stat(real)
      if (!st.isFile()) return deny(404, 'Not Found')
      size = st.size
    } catch {
      return deny(404, 'Not Found')
    }

    // net.fetch(file://) gives us Range support for <video>/<audio> for free.
    const range = request.headers.get('range')
    const upstream = await net.fetch(pathToFileURL(real).toString(), range ? { headers: { range } } : undefined)
    const headers = new Headers()
    headers.set('content-type', mediaTypeFor(real))
    headers.set('cache-control', 'private, max-age=3600')
    headers.set('accept-ranges', 'bytes')
    for (const h of ['content-range', 'content-length']) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    if (!headers.has('content-length') && upstream.status === 200) headers.set('content-length', String(size))
    return new Response(upstream.body, { status: upstream.status, headers })
  })
}
