# 跨平台桌面体验审计与实施记录

日期：2026-09-18。基线提交：`1d9dc2e`。开始时工作区干净。

## 范围与方法

阅读 README、AGENTS、CLAUDE、DESIGN-SPEC、ARCHITECTURE、构建脚本、共享 Kit / shell / workspace / 外观实现；对 src 全部动画、过渡、关键帧、滚动、rAF 与宠物动画进行搜索和只读子代理交叉审计。检查聊天、自动回复、克隆、任务、日记、文件、设置和 onboarding 的状态处理入口。该覆盖是源码审计，不等于每个业务分支均完成真机验收。

栈：Electron 39、React 19.2、TypeScript、Vite、Tailwind 4、Radix、zustand、virtua；没有传统 URL 路由，工作区用 tabRegistry，功能用对象列表注册表。主题由 paletteTokens 派生，Kit 是唯一组件层。

## 优先级与改动

本次未发现经证实的 P0 界面阻断。未运行的硬件 / 权限场景不作无问题承诺。

| 级别 | Before | After | Why |
|---|---|---|---|
| P1 | Tab 只有 Enter / Space，非活动项 tabIndex=-1 | 左右循环 / Home / End 激活与聚焦，同源用于两个 Agent 布局 | 完整键盘路径 |
| P1 | 设置搜索高亮未通过 ARIA 关联输入 | controls / activedescendant，候选独立滚动与即时定位 | 屏幕阅读器可定位当前候选 |
| P1 | 浮层 ease-in 退出，键盘菜单也缩放 | 高频浮层即时，偶发浮层共享曲线，键盘禁用装饰动画 | 更直接的响应 |
| P1 | 弹窗 keyframes 与 Tailwind 4 重复 translate | keyframe 只 scale / opacity | 修正播放中的位置偏移 |
| P1 | reduced-motion 漏掉加载与开关运动 | 静态加载、即时进度 / 开关，短 opacity 浮层 | 尊重系统偏好 |
| P1 | 浅色沿用亮黄 / 亮绿状态字 | 深一档浅色语义 token | 浅底可读性 |
| P2 | 长控件挤压设置标题 | 至少 128px 标题空间，控件可换行 | 1200×720 与英文可用 |
| P2 | 通知截断正文，聚焦仍消失 | 正文换行、24px 关闭命中区、聚焦暂停，去掉嵌套 live region | 信息能读完、操作能完成 |
| P2 | 固定中文字体优先，标题弱 | 系统字体优先、标题字重 / tracking、等宽数字 | 各平台自然排版 |
| P2 | 焦点只靠 box-shadow，材质无系统降级 | outline、forced-colors、contrast、reduced-transparency | Windows 高对比度与跨平台可访问性 |
| P2 | 进度动画 width，上下文环频繁重绘补间 | scaleX 进度；预算环即时更新 | 降低布局和绘制工作 |
| P2 | Toast keyframe、宠物按压缩放、rail filter 过渡 | Toast transition，去掉多余按压与 filter 动画 | 减少高频动效 |

## 设计系统

| 维度 | 规则 |
|---|---|
| 层级 | 壳 / 面板 / 内容三层继续由当前用户配色派生；浮层单独 overlay，卡片无投影 |
| 品牌 | 保留单一用户强调色、功能栏渐变图标、头像、消息气泡和可选宠物 |
| 排版 | 正文13、说明12、微文字11、消息14/22、标题20；系统字体；标题负字距；数字等宽 |
| 空间 | 原有4px步进、30px按钮、40px标签栏、8/6/12px条目/按钮/卡片圆角继续复用 |
| 材质 | 仅导航与侧栏使用原生材质；内容不透明；系统减少透明度 / 高对比度回退实色 |
| 状态 | hover / pressed 即时且轻量，selected 与 focus 分离，loading / empty / error 使用共享组件 |
| 动效 | fast120、base180、surface220；ease-out(0.23,1,0.32,1)、drawer(0.32,0.72,0,1)；没有需要新增 spring 的手势 |
| Mac | 系统字体、Cmd、原有左侧窗口控件和拖动区、sidebar vibrancy；没有新增 macOS 仿制控件 |
| Windows | 系统字体、Ctrl、原生 caption overlay、已有 acrylic 能力检测、真实 outline / forced-colors |

