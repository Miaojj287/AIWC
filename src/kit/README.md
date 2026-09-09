# @/kit — AIWC 组件库

唯一的 UI 原语层（`ARCHITECTURE.md` §9）。页面只组合这里的组件，不得自造按钮 / 行 / 菜单 / 弹窗。
视觉真源：Figma `154:415` 通用组件看板；约束：`CLAUDE.md` §2–§3；行为：`DESIGN-SPEC.md` §6。
颜色 / 圆角 / 字号只用 `src/styles/tokens.css` 映射出的 Tailwind 类（`bg-panel`、`text-fg-3`、`rounded-card`…），组件里不出现 hex。行高用 spacing 步进（`leading-4 / leading-4.5 / leading-5` = 16 / 18 / 20px），不写 `leading-[Npx]`。
「白色叠加」只用命名的灰阶：`line-4/6/8/10`、`hover-5/7`（`bg-line-8`、`border-line-10`），再强一档用 `kit.css` 里的 `fill-13 / line-16 / fill-20 / line-25 / fill-28 / line-40`（写成 `bg-(--fill-13)`、`border-(--line-16)`），亮色主题下自动翻转。不要写 `fg/N` 这类临时透明度，不要加第七档。弹窗 / 抽屉的遮罩只用 `kit.css` 里的 `--scrim`（挂在 `.kit-overlay` 上），不要各自再写一个 `bg-black/N`。
Gallery：工作区 Tab `kit`（`src/features/kit`），每个组件 × 每个状态，与 Figma 看板同序，便于并排截图。

| 组件 | 一句话 | 什么时候用 |
|---|---|---|
| `Button` | primary / ghost / outline / danger / link，h30 r6，sm h26；`icon`、`loading` | 每屏一个 primary；danger 只在破坏性确认；link 做行内动作 |
| `IconButton` | 28 方形图标钮，`label` 必填；`active` = 橙 15% 底 | 工具栏、hover 露出的 `···`、输入框尾部（size xs） |
| `Toggle` | Radix Switch 36×20 | 即时生效的开 / 关（设置行右侧、规则启停） |
| `Checkbox` | 16 r4，支持 `indeterminate`，可带 `label / description` | 多选、导出勾选、全选 |
| `Radio` / `RadioGroup` | 16 圆，选中 5px 橙环 | 弹窗 / popover 里的单选表单；主界面不用 radio |
| `SegmentedControl` | 2–3 选一，←/→ 键盘移动即选中 | 主题、全部 / 已开启 / 已暂停、本地 / 在线 |
| `Select` | 触发器 h28 + 带勾 / 描述 / 徽标 / 搜索 / 「管理…」页脚的列表 | 从若干项里选一个（模型、提供商、触发方式） |
| `Input` | h32，6 态；`icon`、`trailing`、`mono`、密码 👁、`error` 行内报错 | 所有单行输入；路径 / wxid / 密钥用 `mono` |
| `Textarea` | 同框，12/18；`autosize` | 提示词、固定文案、记忆编辑 |
| `SearchBox` | 搜索图标 + 清除 ×；Enter 提交，Esc 清空 | 会话搜索、设置搜索、成员筛选 |
| `FieldLabel` | 图标 + 名称 + ? tooltip + 提示 + 状态 | 向导 / 设置里的字段标题行 |
| `Badge` | 语义色 14% 底 + 30% 描边；`dot` 变体 | 已验证 / 未验证 / 本地 / 分身 / 失败 / 等待确认 |
| `Chip` | filter（带计数，选中橙 12%）/ mention（橙 chip + ×） | 列表筛选；Agent 输入框的 @ 引用 |
| `InlineHint` | 图标 12 + 文字 11.5，四种语义色 | 控件下的校验 / 状态一句话 |
| `Spinner` | 12 / 16 / 24 旋转 loader | 加载中、按钮 loading、同步条 |
| `ProgressBar` | 6px 条，确定 / 不确定 | 下载、克隆、密钥获取、上下文占用 |
| `Skeleton` / `SkeletonListRows` | 脉冲占位；列表行骨架 | 列表首次加载 |
| `EmptyState` | empty / loading / error / no-results 一个模板 | 每个列表 / 区域必备四态 |
| `toast()` / `Toaster` / `ToastView` | store + 右下角容器；4s 自动消失，带操作 / progress 常驻 | 操作结果；`Toaster` 只在 App 挂一次 |
| `Tooltip` / `TooltipProvider` | 纯文字 / 带 `kbd` / 两行 | 图标按钮说明、禁用原因、上下文明细 |
| `Popover*` | r12 浮层卡 | 轻量确认 / 小表单（权限确认、会话信息、纠正） |
| `DropdownMenu*` / `ContextMenu*` / `MenuSpec` | 同一套项样式：h30 / 带描述 42、分组、快捷键、子菜单、禁用、徽标、危险项最后 | `···` 与右键用同一份 `MenuSpec` |
| `Dialog*` | 基础件：`DialogContent`(size / lockOutside / lockEscape) + `DialogHeader` + `DialogBody` + `DialogFooter` | 自己组合特殊弹窗时 |
| `ConfirmDialog` | info 图标，取消默认焦点 | 普通二次确认 |
| `DangerDialog` | danger 主按钮，遮罩点击不关闭，可选 `confirmWord` | 删除 / 清空 / 撤回 / 发送 |
| `FormDialog` + `FormDialogField` | 64px 标签列 + 控件，Enter 提交 | 小表单（导出、新建规则） |
| `ProgressDialog` | 进度条 + 状态 + 步骤 ✓/⟳/○/!，只有取消 | 长任务 |
| `Drawer` | 右侧 360 抽屉 | 长列表详情（全部记录）；不做功能页 |
| `Avatar` | 36 / 28 / 20，首字 + 8 个哈希渐变块；`members` 九宫格（r4 色块 / 图片，格内不放文字） | 会话 / 联系人 / 群 |
| `ListItem` | 头像 36｜标题 13 + 副标题 12｜meta / trailing；选中橙 12%，hover 露出 `hoverActions` | 会话、联系人、规则 |
| `SettingRow` | 标题 + 说明｜控件；行间 1px；`stacked` 整行控件 | 所有设置页；放在 `<Card variant="rows">` 里 |
| `Tab` | h40，激活 = 与内容同底 + 上圆角 8 + 橙图标 + ×；`pinned` / `dirty` | 工作区与 Agent 面板的 Tab 条 |
| `Card` | 面板底 + 1px line-6 + r12 + p16，无投影 | 分组内容、设置卡、克隆确认页 |
| `Kbd` | 快捷键胶囊 | tooltip / 菜单里的快捷键 |
| `Divider` | 1px 线，可竖向 / 带文字 | 层与层之间 |
| `ScrollArea` | 细滚动条（hover 出现） | 三个固定列、Tab 内容 |

约定：图标只用 lucide（stroke 1.75）；不用 emoji；每个可点的东西都有 hover / focus-visible / disabled 态；
破坏性动作走 `DangerDialog`；长任务走 `ProgressDialog`；结果走 `toast`；校验走 `Input error` / `InlineHint`。
