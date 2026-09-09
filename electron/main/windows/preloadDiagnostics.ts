/**
 * Turns renderer-side failures (preload could not load, page failed to load, renderer crashed) into
 * one actionable line for the log and for the `--smoke` run, which must fail fast instead of waiting
 * for an `app:getInfo` that will never come. Pure — no `electron` import — so it is unit-testable.
 */

export type RendererFaultKind = 'preload' | 'load' | 'crash'

export interface RendererFault {
  kind: RendererFaultKind
  detail: string
}

const ESM_IN_SCRIPT_RE = /Cannot use import statement outside a module|Unexpected token 'export'|import\.meta/i
const MISSING_FILE_RE = /ENOENT|no such file|Cannot find module/i

/**
 * Explains a `preload-error`. Electron runs a sandboxed preload as a plain CommonJS script, so the most
 * common cause is the bundler emitting it as an ES module (the build config, not the preload source).
 */
export function describePreloadError(preloadPath: string, error: { message: string }): string {
  const base = `preload script failed to load: ${preloadPath}: ${error.message}`
  if (ESM_IN_SCRIPT_RE.test(error.message)) {
    return (
      `${base} — the file was emitted as an ES module, but a sandboxed preload must be CommonJS. ` +
      `In vite.config.ts the preload entry must pass rollupOptions.output as an ARRAY ` +
      `([{ entryFileNames: 'preload.cjs', format: 'cjs' }]); vite-plugin-electron forces lib.formats=['es'] ` +
      `for a "type":"module" package and Vite overwrites a plain output.format with it.`
    )
  }
  if (MISSING_FILE_RE.test(error.message)) {
    return `${base} — the preload bundle is missing; run "vite build" (or "npm run dev") first.`
  }
  return base
}

/** One-line description of a `did-fail-load` (main frame only is the caller's concern). */
export function describeLoadFailure(url: string, errorCode: number, errorDescription: string): string {
  return `renderer failed to load ${url}: ${errorDescription} (${errorCode})`
}

/** One-line description of a `render-process-gone`. */
export function describeRendererGone(details: { reason: string; exitCode: number }): string {
  return `renderer process gone: ${details.reason} (exit code ${details.exitCode})`
}
