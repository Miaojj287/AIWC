/** Start account background work once, only after the owner explicitly enters this session. */
export function createAccountRuntime(starters: readonly (() => void)[]): () => void {
  let started = false
  return () => {
    if (started) return
    started = true
    for (const start of starters) start()
  }
}
