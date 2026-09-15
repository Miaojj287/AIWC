/**
 * Office platforms feature (飞书 / 钉钉 / 企业微信). No workspace Tab of its own: the agent does the
 * work, so this feature contributes cards and approval notes for its tool calls, and the settings
 * page embeds the connection rows.
 *
 *   register()             — tool cards + approval notes for the office_* tools, session subscription
 *   OfficeConnectPanel     — steps + link + QR body shared by the agent card and the settings dialog
 */
import { isOfficePlatform } from '@aiwc/protocol'
import {
  registerApprovalBody,
  registerApprovalNote,
  registerToolCard,
  type ApprovalNote,
} from '@/features/agent/toolCards'
import type { MessageKey } from '@/i18n'
import { ConnectApproval, PushTableApproval } from './OfficeApprovalBodies'
import { PLATFORM_KEY } from './OfficeConnectPanel'
import { ensureOfficeSubscription } from './officeStore'
import { OfficeConnectCard, OfficePushCard } from './OfficeToolCards'

/** Where the data goes, by platform (CLAUDE.md §6) — instead of the generic "以你的微信身份发送". */
const note =
  (key: MessageKey): ApprovalNote =>
  (request, t) => {
    const input = request.input
    const platform =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>).platform
        : undefined
    return isOfficePlatform(platform) ? t(key, { platform: t(PLATFORM_KEY[platform]) }) : undefined
  }

export function register(): void {
  registerToolCard('office_connect', OfficeConnectCard)
  registerToolCard('office_push_table', OfficePushCard)
  registerApprovalNote('office_connect', note('office.approval.connect'))
  registerApprovalNote('office_push_table', note('office.approval.push'))
  registerApprovalBody('office_connect', ConnectApproval)
  registerApprovalBody('office_push_table', PushTableApproval)
  void ensureOfficeSubscription()
}

export { OfficeConnectPanel, PLATFORM_KEY, TABLE_NOUN_KEY } from './OfficeConnectPanel'
export { useOfficeSession, upsertSession, isActiveSession } from './officeStore'
