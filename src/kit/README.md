# @/kit — AIWC 组件库

唯一的 UI 原语层（`ARCHITECTURE.md` §9）。页面只组合这里的组件，不得自造按钮 / 行 / 菜单 / 弹窗。
视觉真源：Figma `154:415` 通用组件看板；约束：`CLAUDE.md` §2–§3；行为：`DESIGN-SPEC.md` §6。
颜色 / 圆角 / 字号只用 `src/styles/tokens.css` 映射出的 Tailwind 类（`bg-panel`、`text-fg-3`、`rounded-card`…），组件里不出现 hex。行高用 spacing 步进（`leading-4 / leading-4.5 / leading-5` = 16 / 18 / 20px），不写 `leading-[Npx]`。
「白色叠加」只用命名的灰阶：`line-4/6/8/10`、`hover-5/7`（`bg-line-8`、`border-line-10`），再强一档用 `kit.css` 里的 `fill-13 / line-16 / fill-20 / line-25 / fill-28 / line-40`（写成 `bg-(--fill-13)`、`border-(--line-16)`），亮色主题下自动翻转。不要写 `fg/N` 这类临时透明度，不要加第七档。弹窗 / 抽屉的遮罩只用 `kit.css` 里的 `--scrim`（挂在 `.kit-overlay` 上），不要各自再写一个 `bg-black/N`。
Gallery：工作区 Tab `kit`（`src/features/kit`），每个组件 × 每个状态，与 Figma 看板同序，便于并排截图。

