/**
 * Wizard dialogs: 用户协议与隐私政策 (scrollable), 需要「完全磁盘访问」权限 guidance, 无法打开数据库 failure,
 * 退出设置向导 confirm. Figma 155:415.
 */
import { CircleAlert, KeyRound, Lock, Settings, ShieldCheck } from 'lucide-react'
import { Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/kit'
import { openUrl } from '@/platform/openExternal'

const AGREEMENT_SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: '一、数据完全本地',
    body: ['AIWC 仅在你的电脑本地读取微信数据库与图片资源。解密、索引、统计、导出和记忆写入都在本机完成，不会把聊天记录上传到任何服务器。', '只有当你在「设置 › AI 接入」中配置了在线模型时，你主动发给 Agent 的内容（以及你 @ 引用的消息）才会发送给你配置的模型服务商；界面会在对应位置说明数据去向。'],
  },
  {
    title: '二、你的授权范围',
    body: ['本软件仅供分析你本人的微信账号，或已获得明确授权的账号。请勿用于未经授权的数据读取、监控他人或任何违反法律法规的用途。', '自动回复与 AI 克隆功能会代表你发送消息；发送前默认需要你确认，并且所有出站消息都会留下本地审计记录。'],
  },
  {
    title: '三、密钥与安全',
    body: ['数据库解密密钥、图片密钥和模型 API Key 由系统安全存储（macOS Keychain / Windows DPAPI）保管，只在本机可读取，界面上默认打码显示。', '你可以随时在「设置 › 账号」中移除密钥、删除本地索引与缓存。'],
  },
  {
    title: '四、免责',
    body: ['本软件按「现状」提供。因使用本软件造成的任何直接或间接损失（包括但不限于账号风险、数据丢失），开发者不承担责任。', '微信是腾讯公司的注册商标。AIWC 与腾讯公司没有任何关联。'],
  },
]

export function AgreementDialog({ open, onOpenChange, onAgree }: { open: boolean; onOpenChange(open: boolean): void; onAgree(): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader icon={ShieldCheck} tone="ok" title="用户协议与隐私政策" description="请阅读后勾选同意。全文很短，重点是：数据不出本机，功能仅限你本人的账号。" />
        <DialogBody className="max-h-[52vh] gap-4 pr-1">
          {AGREEMENT_SECTIONS.map((s) => (
            <section key={s.title} className="flex flex-col gap-1.5">
              <h3 className="text-body font-medium text-fg">{s.title}</h3>
              {s.body.map((p, i) => (
                <p key={i} className="text-caption leading-[18px] text-fg-2">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            onClick={() => {
              onAgree()
              onOpenChange(false)
            }}
          >
            我已阅读并同意
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

export function PermissionDialog({ open, onOpenChange, onRetry }: { open: boolean; onOpenChange(open: boolean): void; onRetry(): void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={Lock} tone="danger" title="需要「完全磁盘访问」权限" description="内存扫描需要读取微信进程数据。请在 系统设置 › 隐私与安全性 › 完全磁盘访问 中勾选 AIWC，然后回到这里重试。" />
        <DialogBody>
          <ol className="flex flex-col gap-1.5 text-caption text-fg-2">
            {['打开 系统设置 › 隐私与安全性', '在「完全磁盘访问」中勾选 AIWC', '回到 AIWC 点击重试'].map((t, i) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex size-4 items-center justify-center rounded-chip border border-(--line-25) font-latin text-micro text-fg-3">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            稍后
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              onRetry()
            }}
          >
            重试
          </Button>
          <Button icon={Settings} onClick={() => void openUrl(SETTINGS_URL)}>
            打开系统设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectFailDialog({ error, onOpenChange, onReacquire }: { error: string | undefined; onOpenChange(open: boolean): void; onReacquire(): void }) {
  return (
    <Dialog open={error !== undefined} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={CircleAlert} tone="danger" title="无法打开数据库" description={`${error ?? ''}。通常是解密密钥与该账号不匹配，请重新自动获取密钥或确认 wxid。`} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            返回修改
          </Button>
          <Button
            icon={KeyRound}
            onClick={() => {
              onOpenChange(false)
              onReacquire()
            }}
          >
            重新获取密钥
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ExitDialog({ open, onOpenChange, onExit }: { open: boolean; onOpenChange(open: boolean): void; onExit(): void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={CircleAlert}
      tone="warn"
      title="退出设置向导？"
      description="已填写的路径与密钥会保留在本机，下次打开可继续。"
      cancelLabel="继续设置"
      confirmLabel="退出"
      onConfirm={onExit}
    />
  )
}

