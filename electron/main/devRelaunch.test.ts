import { describe, expect, it } from 'vitest'
import { DEV_RELAUNCH_ENV, relaunchesThroughDevServer } from './devRelaunch'

describe('relaunchesThroughDevServer', () => {
  it('only hands the relaunch to the dev server that spawned this unpackaged Electron', () => {
    expect(relaunchesThroughDevServer({ [DEV_RELAUNCH_ENV]: '1' }, false)).toBe(true)
    // `electron .` against a running dev server: nobody would restart it, so app.relaunch() it is.
    expect(relaunchesThroughDevServer({ VITE_DEV_SERVER_URL: 'http://localhost:5177/' }, false)).toBe(false)
    // An inherited variable must never change how a packaged build relaunches.
    expect(relaunchesThroughDevServer({ [DEV_RELAUNCH_ENV]: '1' }, true)).toBe(false)
  })
})
