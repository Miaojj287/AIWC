import { ScrollArea } from '@/kit'
import type { TabRendererProps } from '@/workspace/tabRegistry'
import { ButtonsSection } from './sections/ButtonsSection'
import { EmptyStatesSection } from './sections/EmptyStatesSection'
import { FeedbackSection } from './sections/FeedbackSection'
import { InputsSection } from './sections/InputsSection'
import { OverlaysSection } from './sections/OverlaysSection'
import { StructureSection } from './sections/StructureSection'
import { TogglesSection } from './sections/TogglesSection'

const SECTIONS = [
  { id: 'buttons', label: '① 按钮' },
  { id: 'toggles', label: '② 开关 / 复选 / 单选' },
  { id: 'inputs', label: '③ 输入与选择' },
  { id: 'feedback', label: '④ 反馈' },
  { id: 'overlays', label: '⑤ 浮层模板' },
  { id: 'states', label: '⑥ 空态 / 加载 / 错误' },
  { id: 'structure', label: '⑦ 结构组件' },
]

/**
 * Kit gallery Tab — every component × every state, in the order of the Figma board 154:415 so a
 * screenshot of this tab can be placed next to docs/design/figma/components-board-154-415.png.
 * Dev-only surface; open it with `runCommand` / tabsStore.open({ kind: 'kit', objectId: 'gallery', title: '组件库' }).
 */
export function KitTab(_props: TabRendererProps) {
  return (
    <ScrollArea className="h-full w-full bg-content">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-12 px-10 pb-16 pt-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-title font-medium leading-7 text-fg">通用组件 · 状态总表</h1>
          <p className="text-caption text-fg-3">所有页面共用的基础控件与浮层模板：按钮 / 开关 / 输入 / 反馈 / 浮层 / 空态。各页面的具体实例对应「交互态」看板。</p>
          <nav aria-label="分节" className="mt-1 flex flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(s.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                }}
                className="rounded-chip bg-line-6 px-2.5 py-0.5 text-caption text-fg-2 hover:bg-line-10 hover:text-fg"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </header>
        <ButtonsSection />
        <TogglesSection />
        <InputsSection />
        <FeedbackSection />
        <OverlaysSection />
        <EmptyStatesSection />
        <StructureSection />
      </div>
    </ScrollArea>
  )
}