导航、默认列宽、窗口最小尺寸、多显示器 fitToDisplays、缩放与原生安全配置保留。页面内部尺寸调整见下表。没有新增依赖或改动后台数据流。

## 核心页面实施（第二批）

第一批主要解决共享组件与交互问题，不足以代表完整的可感知视觉升级。第二批直接调整日常界面：

| Before | After | Why |
|---|---|---|
| 功能栏常显名称（第二批尝试） | 已按用户反馈撤回，恢复纯图标与 Tooltip | 保持简洁 |
| 对象列表新增标题（第二批尝试） | 已按用户反馈撤回，恢复从搜索开始 | 去掉重复信息 |
| 选中列表行只有淡底色 | accent-15 底与 accent-30 内描边，文字间距更清楚 | 选中对象不与 hover 混淆 |
| 聊天常用动作藏在更多菜单 | 搜索、导出常显并带提示，仍复用原处理器 | 高频动作少一次菜单操作 |
| 聊天 / 回复页首拥挤 | 最小 72px 页首与加粗标题；回复分组更明确 | 内容、状态与动作有层级 |
| 设置标题、分组、行密度相近 | 页首分隔、28px 分组间距、16px 行内边距、12px 说明 | 长设置页更易扫描 |
| Agent 建议是截断的小胶囊 | 最小 40px 整行按钮，完整换行 | 提交前能读清整个建议 |
| Agent 输入文字与工具挤在一起 | 14px 输入文字、工具栏分隔 | 明确输入与配置的空间关系 |
| 克隆参数使用独立横向表单 | Card + SettingRow，与设置页同源 | 更可维护，窄栏自动堆叠 |
| 任务模板依赖窗口宽度决定双列 | 按自身容器 520px 切列，完整说明，复用 Kit Button | 四列布局中不会误判可用宽度 |
| 大区域空态的标题与正文几乎同级 | 56px 图标容器 + 20px 标题；compact 保持紧凑 | 空白页面更清楚表达状态与下一步 |

新增入口回归测试验证聊天快捷动作与加载禁用态。第二批未增加位移或布局动画；复审保留高频交互即时响应，所有新按钮沿用 Kit 的按压、焦点与 reduced-motion 规则。

## 历史 Prompt 区分修复

参考用户提供的成熟 Agent 界面截图：用户请求是一张独立卡片，AI 答复是连续正文。原实现的 Prompt 与工具卡片同为 content 底，正文也接近 AI 字号。修复为 raised 底、line-16 描边、14px Medium / 24px 正文；卡头显示「你 / You」和现有操作，后续轮次前留 24px。修改共享 UserMessage，面板和 Agent 窗口同时生效。未更改消息数据与发送行为。

先复现用户消息无法按独立语义区域识别的失败测试，再修复。修复后构建、类型、lint 与全量 2,256 个测试通过（247 个文件，4 个真实数据库测试跳过）；深色中文与浅色英文预览确认卡片层级和换行，控制台无 error / warn。总检查仍被下述原有 14 个格式问题阻断。

## 动效机会筛选

### Agent 过程展示补充（2026-09-19）

| Before | After | Why |
|---|---|---|
| reasoning 已被接收但未渲染，纯思考消息被过滤 | 独立的默认收起思考区，保留用户展开状态 | 过程可查，答案保持清晰 |
| 所有生成阶段同一文案 | 根据真实消息区分思考、工具执行、回复；审批优先 | 等待状态可理解，不编造耗时 |
| 工具摘要固定一行 | 摘要完整换行，详情分隔，保留独立审批 | 避免关键操作信息被截断 |

