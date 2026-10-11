/**
 * 完成后推送到我的微信 — the task editor's switch for pushing a finished run (summary or failure) to the owner's
 * own WeChat. Shows when 我的微信 is not connected (the push would be skipped) with a way to go connect it.
 */
import { useState } from 'react'
import type { MobileStatus } from '@aiwc/protocol'
import { runCommand } from '@/app/commands'
import { useT } from '@/i18n'
import { Button, InlineHint, SettingRow, Toggle } from '@/kit'
import { useBridgeEvent, useInvoke } from '@/platform/hooks'

export interface PushToPhoneRowProps {
  checked: boolean
  onChange(checked: boolean): void
}

export function PushToPhoneRow({ checked, onChange }: PushToPhoneRowProps) {
  const t = useT()
  const initial = useInvoke('mobile:status', undefined, [])
  const [live, setLive] = useState<MobileStatus>()
  useBridgeEvent('mobile:changed', setLive)
  const status = live ?? initial.data
  // Unknown (still loading / failed to load) is not "disconnected": only warn on a definite answer.
  const disconnected = status !== undefined && (status.state !== 'connected' || status.ownerUnknown)
  return (
    <SettingRow
      title={t('mobile.task.push')}
      footer={
        checked && disconnected ? (
          <div className="flex flex-wrap items-center gap-2">
            <InlineHint kind="warning">{t('mobile.task.notConnected')}</InlineHint>
            <Button
              variant="link"
              onClick={() => runCommand('tab.openSettings', { page: 'account', highlight: 'account.mobile' })}
            >
              {t('mobile.task.connect')}
            </Button>
          </div>
        ) : null
      }
    >
      <Toggle label={t('mobile.task.push')} checked={checked} onCheckedChange={onChange} />
    </SettingRow>
  )
}
