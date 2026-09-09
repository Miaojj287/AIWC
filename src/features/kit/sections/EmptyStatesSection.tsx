import { Plus, RefreshCw, X } from 'lucide-react'
import { EmptyState } from '@/kit'
import { Item, Section } from '../gallery'

export function EmptyStatesSection() {
  return (
    <Section id="states" title="⑥ 空态 / 加载 / 错误" description="统一：图标盒 44px + 标题 14 + 说明 12 + 主按钮">
      <Item label="空态">
        <EmptyState bordered variant="empty" title="还没有内容" description="一句话告诉用户下一步做什么" action={{ label: '开始', icon: Plus, onClick: () => {} }} className="h-[200px] w-[300px]" />
      </Item>
      <Item label="加载中">
        <EmptyState bordered variant="loading" title="正在加载…" description="首次索引可能需要几分钟" className="h-[200px] w-[300px]" />
      </Item>
      <Item label="错误">
        <EmptyState bordered variant="error" title="加载失败" description="网络或数据库暂时不可用" action={{ label: '重试', icon: RefreshCw, onClick: () => {} }} className="h-[200px] w-[300px]" />
      </Item>
      <Item label="无结果">
        <EmptyState bordered variant="no-results" title="没有匹配的结果" description="试试其他关键词，或清除筛选" action={{ label: '清除筛选', icon: X, onClick: () => {} }} className="h-[200px] w-[300px]" />
      </Item>
      <Item label="compact（窄列）">
        <EmptyState bordered compact variant="empty" title="暂无会话" description="同步后会出现在这里" action={{ label: '同步', icon: RefreshCw, onClick: () => {} }} className="w-[240px]" />
      </Item>
    </Section>
  )
}
