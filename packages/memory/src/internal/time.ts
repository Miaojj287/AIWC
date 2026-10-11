/** Clock text for model-facing transcripts (local time). Dates use `todoDateOf` from @aiwc/protocol. */
import type { Millis } from '@aiwc/protocol'

export function formatClock(ms: Millis): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
