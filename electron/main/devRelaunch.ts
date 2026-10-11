/**
 * Relaunching under `npm run dev`. vite-plugin-electron stops the dev server as soon as Electron exits, so
 * `app.relaunch()` would start an instance that loads a dead VITE_DEV_SERVER_URL and sits on a blank window
 * while holding the single-instance lock (every later `npm run dev` then quits at once). Instead the
 * Electron spawned by vite.config.ts exits with DEV_RELAUNCH_EXIT_CODE and vite.config.ts starts it again.
 * No Electron import: vite.config.ts reads these constants too.
 */

/** Exit code that asks vite.config.ts to start Electron again (EX_TEMPFAIL: "try again"). */
export const DEV_RELAUNCH_EXIT_CODE = 75

/** Set by vite.config.ts on the Electron it spawns; only that parent knows how to restart it. */
export const DEV_RELAUNCH_ENV = 'AIWC_DEV_RELAUNCH'

/** Whether a relaunch must go through the dev server's restart instead of `app.relaunch()`. */
export function relaunchesThroughDevServer(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  return !isPackaged && env[DEV_RELAUNCH_ENV] === '1'
}