沿用 emil-design-eng / apple-design 的层级与克制原则，无新依赖。高频流式输出、思考展开与收起即时响应，不增加布局动画；现有按钮反馈与 Spinner 沿用 Kit 的 reduced-motion。两种 Agent 布局共享实现。先复现 reasoning 丢失及状态不准确的失败测试，再修复；全量 2,259 个测试通过（247 个文件，4 个真实数据库测试跳过），类型检查、lint、构建通过。浏览器检查深色中文流式思考、浅色英文、键盘展开、工具详情，控制台无警告或错误。未请求真实模型；是否返回 reasoning 取决于模型服务，未验证 Windows 真机。总检查仍有原有 14 个格式问题。

| # | 位置 | Today（基线） | Purpose | Frequency | 采用方式 |
|---|---|---|---|---|---|
| 1 | kit.css / Dialog | 居中位移重复、弱缓动 | Spatial consistency | 偶发 | scale .97→1 + opacity；220ms cubic-bezier(.23,1,.32,1)，reduce只淡入 |
| 2 | ToastView | 固定关键帧进入 | Preventing a jarring change | 偶发 | @starting-style，translateY(25%) / opacity，180ms同曲线；reduce只opacity |
| 3 | ProgressBar | 宽度动画 | State indication | 长任务 | scaleX，180ms同曲线；reduce直接显示数值 |

明确拒绝：Tab / 会话切换（高频键盘）；消息流 stagger（正在阅读的数据）；菜单弹跳（高频）；设置搜索 smooth scroll（键盘定位）；新增玻璃模糊动画（无功能收益、增加绘制成本）。这个产品需要少量有目的的状态反馈，最高收益是消除原有干扰。实施详见 plans/001、002。

## Skill 协调

依次使用 emil-design-eng → apple-design → improve-animations（只读子代理审计）→ find-animation-opportunities → animate → review-animations。

不采用新依赖，因此未触发 pick-ui-library；保持现有信息架构，无重大设计分歧，未触发 prototype；无 Swift / Expo / Sonner，因此对应技能不适用；术语无歧义，未启用 animation-vocabulary。

## 复审

| Before | After | Why |
|---|---|---|
| 弹窗动画重复中心位移 | 只缩放，布局负责中心位移 | 消除可见跳位 |
| 所有菜单进入缩放 | 即时打开 | 删除高频动画优先于调整曲线 |
| Toast 动态关键帧 | CSS transition / starting-style | 同 id 更新不重新进入 |
| 动效遗漏系统偏好 | 降级规则统一覆盖 | 保留状态表达，移除位移 |
| focus outline 与输入框边框叠加 | 输入框保留外框聚焦；forced-colors 增加原生轮廓 | 视觉 QA 修正重复焦点框 |

源码复审：Approve。本次新增/调整动效没有 ease-in、layout 补间、未降级位移或悬停位移。保留偶发 Radix Presence 的出入关键帧以维持现有卸载生命周期；没有声称它具备 spring 的速度连续性。Toast 关闭直接生效是明确取舍。原生慢速逐帧、120Hz 和手势手感仍需真机验收。

## 验证与限制

