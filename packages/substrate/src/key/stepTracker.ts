/**
 * Step bookkeeping for acquireKeys: every transition is pushed through `onStep` as a full copy, and
 * `finish()` guarantees each of the four steps ends `done` or `failed` (never a dangling ⟳ or ○).
 */
import {
  finalizeKeySteps,
  type KeyAcquireFailure,
  type KeyAcquireScope,
  type KeyAcquirePhase,
  type KeyAcquireStep,
} from '@aiwc/protocol'

const STEP_LABELS: Record<KeyAcquireStep['id'], string> = {
  db_key: '获取数据库密钥',
  image_xor: '获取图片 XOR 密钥',
  image_aes: '获取图片 AES 密钥',
  verify: '校验密钥',
}

export class StepTracker {
  private readonly byId = new Map<KeyAcquireStep['id'], KeyAcquireStep>()
  private readonly order: KeyAcquireStep['id'][] = []

  constructor(
    private readonly onStep: (step: KeyAcquireStep) => void,
    private readonly scope: KeyAcquireScope = 'all',
  ) {}

  get steps(): KeyAcquireStep[] {
    return this.order.map((id) => ({ ...(this.byId.get(id) as KeyAcquireStep) }))
  }

  private put(step: KeyAcquireStep): void {
    if (!this.byId.has(step.id)) this.order.push(step.id)
    this.byId.set(step.id, step)
    this.onStep({ ...step })
  }

  private base(id: KeyAcquireStep['id']): KeyAcquireStep {
    return this.byId.get(id) ?? { id, label: STEP_LABELS[id], status: 'todo' }
  }

  /** Enter (or move to another) stage of a running step. */
  phase(id: KeyAcquireStep['id'], phase: KeyAcquirePhase, waitUntil?: number): void {
    const { failure: _failure, ...rest } = this.base(id)
    this.put({ ...rest, status: 'doing', phase, waitUntil, detail: undefined })
  }

  done(id: KeyAcquireStep['id'], detail?: string): void {
    this.put({ ...this.base(id), status: 'done', detail, phase: undefined, waitUntil: undefined, failure: undefined })
  }

  fail(id: KeyAcquireStep['id'], detail: string | undefined, failure?: KeyAcquireFailure): void {
    this.put({ ...this.base(id), status: 'failed', detail, failure, phase: undefined, waitUntil: undefined })
  }

  /**
   * Close the run: steps that never ended become `failed` with `reason` (only the running one; the
   * untouched ones become 'skipped' unless the whole run was cancelled). Emits each change.
   */
  finish(reason: KeyAcquireFailure): KeyAcquireStep[] {
    const closed = finalizeKeySteps(this.steps, reason, (id) => STEP_LABELS[id], this.scope)
    for (const step of closed) {
      const before = this.byId.get(step.id)
      if (!before || before.status !== step.status) this.put(step)
    }
    return this.steps
  }
}