| 组件 | 一句话 | 什么时候用 |
|---|---|---|
| `Button` | primary / ghost / outline / danger / link，h30 r6，sm h26；`icon`、`loading`（不变灰、忽略点击、`aria-busy`）、`disabledReason`（禁用原因 Tooltip） | 每屏一个 primary；danger 只在破坏性确认；link 做行内动作 |
| `IconButton` | 28 方形图标钮，`label` 必填；`active` = 强调色 15% 底；同样支持 `loading` / `disabledReason` | 工具栏、hover 露出的 `···`、输入框尾部（size xs）、弹窗 / 抽屉 / Toast 的关闭钮 |
| `Toggle` | Radix Switch 36×20 | 即时生效的开 / 关（设置行右侧、规则启停） |
| `Checkbox` | 16 r4，支持 `indeterminate`，可带 `label / description`；`shape="round"` = 18 圆形（清单勾选） | 多选、导出勾选、全选；每日待办清单 |
| `Radio` / `RadioGroup` | 16 圆，选中 5px 强调色环 | 弹窗 / popover 里的单选表单；主界面不用 radio |
| `SegmentedControl` | 2–3 选一，←/→ 键盘移动即选中 | 主题、全部 / 已开启 / 已暂停、本地 / 在线 |
| `Select` | 触发器 h28 + 带勾 / 描述 / 徽标 / 搜索 / 「管理…」页脚的列表 | 从若干项里选一个（模型、提供商、触发方式） |
| `PermissionSelect` | Ask / Bypass / Autopilot 下拉，每项一句说明，可带「权限规则…」页脚；触发器显示模式名 | Agent 输入框工具栏、定时任务编辑器 |
| `ModelSelect` | 模型下拉：名称 + 本地 / 在线徽标 + 推理强度；`modelLabelFor` 给出同一套显示名 | Agent 输入框工具栏、克隆、自动回复、定时任务 |
| `ReasoningEffortSelect` | 推理强度下拉：「默认（模型设置）」+ 该模型支持的档位，每档一句说明；只给支持推理控制的模型显示 | Agent 输入框工具栏（每个会话单独设置） |
| `ColorField` | 左侧色样（点开色板）+ 右侧可编辑 HEX，3 / 6 位；拖动只更新局部预览，松手 / 回车 / 失焦才 `onCommit` | 外观设置里的强调色、背景、前景、字体色 |
| `Input` | h32，6 态；`icon`、`trailing`、`mono`、密码 👁、`error` 行内报错 | 所有单行输入；路径 / wxid / 密钥用 `mono` |
| `Textarea` | 同框，12/18；`autosize` | 提示词、固定文案、记忆编辑 |
| `SearchBox` | 搜索图标 + 清除 ×；Enter 提交，Esc 清空；`landmark` 才声明 `role="search"`（一屏只给主搜索） | 会话搜索、设置搜索、成员筛选 |
| `FieldLabel` | 图标 + 名称 + `help` 问号 + 提示 + 状态（状态单行截断） | 向导 / 设置里的字段标题行 |
| `Badge` | 语义色 14% 底 + 30% 描边 + ink 字；`dot` 变体 | 已验证 / 未验证 / 本地 / 分身 / 失败 / 等待确认 |
| `Chip` | filter（带计数，选中强调色 12%）/ mention（强调色 chip + ×；聚焦后 Delete / Backspace 移除） | 列表筛选；Agent 输入框的 @ 引用 |
| `InlineHint` | 图标 12 + 文字 11.5，四种语义色（ink 字）；`truncate` 单行省略并把全文放进 `title`；`live` 才成为 live region | 控件下的校验 / 状态一句话；窄标题栏里的状态行用 `truncate` |
| `Spinner` | 12 / 16 / 24 旋转 loader；默认 `aria-hidden`，独立出现且旁边没有文字时传 `announce` | 加载中、按钮 loading、同步条 |
| `ProgressBar` | 6px 条，确定 / 不确定 | 下载、克隆、密钥获取、上下文占用 |
| `Skeleton` / `SkeletonListRows` | 脉冲占位；列表行骨架 | 列表首次加载 |
| `EmptyState` | empty / loading / error / no-results 一个模板 | 每个列表 / 区域必备四态 |
| `ErrorBoundary` | 子树渲染出错时显示 `EmptyState` 错误态 +「重试」（重新挂载子树）；`compact`、`fallback` | 每个 Tab 宿主、对象列表主体、Agent 面板；内容整体换掉时给它 `key`，旧错误不残留 |
| `toast()` / `Toaster` / `ToastView` | store + 顶部居中容器；4s 自动消失，带操作 / progress 常驻 | 操作结果；`Toaster` 只在 App 挂一次 |
| `Tooltip` / `TooltipProvider` | 纯文字 / 带 `kbd` / 两行 / `multiline` 说明（最宽 240 可换行） | 图标按钮说明、禁用原因、上下文明细 |
| `SelectionAction` | 选中文字后浮在选区上方的一个 sm outline 按钮（浮层底 + 浮层投影）；只认 `containerRef` 内的选区，选区收起 / 滚动 / 改窗口大小即消失；按下不丢选区 | 引用到 Agent（Agent 对话、聊天 Tab、文件 Tab） |
| `HelpTip` | 13 问号图标 + `multiline` Tooltip，无障碍名「{subject}说明」 | 替代长说明文字：`SettingRow` / `Section` / `FieldLabel` 的 `help` 已内置，不要手摆 |
| `Popover*` | r12 浮层卡 | 轻量确认 / 小表单（权限确认、会话信息、纠正） |
| `DropdownMenu*` / `ContextMenu*` / `MenuSpec` | 同一套项样式：h30 / 带描述 42、分组、快捷键、子菜单、禁用、徽标、危险项最后 | `···` 与右键用同一份 `MenuSpec` |
| `MenuItemContent` / `menuItemClass` / `menuLabelClass` | 菜单项的内部布局与类名（与上面同一套） | 不是 Radix 菜单、但要长得像菜单项的列表：输入框建议列表、线程列表 |
| `Dialog*` | 基础件：`DialogContent`(size / lockOutside / lockEscape) + `DialogHeader` + `DialogBody` + `DialogFooter`；页脚放「取消 + 主按钮」时传 `actions`，Windows 自动反序 | 自己组合特殊弹窗时 |
| `ConfirmDialog` | info 图标，取消默认焦点 | 普通二次确认 |
| `DangerDialog` | danger 主按钮，遮罩点击不关闭，可选 `confirmWord` | 删除 / 清空 / 撤回 / 发送 |
| `FormDialog` + `FormDialogField` | 64px 标签列 + 控件，Enter 提交 | 小表单（导出、新建规则） |
| `ProgressDialog` | 进度条 + 状态 + 步骤 ✓/⟳/○/!，只有取消 | 长任务 |
| `TaskProgress` | 行内长任务：一行当前阶段 + 可选提示 / 计时 + 步骤 ✓/⟳/○/! + 失败原因与操作 | 跟随产物的长任务（密钥获取） |
| `Drawer` | 右侧 360 抽屉 | 长列表详情（全部记录）；不做功能页 |
| `Avatar` | 36 / 28 / 20，首字 + 8 个哈希渐变块；`members` 九宫格（r4 色块 / 图片，格内不放文字） | 会话 / 联系人 / 群 |
| `ListItem` | 头像 36｜标题 13 + 副标题 12｜meta / trailing；选中 `bg-selected` + `ring-selected-ring`（`aria-current`），hover 露出 `hoverActions`；`tooltip` 给整行说明；类名 `kit-row` 供键盘导航与焦点框使用；`compact` = 32px 单行导航行（16px 前置槽放图标 / 状态、标题 13 常规、无副标题，隐含 `quiet`）；`quiet` = 中性选中 `bg-raised`（同设置导航，无强调色底与描边） | 会话、联系人、规则；`compact`：Agent 窗口侧栏 |
| `SettingRow` | 标题 + 一句说明 + `help` 问号｜控件；行间 1px；`stacked` 整行控件；窄于 380px 时控件自动落到文字下方 | 所有设置页；放在 `<Card variant="rows">` 里 |
| `Tab` | h40，激活 = 与内容同底 + 上圆角 8 + 主色文字与图标（无强调色）+ ×；`pinned` / `dirty` / `indicator`（标签后的状态点：accent = 已完成未查看，danger = 失败，`label` 供读屏） | 工作区与 Agent 面板的 Tab 条 |
| `Card` | 面板底 + 1px line-6 + r12 + p16，无投影 | 分组内容、设置卡、克隆确认页 |
| `Kbd` | 快捷键胶囊 | tooltip / 菜单里的快捷键 |
| `Divider` | 1px 线，可竖向 / 带文字 | 层与层之间 |
| `ScrollArea` | 细滚动条（hover / 滚动时 120ms 淡入淡出） | 三个固定列、Tab 内容 |
| `Markdown` / `MarkdownInlines` | 唯一的 Markdown 解析 + 渲染（不注入 HTML）：标题、段落、缩进嵌套列表、引用、代码块（悬停露出「复制代码」）、分隔线、GFM 表格（对齐、`\|`、参差行；表格在自己的横向滚动框里，表头 Semibold，12px）；流式安全：未闭合的代码块按代码显示，表格的分隔行写完前按段落显示。`preserveLineBreaks` 保留单个换行；`onLink` 处理链接点击（不传 = 只显示、`title` 给出目标）；`renderInlines(nodes, scope)` 替换所有行内渲染（段落、标题、列表项、引用、表格单元格；表格的 `scope` 是整张表），`MarkdownInlines` 的 `renderNode` 只替换某个节点；`tableActions` 打开表格的 `···` 菜单（复制为 Markdown / TSV，`onSaveCsv` 另存为 CSV）；`resolveImage(src)` 把 `![alt](src)` 显示为图片（返回可加载的 URL，返回 undefined 保持为链接；不传 = 图片都是链接），点开在 `ZoomPan` 对话框里看。` ```mermaid ` 代码块画成图表（`MermaidBlock`：`mermaid` 懒加载、`securityLevel: 'strict'`、主题取 token、画不出时显示源码，可切换源码 / 放大查看）。元素类名只来自 `MARKDOWN_CLASS` | Agent 回复（引用 chip、存 CSV、本地图片）、文件 Tab 预览；不要再写第二个 Markdown 渲染 |
| `ZoomPan` | 可缩放平移的查看器：滚轮 / 触控板捏合以指针为中心缩放（25%–800%）、触摸双指缩放、拖动平移、双击还原，聚焦时 + / − / 0；底部 − · 百分比 · + · 还原 工具条（`hideToolbar` 隐藏）。内容按自己的 CSS 先适配（`max-h-full max-w-full`），缩放相对于此；计算在 `zoomMath.ts` | 聊天图片灯箱、文件 Tab 的图片、回复里的图片与 Mermaid 图表 |

约定：图标只用 lucide（stroke 1.75）；不用 emoji；每个可点的东西都有 hover / focus-visible / disabled 态；
破坏性动作走 `DangerDialog`；长任务走 `ProgressDialog`；结果走 `toast`；校验走 `Input error` / `InlineHint`。

截断：单行文字的 `truncate` 放在文字自己的 span 上，不放在 `flex` / `inline-flex` 容器上（否则会截出半个字而没有「…」），flex 链上的每一项加 `min-w-0`。`truncation.test.ts` 会检查同一 class 串里是否同时出现 `flex` 和 `truncate`。


## 桌面交互基线

共享动效见 `kit.css`，曲线与时长见 `styles/tokens.css`；系统无障碍覆盖见 `styles/accessibility.css`。菜单 / Tooltip 即时显示，偶发弹窗用短 scale / opacity，Toast 用可中断的 transition；键盘触发浮层不做装饰动画。
Tab 方向键 / Home / End 在 Kit 内统一实现；设置行在长控件旁也保留标题空间。通知正文不截断，键盘聚焦暂停计时。浅色语义色、减少透明度、高对比度和减少动态效果须与普通主题一起验证。

设置行上下内边距 16px，说明 12px / 20px；列表选中使用 `selected` / `selected-ring` token（默认 accent-15 底和 accent-30 内描边，窗口失焦变中性灰，高对比度下变实色描边）。常规空态采用 56px 图标容器与 20px 标题，compact 不扩张。Agent 建议和任务模板复用 Button，通过现有参数与 className 排版，不增加第二套可点击组件。

## 状态与文字颜色（2026-09-20）

- **填充用 fill / hover，描边用 line。** `line-*` 会随主题对比度缩放，拿来做 hover 底色在低对比度配色下几乎看不见。交互底色只用 `hover-5 / hover-7 / fill-13 / fill-20`：hover 一档，按下再深一档。按下只换颜色，不缩放。
- **禁用 = 40%，仍然接住指针。** 不写 `pointer-events-none`；`enabled:` 前缀保证禁用时没有 hover 反馈。要解释原因就传 `disabledReason`：禁用的原生按钮不触发 hover，kit 用一层包裹显示 Tooltip 并写入 `aria-description`。不要在禁用按钮上放 `title`。
- **loading 不是 disabled。** 按钮保持原色，spinner 取代图标，点击被忽略，`aria-busy="true"`。
- **彩色文字用 ink。** `text-accent-ink / ok-ink / warn-ink / danger-ink / info-ink / clone-ink` = 语义色向文字色混 22%，11–13px 在两种主题的面板上都 ≥ 4.5:1。纯色（`text-accent` 等）只给图标、填充、描边。固定色表面（primary / danger 按钮、「我」的气泡、头像块）上的字用固定白。
- **焦点只有一处定义。** `styles/accessibility.css` 给所有可聚焦元素 2px 强调色 outline；行、选项、菜单项画在盒内；输入框用 1px 强调色边 + 1px ring。组件里不要再写 `focus-visible:ring-*` / `outline-*`。
- **过渡默认值。** `transition-*` 默认 `--dur-fast` + `--ease-out`，不用逐处写时长。少见、被注视的状态变化用 `.kit-enter`（scale .96 → 1 + 淡入，220ms；给元素换 `key` 触发）。正在干活的文字标签（Agent 的思考行、运行中的工具行）用 `.kit-shimmer`：alpha 蒙版上的一道柔光扫过再停顿，文字颜色不变；减少动态效果下改为透明度呼吸。减少动态效果下 `.animate-spin` 自动改为透明度呼吸，不需要各处判断。
- **键盘触发的浮层即时出现**：由 `<html data-input='keyboard'>` 把 `.kit-overlay / .kit-dialog / .kit-drawer` 的动画时长压到 0.01ms。不要改成 `animation: none`，Radix Presence 会等不到 `animationend` 而把关闭中的弹窗留在屏幕上。

