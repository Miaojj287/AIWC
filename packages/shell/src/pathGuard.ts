/**
 * Which of the app's own files a command line can reach, judged by where its words point rather than by
 * how they are spelled. A substring test on absolute paths misses `cat ../mirror.db`, `type ..\mirror.db`,
 * `Get-Content C:/…/mirror.db` and `cat "$AIWC_WORKSPACE/../extensions.json"`, so every word (and every
 * redirection target) is expanded where the expansion is known (`$AIWC_WORKSPACE`, `~`, `$HOME`, `$PWD`),
 * resolved against the directory the line runs in (following `cd`), normalised (separators; case on the
 * case-insensitive macOS / Windows filesystems) and only then compared with the protected paths.
 *
 * Without an OS sandbox nothing else stops a write or a read, so there the whole data root outside the
 * writable roots counts as protected. A word whose expansion is unknown but that names the data root's
 * folder or a protected file is treated as reaching it.
 */
import { posix, win32 } from 'node:path'
import type { CommandSegment } from './classify'

/** Where a line runs and what its paths may expand to; built per call by the shell tool. */
export interface PathContext {
  /** The directory the line starts in when the call names none (the workspace). */
  defaultCwd: string
  /** Values the line may reference: AIWC_WORKSPACE, HOME, USERPROFILE… */
  vars: Readonly<Record<string, string>>
  /** The app's data root: its folder name marks words whose expansion is unknown. */
  dataRoot?: string
  /** False = no OS sandbox this run: the data root outside `writableRoots` is protected as a whole. */
  sandboxed: boolean
  writableRoots: readonly string[]
  /** Real path of an existing file (symlinks resolved); undefined when it does not exist. */
  realpath?: (path: string) => string | undefined
}

export interface PathGuardOptions {
  protectedPaths?: readonly string[]
  cwd?: string
  platform?: NodeJS.Platform
  pathContext?: PathContext
}

export const PROTECTED_NOTE = '涉及 AIWC 自己的密钥或解密数据'
export const DATA_ROOT_NOTE = '沙箱外访问 AIWC 数据目录'

