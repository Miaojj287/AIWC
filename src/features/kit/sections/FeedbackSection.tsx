import { Plus, RefreshCw } from 'lucide-react'
import { Badge, Button, IconButton, InlineHint, ProgressBar, SkeletonListRows, Spinner, ToastView, Tooltip, toast } from '@/kit'
import { Item, Row, Section, State } from '../gallery'

export function FeedbackSection() {
  return (
    <Section id="feedback" title="④ 反馈" description="Toast 五种；行内提示；tooltip；徽标；进度；加载">
      <Item label="Toast · 右下角出现，4s 自动消失，带操作时不自动消失">
        <div className="flex flex-col items-start gap-2">
          <ToastView toast={{ kind: 'success', text: '已保存' }} onDismiss={() => {}} />
          <ToastView toast={{ kind: 'info', text: '已把 2 条消息加入 Agent 上下文', action: { label: '撤销', onClick: () => {} } }} onDismiss={() => {}} />
          <ToastView toast={{ kind: 'warning', text: '磁盘空间不足，建议更换缓存目录' }} onDismiss={() => {}} />
          <ToastView toast={{ kind: 'error', text: '连接失败 · 401 Unauthorized', action: { label: '重试', onClick: () => {} } }} onDismiss={() => {}} />
          <ToastView toast={{ kind: 'progress', text: '正在同步…', detail: '1,240 / 14,238 条' }} onDismiss={() => {}} />
          <Row className="mt-1 gap-2">
            <Button size="sm" variant="ghost" onClick={() => toast.success('已保存')}>
              触发 success
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toast.error('连接失败', { action: { label: '重试', onClick: () => toast.info('已重试') } })}>
              触发 error + 操作
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const id = toast.progress('正在处理…')
                setTimeout(() => toast.update(id, { kind: 'success', text: '处理完成', sticky: false }), 1500)
              }}
            >
              触发 progress → success
            </Button>
          </Row>
          <div className="text-micro text-fg-3">实时 Toast 由 App 根节点挂载的 &lt;Toaster/&gt; 渲染</div>
        </div>
      </Item>
      <Item label="行内提示 · 四种">
        <div className="flex flex-col gap-1.5">
          <InlineHint kind="success">已连接 · 延迟 420 ms</InlineHint>
          <InlineHint kind="info">预计 2 分钟</InlineHint>
          <InlineHint kind="warning">该模型不支持工具调用</InlineHint>
          <InlineHint kind="error">密钥应为 64 位十六进制</InlineHint>
        </div>
      </Item>
      <Item label="Tooltip · 纯文字 / 带快捷键 / 两行（hover 查看）">
        <Row className="gap-3">
          <Tooltip content="重新同步">
            <IconButton icon={RefreshCw} label="重新同步" />
          </Tooltip>
          <Tooltip content="新建会话" kbd="⌘N">
            <IconButton icon={Plus} label="新建会话" />
          </Tooltip>
          <Tooltip content="上下文占用 32%" description="41k / 128k tokens · 点击查看明细">
            <Button variant="outline" size="sm">
              两行
            </Button>
          </Tooltip>
          <Tooltip content="常显示例" open side="right">
            <Button variant="ghost" size="sm">
              open
            </Button>
          </Tooltip>
        </Row>
      </Item>
      <Item label="徽标 · 语义色">
        <Row className="gap-2">
          <Badge tone="ok">已验证</Badge>
          <Badge tone="ok">当前</Badge>
          <Badge tone="warn">未验证</Badge>
          <Badge tone="accent">等待确认</Badge>
          <Badge tone="ok">本地</Badge>
          <Badge tone="clone">分身</Badge>
          <Badge tone="info">信息</Badge>
          <Badge tone="neutral">已暂停</Badge>
          <Badge tone="danger">失败</Badge>
          <Badge tone="danger" dot />
        </Row>
      </Item>
      <Item label="进度条 · 确定 / 不确定（滑动段）">
        <div className="flex w-[260px] flex-col gap-2.5">
          <ProgressBar value={32} label="示例 32%" />
          <ProgressBar value={62} label="示例 62%" />
          <ProgressBar label="不确定" />
        </div>
      </Item>
      <Item label="加载 spinner · 12 / 16 / 24">
        <Row>
          <Spinner size={12} />
          <Spinner size={16} />
          <Spinner size={24} />
        </Row>
      </Item>
      <Item label="骨架屏 · 列表加载中">
        <SkeletonListRows rows={3} className="w-[264px]" />
      </Item>
      <Item label="状态占位">
        <State name="Badge dot / spinner 行内">
          <Row className="gap-2 text-caption text-fg-2">
            <Spinner size={12} /> 同步中…
          </Row>
        </State>
      </Item>
    </Section>
  )
}
