/**
 * Static classification of a shell command line into the approval matrix's four risks. This is the
 * framework's answer to "the agent reads untrusted text all day": a command is judged by what it can
 * do, not by who asked for it. Reads run silently, writes ask once and can be allow-listed by prefix,
 * anything that leaves the machine asks every time it changes, and the destructive class (recursive
 * deletes, privilege escalation, piping downloads into an interpreter, touching credential files)
 * can never be pre-approved.
 *
 * The parser is deliberately conservative: anything it cannot understand is a write, never a read.
 */
import type { ToolRisk } from '@aiwc/protocol'

export interface CommandSegment {
  argv: string[]
  raw: string
}

export interface CommandPolicy {
  risk: ToolRisk
  /** `shell:git commit` — what "总是允许" stores; one key per distinct command prefix in the line. */
  allowKey: string
  note?: string
  segments: CommandSegment[]
}

/** Extra per-segment rules (vendor CLIs); the first classifier that returns wins for that segment. */
export type SegmentClassifier = (argv: string[]) => { risk: ToolRisk; note?: string; allowKey?: string } | undefined

export interface ClassifyOptions {
  classifiers?: readonly SegmentClassifier[]
  /** Paths whose mention makes a command destructive (the app's own secret store, decrypted mirror…). */
  protectedPaths?: readonly string[]
  platform?: NodeJS.Platform
}

const ORDER: Record<ToolRisk, number> = { read: 0, write: 1, send: 2, destructive: 3 }
export const maxRisk = (a: ToolRisk, b: ToolRisk): ToolRisk => (ORDER[a] >= ORDER[b] ? a : b)

// ---- tokenizer ---------------------------------------------------------------------------------

/**
 * Split a command line into pipeline segments, each an argv. Handles quotes, escapes, `|`, `||`,
 * `&&`, `;`, `&`, newlines, subshell parens, and lifts `$(…)` / backtick substitutions out as their
 * own segments so a command hidden inside `echo $(rm -rf ~)` is still seen.
 */
export function splitCommand(command: string): CommandSegment[] {
  const segments: CommandSegment[] = []
  let argv: string[] = []
  let token = ''
  let hasToken = false
  let rawStart = 0
  let i = 0
  const flushToken = () => {
    if (hasToken) argv.push(token)
    token = ''
    hasToken = false
  }
  const flushSegment = (end: number) => {
    flushToken()
    if (argv.length > 0) segments.push({ argv, raw: command.slice(rawStart, end).trim() })
    argv = []
    rawStart = end
  }
  const lift = (inner: string) => {
    for (const s of splitCommand(inner)) segments.push(s)
  }
  while (i < command.length) {
    const ch = command[i] as string
    const next = command[i + 1]
    if (ch === '\\' && next !== undefined) {
      token += next
      hasToken = true
      i += 2
      continue
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      const body = end < 0 ? command.slice(i + 1) : command.slice(i + 1, end)
      token += body
      hasToken = true
      i = end < 0 ? command.length : end + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let body = ''
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) {
          body += command[j + 1]
          j += 2
          continue
        }
        if (command[j] === '$' && command[j + 1] === '(') {
          const close = matchParen(command, j + 1)
          lift(command.slice(j + 2, close))
          body += ' '
          j = close + 1
          continue
        }
        body += command[j]
        j++
      }
      token += body
      hasToken = true
      i = j + 1
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1)
      lift(end < 0 ? command.slice(i + 1) : command.slice(i + 1, end))
      token += ' '
      hasToken = true
      i = end < 0 ? command.length : end + 1
      continue
    }
    if (ch === '$' && next === '(') {
      const close = matchParen(command, i + 1)
      lift(command.slice(i + 2, close))
      token += ' '
      hasToken = true
      i = close + 1
      continue
    }
    if (ch === '|' || ch === ';' || ch === '\n' || ch === '&' || ch === '(' || ch === ')') {
      flushSegment(i)
      while (i < command.length && '|;&\n() \t'.includes(command[i] as string)) i++
      rawStart = i
      continue
    }
    if (ch === ' ' || ch === '\t') {
      flushToken()
      i++
      continue
    }
    token += ch
    hasToken = true
    i++
  }
  flushSegment(command.length)
  return segments
}