const CD_COMMANDS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location'])
const GLOB_CHARS = /[*?[{]/
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i
/** Redirection operators a word may start with or contain (`>out`, `2>>log`, `x>../f`). */
const REDIRECT_SPLIT = /\d?>>?|&>|>\||</
const VAR_RE =
  /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/gi

interface Guard {
  path: string
  kind: 'protected' | 'dataRoot'
}

/** The note for a line that reaches a protected path, or undefined. */
export function guardedPathNote(
  command: string,
  segments: readonly CommandSegment[],
  opts: PathGuardOptions,
): string | undefined {
  const platform = opts.platform ?? process.platform
  const P = platform === 'win32' ? win32 : posix
  const foldCase = platform === 'win32' || platform === 'darwin'
  const ctx = opts.pathContext
  const canon = (p: string): string => {
    const slashed = P.resolve(p).replace(/\\/g, '/')
    const trimmed =
      slashed.length > 1 && slashed.endsWith('/') && !/^[A-Za-z]:\/$/.test(slashed) ? slashed.slice(0, -1) : slashed
    return foldCase ? trimmed.toLowerCase() : trimmed
  }
  const within = (child: string, parent: string): boolean =>
    child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)

  const protectedCanon = new Set<string>()
  for (const p of opts.protectedPaths ?? []) {
    if (!p) continue
    protectedCanon.add(canon(p))
    const real = ctx?.realpath?.(p)
    if (real) protectedCanon.add(canon(real))
  }
  const dataRoot = ctx?.dataRoot ? canon(ctx.dataRoot) : undefined
  const writable = (ctx?.writableRoots ?? []).filter(Boolean).map(canon)
  const guardDataRoot = Boolean(ctx && !ctx.sandboxed && dataRoot)
  if (protectedCanon.size === 0 && !guardDataRoot) return undefined

  const check = (abs: string): Guard['kind'] | undefined => {
    for (const c of [canon(abs), ...(ctx?.realpath ? [ctx.realpath(abs)].filter(isString).map(canon) : [])]) {
      for (const g of protectedCanon) if (within(c, g)) return 'protected'
      if (guardDataRoot && dataRoot && within(c, dataRoot) && !writable.some((w) => within(c, w))) return 'dataRoot'
    }
    return undefined
  }
  const checkGlob = (abs: string): Guard['kind'] | undefined => {
    const parts = canon(abs).split('/')
    const k = parts.findIndex((part) => GLOB_CHARS.test(part))
    if (k < 0) return check(abs)
    const base = parts.slice(0, k).join('/') || '/'
    const pattern = parts.slice(k).map(globComponent)
    const reaches = (target: string): boolean => {
      if (within(base, target)) return true
      if (!within(target, base)) return false
      const rest = target.slice(base === '/' ? 1 : base.length + 1).split('/')
      for (let i = 0; i < Math.min(rest.length, pattern.length); i++) {
        const re = pattern[i]
        if (re === 'any') return true
        if (!re?.test(rest[i] ?? '')) return false
      }
      return true
    }
    for (const g of protectedCanon) if (reaches(g)) return 'protected'
    if (guardDataRoot && dataRoot && reaches(dataRoot) && !writable.some((w) => within(base, w))) return 'dataRoot'
    return undefined
  }

  // Names that mark a word with an unknown expansion as aimed at the app's data: the data root's folder
  // and protected file names (`$APPDATA/aiwc/…`, `$X/../mirror.db`).
  const markers = new Set<string>()
  if (dataRoot) markers.add(lastComponent(dataRoot))
  for (const g of protectedCanon) {
    const name = lastComponent(g)
    if (name.includes('.') || name.includes('-')) markers.add(name)
  }

  const vars = new Map<string, string>()
  for (const [k, v] of Object.entries(ctx?.vars ?? {})) if (v) vars.set(k.toUpperCase(), v)
  const home = vars.get('HOME') ?? vars.get('USERPROFILE')

  const startCwd = opts.cwd ?? ctx?.defaultCwd
  const cwds = new Set<string>(startCwd ? [startCwd] : [])
  // `cd ..; cat extensions.json`: every directory the line moves to is a place its words resolve against.
  let current = startCwd
  for (const seg of segments) {
    const head = (seg.argv[0] ?? '').toLowerCase()
    if (!CD_COMMANDS.has(head)) continue
    const target = seg.argv.slice(1).find((a) => !a.startsWith('-'))
    const expanded = target === undefined ? { path: home, unresolved: false } : expand(target, vars, home, current)
    if (!expanded.path || expanded.unresolved) continue
    current = current ? P.resolve(current, expanded.path) : P.resolve(expanded.path)
    cwds.add(current)
  }

  let hit: Guard['kind'] | undefined
  const note = (kind: Guard['kind'] | undefined) => {
    if (kind === 'protected') hit = 'protected'
    else if (kind === 'dataRoot' && !hit) hit = 'dataRoot'
  }
  for (const dir of cwds) note(check(dir))

  const words = new Set<string>()
  for (const seg of segments) for (const a of seg.argv) words.add(a)
  for (const w of rawWords(command, platform)) words.add(w)

  for (const word of words) {
    for (const candidate of candidatesOf(word)) {
      for (const dir of cwds.size > 0 ? cwds : new Set<string | undefined>([undefined])) {
        const { path, unresolved } = expand(candidate, vars, home, dir)
        if (unresolved) {
          const comps = path
            .replace(/\\/g, '/')
            .split('/')
            .map((c) => (foldCase ? c.toLowerCase() : c))
          if (comps.some((c) => markers.has(c))) note('protected')
          continue
        }
        if (!path) continue
        if (!P.isAbsolute(path) && !dir) continue
        const abs = dir ? P.resolve(dir, path) : P.resolve(path)
        note(GLOB_CHARS.test(path) ? checkGlob(abs) : check(abs))
      }
      if (hit === 'protected') return PROTECTED_NOTE
    }
  }
  return hit === 'dataRoot' ? DATA_ROOT_NOTE : hit === 'protected' ? PROTECTED_NOTE : undefined
}

const isString = (v: string | undefined): v is string => typeof v === 'string'

function lastComponent(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] ?? p
}

