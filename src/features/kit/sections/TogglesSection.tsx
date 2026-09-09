import { Checkbox, Radio, RadioGroup, Toggle } from '@/kit'
import { FOCUS_RING, Item, Row, Section, State } from '../gallery'

export function TogglesSection() {
  return (
    <Section id="toggles" title="② 开关 / 复选 / 单选" description="选中色统一用品牌橙；禁用 40% 透明；focus 用 2px 外描边">
      <Item label="开关">
        <Row align="start">
          <State name="关">
            <Toggle label="示例" defaultChecked={false} />
          </State>
          <State name="关 hover">
            <Toggle label="示例" defaultChecked={false} className="bg-(--fill-28)" />
          </State>
          <State name="开">
            <Toggle label="示例" defaultChecked />
          </State>
          <State name="开 hover">
            <Toggle label="示例" defaultChecked className="data-[state=checked]:bg-accent-hover" />
          </State>
          <State name="focus">
            <Toggle label="示例" defaultChecked className={FOCUS_RING} />
          </State>
          <State name="禁用">
            <Toggle label="示例" defaultChecked={false} disabled />
          </State>
        </Row>
      </Item>
      <Item label="复选框">
        <Row align="start">
          <State name="未选">
            <Checkbox aria-label="示例" checked={false} />
          </State>
          <State name="hover">
            <Checkbox aria-label="示例" checked={false} className="border-(--line-40) bg-line-8" />
          </State>
          <State name="选中">
            <Checkbox aria-label="示例" checked />
          </State>
          <State name="部分选中">
            <Checkbox aria-label="示例" checked="indeterminate" />
          </State>
          <State name="禁用">
            <Checkbox aria-label="示例" checked={false} disabled />
          </State>
          <State name="带标签">
            <Checkbox defaultChecked label="选项名称" description="一句话说明" />
          </State>
        </Row>
      </Item>
      <Item label="单选">
        <Row align="start">
          <RadioGroup value="on" aria-label="示例" className="flex-row gap-4">
            <State name="未选">
              <Radio value="off" aria-label="未选" />
            </State>
            <State name="hover">
              <Radio value="hover" aria-label="hover" className="border-(--line-40)" />
            </State>
            <State name="选中">
              <Radio value="on" aria-label="选中" />
            </State>
            <State name="禁用">
              <Radio value="disabled" aria-label="禁用" disabled />
            </State>
          </RadioGroup>
          <State name="带标签">
            <RadioGroup defaultValue="a" aria-label="示例组">
              <Radio value="a" label="选项 A" description="一句话说明" />
              <Radio value="b" label="选项 B" />
            </RadioGroup>
          </State>
        </Row>
      </Item>
    </Section>
  )
}