- 基线 typecheck / lint 通过；基线 242 个测试文件通过，2,246 个测试通过，4 个真实数据库测试跳过。
- 第二批最终 `npm run build`、`npm run typecheck`、`npm run lint`、`git diff --check` 通过；全量 247 个测试文件、2,255 个测试通过，4 个真实数据库测试跳过。包括 AgentPanel / AgentWindow 与国际化测试；第一批还单独运行了 `npx vitest run packages/i18n`。
- 已先复现 Tab 方向键、Toast 聚焦计时、设置搜索 ARIA 的失败测试，再实施修复。
- 浏览器实际检查：自动回复四列、Agent 会话展示与整窗切换、浅色 / 深色、英文设置、定时任务空态 / 新建表单、键盘 Tab 切换、复制规则弹窗的居中 / 焦点 / 禁用态、1200×720 最小尺寸。截图已在任务中展示。仅使用已有 dev fixture，无新增演示数据进入生产。
- 预览控制台检查未见 error / warn。构建存在依赖 zod 注释标记警告与既有大包提示；Electron 启动有 SQLite experimental warning。
- 第一批 Mac 锁屏；第二批锁屏限制解除，实际检查了原生窗口、功能栏、侧栏材质、定时任务空态、设置页、浅色与 English 排版，并恢复深色 / 中文偏好。未验证多显示器 / 高 DPI / 系统媒体偏好、Windows 真机或屏幕阅读器。CSS偏好分支由代码约束测试覆盖，不替代真机。
- `npm run check` 被原有14个格式问题阻断；knip 原有13个未使用导出、12个未使用类型，集中于 packages/shell/src/index.ts 与 src/features/tasks/taskStore.ts。保持未涉及代码不变。

原有格式失败文件：

- packages/office/src/cli/cli.test.ts
- packages/office/src/platforms/common.ts
- packages/office/src/service.test.ts
- packages/office/src/service.ts
- packages/office/src/tools/officeTools.ts
- packages/shell/src/classify.test.ts
- packages/shell/src/classify.ts
- packages/shell/src/sandbox.ts
- packages/shell/src/shell.test.ts
- packages/shell/src/shellTool.ts
- src/features/agent/messages/ShellCards.tsx
- src/features/office/OfficeApprovalBodies.tsx
- src/features/settings/pages/AppearanceSettings.test.tsx
- src/features/settings/pages/AppearanceSettings.tsx

后续可选：在两台真机补充系统偏好、读屏、缩放与120Hz性能录制；复杂新布局若需要改变产品导航，再进入三个方案的 prototype 选择流程。

---

# 第二轮：平台原生性、控件状态与直接操纵（2026-09-20）

基线：提交 `1d9dc2e` 之上的未提交工作区（含第一轮改动，全部保留）。开始前 `npm run typecheck`、`npm run lint` 通过；`npx vitest run` 247 个文件、2259 个测试通过、4 个跳过；`prettier --check` 有 14 个与界面无关的既有失败；knip 有 `packages/shell` 与 `taskStore.ts` 的既有未使用导出。

## 方法

五个只读子代理分域审计（主进程与窗口、kit 与 token、壳与工作区、聊天 / Agent / 回复台、设置 / 向导 / 克隆 / 任务 / 日记 / 文件），主会话去重、核对源码后合并为下表。Electron 截图脚本在改动前抓了 14 个场景（深 / 浅、中 / 英、1200×720、Agent 窗口、设置、向导）作为 before。与第一轮不同，这一轮重点不是「动效对不对」，而是「这个应用在各自平台上像不像原生应用」和「控件的每个状态是否一致可信」。

## 发现与处理

