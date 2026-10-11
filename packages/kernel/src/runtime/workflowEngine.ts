/**
 * The scheduler behind `workflow_run`: a small DAG of sub-agent steps run with a concurrency cap, a per-step time
 * limit and cancellation. Pure orchestration — how a step runs is injected — so the rules (order, skipping the
 * dependents of a failed step, cancelling what has not finished) are testable without a model.
 */
import type { WorkflowRunView, WorkflowStepError, WorkflowStepStatus } from '@aiwc/protocol'
import { createTurnBudget } from './turnBudget'

export interface WorkflowStepPlan {
  id: string
  title: string
  prompt: string
  dependsOn: string[]
  mode: 'read' | 'write'
  output: 'text' | 'json'
  schema?: Record<string, unknown>
}

export interface WorkflowPlan {
  title: string
  steps: WorkflowStepPlan[]
  maxConcurrency: number
}

/** A step runner's failure, with the stable reason the card shows. */
export class WorkflowStepFailure extends Error {
  constructor(
    readonly code: WorkflowStepError,
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowStepFailure'
  }
}

export interface StepState {
  status: WorkflowStepStatus
  output?: string
  error?: WorkflowStepError
  message?: string
  startedAt?: number
  durationMs?: number
}

export interface WorkflowEngineDeps {
  /**
   * Runs one step; `inputs` are the outputs of its dependencies, in `dependsOn` order. `pauseClock` stops the
   * step's time limit while the step waits for the user (an approval); the returned function resumes it.
   */
  runStep(
    step: WorkflowStepPlan,
    inputs: Array<{ step: WorkflowStepPlan; output: string }>,
    signal: AbortSignal,
    pauseClock: () => () => void,
  ): Promise<string>
  stepTimeoutMs: number
  signal: AbortSignal
  /** Called after every state change (progress card). */
  onUpdate?(states: ReadonlyMap<string, StepState>): void
  now?: () => number
}

/** Why a plan cannot run (model-facing text), or undefined when it is a valid DAG. */
export function validatePlan(plan: WorkflowPlan): string | undefined {
  const ids = new Set<string>()
  for (const step of plan.steps) {
    if (ids.has(step.id)) return `步骤 id 重复：${step.id}`
    ids.add(step.id)
  }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (dep === step.id) return `步骤 ${step.id} 不能依赖自己`
      if (!ids.has(dep)) return `步骤 ${step.id} 依赖了不存在的步骤 ${dep}`
    }
  }
  // Kahn: whatever cannot be ordered sits on a cycle.
  const remaining = new Map(plan.steps.map((s) => [s.id, new Set(s.dependsOn)]))
  let progressed = true
  while (remaining.size > 0 && progressed) {
    progressed = false
    for (const [id, deps] of remaining) {
      if ([...deps].every((d) => !remaining.has(d))) {
        remaining.delete(id)
        progressed = true
      }
    }
  }
  if (remaining.size > 0) return `步骤之间存在循环依赖：${[...remaining.keys()].join('、')}`
  return undefined
}

