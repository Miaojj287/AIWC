/**
 * 欢迎页 (Figma 91:417): logo → title 22 → subtitle → three capability Cards → agreement Card → primary
 * button (disabled until agreed) → hint line. The steps bar is rendered by the wizard frame.
 */
import { ArrowRight, Bot, CircleAlert, Lock, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Checkbox, ICON_STROKE, Tooltip, cn } from '@/kit'
import { AgreementDialog } from './dialogs'
import { useWizardStore } from './wizardStore'

const CAPABILITIES = [
  { icon: Lock, tone: 'bg-ok/15 text-ok', title: '完全本地', body: '解密、索引、转写都在本机完成，不上传任何聊天数据' },
  { icon: Sparkles, tone: 'bg-accent-15 text-accent', title: 'AI Agent', body: '用自然语言检索、总结、生成周报，可接入任意模型' },
  { icon: Bot, tone: 'bg-info/15 text-info', title: '自动回复 · AI 克隆', body: '为指定会话设置自动回复，克隆联系人的说话风格' },
] as const

const NOTES = [
  { icon: ShieldCheck, tone: 'text-ok', title: '数据完全本地', body: 'AIWC 仅在你的电脑本地读取微信数据库，解密、索引、转写都在本地完成' },
  { icon: UserRound, tone: 'text-info', title: '你的授权范围', body: '仅供分析你本人或获得授权的微信账号，请合规使用' },
  { icon: CircleAlert, tone: 'text-fg-3', title: '免责', body: '因使用本软件造成的损失，开发者不承担责任' },
] as const

export function WelcomeStep({ onNext }: { onNext(): void }) {
  const agreed = useWizardStore((s) => s.agreed)
  const setAgreed = useWizardStore((s) => s.setAgreed)
  const [agreementOpen, setAgreementOpen] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col items-center gap-6 px-6 pb-10 pt-12">
      <div aria-hidden className="flex h-[88px] items-center justify-center">
        <span className="select-none font-latin text-[56px] font-semibold tracking-[0.18em] text-fg">
          A<span className="text-accent">I</span>WC
        </span>
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-wizard font-medium leading-8 text-fg">欢迎使用 AIWC</h1>
        <p className="text-body text-fg-3">一个完全在本地运行的微信数据管家 · 让你的对话回到你手中</p>
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        {CAPABILITIES.map((c) => (
          <Card key={c.title} className="flex flex-col gap-3">
            <span className={cn('flex size-8 items-center justify-center rounded-item', c.tone)}>
              <c.icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <div className="text-body font-medium text-fg">{c.title}</div>
              <div className="text-caption leading-[18px] text-fg-3">{c.body}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="flex w-full flex-col gap-3">
        <div className="flex items-center gap-1 border-b border-line-6 pb-3">
          <Checkbox checked={agreed} onCheckedChange={(c) => setAgreed(c === true)} label="我已阅读并同意" className="items-center" />
          <Button variant="link" size="sm" onClick={() => setAgreementOpen(true)} className="-ml-1 px-1">
            《用户协议与隐私政策》
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {NOTES.map((n) => (
            <li key={n.title} className="flex items-start gap-2 text-caption leading-[18px]">
              <n.icon size={13} strokeWidth={ICON_STROKE} aria-hidden className={cn('mt-0.5 shrink-0', n.tone)} />
              <span>
                <span className="font-medium text-fg">{n.title}</span>
                <span className="text-fg-3"> —— {n.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col items-center gap-3">
        <Tooltip content="请先阅读并勾选同意用户协议" disabled={agreed}>
          <span className="inline-flex">
            <Button trailingIcon={ArrowRight} disabled={!agreed} onClick={onNext} className="h-9 px-6">
              开始设置
            </Button>
          </span>
        </Tooltip>
        <span className="text-note text-fg-3">预计 2 分钟 · 需要本机已登录微信客户端</span>
      </div>

      <AgreementDialog open={agreementOpen} onOpenChange={setAgreementOpen} onAgree={() => setAgreed(true)} />
    </div>
  )
}