/** A word's possible path readings: itself, after a redirection operator, after `=` / `@` / PowerShell `-Name:`. */
function candidatesOf(word: string): string[] {
  const out = new Set<string>()
  const add = (s: string | undefined) => {
    // Not trimmed: a leading blank is where a lifted `$(…)` stood, which `expand` treats as unknown.
    if (s?.trim() && !URL_RE.test(s.trim())) out.add(s)
  }
  for (const piece of word.split(REDIRECT_SPLIT)) {
    if (piece.startsWith('-')) {
      const eq = piece.indexOf('=')
      if (eq > 0) add(piece.slice(eq + 1))
      const ps = /^-[A-Za-z][\w-]*:(.+)$/.exec(piece)
      if (ps) add(ps[1])
      continue
    }
    add(piece)
    if (piece.startsWith('@')) add(piece.slice(1))
    const eq = piece.indexOf('=')
    if (eq > 0) add(piece.slice(eq + 1))
  }
  return [...out]
}

/** Expand `~`, `$NAME`, `${NAME}`, `$env:NAME`, `%NAME%` where known; `$PWD` is the directory in use. */
function expand(
  word: string,
  vars: ReadonlyMap<string, string>,
  home: string | undefined,
  cwd: string | undefined,
): { path: string; unresolved: boolean } {
  let path = word
  let unresolved = false
  if (home && (path === '~' || path.startsWith('~/') || path.startsWith('~\\'))) path = home + path.slice(1)
  else if (path.startsWith('~')) unresolved = true
  path = path.replace(VAR_RE, (match, a?: string, b?: string, c?: string, d?: string) => {
    const name = (a ?? b ?? c ?? d ?? '').toUpperCase()
    const value = name === 'PWD' ? cwd : vars.get(name)
    if (value === undefined) {
      unresolved = true
      return match
    }
    return value
  })
  // A lifted `$(…)` / backtick leaves a blank in its place: whatever it printed is unknown.
  if (/\s/.test(path) && /^\s|\s[\\/]/.test(path)) unresolved = true
  return { path, unresolved }
}

/** Words of the raw line split on whitespace and shell operators, quotes dropped; backslash is a separator on Windows, an escape elsewhere. */
function rawWords(command: string, platform: NodeJS.Platform): string[] {
  const text = platform === 'win32' ? command : command.replace(/\\(.)/g, '$1')
  return text
    .split(/[\s|;&()`]+/)
    .map((w) => w.replace(/["']/g, ''))
    .filter(Boolean)
}

/** One glob path component as a matcher; `**` matches any depth. */
function globComponent(part: string): RegExp | 'any' {
  if (part === '**') return 'any'
  let re = ''
  for (let i = 0; i < part.length; i++) {
    const ch = part[i] as string
    if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else if (ch === '[') {
      const close = part.indexOf(']', i + 1)
      if (close < 0) re += '\\['
      else {
        re += `[${part
          .slice(i + 1, close)
          .replace(/^!/, '^')
          .replace(/\\/g, '\\\\')}]`
        i = close
      }
    } else if (ch === '{') {
      const close = part.indexOf('}', i + 1)
      if (close < 0) re += '\\{'
      else {
        re += `(?:${part
          .slice(i + 1, close)
          .split(',')
          .map(escapeRe)
          .join('|')})`
        i = close
      }
    } else re += escapeRe(ch)
  }
  return new RegExp(`^${re}$`)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
