import { Ellipsis, FileText, MessageCircle, Settings, Sparkles, UserRound } from 'lucide-react'
import { useState } from 'react'
import {
  Avatar,
  Badge,
  Card,
  Chip,
  Divider,
  FieldLabel,
  IconButton,
  Input,
  Kbd,
  ListItem,
  ScrollArea,
  SegmentedControl,
  Select,
  SettingRow,
  Tab,
  Toggle,
} from '@/kit'
import { Item, Row, Section, State } from '../gallery'

const MEMBERS = Array.from({ length: 9 }, (_, i) => ({ id: `member-${i}`, name: `成员${i + 1}` }))

export function StructureSection() {
  const [tab, setTab] = useState('a')
  const [chip, setChip] = useState('all')
  const [row, setRow] = useState('two')
  const [toggle, setToggle] = useState(true)
  const [seg, setSeg] = useState('dark')
  const [sel, setSel] = useState('ask')

  return (
    <Section id="structure" title="⑦ 结构组件" description="头像 / 列表项 / 设置行 / Tab / 卡片 / chip / kbd / 分隔线 / 滚动区 / 字段标签 —— 与各功能看板一致">
      <Item label="头像 · 36 / 28 / 20，首字 + 哈希渐变；群九宫格（仅色块 / 图片）；图片回退">
        <Row>
          {['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-8'].map((id, i) => (
            <Avatar key={id} id={id} name={String.fromCharCode(0x4e00 + i * 37)} />
          ))}
          <Avatar id="id-x" name="Alex" size={28} />
          <Avatar id="id-y" name="b" size={20} />
          <Avatar id="group-1" name="示例群" members={MEMBERS} />
          <Avatar id="group-2" name="示例群" members={MEMBERS.slice(0, 4)} size={44} />
          <Avatar id="img" name="图" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" size={36} />
          <Avatar id="broken" name="回退" src="/nonexistent.png" size={36} />
        </Row>
      </Item>
      <Item label="列表项 · 默认 / hover / 选中 / 带开关">
        <div className="flex w-[280px] flex-col gap-0.5 rounded-card border border-line-6 bg-panel p-1.5">
          <ListItem
            leading={<Avatar id="row-1" name="一" />}
            title="列表项标题"
            subtitle="第二行说明文字"
            meta="12:30"
            selected={row === 'one'}
            onSelect={() => setRow('one')}
            hoverActions={<IconButton size="sm" icon={Ellipsis} label="更多" />}
          />
          <ListItem
            leading={<Avatar id="row-2" name="二" />}
            title="选中的列表项"
            subtitle={
              <>
                <Badge tone="ok">已开启</Badge>
                <span className="truncate">AI 生成 · 参考 30 条 · 今日 3 次</span>
              </>
            }
            meta="昨天"
            selected={row === 'two'}
            onSelect={() => setRow('two')}
            hoverActions={<IconButton size="sm" icon={Ellipsis} label="更多" />}
          />
          <ListItem
            leading={<Avatar id="row-3" name="三" members={MEMBERS.slice(0, 5)} />}
            title="带右侧开关"
            subtitle="未设置"
            trailing={<Toggle label="启用" checked={toggle} onCheckedChange={setToggle} />}
            selected={row === 'three'}
            onSelect={() => setRow('three')}
          />
          <ListItem data-hover="" leading={<Avatar id="row-4" name="四" />} title="强制 hover 预览" subtitle="hover 露出 ···" meta="09:00" hoverActions={<IconButton size="sm" icon={Ellipsis} label="更多" />} onSelect={() => {}} />
          <ListItem leading={<Avatar id="row-5" name="五" />} title="禁用项" subtitle="不可点击" disabled onSelect={() => {}} />
          <ListItem dense leading={<Avatar id="row-6" name="六" size={28} />} title="dense 行" trailing={<Badge tone="neutral">12</Badge>} onSelect={() => {}} />
        </div>
      </Item>
      <Item label="设置行 · 控件在右 / stacked / 带徽标 / 禁用">
        <Card variant="rows" className="w-[520px]">
          <SettingRow title="开关设置" description="一句话说明这个选项做什么">
            <Toggle label="开关设置" checked={toggle} onCheckedChange={setToggle} />
          </SettingRow>
          <SettingRow title="下拉设置" description="从若干项里选一个" badge={<Badge tone="ok">本地</Badge>}>
            <Select value={sel} onValueChange={setSel} options={[{ value: 'ask', label: 'Ask', description: '写入前询问' }, { value: 'bypass', label: 'Bypass', description: '读写直接执行' }]} />
          </SettingRow>
          <SettingRow title="分段设置" description="二选一 / 三选一">
            <SegmentedControl aria-label="主题" value={seg} onValueChange={setSeg} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} />
          </SettingRow>
          <SettingRow stacked title="整行输入" description="stacked 变体，控件占满一行" htmlFor="kit-stacked">
            <Input id="kit-stacked" mono placeholder="~/Library/Application Support/…" />
          </SettingRow>
          <SettingRow title="禁用的行" description="不可用时整体 40%" disabled>
            <Toggle label="禁用" checked={false} disabled />
          </SettingRow>
        </Card>
      </Item>
      <Item label="Tab · 激活 / hover / 默认 / 固定 / 未保存（工作区底色 · Agent 面板底色）">
        <div className="flex flex-col gap-3">
          <div className="flex items-end bg-shell px-2 pt-1" role="tablist">
            <Tab icon={Settings} label="固定的设置" pinned active={tab === 'pin'} onSelect={() => setTab('pin')} onClose={() => {}} />
            <Tab icon={MessageCircle} label="会话名称" active={tab === 'a'} onSelect={() => setTab('a')} onClose={() => {}} />
            <Tab icon={FileText} label="生成的文件.md" active={tab === 'b'} onSelect={() => setTab('b')} onClose={() => {}} />
            <Tab icon={Sparkles} label="有未保存修改的规则" dirty active={tab === 'c'} onSelect={() => setTab('c')} onClose={() => {}} />
            <Tab icon={MessageCircle} label="很长很长很长很长的会话标题会被截断" active={tab === 'd'} onSelect={() => setTab('d')} onClose={() => {}} />
          </div>
          <div className="h-3 rounded-b-card bg-content" />
          <div className="flex items-end bg-shell px-2 pt-1" role="tablist">
            <Tab icon={Sparkles} label="Agent 会话" active activeBg="panel" onSelect={() => {}} onClose={() => {}} />
            <Tab icon={Sparkles} label="另一个会话" onSelect={() => {}} onClose={() => {}} />
          </div>
          <div className="h-3 rounded-b-card bg-panel" />
        </div>
      </Item>
      <Item label="卡片 · 面板底 + 1px + r12，无投影">
        <Row align="start">
          <Card className="w-[260px]">
            <div className="text-body text-fg">纯内容卡片</div>
            <div className="mt-1 text-caption text-fg-3">卡片内 pad 16，不加投影。</div>
          </Card>
          <Card title="带头部的卡片" description="标题 13 Medium + 说明 11.5 弱色" actions={<IconButton size="sm" icon={Ellipsis} label="更多" />} className="w-[300px]">
            <div className="text-caption text-fg-2">内容区</div>
          </Card>
        </Row>
      </Item>
      <Item label="Chip · 筛选（带计数）/ 引用">
        <Row className="flex-wrap gap-2">
          <Chip label="全部" count={42} selected={chip === 'all'} onClick={() => setChip('all')} />
          <Chip label="单聊" count={26} selected={chip === 'dm'} onClick={() => setChip('dm')} />
          <Chip label="群聊" count={16} selected={chip === 'group'} onClick={() => setChip('group')} />
          <Chip label="禁用" disabled />
          <Divider orientation="vertical" className="h-5" />
          <Chip variant="mention" icon={MessageCircle} label="会话引用" onRemove={() => {}} />
          <Chip variant="mention" icon={FileText} label="文件.md" onRemove={() => {}} />
          <Chip variant="mention" icon={UserRound} label="联系人" onRemove={() => {}} />
        </Row>
      </Item>
      <Item label="Kbd / 分隔线">
        <Row align="start" className="gap-6">
          <Row className="gap-2">
            <Kbd keys="⌘K" />
            <Kbd keys="⌘⇧T" />
            <Kbd keys="Esc" />
          </Row>
          <div className="flex w-[200px] flex-col gap-3">
            <Divider />
            <Divider strength={8} />
            <Divider label="或" />
          </div>
        </Row>
      </Item>
      <Item label="ScrollArea · 细滚动条（hover 出现）">
        <ScrollArea className="h-[120px] w-[240px] rounded-card border border-line-6 bg-panel">
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="rounded-control px-2 py-1 text-caption text-fg-2">
                第 {i + 1} 行
              </div>
            ))}
          </div>
        </ScrollArea>
      </Item>
      <Item label="字段标签 · 图标 + 名称 + ? + 提示 + 状态">
        <div className="flex w-[420px] flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel icon={FileText} label="数据库路径" help="微信本地数据库所在目录" hint="自动检测或手动选择" status={{ kind: 'success', text: '已自动获取' }} htmlFor="kit-field-1" />
            <Input id="kit-field-1" mono placeholder="/path/to/db" />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel icon={UserRound} label="账号" required status={<Badge tone="warn">未验证</Badge>} htmlFor="kit-field-2" />
            <Input id="kit-field-2" mono placeholder="wxid_…" />
          </div>
          <State name="error 状态" className="items-start">
            <FieldLabel icon={Settings} label="密钥" hint="64 位十六进制" status={{ kind: 'error', text: '格式不正确' }} className="w-full" />
          </State>
        </div>
      </Item>
    </Section>
  )
}