function matchParen(text: string, open: number): number {
  let depth = 0
  for (let k = open; k < text.length; k++) {
    if (text[k] === '(') depth++
    else if (text[k] === ')') {
      depth--
      if (depth === 0) return k
    }
  }
  return text.length
}

// ---- vocabulary ----------------------------------------------------------------------------------

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'fd', 'pwd', 'echo', 'printf',
  'which', 'whereis', 'type', 'command', 'file', 'stat', 'du', 'df', 'date', 'cal', 'uname', 'whoami', 'id', 'printenv', 'env',
  'basename', 'dirname', 'realpath', 'readlink', 'tree', 'sort', 'uniq', 'cut', 'awk', 'tr', 'jq', 'yq', 'diff', 'cmp', 'md5',
  'md5sum', 'shasum', 'sha256sum', 'base64', 'xxd', 'hexdump', 'od', 'strings', 'column', 'paste', 'comm', 'nl', 'tac', 'rev',
  'fold', 'true', 'false', 'test', '[', 'sleep', 'ps', 'lsof', 'netstat', 'ifconfig', 'sw_vers', 'mdfind', 'mdls', 'otool', 'nm',
  'seq', 'expr', 'bc', 'dc', 'tput', 'locale', 'hostname', 'uptime', 'w', 'last', 'groups', 'arch', 'nproc', 'sysctl', 'plutil',
  'xcode-select', 'xcrun', 'iconv', 'zcat', 'gunzip', 'gzip', 'tar', 'unzip', 'zip', 'pandoc', 'wc', 'look', 'man', 'help', 'ls',
  'pbpaste', 'Get-ChildItem', 'Get-Content', 'Get-Item', 'Get-Location', 'Get-Date', 'Get-Process', 'Select-String', 'dir', 'type',
  'findstr', 'where', 'ver', 'systeminfo', 'tasklist', 'ipconfig', 'Write-Output', 'Write-Host',
])
// `tar`, `zip`, `gzip`, `pandoc`, `iconv` write files — but only where they are told; the sandbox keeps
// that inside the workspace, so they are treated as reads for approval purposes like `sort > file` is.

const NETWORK = new Set([
  'curl', 'wget', 'http', 'https', 'xh', 'httpie', 'aria2c', 'nc', 'ncat', 'netcat', 'telnet', 'ssh', 'scp', 'sftp', 'ftp',
  'rsync', 'mail', 'mailx', 'sendmail', 'msmtp', 'mutt', 'openssl', 'dig', 'nslookup', 'ping', 'traceroute', 'gh', 'glab',
  'Invoke-WebRequest', 'Invoke-RestMethod', 'iwr', 'irm', 'Send-MailMessage',
])

const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'fish', 'ksh', 'dash', 'python', 'python3', 'node', 'perl', 'ruby', 'php', 'deno', 'bun', 'osascript', 'pwsh', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'])

const DESTRUCTIVE_COMMANDS = new Set([
  'sudo', 'su', 'doas', 'dd', 'mkfs', 'newfs', 'fdisk', 'gdisk', 'parted', 'shutdown', 'reboot', 'halt', 'poweroff', 'nvram',
  'csrutil', 'spctl', 'tccutil', 'killall', 'pkill', 'crontab', 'at', 'launchctl', 'systemctl', 'service', 'chroot', 'mount',
  'umount', 'diskpart', 'format', 'bcdedit', 'reg', 'Remove-Item', 'rd', 'rmdir', 'del', 'erase',
])