| 级别 | 问题 | 处理 |
|---|---|---|
| P0 | Agent 审批卡在 window 上监听 Enter：焦点在别处（输入框、另一个弹窗）按回车也会批准工具调用 | 只在审批卡自己获得焦点时响应（页面层，见下） |
| P0（Windows） | 「关闭窗口后继续运行」直接 `hide()`，Windows / Linux 没有托盘也没有程序坞，窗口无法找回 | 隐藏前懒创建系统托盘（单击显示、菜单含显示 / 退出），文案按平台区分 |
| P0 / P1 | 禁用按钮上的原因说明写在 `title` 或外层 Tooltip：禁用的原生按钮不触发 hover，用户永远看不到 | kit `disabledReason`：包裹层接指针 + Tooltip + `aria-description` |
| P1 | 键盘模式规则 `animation: none` 让 Radix Presence 等不到 `animationend`，关闭中的弹窗与遮罩滞留 | 时长压到 0.01ms；输入方式在鼠标移动时回到 pointer |
| P1 | Windows 标题栏按钮颜色启动时写死为深色，浅色主题下是一块深色补丁；窗口底色同理，启动先黑后白 | `nativeChrome.ts` 按主题 / 配色 / 系统外观实时更新；`themeBoot.ts` 首帧前恢复主题 |
| P1 | macOS 被全局 `::-webkit-scrollbar` 强制为经典常显滚动条 | macOS 不写滚动条样式；Windows / Linux 保留 8px 细滚动条 |
| P1 | 浅色主题弱文字 `--fg-3` 在面板上约 3.5:1；徽标 / 链接 / chip 的彩色文字在浅色下不足 4.5:1 | `--fg-3` 提到 `#616161`；新增 ink token，彩色文字统一改用 |
| P1 | hover / 按下用 `line-*` 做填充，随对比度设置缩放，低对比度下几乎无反馈；按下态多数缺失 | 填充统一 `hover-5/7`、`fill-13/20`；每个控件补齐按下态 |
| P1 | `loading` 把按钮变成 40% 灰，看起来像「不可用」而不是「进行中」 | loading 保持原色、忽略点击、`aria-busy` |
| P1 | 固定列宽在 1200px 窗口下可把工作区挤到不足 100px | `fitColumns`：Agent 面板、列表依次让位，工作区 ≥ 400px |
| P1 | 自绘红黄绿灯：失焦不变灰、无 ⌥ 缩放、全屏仍显示并留白、占用 Tab 序 | 按系统规则补齐；新增 `app:windowState` 事件与 `zoom` 动作 |
| P1 | 弹窗打开时 ⌘W / ⌘N / ⌘1–4 仍作用于后面的窗口 | 有模态弹窗时全局快捷键不派发 |
| P1 | 输入框没有右键菜单（Electron 默认不提供），无法用鼠标粘贴 | 原生文字菜单，仅在可编辑区 / 有选中文字时出现 |
| P1 | 关闭标签后焦点掉到 `<body>`；Tab 与面板没有 ARIA 关联；列表行只能 Tab 逐个走 | 焦点交给相邻标签；`aria-controls / labelledby`；↑ ↓ Home End |
| P1 | 最小窗口 1200×720 大于小屏（如 1366×768 缩放 125%）的工作区 | 最小尺寸不超过所在显示器工作区，换屏重算 |
| P2 | macOS 快捷键标签写成 `⌘⇧T`（系统顺序是 `⇧⌘T`） | 统一 ⌃⌥⇧⌘ 顺序，界面里手写的标签改为从快捷键表生成 |
| P2 | 弹窗按钮顺序两平台相同 | `DialogFooter actions` 在 Windows 反序 |
| P2 | 窗口失焦后列表选中仍是强调色 | 失焦退为中性灰 |
| P2 | Tab 拖动不跟手、换位瞬移；ScrollArea 滚动条硬切；抽屉与遮罩退出不同步 | plans/004 |
| P2 | 减少动态效果下加载图标冻结 | 透明度呼吸，plans/003 |
| P2 | 每个组件各写一份 `focus-visible:ring-*`，与全局 outline 叠成双圈 | 组件内全部移除，`accessibility.css` 一处定义 |
| P2 | 原生菜单缺视图缩放、定时任务、引用到 Agent；Windows 菜单沿用 mac 措辞 | 补齐；Windows 用「退出」与帮助 › 关于 |
| P2 | 开机自启开关只存配置、不写系统登录项；Windows 未设 AppUserModelId | `loginItem.ts`（仅打包版本）；设置 AUMID |

## 设计方向

沿用品牌与信息架构（四列、单一强调色、三层背景、无投影卡片、lucide 线性图标），不引入第二套组件或动画库。方向一句话：**同一套 token 与 kit，状态更诚实，平台各自像自己。**

