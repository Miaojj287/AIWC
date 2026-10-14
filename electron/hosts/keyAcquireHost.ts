import { acquireKeys, inspectDbCredentials } from '@aiwc/substrate'
import { createKeyAcquireRuntime } from './keyAcquireRuntime'

const PARENT_CHECK_INTERVAL_MS = 250
const port = process.parentPort
const parentPid = process.ppid
const parentTimer = setInterval(() => {
  if (process.ppid !== parentPid) runtime.disconnect()
}, PARENT_CHECK_INTERVAL_MS)
const runtime = createKeyAcquireRuntime({
  post: (message) => port.postMessage(message),
  acquire: acquireKeys,
  inspect: ({ request, dbKeyHex, dbCredentials }) => inspectDbCredentials({ ...request, dbKeyHex, dbCredentials }),
  exit: () => {
    clearInterval(parentTimer)
    port.removeListener('message', onMessage)
    process.removeListener('SIGTERM', onDisconnect)
    process.removeListener('SIGINT', onDisconnect)
    // The parent port keeps Electron's utility alive; delivery and cleanup are already acknowledged.
    process.exit(0)
  },
})
const onMessage = (event: Electron.MessageEvent) => runtime.receive(event.data)
const onDisconnect = () => runtime.disconnect()
port.on('message', onMessage)
process.on('SIGTERM', onDisconnect)
process.on('SIGINT', onDisconnect)
