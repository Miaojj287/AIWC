/**
 * Detect the running WeChat 4.x process and its version. All shell-outs have explicit timeouts and
 * never require elevation; failures degrade to "not running / unknown".
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const EXEC_TIMEOUT_MS = 4_000

export interface WeChatProcessInfo {
  pid: number
  /** executable / process name */
  name: string
  /** Windows: working set in KB (largest = main data process). */
  workingSetKb?: number
}

const MAC_PROCESS_NAMES = ['WeChat', 'Weixin']
const MAC_APP_PATHS = ['/Applications/WeChat.app', '/Applications/Weixin.app']

function parsePidList(output: string): number[] {
  return output
    .split(/\r?\n/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/** Parse `tasklist /FO CSV /NH` and put the largest Weixin.exe first. */
export function parseWindowsTasklist(output: string): WeChatProcessInfo[] {
  const processes: WeChatProcessInfo[] = []
  for (const line of output.trim().split(/\r?\n/)) {
    const fields = Array.from(line.matchAll(/"([^"]*)"/g), (m) => m[1] ?? '')
    const name = fields[0] ?? ''
    if (fields.length < 2 || !/^(weixin|wechat)\.exe$/i.test(name)) continue
    const pid = Number.parseInt(fields[1] ?? '', 10)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const workingSetKb = Number.parseInt(String(fields[4] ?? '').replace(/\D/g, ''), 10) || 0
    processes.push({ pid, name, workingSetKb })
  }
  return processes.sort((a, b) => (b.workingSetKb ?? 0) - (a.workingSetKb ?? 0))
}

/** Parse `ps -A -o pid,comm,command` for the WeChat main process (helpers excluded). */
export function parseMacPsOutput(output: string): WeChatProcessInfo[] {
  const result: WeChatProcessInfo[] = []
  for (const line of output.split(/\r?\n/).slice(1)) {
    const match = /^\s*(\d+)\s+(\S+)\s*(.*)$/.exec(line)
    if (!match) continue
    const pid = Number.parseInt(match[1] ?? '', 10)
    const comm = match[2] ?? ''
    const command = match[3] ?? ''
    const base = comm.split('/').pop() ?? comm
    const isMain = MAC_PROCESS_NAMES.includes(base) || /\/Contents\/MacOS\/(WeChat|Weixin)$/.test(command)
    const isHelper = /WeChatAppEx|Helper|crashpad_handler|XPCService/.test(command)
    if (isMain && !isHelper && pid > 0) result.push({ pid, name: base })
  }
  return result.sort((a, b) => b.pid - a.pid)
}

function macProcessesSync(): WeChatProcessInfo[] {
  for (const name of MAC_PROCESS_NAMES) {
    try {
      const out = execFileSync('/usr/bin/pgrep', ['-x', name], { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
      const pids = parsePidList(out)
      if (pids.length > 0) return pids.sort((a, b) => b - a).map((pid) => ({ pid, name }))
    } catch {
      // not found → next name
    }
  }
  try {
    const out = execFileSync('/bin/ps', ['-A', '-o', 'pid,comm,command'], { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
    return parseMacPsOutput(out)
  } catch {
    return []
  }
}

function windowsProcessesSync(): WeChatProcessInfo[] {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Weixin.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    return parseWindowsTasklist(out)
  } catch {
    return []
  }
}

/** All WeChat processes, most relevant first (sync; used by key acquisition loops). */
export function listWeChatProcessesSync(): WeChatProcessInfo[] {
  if (process.platform === 'darwin') return macProcessesSync()
  if (process.platform === 'win32') return windowsProcessesSync()
  return []
}

export function findWeChatPidSync(): number | null {
  return listWeChatProcessesSync()[0]?.pid ?? null
}

export async function listWeChatProcesses(): Promise<WeChatProcessInfo[]> {
  return listWeChatProcessesSync()
}

/** Parse the version out of `defaults read …/Info.plist CFBundleShortVersionString` or a plist dump. */
export function parseVersionString(output: string): string | undefined {
  const match = /(\d+\.\d+(?:\.\d+){0,2})/.exec(output)
  return match?.[1]
}

async function macVersion(): Promise<string | undefined> {
  for (const app of MAC_APP_PATHS) {
    const plist = `${app}/Contents/Info.plist`
    if (!existsSync(plist)) continue
    try {
      const { stdout } = await execFileAsync('/usr/bin/defaults', ['read', plist.replace(/\.plist$/, ''), 'CFBundleShortVersionString'], { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS })
      const version = parseVersionString(stdout)
      if (version) return version
    } catch {
      // try next bundle
    }
  }
  return undefined
}

async function windowsVersion(): Promise<string | undefined> {
  try {
    const script = '(Get-Process Weixin -ErrorAction SilentlyContinue | Select-Object -First 1).MainModule.FileVersionInfo.ProductVersion'
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, windowsHide: true })
    return parseVersionString(stdout)
  } catch {
    return undefined
  }
}

export async function readWeChatVersion(): Promise<string | undefined> {
  if (process.platform === 'darwin') return macVersion()
  if (process.platform === 'win32') return windowsVersion()
  return undefined
}
