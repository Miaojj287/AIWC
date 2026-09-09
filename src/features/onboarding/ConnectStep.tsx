/**
 * 连接微信 + 解锁数据 (Figma 135:415, merged page): two sections with the account and keys cards, the
 * orange local-only notice (CLAUDE.md §6), and the 上一步 / 下一步 footer with the gate tooltip.
 */
import { ArrowLeft, ArrowRight, Info } from 'lucide-react'
import { Button, ICON_STROKE, Tooltip } from '@/kit'
import { AccountCard } from './AccountCard'
import { KeysCard } from './KeysCard'
import { PermissionDialog } from './dialogs'
import { nextStepGate } from './gating'
import { selectDbKeyPresent, useWizardStore } from './wizardStore'

export interface ConnectStepProps {
  onBack(): void
  onNext(): void
  stepsBar: React.ReactNode
}

export function ConnectStep({ onBack, onNext, stepsBar }: ConnectStepProps) {
  const dbRoot = useWizardStore((s) => s.dbRoot)
  const wxid = useWizardStore((s) => s.wxid)
  const verified = useWizardStore((s) => s.verifyState === 'verified')
  const dbKeyPresent = useWizardStore(selectDbKeyPresent)
  const testing = useWizardStore((s) => s.testing)
  const permissionDialog = useWizardStore((s) => s.permissionDialog)
  const dismissPermissionDialog = useWizardStore((s) => s.dismissPermissionDialog)
  const acquire = useWizardStore((s) => s.acquire)

  const gate = nextStepGate({ dbRoot, wxid, verified, dbKeyPresent })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-8 pb-6 pt-8">
          <section className="flex flex-col gap-3">
            <header className="flex flex-col gap-1">
              <h2 className="text-title font-medium leading-7 text-fg">设置微信数据路径</h2>
              <p className="text-caption text-fg-3">确认微信数据库路径、缓存目录和对应的微信账号。路径只在本机读取，不会上传</p>
            </header>
            <AccountCard />
          </section>
          <section className="flex flex-col gap-3">
            <header className="flex flex-col gap-1">
              <h2 className="text-title font-medium leading-7 text-fg">检测微信并解锁数据</h2>
              <p className="text-caption text-fg-3">一次性读取解密密钥、图片 XOR 与图片 AES 密钥</p>
            </header>
            <KeysCard />
          </section>
          <div className="flex items-center gap-2 rounded-item border border-accent/25 bg-accent-12 px-3 py-2 text-caption text-accent">
            <Info size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0" />
            <span>AIWC 仅读取数据库与图片资源，不会修改任何微信数据。三部分密钥仅本地可读取，不会发送到任何外部服务</span>
          </div>
        </div>
      </div>
      <footer className="flex h-[64px] shrink-0 items-center gap-4 border-t border-line-6 px-8">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack} disabled={testing}>
          上一步
        </Button>
        <div className="flex flex-1 justify-center">{stepsBar}</div>
        <Tooltip content={gate.reason ?? ''} disabled={gate.ok}>
          <span className="inline-flex">
            <Button trailingIcon={ArrowRight} disabled={!gate.ok} loading={testing} onClick={onNext}>
              {testing ? '正在测试连接…' : '下一步'}
            </Button>
          </span>
        </Tooltip>
      </footer>

      <PermissionDialog open={permissionDialog} onOpenChange={(o) => !o && dismissPermissionDialog()} onRetry={() => void acquire('memory_scan')} />
    </div>
  )
}
