import { Check, Sparkles, Trash } from 'lucide-react'
import { Button, IconButton, type ButtonProps } from '@/kit'
import { FOCUS_RING, Item, Row, RowLabel, Section, State } from '../gallery'

type Variant = NonNullable<ButtonProps['variant']>

const VARIANTS: Array<{ variant: Variant; label: string; icon?: ButtonProps['icon']; forced: { hover: string; active: string } }> = [
  { variant: 'primary', label: '保存', icon: Check, forced: { hover: 'bg-accent-hover', active: 'bg-accent-active' } },
  { variant: 'ghost', label: '取消', forced: { hover: 'bg-(--fill-13)', active: 'bg-(--line-16)' } },
  { variant: 'outline', label: '更多', forced: { hover: 'bg-(--fill-13) border-(--line-25)', active: 'bg-(--line-16)' } },
  { variant: 'danger', label: '删除', icon: Trash, forced: { hover: 'brightness-[1.08]', active: 'brightness-[0.9]' } },
  { variant: 'link', label: '查看全部', forced: { hover: 'bg-accent/8', active: 'bg-accent/14' } },
]

export function ButtonsSection() {
  return (
    <Section id="buttons" title="① 按钮" description="5 种类型 × 6 种状态。primary 用于每个界面唯一主操作；danger 只在破坏性确认里出现；link 用于行内动作">
      {VARIANTS.map(({ variant, label, icon, forced }) => (
        <Item key={variant} label={`${variant} · ${label}`}>
          <Row>
            <RowLabel>{variant}</RowLabel>
            <State name="默认">
              <Button variant={variant} icon={icon}>
                {label}
              </Button>
            </State>
            <State name="hover">
              <Button variant={variant} icon={icon} className={forced.hover}>
                {label}
              </Button>
            </State>
            <State name="按下">
              <Button variant={variant} icon={icon} className={forced.active}>
                {label}
              </Button>
            </State>
            <State name="focus">
              <Button variant={variant} icon={icon} className={FOCUS_RING}>
                {label}
              </Button>
            </State>
            <State name="禁用">
              <Button variant={variant} icon={icon} disabled>
                {label}
              </Button>
            </State>
            <State name="loading">
              <Button variant={variant} icon={icon} loading>
                {label}
              </Button>
            </State>
          </Row>
        </Item>
      ))}
      <Item label="尺寸 · sm h26">
        <Row>
          <Button size="sm" icon={Check}>
            保存
          </Button>
          <Button size="sm" variant="ghost">
            取消
          </Button>
          <Button size="sm" variant="outline">
            更多
          </Button>
          <Button size="sm" variant="link">
            查看全部
          </Button>
        </Row>
      </Item>
      <Item label="图标按钮 · 四态">
        <Row className="gap-3">
          <State name="默认">
            <IconButton icon={Sparkles} label="示例" />
          </State>
          <State name="hover">
            <IconButton icon={Sparkles} label="示例" className="bg-line-8 text-fg" />
          </State>
          <State name="按下">
            <IconButton icon={Sparkles} label="示例" className="bg-(--fill-13) text-fg" />
          </State>
          <State name="激活">
            <IconButton icon={Sparkles} label="示例" active />
          </State>
          <State name="禁用">
            <IconButton icon={Sparkles} label="示例" disabled />
          </State>
          <State name="sm / xs">
            <Row className="gap-1">
              <IconButton icon={Sparkles} label="示例" size="sm" />
              <IconButton icon={Sparkles} label="示例" size="xs" />
            </Row>
          </State>
        </Row>
      </Item>
    </Section>
  )
}
