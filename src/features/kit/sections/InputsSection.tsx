import { Copy, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { Badge, IconButton, Input, SearchBox, SegmentedControl, Select, Textarea, type SelectOption } from '@/kit'
import { Item, Row, Section, State } from '../gallery'

const SELECT_OPTIONS: SelectOption[] = [
  { value: 'a', label: '选项 A', description: '一句话说明它做什么' },
  { value: 'b', label: '选项 B', description: '一句话说明' },
  { value: 'c', label: '选项 C', description: '一句话说明', badge: <Badge tone="ok">本地</Badge> },
  { value: 'd', label: '禁用项', description: '不可选择', disabled: true },
]

const THEME_OPTIONS = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统' },
] as const

export function InputsSection() {
  const [selectValue, setSelectValue] = useState<string>('a')
  const [theme, setTheme] = useState<string>('dark')
  const [search, setSearch] = useState('')
  const [text, setText] = useState('')

  return (
    <Section id="inputs" title="③ 输入与选择" description="输入框 6 态；文本域；下拉选择 4 态；分段控件；搜索框">
      <Item label="输入框">
        <Row align="start" className="flex-wrap">
          <State name="默认">
            <Input placeholder="请输入…" className="w-[220px]" aria-label="默认" />
          </State>
          <State name="hover">
            <Input defaultValue="示例文本" className="w-[220px] border-(--line-16)" aria-label="hover" />
          </State>
          <State name="focus">
            <Input defaultValue="示例" className="w-[220px] border-accent/80" aria-label="focus" />
          </State>
          <State name="错误">
            <Input defaultValue="wxid_example" mono error className="w-[220px]" aria-label="错误" />
          </State>
          <State name="禁用">
            <Input defaultValue="不可编辑" disabled className="w-[220px]" aria-label="禁用" />
          </State>
          <State name="带图标">
            <Input
              type="password"
              defaultValue="sk-example-key"
              mono
              className="w-[220px]"
              aria-label="密钥"
              trailing={<IconButton size="xs" icon={Copy} iconSize={14} label="复制" tabIndex={-1} className="text-fg-3" />}
            />
          </State>
        </Row>
      </Item>
      <Item label="错误态 + 行内提示">
        <Input defaultValue="wxid_example_9f21" mono error="该目录缺少 db_storage" className="w-[220px]" aria-label="账号" />
      </Item>
      <Item label="尺寸 sm · 带提示">
        <Input size="sm" placeholder="h28" hint="一句话帮助文字" className="w-[220px]" aria-label="sm" />
      </Item>
      <Item label="文本域">
        <Row align="start">
          <State name="默认">
            <Textarea placeholder="一段多行文本…" className="w-[260px]" rows={3} aria-label="默认" />
          </State>
          <State name="focus">
            <Textarea defaultValue="一段多行文本，用作示例。" className="w-[260px] border-accent/80" rows={3} aria-label="focus" />
          </State>
          <State name="autosize">
            <Textarea autosize minRows={2} maxRows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入多行会自动长高" className="w-[260px]" aria-label="autosize" />
          </State>
        </Row>
      </Item>
      <Item label="下拉选择">
        <Row align="start">
          <State name="默认">
            <Select options={SELECT_OPTIONS} value={selectValue} onValueChange={setSelectValue} aria-label="默认" />
          </State>
          <State name="hover">
            <Select options={SELECT_OPTIONS} value="a" className="bg-line-10" aria-label="hover" />
          </State>
          <State name="展开（点击）">
            <Select
              options={SELECT_OPTIONS}
              value={selectValue}
              onValueChange={setSelectValue}
              searchable
              footer={{ label: '管理…', description: '跳转到设置', onSelect: () => {} }}
              aria-label="展开"
            />
          </State>
          <State name="禁用">
            <Select options={SELECT_OPTIONS} value="a" disabled aria-label="禁用" />
          </State>
          <State name="占位 · lg · 满宽">
            <Select options={SELECT_OPTIONS} value={null} placeholder="请选择" size="lg" fullWidth className="w-[200px]" aria-label="占位" />
          </State>
        </Row>
      </Item>
      <Item label="分段控件 · hover / 选中 / 默认">
        <Row>
          <SegmentedControl aria-label="主题" options={THEME_OPTIONS} value={theme} onValueChange={setTheme} />
          <SegmentedControl aria-label="尺寸 sm" size="sm" options={[{ value: 'all', label: '全部' }, { value: 'on', label: '已开启' }, { value: 'off', label: '已暂停' }]} value="all" onValueChange={() => {}} />
          <SegmentedControl aria-label="禁用" options={THEME_OPTIONS} value="dark" onValueChange={() => {}} disabled />
        </Row>
      </Item>
      <Item label="搜索框 · 默认 / focus">
        <Row align="start">
          <State name="默认">
            <SearchBox placeholder="搜索会话" shortcut="⌘K" wrapperClassName="w-[240px]" aria-label="默认" />
          </State>
          <State name="focus + 清除">
            <SearchBox value={search || '示例'} onValueChange={setSearch} wrapperClassName="w-[240px] border-accent/80" aria-label="focus" />
          </State>
          <State name="sm">
            <SearchBox size="sm" placeholder="搜索设置" wrapperClassName="w-[200px]" aria-label="sm" />
          </State>
        </Row>
      </Item>
    </Section>
  )
}