/** Credentials and the app's own decrypted data: any command that names them cannot be pre-approved. */
const SECRET_PATH_RE = /(?:^|[\s/"'=])(?:\.ssh\/|\.aws\/|\.gnupg\/|\.netrc\b|\.npmrc\b|\.pypirc\b|\.docker\/config\.json|credentials\.enc\b|secrets\.bin\b|Library\/Keychains\/|\.env(?:\.[\w-]+)?\b|id_rsa\b|id_ed25519\b)/

const TRANSPARENT_WRAPPERS = new Set(['env', 'nohup', 'time', 'nice', 'ionice', 'command', 'exec', 'builtin', 'caffeinate', 'timeout', 'gtimeout', 'xargs', 'watch'])

// ---- per-segment rules -----------------------------------------------------------------------------

interface Verdict {
  risk: ToolRisk
  note?: string
  /** Prefix words for the allow key; defaults to argv0 + up to two non-flag words. */
  prefix?: string[]
}

function basename(word: string): string {
  const stripped = word.replace(/^["']|["']$/g, '')
  const parts = stripped.split(/[\\/]/)
  return parts[parts.length - 1] ?? stripped
}

/** Drop leading `FOO=bar` assignments and transparent wrappers (`env`, `nohup`, `time`…). */
function unwrap(argv: string[]): string[] {
  let a = argv
  for (let guard = 0; guard < 6 && a.length > 0; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0] as string)) {
      a = a.slice(1)
      continue
    }
    const head = basename(a[0] as string)
    if (TRANSPARENT_WRAPPERS.has(head)) {
      // `timeout 30 cmd`, `xargs -0 cmd`: skip the wrapper's own numeric / flag arguments.
      let k = 1
      while (k < a.length && (/^-/.test(a[k] as string) || (head === 'timeout' && /^\d/.test(a[k] as string)))) k++
      if (head === 'env') while (k < a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[k] as string)) k++
      a = a.slice(k)
      continue
    }
    break
  }
  return a
}

const RECURSIVE_FLAG = /^-[a-zA-Z]*[rR]/
const FORCE_FLAG = /^-[a-zA-Z]*f/

function classifyGit(args: string[]): Verdict {
  const sub = args[0] ?? ''
  const rest = args.slice(1)
  const prefix = ['git', sub]
  switch (sub) {
    case 'status': case 'log': case 'diff': case 'show': case 'rev-parse': case 'blame': case 'ls-files': case 'ls-tree':
    case 'cat-file': case 'describe': case 'grep': case 'shortlog': case 'reflog': case 'ls-remote': case 'var': case 'help':
    case 'version': case '--version': case 'check-ignore': case 'rev-list': case 'name-rev':
      return { risk: 'read', prefix }
    case 'branch':
      return rest.some((a) => /^-[a-zA-Z]*[dDmM]/.test(a) || a === '--delete' || a === '--move') ? { risk: 'destructive', prefix, note: '删除或重命名分支' } : rest.length === 0 || rest.every((a) => a.startsWith('-')) ? { risk: 'read', prefix } : { risk: 'write', prefix }
    case 'tag':
      return rest.length === 0 || rest.every((a) => a === '-l' || a === '--list' || a === '-n') ? { risk: 'read', prefix } : rest.includes('-d') || rest.includes('--delete') ? { risk: 'destructive', prefix } : { risk: 'write', prefix }
    case 'remote':
      return rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url' ? { risk: 'read', prefix } : { risk: 'write', prefix }
    case 'stash':
      return rest[0] === 'list' || rest[0] === 'show' ? { risk: 'read', prefix } : rest[0] === 'drop' || rest[0] === 'clear' ? { risk: 'destructive', prefix } : { risk: 'write', prefix }
    case 'config':
      return rest.some((a) => a === '--get' || a === '-l' || a === '--list' || a === '--get-all' || a === '--get-regexp') ? { risk: 'read', prefix } : { risk: 'write', prefix }
    case 'worktree':
      return rest[0] === 'list' ? { risk: 'read', prefix } : rest[0] === 'remove' || rest[0] === 'prune' ? { risk: 'destructive', prefix } : { risk: 'write', prefix }
    case 'push':
      return rest.some((a) => a === '-f' || a === '--force' || a.startsWith('+') || a === '--delete' || a === '-d' || a === '--force-with-lease') ? { risk: 'destructive', prefix, note: '强制推送或删除远端分支' } : { risk: 'send', prefix, note: '推送到远端仓库' }
    case 'reset':
      return rest.includes('--hard') || rest.includes('--merge') ? { risk: 'destructive', prefix, note: '丢弃工作区改动' } : { risk: 'write', prefix }
    case 'clean':
      return rest.some((a) => FORCE_FLAG.test(a) || a === '--force') ? { risk: 'destructive', prefix, note: '删除未跟踪文件' } : { risk: 'read', prefix }
    case 'checkout': case 'restore': case 'switch':
      return rest.includes('--') || rest.includes('.') || rest.some((a) => a === '-f' || a === '--force') ? { risk: 'destructive', prefix, note: '覆盖工作区文件' } : { risk: 'write', prefix }
    case 'filter-branch': case 'filter-repo': case 'gc': case 'prune':
      return { risk: 'destructive', prefix }
    default:
      return { risk: 'write', prefix }
  }
}