- 颜色：新增的只有「派生」而非「新色」——`selected-bg / selected-ring`（选中语义，可被窗口焦点与高对比度改写）、六个 ink（彩色文字的可读版本）、`danger-hover / danger-active`。微信转账卡的橙色收进 `--wx-transfer*`，不再散落 hex。
- 状态：hover → 按下 → 选中 → 禁用 → 忙，五态在所有控件上用同一组填充档位；禁用必须能解释自己；忙不是禁用。
- 字：不变（13 / 12 / 11，标题紧字距）。新增 `text-wordmark` 只给向导字标。
- 材质：不变。系统减少透明度 / 增加对比度 / forced-colors 下的回退补上选中态。
- 动效：默认过渡收敛到 `--dur-fast` + `--ease-out`；新增两处直接操纵（Tab 拖动、滚动条淡入）和一个共享入场 `.kit-enter`；高频操作继续零动画。

## 共享与平台分开

| 共享（一份实现） | 按平台分开 |
|---|---|
| token、kit、焦点样式、键盘导航、动效时长与曲线、减少动态效果 / 透明度 / 对比度降级 | 窗口按钮（mac 自绘灯 / Windows 系统按钮 + 主题色） |
| 四列与 Agent 窗口布局、列宽让位规则 | 标题栏避让（mac 左上 76 / 44px；Windows 右上 `env(titlebar-area-*)`） |
| 文案键（同一个键内用 ICU select 区分「程序坞 / 系统托盘」） | 后台驻留（程序坞 / 系统托盘） |
| 快捷键表（一张表，两种标签格式） | 标签格式（`⇧⌘T` / `Ctrl+Shift+T`）、弹窗按钮顺序、原生菜单措辞 |
| 首帧主题恢复、窗口失焦选中态 | 滚动条（系统 overlay / 8px 自绘）、材质（vibrancy / acrylic）、登录项 API |

## 页面层处理

| 级别 | 问题 | 处理 |
|---|---|---|
| P0 | 审批卡全局 Enter / Esc | 只在焦点位于审批卡内、或没有任何焦点时响应；不再抢输入框焦点；`role="group"` + `aria-keyshortcuts`；补回归测试 |
| P0 | 聊天「删除」没有后端：确认后只弹「暂不支持」 | 底栏、多选栏按钮与消息菜单项一律禁用并说明原因，删掉走不通的确认弹窗；多选栏新增「复制」 |
| P1 | 聊天搜索栏固定约 536px，工作区可窄到 400px | 搜索框弹性收缩，计数不占固定宽度并成为 `role="status"`；快捷键提示按平台显示 |
| P1 | 消息无法用键盘操作 | 每条气泡是一个 Tab 停靠点，聚焦即露出工具条，Shift+F10 打开菜单，↑ ↓ 在气泡间移动；消息流由 `role="log"` 改为普通区域（虚拟列表挂载行时不再被读屏播报） |
| P1 | 生成状态每 100ms 触发一次 live region | 只播报阶段文字，计时器 `aria-hidden`；一轮结束 / 需要审批各播报一次；工具行补读屏状态词 |
| P1 | 克隆联系人列表约千行不虚拟化；克隆页两列在窄工作区溢出 | `VList` 虚拟化；容器宽度小于 720px 时画像区移到对话下方 |
| P1 | 回复台整页每秒重渲染 4 次 | 计时移进待发送草稿自己的卡片 |
| P1 | 各对象 Tab 头部高度、标题字重不一 | 七个 Tab 统一 72px 最小高与 Semibold 标题 |
| P1 | 数据去向提示有五种长相 | 统一为 kit `PrivacyNote`；AI 页只留一条常驻说明，其余收进问号 |
| P1 | 设置 › 常规把一行一卡重复三次；宠物页标题与首行同名 | 合并为「偏好」一组；重复行改为分组的操作与问号 |
| P1 | 危险入口在页面上就是红色 | 触发按钮恢复普通样式，红色只留在确认弹窗里 |
| P2 | 微信转账卡硬编码色值、消息气泡与克隆气泡圆角不一、27 处 `leading-[Npx]` | 全部回到 token 与字号 / 行高档位 |
| P2 | 列表骨架与真实行左边距不一致；加载态复用空态文案；模板、运行记录、会话侧栏缺加载 / 错误态 | 对齐并补齐四态 |
| P2 | 向导换步后焦点留在旧按钮 | 焦点移到新步骤标题，并播报「第 N 步，共 4 步」 |