export async function runWorkflow(plan: WorkflowPlan, deps: WorkflowEngineDeps): Promise<Map<string, StepState>> {
  const now = deps.now ?? Date.now
  const states = new Map<string, StepState>(plan.steps.map((s) => [s.id, { status: 'pending' }]))
  const byId = new Map(plan.steps.map((s) => [s.id, s]))
  const running = new Map<string, Promise<void>>()
  const update = (): void => deps.onUpdate?.(states)
  const set = (id: string, patch: StepState): void => {
    states.set(id, patch)
    update()
  }

  const launch = (step: WorkflowStepPlan): void => {
    const startedAt = now()
    set(step.id, { status: 'running', startedAt })
    const controller = new AbortController()
    let timedOut = false
    // Pausable: time spent waiting for the user's approval does not count toward the step's limit.
    const clock = createTurnBudget(
      deps.stepTimeoutMs,
      () => {
        timedOut = true
        controller.abort(new Error('timeout'))
      },
      now,
    )
    const onAbort = (): void => controller.abort(deps.signal.reason)
    deps.signal.addEventListener('abort', onAbort, { once: true })
    const inputs = step.dependsOn.map((id) => ({ step: byId.get(id)!, output: states.get(id)?.output ?? '' }))
    const job = deps
      .runStep(step, inputs, controller.signal, () => clock.pause())
      .then(
        (output) => set(step.id, { status: 'done', output, startedAt, durationMs: now() - startedAt }),
        (err: unknown) => {
          const durationMs = now() - startedAt
          const message = err instanceof Error ? err.message : String(err)
          if (timedOut) set(step.id, { status: 'failed', error: 'timeout', message, startedAt, durationMs })
          else if (deps.signal.aborted) set(step.id, { status: 'cancelled', error: 'cancelled', startedAt, durationMs })
          else {
            const code = err instanceof WorkflowStepFailure ? err.code : 'failed'
            set(step.id, { status: 'failed', error: code, message, startedAt, durationMs })
          }
        },
      )
      .finally(() => {
        clock.dispose()
        deps.signal.removeEventListener('abort', onAbort)
        running.delete(step.id)
      })
    running.set(step.id, job)
  }

  for (;;) {
    if (deps.signal.aborted) {
      for (const [id, s] of states)
        if (s.status === 'pending') states.set(id, { status: 'cancelled', error: 'cancelled' })
      update()
      await Promise.allSettled([...running.values()])
      return states
    }
    // Dependents of a step that did not finish are skipped, transitively (re-checked every round).
    let skipped = true
    while (skipped) {
      skipped = false
      for (const step of plan.steps) {
        if (states.get(step.id)?.status !== 'pending') continue
        const blocked = step.dependsOn.some((d) => {
          const st = states.get(d)?.status
          return st === 'failed' || st === 'skipped' || st === 'cancelled'
        })
        if (blocked) {
          states.set(step.id, { status: 'skipped', error: 'dependency_failed' })
          skipped = true
        }
      }
      if (skipped) update()
    }
    const ready = plan.steps.filter(
      (s) => states.get(s.id)?.status === 'pending' && s.dependsOn.every((d) => states.get(d)?.status === 'done'),
    )
    for (const step of ready) {
      if (running.size >= plan.maxConcurrency) break
      launch(step)
    }
    if (running.size === 0) return states
    await Promise.race(running.values())
  }
}

/** The card / result view; outputs are included only when asked (the progress card never needs them). */
export function workflowView(
  plan: WorkflowPlan,
  states: ReadonlyMap<string, StepState>,
  opts: { done: boolean; outputChars?: number },
): WorkflowRunView {
  const steps = plan.steps.map((step) => {
    const s = states.get(step.id) ?? { status: 'pending' as const }
    // A failed step's message stands in for its output, so the model knows what went wrong.
    const raw = s.output ?? s.message
    const output =
      opts.outputChars && raw !== undefined
        ? raw.length > opts.outputChars
          ? `${raw.slice(0, opts.outputChars)}…[已截断 ${raw.length - opts.outputChars} 字]`
          : raw
        : undefined
    return {
      id: step.id,
      title: step.title,
      mode: step.mode,
      status: s.status,
      ...(step.dependsOn.length ? { dependsOn: step.dependsOn } : {}),
      ...(s.error ? { error: s.error } : {}),
      ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}),
      ...(output !== undefined ? { output } : {}),
    }
  })
  return { kind: 'workflow', title: plan.title, status: overallStatus(steps, opts.done), steps }
}

function overallStatus(steps: Array<{ status: WorkflowStepStatus }>, done: boolean): WorkflowRunView['status'] {
  if (!done) return 'running'
  if (steps.some((s) => s.status === 'cancelled')) return 'cancelled'
  const ok = steps.filter((s) => s.status === 'done').length
  if (ok === steps.length) return 'done'
  return ok === 0 ? 'failed' : 'partial'
}