function classifyPackageManager(tool: string, args: string[]): Verdict {
  const sub = args[0] ?? ''
  const prefix = [tool, sub]
  if (['ls', 'list', 'view', 'info', 'show', 'outdated', 'why', 'explain', 'search', 'help', 'ping', 'root', 'prefix', 'bin', '-v', '--version', 'version', 'audit', 'doctor', 'leaves', 'deps', 'freeze', 'check', 'config', 'cache'].includes(sub)) {
    if (sub === 'config' && !(args[1] === 'get' || args[1] === 'list' || args[1] === 'ls')) return { risk: 'write', prefix }
    if (sub === 'cache' && args[1] !== 'ls' && args[1] !== 'verify') return { risk: 'write', prefix }
    return { risk: 'read', prefix }
  }
  if (sub === 'publish' || sub === 'deprecate' || sub === 'unpublish' || sub === 'login' || sub === 'adduser' || sub === 'token') return { risk: sub === 'unpublish' ? 'destructive' : 'send', prefix, note: '会把内容发布到公共仓库' }
  if (sub === 'uninstall' || sub === 'remove' || sub === 'rm' || sub === 'un' || sub === 'prune') return { risk: args.includes('-g') || args.includes('--global') ? 'destructive' : 'write', prefix }
  return { risk: 'write', prefix }
}