另一个并行会话（前端复查）在同一工作树里处理了文案与截断类问题约五十个文件，双方按文件划分，互不覆盖。

## 复审（review-animations）

| Before | After | Why |
|---|---|---|
| 键盘模式 `animation: none` | `animation-duration: 0.01ms` | Radix Presence 依赖 `animationend`，否则关闭中的浮层滞留 |
| 拖动中的 Tab 70% 透明、原地不动 | `translateX` 1:1 跟手，邻居 120ms FLIP | 直接操纵：对象必须跟着指针 |
| 邻居滑动中再次换位会从槽位起跳 | 先取消在途动画，从当前视觉位置继续 | 可打断 |
| 减少动态效果下 spinner 冻结 | 透明度呼吸，`ease-in-out` 往返 | 减少不等于归零；屏上循环用双向缓动，`ease-out` 会让脉冲一头重 |
| 消息高亮进出同为 180ms | 瞬间进、220ms 出；选中即时 | 系统响应要快，离场可以慢；高频选择不加过渡 |
| 列表选中、设置导航带 120ms 颜色过渡 | 移除 | 一天上百次的操作不做动画 |
| hover 用 `line-*` 做填充 | `hover-7` / `fill-13` | 反馈强度不应随对比度设置消失 |
| 抽屉 180ms 退出、遮罩 120ms 先消失 | 遮罩同步 180ms | 最后几帧不再滑过未变暗的页面 |

结论：Approve。改动范围内没有 `transition: all`、`scale(0)`、UI 上的 `ease-in`、布局属性动画、无门控的 hover 位移或超过 300ms 的界面动画；移动类动效都有减少动态效果的降级。未能做的是 120Hz 真机逐帧与慢放检查。

## 验证与限制（第二轮）

- `npm run typecheck`、`npx eslint src electron dev packages/i18n`、`npm run knip`、`npm run build` 通过；`npx vitest run` 259 个文件、2337 个测试通过，4 个真实数据库测试按设计跳过；本轮改过的源文件 `prettier --check` 通过。
- 新增测试：原生窗口配色、托盘、输入框右键菜单、登录项、最小窗口尺寸、首帧主题、窗口焦点、输入方式、列表键盘导航、列宽让位、红黄绿灯（缩放 / Tab 序 / 全屏）、弹窗按钮顺序、禁用原因、快捷键标签顺序、审批卡按键范围、聊天栏删除禁用与复制、宠物时钟暂停、样式契约（macOS 不写滚动条、键盘规则不含 `animation: none`、减少动态效果的呼吸）。
- Electron 截图脚本在改动前后各抓 14 个场景（深 / 浅、中 / 英、1200×720、设置、克隆、定时任务、Agent 窗口）；浏览器预览检查控制台无报错。
- 未能验证：Windows 真机（标题栏按钮配色、`env(titlebar-area-*)` 实际数值、托盘、acrylic、弹窗按钮顺序的观感、高对比度）；macOS 原生全屏下红黄绿灯隐藏与 ⌥ 缩放的真实手感；开机自启（只在打包版本生效）；读屏软件实测；120Hz 逐帧。主进程的新逻辑（托盘、登录项、原生配色、右键菜单）有单元测试和类型检查，但没有在重新打包的应用里跑过。

后续可选：在 Windows 11 真机过一遍上表；为 Windows 托盘补 `.ico` 多尺寸图标；`RecordsDrawer` 的 500 条记录虚拟化（需要 kit `Drawer` 暴露滚动容器）；回复台草稿卡与自动回复记录行的右键菜单；`kit.css` 里与 `tokens.css` 重复的 `--line-16 / --line-25` 静态值合并到一处。
