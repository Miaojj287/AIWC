/**
 * The OS permissions WeChat auto-send (keyboard injection) needs, as the auto-reply page shows them before and
 * while a rule sends:
 *  - macOS 辅助功能 (Accessibility): checked live (`isTrustedAccessibilityClient(false)`, never prompts).
 *  - macOS 自动化 (Apple Events to WeChat / System Events): there is no prompt-free query, so it is what the
 *    last real attempt showed — a verified send proves it, an `automation-denied` halt disproves it.
 *  - `stale`: Accessibility was granted to an earlier build (version or binary changed) and is refused now.
 *    macOS keys the grant to the exact binary, so after an update the switch still looks on; the fix is to
 *    remove the app from the list and add it again.
 * Windows needs neither; Linux has no injector at all.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { AutoSendHaltCode, AutoSendPermissions, OsPermissionState } from '@aiwc/protocol'

/** What was last observed, persisted so a restart after an update can still tell "stale" from "never granted". */
export interface PermissionMemory {
  /** Build fingerprint under which Accessibility was last seen granted. */
  accessibilityGrantedFor?: string
  automation?: 'granted' | 'denied'
}

export interface AutoSendPermissionDeps {
  platform: NodeJS.Platform
  /** systemPreferences.isTrustedAccessibilityClient(false) on macOS. */
  isAccessibilityTrusted: () => boolean
  /** Identifies this exact build (version + executable); changes on update. */
  fingerprint: () => string
  load: () => PermissionMemory
  save: (memory: PermissionMemory) => void
  now?: () => number
}

export interface AutoSendPermissionService {
  check(): AutoSendPermissions
  /** A send was read back from WeChat's database: every permission it needed works. */
  noteVerifiedSend(): void
  /** The sender halted; permission codes update what is known. */
  noteHalt(code: AutoSendHaltCode | undefined): void
}

export function createAutoSendPermissions(deps: AutoSendPermissionDeps): AutoSendPermissionService {
  const now = deps.now ?? Date.now
  let memory: PermissionMemory = safeLoad(deps.load)
  const remember = (patch: PermissionMemory) => {
    const next = { ...memory, ...patch }
    if (JSON.stringify(next) === JSON.stringify(memory)) return
    memory = next
    deps.save(memory)
  }

  const accessibility = (): OsPermissionState => {
    if (deps.isAccessibilityTrusted()) {
      remember({ accessibilityGrantedFor: deps.fingerprint() })
      return 'granted'
    }
    const grantedFor = memory.accessibilityGrantedFor
    return grantedFor && grantedFor !== deps.fingerprint() ? 'stale' : 'denied'
  }

  return {
    check() {
      const platform = deps.platform === 'darwin' || deps.platform === 'win32' ? deps.platform : 'linux'
      if (platform !== 'darwin') {
        return {
          platform,
          accessibility: 'not-applicable',
          automation: 'not-applicable',
          ready: platform === 'win32',
          checkedAt: now(),
        }
      }
      const ax = accessibility()
      const automation: OsPermissionState = memory.automation ?? 'unknown'
      return {
        platform,
        accessibility: ax,
        automation,
        ready: ax === 'granted' && automation !== 'denied',
        checkedAt: now(),
      }
    },
    noteVerifiedSend() {
      if (deps.platform !== 'darwin') return
      remember({ automation: 'granted', accessibilityGrantedFor: deps.fingerprint() })
    },
    noteHalt(code) {
      if (deps.platform === 'darwin' && code === 'automation-denied') remember({ automation: 'denied' })
    },
  }
}

function safeLoad(load: () => PermissionMemory): PermissionMemory {
  try {
    return load()
  } catch {
    // Missing or corrupt state only loses the stale-vs-denied distinction; the live check still runs.
    return {}
  }
}

/** JSON file persistence for PermissionMemory. Unknown fields and bad values are dropped on read. */
export function permissionMemoryFile(path: string): Pick<AutoSendPermissionDeps, 'load' | 'save'> {
  return {
    load() {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof raw !== 'object' || raw === null) return {}
      const value = raw as Record<string, unknown>
      return {
        ...(typeof value.accessibilityGrantedFor === 'string'
          ? { accessibilityGrantedFor: value.accessibilityGrantedFor }
          : {}),
        ...(value.automation === 'granted' || value.automation === 'denied' ? { automation: value.automation } : {}),
      }
    },
    save(memory) {
      writeFileSync(path, `${JSON.stringify(memory)}\n`, 'utf8')
    },
  }
}
