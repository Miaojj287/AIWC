/**
 * Ordered hook runner. Hooks never break a turn: exceptions are logged and treated as "no opinion".
 * Merge rules: the first block wins; additionalContext is concatenated; updatedInput / updatedOutput
 * last wins (and each rewritten input is what the next hook sees).
 */
import type { Hook, HookEventName, HookPayload, HookResult, HookRunner } from '../ports'

export type HookLogger = (level: 'warn' | 'error', msg: string, meta?: unknown) => void

export function createHookRunner(opts?: { logger?: HookLogger }): HookRunner {
  const hooks: Hook[] = []
  const log: HookLogger = opts?.logger ?? (() => {})

  return {
    add(hook) {
      hooks.push(hook)
      return () => {
        const idx = hooks.indexOf(hook)
        if (idx >= 0) hooks.splice(idx, 1)
      }
    },

    async run(event: HookEventName, payload: HookPayload): Promise<HookResult> {
      const merged: HookResult = {}
      const contexts: string[] = []
      let current: HookPayload = payload
      for (const hook of [...hooks]) {
        if (!hook.events.includes(event)) continue
        let result: HookResult | void
        try {
          result = await hook.run(event, current)
        } catch (err) {
          log('warn', `hook "${hook.name}" failed on ${event}`, err)
          continue
        }
        if (!result) continue
        if (result.block && !merged.block) merged.block = result.block
        if (result.additionalContext) contexts.push(result.additionalContext)
        if (result.updatedInput !== undefined) {
          merged.updatedInput = result.updatedInput
          current = { ...current, input: result.updatedInput }
        }
        if (result.updatedOutput !== undefined) {
          merged.updatedOutput = result.updatedOutput
          current = { ...current, output: result.updatedOutput }
        }
      }
      if (contexts.length) merged.additionalContext = contexts.join('\n')
      return merged
    },
  }
}
