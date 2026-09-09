/**
 * Loop guard (ARCHITECTURE §4.5): trips when the model repeats the same tool call three times in a row, or
 * alternates between two calls (A-B-A-B). Fingerprint = toolName + canonical JSON of the input.
 */
export interface LoopGuardCall {
  toolName: string
  input: unknown
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export const callFingerprint = (call: LoopGuardCall): string => `${call.toolName}:${canonicalJson(call.input)}`

export class LoopGuard {
  private readonly fingerprints: string[] = []

  constructor(private readonly repeatLimit = 3) {}

  /** Records the calls of one step (in call order). Returns true when the guard trips. */
  push(calls: readonly LoopGuardCall[]): boolean {
    for (const c of calls) {
      this.fingerprints.push(callFingerprint(c))
      if (this.fingerprints.length > 16) this.fingerprints.shift()
      if (this.tripped()) return true
    }
    return false
  }

  private tripped(): boolean {
    const f = this.fingerprints
    const n = f.length
    if (n >= this.repeatLimit) {
      const last = f[n - 1]
      let same = true
      for (let i = n - this.repeatLimit; i < n; i++) if (f[i] !== last) same = false
      if (same) return true
    }
    if (n >= 4) {
      const a = f[n - 4]
      const b = f[n - 3]
      if (a !== b && f[n - 2] === a && f[n - 1] === b) return true
    }
    return false
  }

  reset(): void {
    this.fingerprints.length = 0
  }
}
