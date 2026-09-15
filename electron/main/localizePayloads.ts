/**
 * Main-process boundary for system text the business packages emit in Chinese (CLAUDE.md §11.3).
 * Packages don't depend on i18n, so the IPC funnel (ipc/register.ts) and the push broadcast (index.ts)
 * pass payloads through here: known errors, reasons, progress steps and statuses are re-rendered in the
 * UI language via `localizeKnown`. Chat content, names and provider errors are never touched.
 */
import { localizeKnown, translate } from '@aiwc/i18n'
import type {
  AutoReplyRecord,
  AutoReplyRule,
  CloneStatus,
  ThreadSummary,
  Event,
  EventChannel,
  EventMap,
  GatewayEvent,
  InvokeChannel,
  InvokeRes,
  KeyAcquireStep,
  ReplyDraft,
  SubstrateEvent,
  SyncStatus,
} from '@aiwc/protocol'
import { mainLanguage, t } from './i18n'

export const localizeText = <T extends string | undefined>(text: T): T => localizeKnown(text, mainLanguage()) as T

const withError = <T extends { error?: string }>(value: T): T =>
  value.error ? { ...value, error: localizeText(value.error) } : value

export function localizeKeyStep(step: KeyAcquireStep): KeyAcquireStep {
  return { ...step, label: t(`main.keys.label.${step.id}`), detail: localizeText(step.detail) }
}

export function localizeSyncStatus(status: SyncStatus): SyncStatus {
  const progress = status.progress?.label
    ? { ...status.progress, label: localizeText(status.progress.label) }
    : status.progress
  return { ...status, progress, error: localizeText(status.error) }
}

export function localizeCloneStatus(status: CloneStatus): CloneStatus {
  if (status.state === 'building')
    return { ...status, progress: { ...status.progress, step: localizeText(status.progress.step) } }
  if (status.state === 'failed') return { ...status, error: localizeText(status.error) }
  return status
}

const localizeRecord = (record: AutoReplyRecord): AutoReplyRecord => withError(record)
const localizeRule = (rule: AutoReplyRule): AutoReplyRule =>
  rule.pausedReason ? { ...rule, pausedReason: localizeText(rule.pausedReason) } : rule
const localizeDraft = (draft: ReplyDraft): ReplyDraft => withError(draft)

function localizeGatewayEvent(event: GatewayEvent): GatewayEvent {
  switch (event.type) {
    case 'adapter.state':
      return { ...event, detail: localizeText(event.detail) }
    case 'autoreply.halted':
      return { ...event, reason: localizeText(event.reason) }
    case 'outbound':
      return { ...event, result: withError(event.result) }
    default:
      return event
  }
}

function localizeSubstrateEvent(event: SubstrateEvent): SubstrateEvent {
  if (event.type === 'connection') return { ...event, detail: localizeText(event.detail) }
  if (event.type === 'sync') return { ...event, status: localizeSyncStatus(event.status) }
  return event
}

/**
 * The kernel names a thread whose first message is attachment-only with a fixed Chinese title
 * (packages/kernel/src/runtime/thread.ts). Only that exact value is mapped: every other title is
 * derived from what the user typed.
 */
function localizeThreadTitle(title: string): string {
  return title === translate('zh-CN', 'main.agent.attachmentThread') ? t('main.agent.attachmentThread') : title
}
const localizeSummary = (summary: ThreadSummary): ThreadSummary => ({
  ...summary,
  title: localizeThreadTitle(summary.title),
})

function localizeAgentEvent(event: Event): Event {
  if (event.type === 'thread.title') return { ...event, title: localizeThreadTitle(event.title) }
  if (event.type !== 'error') return event
  return {
    ...event,
    error: { ...event.error, message: localizeText(event.error.message) },
    actions: event.actions.map((action) => ({ ...action, label: localizeText(action.label) })),
  }
}

/** Push payloads (main → renderer). Channels not listed carry no package-emitted text. */
export function localizeEvent<K extends EventChannel>(channel: K, payload: EventMap[K]): EventMap[K] {
  switch (channel) {
    case 'substrate:keyStep':
      return localizeKeyStep(payload as EventMap['substrate:keyStep']) as EventMap[K]
    case 'substrate:event':
      return localizeSubstrateEvent(payload as EventMap['substrate:event']) as EventMap[K]
    case 'clone:status': {
      const p = payload as EventMap['clone:status']
      return { ...p, status: localizeCloneStatus(p.status) } as EventMap[K]
    }
    case 'autoreply:record':
      return localizeRecord(payload as EventMap['autoreply:record']) as EventMap[K]
    case 'autoreply:draft':
      return localizeDraft(payload as EventMap['autoreply:draft']) as EventMap[K]
    case 'gateway:event':
      return localizeGatewayEvent(payload as EventMap['gateway:event']) as EventMap[K]
    case 'agent:event':
      return localizeAgentEvent(payload as EventMap['agent:event']) as EventMap[K]
    case 'diary:progress': {
      const p = payload as EventMap['diary:progress']
      return { ...p, step: localizeText(p.step) } as EventMap[K]
    }
    case 'app:toast': {
      const p = payload as EventMap['app:toast']
      return { ...p, text: localizeText(p.text) } as EventMap[K]
    }
    default:
      return payload
  }
}

/** IPC results (renderer ← main) that carry stored or package-emitted system text. */
export function localizeInvokeResult<K extends InvokeChannel>(channel: K, result: InvokeRes<K>): InvokeRes<K> {
  if (result === undefined || result === null) return result
  switch (channel) {
    case 'substrate:acquireKeys':
      return (result as InvokeRes<'substrate:acquireKeys'>).map(localizeKeyStep)
    case 'substrate:status': {
      const r = result as InvokeRes<'substrate:status'>
      return { ...r, sync: localizeSyncStatus(r.sync) }
    }
    case 'substrate:sync':
      return localizeSyncStatus(result as InvokeRes<'substrate:sync'>)
    case 'substrate:verifyAccount':
    case 'substrate:testConnection':
    case 'substrate:connect':
    case 'substrate:setManualKey':
    case 'autoreply:recall':
      return withError(result as { ok: boolean; error?: string })
    case 'agent:listThreads':
      return (result as InvokeRes<'agent:listThreads'>).map(localizeSummary)
    case 'agent:getThread': {
      const r = result as InvokeRes<'agent:getThread'>
      return { ...r, summary: localizeSummary(r.summary) }
    }
    case 'autoreply:listRules':
      return (result as InvokeRes<'autoreply:listRules'>).map(localizeRule)
    case 'autoreply:getRule':
    case 'autoreply:saveRule':
      return localizeRule(result as AutoReplyRule)
    case 'autoreply:listRecords':
      return (result as InvokeRes<'autoreply:listRecords'>).map(localizeRecord)
    case 'autoreply:listDrafts':
      return (result as InvokeRes<'autoreply:listDrafts'>).map(localizeDraft)
    case 'autoreply:status': {
      const r = result as InvokeRes<'autoreply:status'>
      return { ...r, halted: localizeText(r.halted) }
    }
    case 'autoreply:triggerNow': {
      const r = result as InvokeRes<'autoreply:triggerNow'>
      return { ...r, reason: localizeText(r.reason) }
    }
    case 'clone:list':
      return (result as InvokeRes<'clone:list'>).map((item) => ({ ...item, status: localizeCloneStatus(item.status) }))
    case 'clone:status':
      return localizeCloneStatus(result as InvokeRes<'clone:status'>)
    case 'gateway:status':
      return (result as InvokeRes<'gateway:status'>).map((item) => ({ ...item, detail: localizeText(item.detail) }))
    default:
      return result
  }
}
