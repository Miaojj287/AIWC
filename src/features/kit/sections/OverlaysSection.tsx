import { Copy, Ellipsis, Pencil, Pin, Sparkles, Trash } from 'lucide-react'
import { useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DangerDialog,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  FormDialog,
  FormDialogField,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressDialog,
  Select,
  SkeletonListRows,
  type MenuSpec,
  type ProgressStep,
} from '@/kit'
import { Item, Row, Section } from '../gallery'

const MENU: MenuSpec = [
  { type: 'label', id: 'g', label: '分组标题' },
  { id: 'edit', label: '常规操作', icon: Pencil, shortcut: '⌘E' },
  { type: 'sub', id: 'sub', label: '带子菜单', icon: Copy, items: [{ id: 's1', label: '子项 A' }, { id: 's2', label: '子项 B' }] },
  { id: 'pin', label: '禁用项', icon: Pin, disabled: true },
  { type: 'separator' },
  { id: 'badge', label: '带徽标', icon: Sparkles, badge: <Badge tone="accent">新</Badge> },
  { type: 'separator' },
  { id: 'danger', label: '危险操作', icon: Trash, danger: true },
]

const STEPS: ProgressStep[] = [
  { id: '1', label: '检测进程', status: 'done', detail: '0.2s' },
  { id: '2', label: '读取配置', status: 'done', detail: '1.1s' },
  { id: '3', label: '提取密钥', status: 'doing', detail: '进行中' },
  { id: '4', label: '写入本地配置', status: 'todo' },
  { id: '5', label: '示例失败步骤', status: 'failed', detail: '超时' },
]

export function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formName, setFormName] = useState('示例名称')
  const [formType, setFormType] = useState('ai')

  return (
    <Section id="overlays" title="⑤ 浮层模板" description="右键菜单（分组 / 快捷键 / 子菜单 / 禁用 / 危险）；带描述的下拉；对话框四种；右侧抽屉；遮罩">
      <Item label="右键菜单 · 模板（右键区域 / 点击 ···，同一份 MenuSpec）">
        <Row align="start">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex h-[120px] w-[220px] items-center justify-center rounded-card border border-dashed border-line-10 bg-panel text-caption text-fg-3">
                在此右键
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItems items={MENU} />
            </ContextMenuContent>
          </ContextMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={Ellipsis} label="更多" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItems items={MENU} />
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      </Item>
      <Item label="下拉选择 · 带描述与勾选（常开预览）">
        <div className="h-[280px] w-[260px]">
          <Select
            open
            onOpenChange={() => {}}
            searchable
            value="a"
            options={[
              { value: 'a', label: '选项 A', description: '一句话说明它做什么' },
              { value: 'b', label: '选项 B', description: '一句话说明' },
              { value: 'c', label: '选项 C', description: '一句话说明', badge: <Badge tone="ok">本地</Badge> },
            ]}
            footer={{ label: '管理…', description: '跳转到设置', onSelect: () => {} }}
            aria-label="常开预览"
          />
        </div>
      </Item>
      <Item label="Popover · 轻量确认">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">打开 popover</Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="flex flex-col gap-2">
              <div className="text-body font-medium text-fg">允许此操作？</div>
              <div className="text-caption text-fg-3">一句话说明这个工具调用会做什么。</div>
              <Row className="justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost">
                  拒绝
                </Button>
                <Button size="sm" variant="outline">
                  总是允许
                </Button>
                <Button size="sm">允许一次</Button>
              </Row>
            </div>
          </PopoverContent>
        </Popover>
      </Item>
      <Item label="对话框 · 普通确认 / 危险确认 / 表单 / 进度（点击打开）">
        <Row className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            普通确认
          </Button>
          <Button variant="outline" onClick={() => setDangerOpen(true)}>
            危险确认
          </Button>
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            表单
          </Button>
          <Button variant="outline" onClick={() => setProgressOpen(true)}>
            进度
          </Button>
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>
            右侧抽屉
          </Button>
        </Row>
        <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="确认操作？" description="一句话说明后果，让用户知道点确定会发生什么。" onConfirm={() => setConfirmOpen(false)} />
        <DangerDialog
          open={dangerOpen}
          onOpenChange={setDangerOpen}
          title="删除此项？"
          description="说明不可撤销与影响范围。主按钮用 danger，默认焦点落在「取消」，点遮罩不关闭。"
          confirmWord="删除"
          onConfirm={() => setDangerOpen(false)}
        />
        <FormDialog open={formOpen} onOpenChange={setFormOpen} title="表单标题" description="带字段的对话框，字段左标签固定 64px" onSubmit={() => setFormOpen(false)} submitDisabled={!formName.trim()} submitDisabledReason="名称不能为空">
          <FormDialogField label="名称" htmlFor="kit-form-name">
            <Input id="kit-form-name" value={formName} onChange={(e) => setFormName(e.target.value)} error={!formName.trim() && '名称不能为空'} />
          </FormDialogField>
          <FormDialogField label="类型" htmlFor="kit-form-type">
            <Select id="kit-form-type" fullWidth value={formType} onValueChange={setFormType} options={[{ value: 'fixed', label: '固定文案' }, { value: 'ai', label: 'AI 生成' }, { value: 'human', label: '转人工' }]} />
          </FormDialogField>
          <FormDialogField label="备注" htmlFor="kit-form-note">
            <Input id="kit-form-note" placeholder="可选" />
          </FormDialogField>
        </FormDialog>
        <ProgressDialog open={progressOpen} title="正在处理" description="步骤列表 + 进度条，只保留「取消」" value={45} status="第 3 / 5 步 · 预计还需 20 秒" steps={STEPS} note="请勿关闭微信" onCancel={() => setProgressOpen(false)} />
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="抽屉标题" footer={<Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>关闭</Button>}>
          <SkeletonListRows rows={6} />
        </Drawer>
      </Item>
    </Section>
  )
}
