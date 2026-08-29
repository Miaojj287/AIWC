import { wxKeyServiceMac } from '../electron/services/wxKeyServiceMac'

const dbRoot = process.argv[2]
if (process.platform !== 'darwin' || !dbRoot) {
  console.log(JSON.stringify({ skipped: true, reason: 'usage: probe-macos-lldb-key.ts <db-root>' }))
  process.exit(0)
}

async function main(): Promise<void> {
  if (process.argv.includes('--restart') && wxKeyServiceMac.isWeChatRunning()) {
    wxKeyServiceMac.killWeChat()
    await wxKeyServiceMac.waitForWeChatExit(20)
  }

  const result = await wxKeyServiceMac.captureDbKeyOnLaunch(undefined, dbRoot, 90_000)
  console.log(JSON.stringify({
    success: result.success,
    capturedBytes: result.key?.length === 64 ? 32 : 0,
    keyExposed: false,
    error: result.success ? undefined : result.error
  }))
}

void main()