function classifySegment(argvIn: string[], opts: ClassifyOptions): Verdict {
  const argv = unwrap(argvIn)
  if (argv.length === 0) return { risk: 'read', prefix: [] }
  const head = basename(argv[0] as string)
  const args = argv.slice(1)
  const joined = argvIn.join(' ')

  for (const classify of opts.classifiers ?? []) {
    const hit = classify(argv)
    if (hit) return { risk: hit.risk, note: hit.note, prefix: hit.allowKey ? hit.allowKey.split(' ') : undefined }
  }

  if (opts.protectedPaths?.some((p) => p && joined.includes(p))) return { risk: 'destructive', note: '涉及 AIWC 自己的密钥或解密数据' }
  if (SECRET_PATH_RE.test(joined)) return { risk: 'destructive', note: '涉及凭证文件（SSH / 云服务 / 环境变量密钥）' }

  if (DESTRUCTIVE_COMMANDS.has(head)) {
    if (head === 'crontab' && args.includes('-l')) return { risk: 'read' }
    if (head === 'launchctl' && (args[0] === 'list' || args[0] === 'print')) return { risk: 'read' }
    if (head === 'systemctl' && (args[0] === 'status' || args[0] === 'list-units' || args[0] === 'is-active')) return { risk: 'read' }
    if (head === 'reg' && args[0] === 'query') return { risk: 'read' }
    if ((head === 'rmdir' || head === 'rd') && !args.some((a) => RECURSIVE_FLAG.test(a) || /^\/s$/i.test(a))) return { risk: 'write' }
    return { risk: 'destructive', note: head === 'sudo' || head === 'su' || head === 'doas' ? '需要管理员权限' : `${head} 会改变系统或不可恢复` }
  }
  if (head === 'rm') {
    const recursive = args.some((a) => RECURSIVE_FLAG.test(a) || a === '--recursive')
    const dangerousTarget = args.some((a) => !a.startsWith('-') && (/^(\/|~|\$HOME|\*|\.\.?)\/?$/.test(a) || /^\/(Users|home|Library|System|Applications|usr|etc|var|private)\b/.test(a)))
    return recursive || dangerousTarget ? { risk: 'destructive', note: '递归删除或删除系统目录' } : { risk: 'write' }
  }
  if (head === 'chmod' || head === 'chown' || head === 'chgrp' || head === 'chflags') return args.some((a) => RECURSIVE_FLAG.test(a)) ? { risk: 'destructive', note: '递归修改权限' } : { risk: 'write' }
  if (head === 'kill') return args.some((a) => /^-?(9|KILL|-1)$/.test(a)) && args.includes('-1') ? { risk: 'destructive' } : { risk: 'write' }
  if (head === 'defaults') return args[0] === 'read' || args[0] === 'domains' || args[0] === 'find' ? { risk: 'read', prefix: ['defaults', 'read'] } : { risk: 'destructive', note: '修改系统偏好设置' }
  if (head === 'diskutil') return args[0] === 'list' || args[0] === 'info' || args[0] === 'apfs' && args[1] === 'list' ? { risk: 'read' } : { risk: 'destructive', note: '磁盘操作' }
  if (head === 'security') return { risk: 'destructive', note: '访问钥匙串' }
  if (head === 'sysctl') return args.some((a) => a === '-w' || a.includes('=')) ? { risk: 'destructive' } : { risk: 'read' }
  if (head === 'git') return classifyGit(args)
  if (['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pip', 'pip3', 'brew', 'gem', 'cargo', 'go', 'uv', 'poetry', 'conda'].includes(head)) {
    if (head === 'npx' || (head === 'bun' && args[0] === 'x')) return { risk: 'write', prefix: [head, args[head === 'bun' ? 1 : 0] ?? ''] }
    return classifyPackageManager(head, args)
  }
  if (NETWORK.has(head)) {
    if (head === 'openssl' && !args.includes('s_client')) return { risk: 'write' }
    if ((head === 'gh' || head === 'glab') && ['repo', 'pr', 'issue', 'run', 'api', 'release', 'gist'].includes(args[0] ?? '') && ['view', 'list', 'status', 'diff', 'checks'].includes(args[1] ?? '')) return { risk: 'read', prefix: [head, args[0] as string, args[1] as string] }
    return { risk: 'send', note: '会访问网络', prefix: [head] }
  }
  if (INTERPRETERS.has(head)) {
    // `sh -c '…'`: judge the inner command line, not the interpreter.
    const cIndex = args.findIndex((a) => a === '-c' || a === '-lc' || a === '-e' || a === '-Command' || a === '-C')
    if (cIndex >= 0 && (head === 'sh' || head === 'bash' || head === 'zsh' || head === 'dash' || head === 'ksh' || head === 'fish')) {
      const inner = args[cIndex + 1]
      if (inner) {
        const innerPolicy = classifyCommand(inner, opts)
        return { risk: maxRisk('write', innerPolicy.risk), note: innerPolicy.note, prefix: [head, '-c'] }
      }
    }
    if (head === 'osascript') return { risk: 'send', note: '可以控制其他应用（包括发送消息）' }
    return { risk: 'write', prefix: [head, args.find((a) => !a.startsWith('-')) ?? ''] }
  }
  if (head === 'open' || head === 'start' || head === 'xdg-open') return { risk: 'write' }
  if (READ_ONLY.has(head)) {
    if (head === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a))) return { risk: 'write' }
    if (head === 'find' && args.some((a) => a === '-delete' || a === '-exec' || a === '-execdir' || a === '-ok')) {
      const exec = args.indexOf('-exec') >= 0 ? args.slice(args.indexOf('-exec') + 1) : args.slice(args.indexOf('-execdir') + 1)
      const inner = exec.length > 0 ? classifySegment(exec, opts) : { risk: 'write' as ToolRisk }
      return args.includes('-delete') ? { risk: 'destructive', note: 'find -delete' } : { risk: maxRisk('write', inner.risk), note: inner.note }
    }
    if (head === 'tar' && args.some((a) => /^-?[a-zA-Z]*x/.test(a))) return { risk: 'write' }
    if (head === 'unzip' || head === 'gunzip') return { risk: 'write' }
    return { risk: 'read' }
  }
  if (head === 'sed') return { risk: 'write' }
  return { risk: 'write' }
}

