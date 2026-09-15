/**
 * Where the vendor CLIs live. An app launched from Finder / the Dock gets PATH=/usr/bin:/bin:… — none
 * of the places npm, Homebrew or the dws installer put binaries — so the search path is: the app's
 * private install prefix, the user's login-shell PATH (probed once), then well-known bin dirs.
 */
import { execFile } from 'node:child_process'
import { constants, promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

export interface CliEnvOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  home?: string
  /** Searched before anything else (the app's private npm prefix bin). */
  preferredDirs?: readonly string[]
  /** Ask the login shell for PATH. Off in tests. Default: true on macOS / Linux. */
  probeLoginShell?: boolean
}

export interface CliEnv {
  /** PATH value handed to every CLI process. */
  path: string
  env: NodeJS.ProcessEnv
  which(name: string): Promise<string | undefined>
}

export function wellKnownBinDirs(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    return [
      env.APPDATA && join(env.APPDATA, 'npm'),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'dws'),
      join(home, '.local', 'bin'),
      join(home, 'scoop', 'shims'),
    ].filter((d): d is string => Boolean(d))
  }
  return [
    join(home, '.npm-global', 'bin'),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.volta', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, '.yarn', 'bin'),
    join(home, 'go', 'bin'),
    '/usr/bin',
    '/bin',
  ]
}

let loginShellPath: Promise<string | undefined> | undefined

const PATH_MARK = '__AIWC_PATH__'

/** `$SHELL -ilc 'printf …$PATH'`, once per process; undefined when the shell is slow or odd. */
export function probeLoginShellPath(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  loginShellPath ??= new Promise((done) => {
    const shell = env.SHELL && env.SHELL.startsWith('/') ? env.SHELL : '/bin/zsh'
    execFile(
      shell,
      ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`],
      { timeout: 4000, env, maxBuffer: 1_000_000 },
      (err, stdout) => {
        if (err && !stdout) return done(undefined)
        const m = new RegExp(`${PATH_MARK}(.*?)${PATH_MARK}`).exec(String(stdout))
        done(m?.[1] || undefined)
      },
    )
  })
  return loginShellPath
}

export async function createCliEnv(opts: CliEnvOptions = {}): Promise<CliEnv> {
  const platform = opts.platform ?? process.platform
  const base = opts.env ?? process.env
  const home = opts.home ?? homedir()
  const probe = opts.probeLoginShell ?? platform !== 'win32'
  const shellPath = probe ? await probeLoginShellPath(base) : undefined
  const pathKey = platform === 'win32' ? (Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'Path') : 'PATH'

  const dirs: string[] = []
  const add = (d: string | undefined) => {
    if (!d) return
    for (const part of d.split(delimiter)) {
      const trimmed = part.trim()
      if (trimmed && !dirs.includes(trimmed)) dirs.push(trimmed)
    }
  }
  for (const d of opts.preferredDirs ?? []) add(d)
  add(shellPath)
  add(base[pathKey])
  for (const d of wellKnownBinDirs(platform, home, base)) add(d)
  const path = dirs.join(delimiter)

  const env: NodeJS.ProcessEnv = {
    ...base,
    [pathKey]: path,
    // lark-cli: keep update / skills notices out of the JSON we parse.
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    // Never let a CLI think it is inside another agent's workspace.
    OPENCLAW_HOME: undefined,
    HERMES_HOME: undefined,
    NO_COLOR: '1',
  }
  const exts = platform === 'win32' ? ['.exe', '.cmd', ''] : ['']

  return {
    path,
    env,
    async which(name) {
      for (const dir of dirs) {
        for (const ext of exts) {
          const candidate = resolve(dir, name + ext)
          if (await isExecutable(candidate, platform)) return candidate
        }
      }
      return undefined
    },
  }
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fsp.stat(file)
    if (!stat.isFile()) return false
    if (platform === 'win32') return true
    await fsp.access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface ResolvedCommand {
  command: string
  /** Prepended to the CLI's own argv (e.g. the shim script when running through node). */
  prefixArgs: string[]
  env?: NodeJS.ProcessEnv
}

export interface NodeRuntime {
  command: string
  env?: NodeJS.ProcessEnv
}

/**
 * How to actually start `binPath`. Native binaries run directly. npm installs a JS shim: on POSIX it is
 * an executable with a `node` shebang (fine when node is on PATH, otherwise run it with `fallbackNode`,
 * e.g. Electron with ELECTRON_RUN_AS_NODE); on Windows it is a .cmd, which Node refuses to spawn without
 * a shell — so the JS target is read out of the shim and run with node, keeping argv shell-free.
 */
export async function resolveCommand(
  binPath: string,
  cliEnv: Pick<CliEnv, 'which'>,
  fallbackNode?: NodeRuntime,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedCommand> {
  const node = async (): Promise<NodeRuntime | undefined> => {
    const onPath = await cliEnv.which('node')
    return onPath ? { command: onPath } : fallbackNode
  }
  if (platform === 'win32' && /\.cmd$/i.test(binPath)) {
    const script = await shimTarget(binPath)
    const runtime = script ? await node() : undefined
    if (!script || !runtime) return { command: binPath, prefixArgs: [] }
    return { command: runtime.command, prefixArgs: [script], env: runtime.env }
  }
  let real = binPath
  try {
    real = await fsp.realpath(binPath)
  } catch {
    /* keep the link */
  }
  if (/\.(c|m)?js$/i.test(real) && !(await cliEnv.which('node')) && fallbackNode) {
    return { command: fallbackNode.command, prefixArgs: [real], env: fallbackNode.env }
  }
  return { command: binPath, prefixArgs: [] }
}

/** The JS file an npm .cmd shim points at: `"%dp0%\node_modules\…\run.js"`. */
async function shimTarget(cmdPath: string): Promise<string | undefined> {
  try {
    const text = await fsp.readFile(cmdPath, 'utf8')
    const m = /"%(?:~)?dp0%?\\([^"]+?\.(?:c|m)?js)"/i.exec(text)
    return m?.[1] ? join(dirname(cmdPath), m[1]) : undefined
  } catch {
    return undefined
  }
}