// ---- line-level rules -------------------------------------------------------------------------------

const REDIRECT_RE = /(?:^|\s)(?:\d?>>?|&>|>\|)\s*(\S+)/g
const HEREDOC_RE = /<<-?\s*['"]?\w+/

/** Classify a whole command line; the line's risk is the highest of its parts. */
export function classifyCommand(command: string, opts: ClassifyOptions = {}): CommandPolicy {
  const segments = splitCommand(command)
  let risk: ToolRisk = 'read'
  const notes: string[] = []
  const prefixes: string[] = []
  let sawNetwork = false
  let sawSecrets = false

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as CommandSegment
    const v = classifySegment(seg.argv, opts)
    const unwrapped = unwrap(seg.argv)
    const head = unwrapped[0] ? basename(unwrapped[0]) : ''
    if (NETWORK.has(head)) sawNetwork = true
    if (SECRET_PATH_RE.test(seg.raw) || opts.protectedPaths?.some((p) => p && seg.raw.includes(p))) sawSecrets = true
    // Output of a previous segment fed into an interpreter: remote content executed as code.
    if (i > 0 && INTERPRETERS.has(head) && !unwrapped.slice(1).some((a) => a === '-c' || a === '-e')) {
      risk = 'destructive'
      notes.push('把前一步的输出交给解释器执行')
    }
    if (head === 'eval' || head === 'source' || head === '.') {
      risk = 'destructive'
      notes.push('eval / source 会执行任意内容')
    }
    risk = maxRisk(risk, v.risk)
    if (v.note) notes.push(v.note)
    const prefix = (v.prefix ?? defaultPrefix(unwrapped)).filter(Boolean).join(' ')
    if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix)
  }

  // Redirections write files; into a device they can wipe a disk.
  for (const m of command.matchAll(REDIRECT_RE)) {
    const target = m[1] as string
    if (/^\/dev\/(r?disk|sd|nvme|null|stdout|stderr|tty)/.test(target)) {
      if (!/^\/dev\/(null|stdout|stderr|tty)/.test(target)) {
        risk = 'destructive'
        notes.push('直接写入设备')
      }
      continue
    }
    risk = maxRisk(risk, 'write')
  }
  if (HEREDOC_RE.test(command)) risk = maxRisk(risk, 'write')
  if (sawNetwork && sawSecrets) {
    risk = 'destructive'
    notes.push('凭证文件与网络命令出现在同一条命令里')
  }
  if (/\bfork\s*bomb|:\(\)\s*\{/.test(command)) risk = 'destructive'

  const allowKey = `shell:${prefixes.length > 0 ? prefixes.join(' | ') : command.trim().split(/\s+/).slice(0, 2).join(' ')}`.slice(0, 120)
  return { risk, allowKey, note: notes.length > 0 ? [...new Set(notes)].join('；') : undefined, segments }
}

/** Tools whose first words are a subcommand path worth keeping in the allow key (`docker compose up`). */
const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'brew', 'docker', 'kubectl', 'gh', 'glab', 'cargo', 'go', 'uv', 'poetry', 'conda', 'gem', 'lark-cli', 'dws', 'wecom-cli', 'aws', 'gcloud', 'az', 'vercel', 'wrangler', 'supabase', 'firebase', 'flutter', 'xcodebuild', 'swift', 'dotnet', 'mvn', 'gradle', 'make', 'just', 'rake', 'bundle', 'composer', 'php', 'ruby'])

/**
 * argv0, plus up to two subcommand words for tools that have them — `lark-cli base +record-list`,
 * `git commit`. Plain commands keep only their name, so `cp a b` and `cp c d` share one key.
 */
function defaultPrefix(argv: string[]): string[] {
  if (argv.length === 0) return []
  const head = basename(argv[0] as string)
  const out = [head]
  if (!SUBCOMMAND_TOOLS.has(head)) return out
  for (const a of argv.slice(1)) {
    if (out.length >= 3) break
    if (!/^\+?[A-Za-z][A-Za-z0-9_.:-]*$/.test(a) || a.length > 40) break
    out.push(a)
  }
  return out
}
