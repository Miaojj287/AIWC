# AIWC 工程架构（Agent 内核 · 数据基座 · 通道 · 桌面壳）

> 与 `CLAUDE.md`（界面约束）、`DESIGN-SPEC.md`（行为规格）并列。本文回答"代码怎么分层、谁依赖谁、一次对话怎么跑、如何扩展"。
> 设计来源：Hermes 的产品形态（网关 + 有界记忆 + cron + 技能）、Codex 的运行时纪律（Thread/Turn/Step、类型化有界上下文、单一工具注册表、JSONL rollout）、AIWC_ORG 的微信数据层。

## 1. 一句话

**AIWC = 一个本地运行的微信数据工作台：数据基座只读微信，内核跑 Agent，通道层决定在哪听、往哪发，桌面壳只是其中一个通道。**

## 2. 目录与分层

```
AIWC/
├─ packages/protocol/    契约：ID、历史条目、上下文片段、工具、Op/Event、模型端口、网关、基座、记忆、配置、IPC、引用核对、自动回复、Jev 决策、办公平台、定时任务、宠物、微信密钥、模型能力
├─ packages/kernel/      Agent 内核：Thread → Turn → Step 循环、ContextManager、系统提示三层、压缩、工具注册/路由/分发、审批、hook、rollout、技能、子代理、模型适配
├─ packages/substrate/   微信数据基座：两套数据库引擎（原生 WCDB 桥 / 纯 TS SQLCipher）、密钥获取、图片解密、消息归一化、SQLite 镜像（双 FTS5 + 向量）、微信工具集
├─ packages/gateway/     通道层：PlatformAdapter、MessageEvent 归一化、SessionKey、ReplyGate、观察上下文、自动回复队列、iLink 适配器、UI 注入发送
├─ packages/memory/      记忆：MEMORY/USER/SOUL/AGENTS 四个有界 Markdown、关系档案（克隆）、每日待办扫描器、记忆工具
├─ packages/i18n/        界面文案：zh-CN（参考目录）+ en-US、ICU 子集格式化、包内既有中文系统消息的反查表（known）
├─ packages/shell/       命令行：argv-only 进程与登录 shell 环境、命令分级（风险 / allowKey）、macOS seatbelt 沙箱、通用 `shell` 工具（§6.1）
├─ packages/office/      办公平台连接器：飞书 / 钉钉 / 企业微信官方 CLI 的查找与安装、浏览器授权会话、表格推送、推送记录、office_* 工具、CLI 动词分级（§14）
├─ electron/
│  ├─ main/              组合根：启动、窗口、配置、密钥、IPC、调度器、把各包接成一个应用
│  ├─ preload/           typed bridge（window.aiwc）
│  └─ hosts/             utility process 入口（substrateHost：WCDB 原生访问隔离）
├─ src/                  渲染层（React 19）：kit（组件库）→ shell（四列壳）→ workspace（Tab 容器）→ features（各页面）
├─ skills/               内置 SKILL.md
├─ dev/fixtures/         演示数据、生成器与开发预览页（只被测试和预览页使用，不进应用）
└─ docs/                 本文、设计截图、决策记录
```

### 依赖规则（ESLint `boundaries` 强制）

| from | 允许 import |
|---|---|
| protocol | 无内部依赖 |
| kernel / substrate / gateway / memory / shell | 只有 `@aiwc/protocol` 和自己 |
| office | `@aiwc/protocol`、`@aiwc/shell` 和自己 |
| i18n | 只有 `@aiwc/protocol` 和自己 |
| electron | 全部（组合根） |
| src（渲染层） | 只有 `@aiwc/protocol` 类型与 `@aiwc/i18n` 文案；数据一律走 `window.aiwc` IPC |

四个业务包互不依赖：它们通过 protocol 里的接口（`SubstrateService`、`MemoryStore`、`GatewayOutbound`…）在组合根被注入。工具定义（`defineTool`）也在 protocol，所以 substrate / memory / gateway 可以导出工具而不依赖 kernel。

## 3. 进程模型

```
Renderer (React)  ──IPC(typed)──▶  Main (composition root)
                                     ├─ Kernel（进程内，Thread 实例）
                                     ├─ Gateway（iLink 长轮询、UI 注入、观察流）
                                     ├─ 每日待办 scanner（croner，默认关闭）
                                     └─ SubstrateClient ──MessagePort──▶ substrateHost (utility process)
                                                                          └─ WCDB(koffi 原生) / SQLite 镜像 / 解密
```

- 原生代码（koffi 加载的 WCDB 桥、密钥扫描 helper、图片解密模块）与 SQLite 镜像（`node:sqlite`）只在 `substrateHost` 里跑：崩了只重启这个进程。
- 读微信库有两套引擎，由 `wcdb/engine.ts` 按 `resources/native` 里有没有当前平台的 WCDB 库选择（§13.1）：macOS 走原生 WCDB 桥，没有原生库的平台走纯 TypeScript 的 SQLCipher 引擎，两者都实现 `wcdb/bridge.ts` 的同一个接口，上层查询代码不知道差别。
- 内核跑在 main 进程，避免每个工具调用两跳。`KernelHost` 抽象保留把内核挪到 utility process 的余地。
- 渲染层必须连接桌面 preload；纯浏览器或桥接缺失时显示连接错误。mockBridge 仅供隔离测试使用，不会由应用加载。
- **本地数据、文件预览、更新**（2026-10-11，`electron/main/ipc/data.ts`）：`storage:usage` 只按 AppPaths 推出的位置统计（`services/storage.ts`）；`storage:clear` 只接受可重建的缓存（明文副本：先 `substrate.shutdown()`，删完再 `start()`；媒体与 `cache/previews`；旧日志）。`storage:wipeAll` 不在运行中删数据：写 `<userData>/aiwc-reset.json` 后重启，`index.ts` 在 `ensureDirs` 之前由 `services/dataReset.ts` 删除数据目录，以及**应用时从已保存配置推出**的自定义缓存目录（与启动时同样校验）里的 `media` / `wcdb-plain`——标记文件只表示「要清除」，其中列出的目录一律忽略（它在两次运行之间留在磁盘上，伪造的标记不能指向别处），标记本身也在 `protectedDataPaths` 里。docx / xlsx 在主进程解析成纯数据（`services/preview/*`，复用 `services/zip.ts`；解压前按目录里声明的大小检查单个部件 ≤ 24 MB、单次预览合计 ≤ 48 MB，超出即报「文件太大，无法预览」，解压量不超过声明大小，多个工作表指向同一部件只解析一次），渲染层按 React 渲染，不注入 HTML；PDF 用 pdf.js（懒加载，CMap 与标准字体随包）；HTML 在 `sandbox=""` 的 iframe 里显示并带 `default-src 'none'` 的 CSP。聊天文件消息的附件在微信目录里、不在文件白名单内：`file:stageChatFile` 由 substrate 按消息定位附件（必须在账号的微信数据根目录内），复制到 `cache/previews/<hash>/` 再交给文件 Tab 或默认应用。聊天视频不复制：它们（和封面帧）未加密，位于 `<账号>/…/msg/video/`；`aiwc-media://` 在文件白名单之外另有一条只读规则（`security/wechatVideoAccess.ts`）——只放行当前配置的账号根目录下 `msg/video` 里的 mp4 / mov / m4v / jpg / png（符号链接解析后再查一次），从而原地流式播放（Range）。这条规则不进 `AllowList`，`file:*` 读写仍然碰不到微信目录。更新走 electron-updater（懒加载），只有打包版本且安装包带 `app-update.yml` 时可用。

### 3.1 主窗口与系统集成（`electron/main/windows/*`，2026-09-20）

窗口相关的判断都写成可单测的纯函数，`mainWindow.ts` / `index.ts` 只接线：

| 模块 | 职责 |
|---|---|
| `nativeChrome.ts` | 由 `general.theme` + `general.appearance` + `nativeTheme.shouldUseDarkColors` 算出窗口底色与 Windows `titleBarOverlay` 颜色（共用 protocol 的 `panelBackgroundFor`，与渲染层面板色一致；符号取 foreground，不写死色值）；主题、配色、系统外观任一变化即 `setTitleBarOverlay` + `setBackgroundColor`（透明效果开启时不设底色）。Windows 由共享 `WindowChrome` 预留整窗 32px 标题栏，工作台和 Agent 窗口均适用，全屏时收回；Mac 红黄绿灯仍融入左侧栏。 |
| `transparency.ts` | 原生材质（vibrancy / acrylic）的开关；关闭时回退到上面的底色。 |
| `windowState.ts` | 位置 / 尺寸持久化；`minimumSizeFor(workArea)` 让最小尺寸不超过所在显示器的工作区，`display-metrics-changed` 与 `moved` 时重算。 |
| `tray.ts` | 非 macOS 的系统托盘。懒创建：第一次要隐藏窗口前 `ensure()`（`onBeforeHide`），语言切换 `refresh()`，`will-quit` 时 `dispose()`。macOS 靠程序坞的 `activate`，不建托盘。 |
| `editContextMenu.ts` | `webContents` 的 `context-menu`：可编辑区给撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选，普通选中文字给复制，其余不弹（渲染层的 kit 右键菜单已自行 `preventDefault`）。 |
| `services/loginItem.ts` | `general.launchAtLogin` → `app.setLoginItemSettings`，只在打包版本和 macOS / Windows 上执行；启动时与配置变化时各应用一次。 |
| `services/systemNotifier.ts` + `nativeNotification.ts` | 系统通知（`general.notifications`）：没有 AIWC 窗口有焦点时才弹，同一 key 3 秒内只弹一次，持有 Notification 直到点击或关闭（避免回收后点击失效）；点击先 `ensure()` 窗口再经 `app:command` 执行动作。决策是纯函数 `shouldNotify`，Electron 对象注入。哪些事件提醒、正文怎么写（默认不含联系人名）在 `composeNotifications.ts`：Agent 待确认（只看桌面线程）、自动回复草稿待确认、回复台收到 Agent 草稿、自动回复熔断、定时任务完成 / 失败。 |

- 推送事件 `app:windowState { fullscreen, maximized }`：进入 / 离开全屏、最大化 / 还原、`did-finish-load` 时发出。渲染层的 `WindowChrome` 据此在 `<html data-fullscreen>` 上打标，`shell.css` 收回为红黄绿灯预留的空间。`app:windowControl` 多一个 `zoom` 动作（⌥ 点击绿灯 = 最大化 / 还原）。
- `<html>` 上的运行时标记（由 `src/main.tsx`、`src/platform/*` 写入，`data-fullscreen` 由 `src/shell/WindowChrome.tsx` 写入；样式与 kit 只读）：`data-platform`（darwin / win32 / linux）、`data-runtime`（electron / web）、`data-theme`、`data-glass`、`data-input`（keyboard / pointer，`inputModality.ts`）、`data-window-focus`（`windowFocus.ts`）、`data-fullscreen`。
- 首帧主题：`src/platform/themeBoot.ts` 在 React 挂载前从 localStorage 恢复上次解析出的主题与调色板（内容经校验，坏数据直接忽略）；`configStore.applyTheme` 每次应用主题时回写。配置到达后以配置为准。

## 4. 一次对话如何执行（Thread → Turn → Step）

1. 渲染层/网关提交 `Op{type:'turn.start'}`。Thread 把输入放进 mailbox；若有 turn 在跑且 mode='steer' 则并入当前 turn。Op 可带 `clientInputId`（发送方自己的 id）：记录这条输入的 `item.user` 原样带回，渲染层据此把「待并入」的显示换成正式消息（不比较文字）；id 只在事件里，不写入历史。`agent:getThread` 返回 `running` 与 `pendingAsks`（仍在等待的审批 / 提问的请求事件，`runtime/pendingAsks.ts`），重新载入的面板据此恢复「工作中」和确认卡。turn 在记录输入之前就结束（钩子拦截、没有可用模型、预处理中被停止）时，`turn.aborted` 带 `droppedClientInputIds`，渲染层把这些输入放回输入框（`restoreInput.ts`），错误卡的「重试」即发送输入框。
2. **Turn 开始**：`UserPromptSubmit` hook → 预压缩检查 → 组装 turn 级片段（记忆快照差量、关系档案、@ 引用、观察上下文）。turn 级提供者的上下文里有本轮的 `mentions`：主进程 `prompts/mentionFragments.ts` 据此注入「引用到 Agent」选中消息的原文（`<referenced_messages>`，每行带 cite，按整行截到上限，第三方文字中和标签）和 @ 文件的正文（`<referenced_file>`，经路径白名单、仅文本）；context 层的「本轮引用」写出每个引用的 id。
3. **Step**（一次采样请求）：冻结 `StepContext`（模型、工具路由、设置、片段），`ContextManager.forPrompt()` 生成历史，`ModelClient.sample()` 流式返回。采样经 `runtime/model/resilientSample.ts`：首个分片 180 秒内没到、或之后 90 秒没有新分片记为「卡住」（本地模型不限首个分片、分片间隔放宽到 300 秒：长上下文的 prefill 可能要几分钟；已中止的 signal 直接结束不再发请求）并中止重发；429（至少等 Retry-After）、网络错误与 5xx 同样重发，最多 3 次、指数退避，按 `ModelError.code` / HTTP 状态判断，不看错误文字。每次重发发 `stream.retrying`（面板显示「重新连接中 n/m」），失败尝试已流出的文字丢弃（不进历史）；用尽后以 `stream_stalled` 或原错误结束本轮。AI SDK 自身的 `maxRetries` 为 0。中断与本轮超时永远优先，不会被重发。
4. 工具调用：由 `ToolRouter.dispatch` 单一漏斗处理——校验 → 审批（`ApprovalGate.decide` / `ask`）→ `PreToolUse` → 执行（超时）→ `PostToolUse` → 记录时截断。并行安全的工具并发（读锁），其它串行（写锁），结果按调用顺序写回历史。模型还在写参数时，适配器把 AI SDK 的 `tool-input-delta` 转成 `tool_input.delta` 分片，step 经 `runtime/toolInputStream.ts` 节流为 `tool.input` 事件（首片立即、之后每次调用每 100ms 至多一次、单次调用最多 64k 字），仅供显示，最终参数以 `tool.call` 为准，重发时丢弃。工具执行超时是可暂停的（与本轮预算同一个 `createTurnBudget`）：工具通过 `ToolContext.pauseTimeouts()` 在它发起的事情等待用户时同时暂停自己的超时与本轮预算（工作流写步骤的确认）。
5. 有工具结果就进入下一 Step；直到模型不再调用工具、或触达 `maxStepsPerTurn`、或 loop guard（连续 3 次相同调用指纹 / A-B-A-B 交替）、或超时。超时（`turnTimeoutMs`）是可暂停的预算（`runtime/turnBudget.ts`）：工具调用等待用户确认期间不计时（`ToolDispatchContext.onApprovalWait`），模型、工具与压缩的时间照常计入。
6. **Turn 结束**：`Stop` hook（`HookResult.checks` 是宿主自动检查的报告，如引用核对；内核按是否还能重写定下 `action` 后记为 `turn_check` 历史条目并发 `turn.check`，`runtime/turnChecks.ts`；它只给界面看：不进模型消息、token 计 0、压缩与导出跳过）→ `turn.completed` 事件 → rollout flush → 后台任务（标题生成、自动记忆抽取）。没有工具调用的 Step 先经 `runtime/stepEnd.ts` 判定：`finish = length` 时记一段 `continuation` 片段、发 `turn.continuing` 并接着写（最多 2 次，答复 = 各段拼接；之后 `output_truncated` 错误卡）；`content_filter` 与空答复（本轮从未有文字）以错误卡结束（`content_filter` / `empty_response`，带「重试 / 更换模型」），不再当作完成。
7. 中断：`turn.interrupt` → 取消 token → 100ms 优雅期 → 硬中止 → 写入 `turn_aborted` 条目 → flush → 发 `turn.aborted`。
7a. 向用户提问（`tooling/questions.ts`）：`ask_user` 工具经 `ToolContext.askUser` 发 `question.requested`（问题 + 2–5 个选项 + 可选「其他」），在 `QuestionGate`（`KernelServices.questions`，与路由共用一个实例）上等待 `Op{type:'question.answer'}`，作答后发 `question.resolved`，答复以文字作为工具结果交给模型；等待期间暂停本轮预算（同审批），中断时按「不回答」结束。只有 desktop 通道、depth 0 有 `askUser`；定时任务 / 微信机器人 / 子代理里调用立即返回错误让模型自行假设。宿主可用 `kernel.postNote(threadId, text)`（`runtime/notes.ts`）把一条不经模型的助手消息作为独立一轮写进线程（定时提醒）：它在 Thread 的操作队列里写入（不会落进刚开始的回合），等运行中的回合时不占队列（不妨碍并入），回合事件带 `kind: 'note'`，渲染层不会因它放出排队消息。
8. 委派：`delegate_analysis` 的子线程是临时的——继承父线程的权限模式与模型，历史只留在内存（不写 rollout、不进索引与检索），不发 `thread.created`；`listThreads` 排除 `subagent` 线程，父线程不在内存时拒绝委派。`workflow_run` 用同一个 `runChild`（§17）：读步骤是 `subagent`，写步骤沿用父线程的 profile 与白名单；子线程的确认请求与非只读工具行经 `childBridge.ts` 改挂到父线程当前轮次，`ApprovalGate.alias` 让父线程的用户作答、父线程中断时一并拒绝。`runChild` 总会发带 `callId`（发起它的那次工具调用）与 `step`（工作流步骤）的 `subagent` 事件，渲染层据此把子线程自己的事件（threadId = 子线程）折进父工具行下的子代理视图；结束时 `onTrace` 交回执行记录（`runtime/childRun.ts`：回复、工具调用与结果，最多 80 条、输出截到 2000 字，不含给子代理的指令），工具把它放进 `ToolResult.subagents`，随 `tool_result` 写入父线程历史（不发给模型），所以重新打开会话仍能看到子代理做了什么。子线程的确认等待经 `watchApprovalWaits` 暂停父侧的计时：工作流该步的时限、`workflow_run` 自己的超时与父轮次预算。
9. 会话列表与会话检索：`agent:listThreads` 按页（`limit` + `offset`，`nonEmpty` 在索引里排除没有记录的线程）；`agent:searchThreads` → `kernel.searchThreads` → rollout 索引的 FTS（与线程表联结：只看 desktop 通道、排除 `subagent`、默认不含归档；命中词两侧用 `THREAD_SEARCH_MARKS` 私用区字符标记），主进程按线程取最新一条命中并把引用链接还原成文字（`services/threadSearch.ts`）。
10. 回退、分叉、归档（渲染层的「编辑 / 重新生成 / 分出新会话 / 归档」，通道见 `ipcDomains/conversation.ts`，主进程 `ipc/conversation.ts`，只作用于 desktop 线程）：`thread.rollback` 可带 `fromItemId`——从这条 `user_message` 起整段删除（`ContextManager.dropFrom`），找不到（已被压缩进摘要）时以 `rollback_target_missing` 拒绝、历史不变；随后 `rewritePersisted` 原子重写 rollout，重启后就是回退后的历史。`kernel.forkThread(source, { throughItemId, title })` 取源线程从开头到 `throughItemId` 所在轮最后一条记录（`runtime/fork.ts`，运行中的那一轮拒绝），以同样的 origin 与设置建新线程并逐条写入 rollout。归档 = `updateMeta({ archived })`；`listThreads({ archivedOnly })` 只列归档线程。desktop 线程的引用 chip 存在 `ThreadOrigin.contextRef`（只用于显示与 @ 上下文，不是发送目标或数据范围）。

## 5. 上下文规则（内核强制，代码评审必查）

1. 不改写历史：只追加；压缩产生一个 `compaction_summary` 条目替换前缀，并记录检查点。 续跑时 rollout 逐行按 schema 校验（`tooling/rolloutLine.ts`）：撕裂或形状不符的行跳过、计入 `ResumeState.skippedLines` 并记 warn（只记行号、错误码与路径，不记内容）；索引里的 origin / settings 列读不出时列表用兜底值，续跑与 rewrite 以 JSONL 为准。崩溃留下没有换行的半行时，下一次追加先补换行，不会把新行粘到坏行上一起丢掉。
2. 系统提示三层：`stable`（身份 + 规则 + 技能索引 + 记忆**冻结快照**）→ `context`（线程来源、@ 引用）→ `volatile`（日期到天、上下文占用）。stable 层整个会话不变。
   `systemPrompt.byProfile` 可**整体替换** stable 的身份串（目前只有 `persona`：Agent 身份明文禁止冒充他人，与扮演直接冲突，只能换不能叠）；`skillsExcludedProfiles` 让无工具的线程不带技能索引。
3. 任何注入都是 `ContextFragment`：有 `kind`、`marker`、`tokenCap`；渲染后先截断再记录；`tokenCap ≤ 10k`。
4. 工具输出在**记录时**截断（默认 16k 字符，工具可覆盖），不是发送时。工具产出的文件（`ToolResult.artifacts`）只按路径随 `tool_result` 记入历史（`artifacts` 字段，不含内联内容），用于重新打开会话时恢复结果卡；它从不发给模型。
5. 每个 Step 前做 world-state 差量：只有变化的段（权限模式、模型、工具表、AGENTS 规则）才追加一个片段。片段提供者可实现 `reset(threadId)`：历史被清空/回滚时内核会调用它，避免「已发过就不再发」的缓存把片段永久吞掉。
6. 压缩阈值 80%（可配），压缩摘要落盘可续；`context.usage` 每 Step 上报。摘要只转述聊天内容、不加引号，回到提示词时带一句「这是转述不是原文，要引用请重新读」——压缩后的「原话」是编造引用的主要来源。
7. 压缩的输入永远先放上一份摘要，再按整行、从新到旧填满字符上限——从前面截断会把之前折叠的全部历史一并丢掉。
8. 手动压缩可带一句「保留…」（`thread.compact.instructions`，≤ 1000 字，渲染层的 `/compact …`）：追加在压缩提示词末尾，只能加重点，不能取消上面的保留规则。
9. **`/技能`**：一轮的第一段文字以 `/<技能名或其 command>` 开头时，内核自己把该技能的完整 SKILL.md 作为 `skill_invocation` 片段记在这一轮（`runtime/skillInvocation.ts`），其余文字是参数，并列出 frontmatter 声明的 `arguments`；不依赖模型调用 `skill_view`。只有主人自己的通道（desktop / cron / wechat-remote）生效，微信机器人线程里别人打的 `/x` 只是文字；未知的 `/x` 照常当文字。定时任务的 prompt 以 `/` 开头时，`taskRunInput` 把它放在第一段，规则放在第二段，所以同样生效。技能目录扫描会给每个文件夹写诊断（缺 / 坏 frontmatter、空正文、重名被覆盖等，`SkillEntry.diagnostics`）：带阻断诊断的、或在 设置 › 技能 停用的（`agent.disabledSkills`），不进技能索引、不能 `skill_view`、不进 `/` 菜单、不被 `/x` 加载。
10. 内部模型调用（标题、压缩）经 `ModelResolver.resolveAuxiliary(primary)`，与线程自己的模型保持同样的本地 / 在线属性；线程选的本地模型不可用时直接报错，不回退到在线默认模型。

### 检索（substrate mirror）

- 关键词检索同时查 `messages.text` 和 `message_extras`（引用回复的原文 + 语音转写，触发器维护，不重建主索引）。
- 消息正文解码：WCDB 桥把 BLOB 列作为 Buffer 返回，文本列一律按原文使用；只有看起来像 hex / base64、并且解出来确实是 zstd 帧的字符串才解压（身份证号、订单号这类纯数字文本不会被误解码）。群消息的发送者前缀必须是 `用户名:\n` 形式才剥离，单聊里的 `10:30 开会` 保持原样。
- 会话类型只在 `packages/substrate/src/normalize/kinds.ts` 判定：群聊（`@chatroom`、`@im.chatroom`）、公众号、系统账号。WCDB 读取器与镜像共用这一份；`wcdb/accountUtils.ts` 的 `shouldKeepSession` 只决定列表里显示哪些会话。
- 由微信数据拼出的缓存路径片段若只由点号组成，编码为下划线，媒体缓存始终落在 `cacheDir/media/<session>/` 之内。
- 中文没有词边界：查询里的汉字串既按原样短语走 trigram（精确），也按 `Intl.Segmenter` 分出的词走 trigram（召回，`(短语) OR (词…)`）；两个字的词（多数人名）走 OR 的 LIKE 通道，命中的词越多分越高。
- 没配置向量模型时 `semantic_search` 实际只做关键词检索，工具结果会如实写 `mode: 'keyword'` 并提示换关键词，不再假装做了语义检索。
- 命中结果带会话名（`chat`）；索引里只有 wxid 的发送者在工具层用通讯录补上名字。
- 拼音检索（2026-10-11）：`sessions.title_py` 与 `contacts.name_py` 存「全拼 + 每个读音的首字母组合」（`mirror/pinyin.ts`，pinyin-pro；多音字组合最多 8 个），upsert 时写入，旧库打开时补算（NULL = 未算，'' = 不含汉字）。查询是纯字母时额外匹配这两列，对象列表搜索、@ 引用和 ⌘K 都能用 `zs` 找到张三、`cpq` 找到产品群。

## 6. 工具规则

- 工具 = `defineTool({ name, description, inputSchema(zod), profiles, risk, parallelSafe, execute })`。
- `risk`：`read` / `write` / `send` / `destructive`。审批矩阵：

读取永不询问；Ask 模式下写入先问（选「总是允许」后该工具不再问）；对外发送（微信消息、推送表格）只有 Autopilot 不问；破坏性操作在任何模式下每次都要确认。表格即 `packages/kernel/src/tooling/approval.ts` 的 `APPROVAL_MATRIX`。

| 模式 \ 风险 | read | write | send | destructive |
|---|---|---|---|---|
| Ask（默认） | 放行 | 问（白名单放行） | 问 | 问（不可总是允许） |
| Bypass | 放行 | 放行 | 问 | 问（不可总是允许） |
| Autopilot | 放行 | 放行 | 放行 | 问（不可总是允许） |

- 「总是允许」有两种范围：本会话（写进 `ThreadSettings.allowAlways`）与所有会话（`agent.allowAlways`，经 `KernelOptions.onGlobalGrant` 由主进程 `services/grants.ts` 持久化）。全局白名单**不复制**进新会话，而是每次调用时由 `effectiveAllowAlways`（`runtime/effectiveAllowAlways.ts`）合并，且只对 origin 为 `desktop` 的 `desktop-chat` 线程生效（定时任务、机器人会话、手机遥控线程都不受影响；在这些线程上答「所有会话」只记进该线程）；撤销立即生效。`approval.resolve` 可带 `reason`（拒绝并说明，≤ 1000 字，原样交回模型：「用户拒绝了此操作。用户的说明：…」）与 `scope`；`approval.requested` 带 `allowKey` 供确认卡写明放行范围。设置 › AI 接入 › 权限规则经 `privacy:listGrants / revokeGrant` 列出与撤销。
- **改动日志**（`electron/main/services/changes/`）：一个 PreToolUse / PostToolUse host hook（`HookPayload` 带 `callId`、`isError`）记录每次工具调用真正改了什么——`shell` 前后对工作区做有界快照（≤ 1 MB 的文件保留字节，按 size+mtime 缓存）、技能前后读 SKILL.md、`remember` / `forget` 记条目、发送类工具只记不撤。日志是 `<dataRoot>/changes/journal.jsonl` + 被替换内容的 blob（`protectedDataPaths` 内，shell 读不到），`privacy:listChanges / undoChange` 给渲染层「本轮改动」与撤销；撤销只在对象仍是 Agent 留下的样子时进行（否则 `conflict`），新建的文件移到废纸篓。记忆条目在 sidecar 里记下写入它的 `threadId`。
- `profiles` 决定挂载面：`desktop-chat` 全量；`wechat-bot` **只有 read + 发回原会话**；`cron` 全量挂载但**永不询问**——矩阵里会「放行」的就放行（read、记忆写、白名单，以及任务权限模式覆盖的风险），会「问」的一律拒绝并告诉模型「权限模式不允许，已跳过，请说明」；`subagent` 只读且无 `delegate`；`persona` 无工具。 `subagent` 只读与 `persona` 无工具由 registry 按 `risk` 强制，工具定义里写了也挂不上。
- **按调用分级**：工具可以带 `classify?: (input) => ToolCallPolicy`，在参数校验后决定这一次调用的 `risk`、`allowKey`（白名单键，默认 = 工具名）、`canAllowAlways` 和给确认卡的 `note`。`shell` 靠它把「`git status`」和「`rm -rf`」判成不同风险；`tool.call` 事件带 `allowKey`，定时任务据此列出「被拒绝的操作」供用户授权。
- 「总是允许」只在授权真的会被采纳时提供：把该调用的 `allowKey` 加进白名单后审批结果会变成放行，才显示这个选项；send / destructive 每次都确认。
- `draft_reply` 在 `desktop-chat` / `wechat-bot` / `cron` 都可用：它只把草稿交给回复台（`mode: 'confirm'`），自己从不发送，所以是 `read` 风险；桌面端必须给 `to`，机器人线程忽略 `to` 只能回来源会话。
- **证据引用**：检索 / 上下文 / 时间线工具的每条消息都带 `cite`（`[MM-DD HH:mm](wx://sessionId/messageId)`，格式与核对逻辑在 `@aiwc/protocol` 的 `citations.ts`）。模型原样粘贴；面板渲染为可点击 chip 并逐字核对引号内容；主进程 `citationAuditHook`（Stop hook）在桌面线程的回答结束时再核对一次。引号与链接的配对只有一处实现（`planCitations`）：紧挨在链接前的引号才算这条链接担保的原文（间隔 ≤ 20 个可见字符），一串引号对一串链接按顺序配对，配错到同一串里另一条链接的也算对；匹配时忽略标点、宽度、零宽字符与表情变体，容忍省略号分段、去掉的 `[表情]` 代码和引号里的发送者前缀。Stop hook 另外容忍原文出现在被引消息前后 5 条之内（归属小错，chip 仍会标出），只有哪里都找不到的引号或不存在的消息才 `block`。内核据此把原因作为 `stop_hook` 片段追加并**让模型重写完整答复**：续跑那一步的 `step.started` 带 `revision: 'stop_hook'`，它的输出替换本轮答复（不是追加），并再次核对，每轮最多两次（`MAX_STOP_CONTINUATIONS`）。面板把这一步之前的回复当作被替换的草稿收进本轮的工作折叠里。
- **时间参数**：所有工具的 `from` / `to` 同时接受毫秒时间戳和本地时间字符串（`2026-02-14`、`2026-02-14 19:28`、`2026-02`），`to` 只写日期时包含当天全天。`get_timeline` 返回 `olderCursor` / `newerCursor`，长对话要翻页读完再下结论。
- 通道感知：`ToolContext.origin` 记录线程来源，发送类工具在 `wechat-*` 通道只能发回 `origin.chatId`。
- `wechat-bot` 线程调用 `get_relationship_profile`：没有来源会话时拒绝，只能查当前会话的对象，并且只拿到语气与称呼视图（`relationship_style`），拿不到完整档案——机器人的回复正是发给这个人的。
- `query_sql` 是唯一的原始 SQL 出口，只接受单条 `SELECT` / `WITH`。`SubstrateFacade.querySql` 调用 `shared/sqlGuard.ts` 的 `guardSelectSql` 恰好一次，读取器只接收它产出的品牌类型 `GuardedSql`，不各自校验。PRAGMA、EXPLAIN 与 `pragma_*` 表值函数（含各种引号写法）一律拒绝，结果最多 200 行；表结构用 `SELECT name, sql FROM sqlite_master WHERE type = 'table'` 查看。
- 新增一个工具：在对应包 `tools/` 下 `defineTool`，在包的 `index.ts` 导出，在 `electron/main/composition.ts` 注册。**不需要**改提示词、超时表、审批表（都从定义推导）。
- 工具的 `risk` 取其中最危险的那个动作；动作风险不同就拆成多个工具。例如 `skill_manage`（新建 / 修改，`write`，可「总是允许」）与 `skill_delete`（`destructive`，每次都问）。
- **离开本机的工具**：`ToolDefinition.offDevice = true`（远程 MCP 服务器的工具）在线程模型是本地模型时不挂载（路由构建时按 `ModelClient.ref.local` 过滤），本地模型线程的数据不出本机。工具也可以带 `inputJsonSchema` 直接给模型看自己的 JSON Schema（MCP 工具），此时 zod `inputSchema` 只做宽松的形状检查。
- `update_plan`（kernel `planTools.ts`，`read`，只挂 `desktop-chat` / `subagent`）：调用参数本身就是计划，面板取本轮最近一次 `update_plan` 的参数画计划卡（实时来自 `tool.call`，重开会话来自记录的调用），不走旁路事件、不写任何文件。
- **工具行的说明由界面生成**：`summarize` 只给日志和没有界面文案表的地方（微信里的确认）用；面板按工具名 + 参数 + `display`（`ToolDefinition.describe` 返回的结构化摘要，只在句子需要参数里没有的信息时声明，如定时任务名、MCP 服务器名；随 `tool.call` / `approval.requested` 事件与 `tool_call` 历史条目一起记录）在 `src/features/agent/toolSummaries.ts` 里按当前语言措辞（`agent.toolSummary.*`）。新增内置工具时同时在那里加一句并补两种语言的文案。

### 6.1 命令行（`@aiwc/shell`，2026-09-13）

Agent 有一个通用 `shell` 工具，让它能像 Cursor / Hermes 这类通用 Agent 一样直接用本机命令（各家 CLI、git、脚本）。注入防御放在框架里，而不是靠「不给命令行」：

- **不挂 `wechat-bot`**：远端联系人的消息永远驱动不了本机命令。提示词把聊天记录、文件、网页里的文字一律声明为数据。
- **逐条分级**（`classify.ts`）：按 `;`/`&&`/`|` 拆段，每段查词表——只读命令（ls / cat / git status / grep…）是 read；`git commit`、包管理器安装、写文件是 write；`rm -rf`、`chmod -R`、`sudo`、`defaults write`、把 `curl` 管给解释器、读到密钥路径再联网等是 destructive（永远不可「总是允许」）。`allowKey` 是「可执行文件 + 子命令」前缀（`shell:git commit`、`shell:lark-cli base`），「总是允许」只放行同一前缀。各包可以注册 `SegmentClassifier`（办公连接器注册了三家 CLI 的动词表）。
- **受保护路径的判定**（`pathGuard.ts`）：不按绝对路径子串匹配，而是把命令里的每个词（含重定向目标、`--x=…`、`@文件`、PowerShell `-Path:…`）展开已知变量（`$AIWC_WORKSPACE`、`~` / `$HOME`、`$PWD`、`$env:X`、`%X%`）、按 `cd` 之后的目录解析、统一分隔符（macOS / Windows 再忽略大小写）、存在时解析符号链接后再比对 `protectedDataPaths`；通配符 / 花括号按能否匹配到受保护路径判断。展开不了的变量只要路径里出现数据目录名或受保护的文件名就按命中处理。没有沙箱时（Windows、沙箱关闭、`escalate`）数据目录里工作区与可写目录以外的任何位置都按 destructive。
- **沙箱**（`sandbox.ts`）：macOS 用 `sandbox-exec` seatbelt——可读整机、可写 `<dataRoot>/workspace`、临时目录和各 CLI 状态目录、可联网，但**读不到** `secrets.bin`、镜像库、索引库、记录库、改动日志，以及微信库的明文副本——副本位置与引擎用同一个解析函数（`paths.ts` 的 `substrateCacheDir`：账号自定义缓存目录或 `<cache>/media`），`shell` 每条命令重新读取受保护清单，运行中改了缓存目录也立即生效。Linux / Windows 目前没有沙箱（`sandboxed: false` 会写进输出）。命令想跳出沙箱要带 `escalate: true` + `reason`，风险至少 write、不可「总是允许」，确认卡会标出「沙箱外运行」。
- **进程**：argv-only spawn（`/bin/zsh -lc` 登录 shell 的 PATH），进程组 kill，超时 1s–10min，输出截断，退出码与 hint（超时 / 沙箱拒绝 / 命令不存在）一起返回。
- 设置：`agent.shellSandbox: 'auto' | 'off'`。
- **生成的文件**（`workspaceChanges.ts`）：可能写入的命令（风险不是 read）执行前后各给工作区拍一次快照（名字、大小、修改时间，深度 4、4000 项、150ms 上限，超出就不报），新增或改过的可预览文件作为 `artifacts` 返回（每次最多 5 个），相对路径同时写进输出的 `files` 让模型能提到它们。

## 7. 通道与自动回复

- 入站统一 `MessageEvent`；`buildSessionKey(source)`：dm 按对方隔离，群按「群 + 人」隔离。
- `ReplyGate` 是**确定性闸门**，只判三件事：不是自己发的 / 消息类型可回 / 该会话的规则启用且未被熔断暂停。过闸后才调用模型起草。闸门里不放任何 UI 上看不见的条件——那正是「规则开着却不回」的来源，全局总开关也因此删掉了。
- 没有规则覆盖的群消息以 `observed` 形式存入观察缓冲，之后该会话真的回复时作为**仅 API 可见**的片段回放，不进历史当用户轮次。
- 群成员的文本与昵称是第三方数据：写进观察片段前折叠成一行并中和 `<` `>`，无法伪造或提前关闭 `<observed_context>`。
- 规则的 `sendMode` 决定草稿怎么离开：`confirm`（界面叫「自动回复」，新规则默认）停在记录里等用户点「确认发送」，不自动过期，被同会话的新消息取代，重启后保留且不为同一条消息重复生成；`auto`（「全自动回复」）倒计时后发送。没有 `sendMode` 的旧规则按 `auto` 读回，行为不变。Agent 的 `draft_reply` 交接也是 `confirm`。
- AI 起草（`autoReplyGenerate.ts`）：一次读该会话最近 `max(historyCount, 200)` 条，最近 `historyCount` 条作为逐行对话记录给模型，整个窗口里主人自己的消息提炼为口吻指南（`replyStyle.ts`：原话样本、长度中位数、句尾标点、表情、连发习惯），temperature 0.75；生成后 `polishReply` 去掉引号包裹、Markdown、「回复：」前缀和主人从不打的句号。
- 本机微信的观察端是 `autoReplyMonitor`：订阅 substrate 的 DB 变更 + 3s 轮询，静默窗口 5s 后才入闸。第一次看到某会话（= 规则刚开启 / 应用刚启动 / 刚重连）会**补回一次**：最后一条若是对方发的就直接回，不等下一条。这个动作幂等——回完最后一条就是我们自己的了。`triggerNow(sessionId)` 是它的手动版本（IPC `autoreply:triggerNow`），跳过静默窗口并带 `force` 绕过判重。
- 两条发送通道信任级别不同：iLink 发送走 API 校验；UI 键盘注入必须做 **DB 读回验证**，失败即整体熔断（halt），需手动恢复。
- iLink 的失败按结构化字段判断：客户端抛 `IlinkApiError`（HTTP 状态 + 响应体 `ret`），`ret === -14` 才算会话过期；`sendmessage` 超时视为发送失败，不记为已发送。`getupdates` 返回非 0 的 `ret` 同样是轮询失败（退避，`-14` 转入重新登录），响应里的消息与游标一概不用；空轮询之后至少等 `POLL_IDLE_MIN_MS`（1 秒）。
- 所有出站都进审计记录（`AutoReplyRecord` / `outbound` 事件）。
- **回复方式 Jev（beta）**（2026-09-27）：`source: 'jev'` 的规则不调聊天模型，走 `electron/main/services/jevReply.ts`：把最近 N 条聊天与这条消息组成 JSON state，向 TypeSafe 的 Jev（`services/jevClient.ts`，`POST /v1/systemone`，20s 超时，429 / 529 重试一次，响应经 `@aiwc/protocol` 的 `JevResponseSchema` 校验）问一个 Choice（候选 c1…cN + 可选的 none）和一个 Noul（需要回复吗）。`interpretJevAnswers` 是唯一的路由逻辑：置信度 ≥ 门槛 → 候选照发送方式发 / none 则 `skip`；< 门槛 → 最佳候选带 `confirm: true` 交给用户。网关的 `generate` 结果因此多了两种形状（`GenerateResult`：`{ skip, jev }` 把记录标为 rejected 且不建草稿、不释放触发键；`{ text, jev, confirm }` 强制 confirm 模式），决策原样存进 `AutoReplyRecord.jev`。Key 存 secretStore（`ai.jev.apiKey`），端点与模型在 `config.ai.jev`；`jev:test` 只打 `GET /v1/models`，`jev:preview` 用未保存的草稿对最后一条消息试跑（主进程用 zod 重新校验规则）。Jev 的提示词是英文（其主训练语言），聊天内容与候选保持原文，且只进 state、不进 instructions。

### 7.1 我的微信：推送与手机遥控（2026-10-11）

- **身份**：主人用自己的微信扫 iLink 机器人的登录码；登录响应的 `ilink_user_id`（扫码并确认的那个微信号）就是**主人**，随登录一起存进 secretStore（`mobile.ilink.session`，不再写明文 `ilink-session.json`，旧文件启动时删除；系统钥匙串不可用时只在本次运行有效）。消息内容改变不了主人；重新扫码 = 重新绑定。渲染层碰不到这条会话：`secret:*` 只接受渲染层自己管理的引用（`security/secretRefPolicy.ts`：服务商 Key、Jev Key、代理密码、账号密钥；明文读取只给账号密钥），`config:set` 与 `ai:*` 里的 `apiKeyRef` 也只能指向同类引用，`mobile.*` / `mcp.*` 一律拒绝。
- **唯一出口**：`@aiwc/gateway` 的 `createOwnerChannel` 只发给主人：经 `withOriginGuard` 以 `wechat-remote` 来源重建目标（`sendChannelForOrigin('wechat-remote') = 'wechat-ilink'`），每次尝试（成功或失败）写审计 `<dataRoot>/mobile/sends.jsonl`（类型、结果、字数，不存正文）。
- **任务推送**：任务的 `pushToPhone`（编辑器「完成后推送到我的微信」）为真时，运行结束（完成 / 失败）由 `composeTasks.onFinished` → `composeMobile.pushTaskRun` 发摘要（截到 1200 字）或失败原因。**不逐条审批**：这不是 Agent 的工具调用——收件人固定为扫码绑定的主人，模型写不出别的目标；用户为每个任务显式开启，性质等同系统通知。
- **手机遥控**（`createRemoteControl`，默认关，设置 › 账号 › 手机遥控）：只接受 `checkOwnerMessage` 通过的消息（`wechat-ilink` 通道、单聊、`peerId === chatId === 主人`、非 internal），其余一律忽略并记 info 日志（只记原因与打码 id）。消息进入专用线程（origin `{ channel: 'wechat-remote', chatId: 主人 }`，profile `desktop-chat`，`allowAlways` 为空）；`wechat-remote` 不在 `BOT_CHANNELS`，审批按线程权限模式走矩阵。权限模式只在电脑上设置（Ask 默认 / Bypass，`MobileRemoteModeSchema` 没有 Autopilot），每轮前与每次 `thread.settings` 事件后重新套用，手机无法提权；渲染层也改不了它（`agentOpGuard` 只允许对非桌面线程停止与审批）。入站文字中和 `<` `>` 并截到 4000 字。指令只有 `/状态 /停止 /新会话 /帮助`（全角也认），其它 `/x`（含 `／x`）当普通消息交给内核，`/技能` 因此在手机上同样生效。等待审批时回复数字 1 允许一次 / 2 总是允许（只记在手机线程自己的白名单；不可加白名单时拒绝）/ 3 拒绝，其它文字只会重发确认；数字只回答**手机上最后显示的那一条**——队首换了（电脑上先处理了、或遥控关闭期间到达的审批）时先把新队首发给手机，不会用数字回答没见过的审批；电脑上先处理了会告知手机。绑定的主人换了（重新扫码成另一个微信号）时，旧主人的手机线程与其待审批队列一并放下：`/停止`、`/状态`、数字都只作用于 origin `chatId` 等于当前主人的线程，旧线程的事件也不再发到手机。桌面的「所有会话」白名单不作用于手机线程；手机上答的「总是允许」出现在 设置 › AI 接入 › 权限规则（标为手机遥控会话），经 `privacy:revokeGrant` 由主进程撤销。答复去掉 Markdown 与 `wx://` 链接、截到 3000 字后经 `textSplit` 规则分条发回。文案由主进程 `mobileText.ts` 按界面语言生成（包里只出 `RemoteNotice` 代码）。
- iLink 发送遇到 `-14` 且带了 `context_token` 时先不带 token 重试一次（久未聊天的 token 失效 ≠ 登录失效），仍失败才转入重新扫码。

## 8. 记忆与每日待办

- `MEMORY.md`（当下事实）、`USER.md`（我是谁）、`SOUL.md`（Agent 人格）、`AGENTS.md`（用户规则）——四个有界 Markdown，`§` 分隔条目，写入加锁 + 漂移检测；系统提示里用冻结快照并显示占用百分比。
- `forget` 必须带上条目原文，审批摘要展示这段原文；该序号处的文字已经变了（文件被改动或重排）时，存储层抛 `MemoryEntryMismatchError` 拒绝，工具把最新列表还给模型。
- 记忆包里的每次模型调用都有截止时间 `MODEL_CALL_TIMEOUT_MS`（5 分钟），与调用方的 `AbortSignal` 合并。
- 设置 › 记忆的三个开关都在后端生效（接线在 `electron/main/composeMemory.ts`，每次使用时读配置）：
  - **记忆条数上限** `memory.maxEntries`：存储层 `addEntry` 在锁内检查单个文件的条数，满了返回 `over_count`、**不淘汰**（淘汰旧条目就是未经确认的删除）；`remember` 把这个结果连同当前列表还给模型，让它先 `forget`。设置页编辑器的整文件保存不受条数限制。
  - **写入前需要确认** `memory.confirmBeforeWrite`：`remember` 不写文件，改为放进待确认列表（`classify` 把这次调用降为 read，避免「审批 + 待确认」两次确认）。
  - **自动写入记忆** `memory.autoWrite`：桌面 Agent 会话（`desktop` 通道 + `desktop-chat` 画像，不含克隆 / 定时 / 机器人 / 子线程）最后一轮结束 10 分钟无新轮次后，用**该会话的模型、最低推理强度**（`ai/lowEffortModel.ts`；本地会话的模型不可用时拒绝，不回退到在线默认模型）做一次提炼（`packages/memory/src/review/extract.ts`，截止 90 秒、可取消、一次一个），只看水位线之后的消息，只依据「我」说的话，过滤已有条目和疑似密钥 / 卡号；结果**只进待确认列表**，从不直接写文件。失败不推进水位线；启动时补跑最近 24 小时内错过的至多 3 个会话。
  - 待确认列表 = `memory/proposals.json`（`packages/memory/src/review/proposalStore.ts`，原子写 + 互斥，读时逐条 zod 校验；同时存每个会话已提炼的用户消息数）。至多 50 条，满了拒绝新的。「写入」经 `MemoryStore.addEntry`（锁、漂移检测、字数预算、条数上限全都生效，来源记为 `user`）；IPC `memoryReview:list / accept / dismiss` 入参先过 protocol schema，变化推 `memoryReview:changed`。
  - 「Agent 已写入记忆」Toast 跟随存储层的变更事件（`source: 'agent'`），被拒绝的写入不会再误报成功。
- 会变成路径的 id 先校验：联系人 id 经 `folderNameFor` 编码（`.`、`..` 也会编码）且断言落在关系档案目录内；记忆文件名只放行四个文件：清单是 `@aiwc/protocol` 的 `MEMORY_FILES`，IPC 入口先用 `isMemoryFile` 拒绝，存储层再用 `assertMemoryFile` 断言，渲染层的文案表按这份清单派生。跨进程文件锁在所有路径上关闭文件描述符。
- 关系档案（克隆）按联系人一个文件夹：`profile.json`（card + deep + stats）、`samples.jsonl`、`pairs.jsonl`、`notes.jsonl`、`corrections.jsonl`、`status.json`、`reflected.json`。
  - 构建：读消息 → 补转语音 → 轮次合并 → 分块 map-reduce（块按时间分散取，不只取最近）→ 私聊语料不足时用**群聊发言**补风格/深层画像（群聊回复错位，绝不产出问答对）。
  - 聊天：`persona` 线程换掉 stable 身份，`<persona>`（stable，人设）+ `<persona_notes>`（turn，去重，扮演纠正）+ `<persona_recall>`（turn，按当前这句检索 `pairs.jsonl` 的真实回复 + 基座里的真实聊天片段）。
  - 回路：试聊里的「不像 TA」和定期 `clone:reflect` 把用户的纠正写进 `notes.jsonl`，下一轮起强制遵守。
  - 编辑画像（`clone:updateProfile`）先经 zod 校验：顶层只允许 `card` / `deep` / `samples`，类型或长度不对整条拒绝；这三者内部的未知键丢弃，不写进 `profile.json`。只记录改动的键或样本，原文不截断；重新克隆时应用不上的纠正写警告日志。
  - 卡片的受众：用户自己的线程与克隆线程拿完整卡片；面向第三方的线程（机器人私聊、群）只拿 `<relationship_style audience="third_party">`，即语气与称呼，并附「私密信息不得透露」。
- 每日待办 = 用户开启后的调度作业（`packages/memory/src/todo/`，主进程接线在 `electron/main/composeTodo.ts`）：只读 `config.todo.sources` 里的群聊，每个群从游标（上次读到的 seq）往后取最新的至多 N 条，一个群一次模型调用（并发 3，`generateValidated` + zod），得到「当天摘要（与之前的合并）+ 我要做的事（引用消息编号）」，写入 `todo/items.json`（按群 + 规范化文字 14 天去重）、`todo/days/YYYY-MM-DD.json`、`todo/state.json`（游标 + 上次结果）。调用失败的群不推进游标；解析不到模型时整次失败且不读任何消息；同一时间只跑一次，取消的扫描不写文件。**不写 MEMORY**：第三方聊天提炼出的内容不进主人的记忆（AGENTS.md §3.5）。周期（每 N 小时 / 每天 HH:mm / 仅手动）由 config 驱动，config 变化时重新调度；启动约 1 分钟后，若上次扫描早于最近一次应触发的时间，补跑一次。它取代了 2026-09-27 前默认开启的日记流水线（旧的 `diaries/` 保留、不再写入，仍在 shell 工具禁读名单里）。
- 用户数据目录：`<userData>/aiwc/{config.json, secrets.bin, rollouts/, index.db, memory/, relationships/, todo/, skills/, pets/, logs/}`（旧版本可能还留有 `diaries/`）。
- AI 宠物（Codex Pets 格式）：`pets/<id>/{pet.json, spritesheet.webp|png, meta.json}`；内置宠物随包放在 `resources/pets`，启动时复制进来。`electron/main/services/petService.ts` 负责图库（codex-pets.net）、下载、zip 导入与文件头校验；IPC 为 `pet:*`，状态语义见 DESIGN-SPEC「AI 宠物」。

## 9. 渲染层结构

- `src/kit/`：唯一的组件库（按钮 5 种、开关、单选、输入、取色、下拉、分段、chip、徽标、Toast、tooltip、右键菜单、popover、对话框 4 种、抽屉、空态 4 种、骨架、进度、头像、列表项、设置行、Tab、卡片、键帽、分隔线、滚动容器、问号提示、行内提示、错误边界、权限模式与模型下拉）。页面**不得**自造这些。
- `src/shell/`：WindowChrome、四列布局、IconRail、ObjectList、AgentPanel（可收起）、快捷键；另有 Agent 窗口的布局帧 `AgentWindowFrame.tsx` + `agentWindowLayout.ts`（侧栏 | 对话 | 按需工作区栏，列宽持久化在 `ui.agentWindow*`）。壳层样式只挂 `shell-*` 类，不用 data-testid / aria-label 选择器（`shell.css.test.ts` 检查）。
- Agent 有两个界面、一套状态：`src/features/agent/useAgentSurface.ts` + `ThreadConversation.tsx` + `threadMenus.ts` 同时驱动右侧面板（`AgentPanel`）与整窗的 Agent 窗口（`window/AgentWindow`）。`ui.shellMode` 决定 `App` 挂载 `Shell` 还是 `AgentWindow`；切换只经 `shell.setMode` / `shell.toggleMode`（`src/app/shellMode.ts`）。Agent 窗口把普通的 `Workspace` 作为右侧工作区栏常驻挂载（隐藏时也挂着，`tab.*` 命令因此始终有处理者），`tabsStore.openSeq` 每次 `open()` 自增用于重新显示它。规则见 CLAUDE.md §12。
- 错误边界：`@/kit` 的 `ErrorBoundary`（错误态 +「重试」重新挂载子树）包住每个 Tab 宿主、对象列表主体（按 rail 功能加 key）与 Agent 面板；`main.tsx` 在 `<App/>` 外再包一层兜底。
- 会话列表加载失败按 `substrate:status.connection` 分类（`sessionListModel.ts` 的 `listFailureView`），不看错误文字。
- 基于 `substrate:listSessions` 的列表一律分页并在服务端搜索（会话列表、自动回复规则列表、复制规则弹窗、每日待办群聊列表；后三者共用 `src/platform/sessionPaging.ts`）；按 id 已知的对象（规则、克隆）用 `substrate:getSession` 单独补齐，不会被分页藏掉。
- 导出「当前筛选」时请求带上发送者筛选 `senderIds`；主进程先用 zod 校验请求（非法即拒绝，不当作「无筛选」），再在 `services/exporter.ts` 的 `collectSessionExportMessages` 逐条过滤一次，不依赖基座是否执行了筛选。
- `src/workspace/`：Tab 容器 + `tabRegistry`；每类 Tab 是一个 `TabRenderer`，页面在 `src/features/*` 里注册。
- `src/platform/`：`bridge.ts`（取 `window.aiwc`，缺失时报连接错误，从不回退到模拟数据）、`hooks.ts`（`invoke` / `useInvoke` / `useBridgeEvent`）；另有不依赖 React 的窗口级安装器 `inputModality.ts`、`windowFocus.ts`、`themeBoot.ts`（§3.1）与列表键盘导航 `listNavigation.ts`（↑ ↓ Home End 在 `.kit-row` 行间移动焦点，对象列表与 Agent 侧栏共用）。
- 列宽：`src/shell/columnLayout.ts` 的 `fitColumns` 在窗口变窄时让 Agent 面板、对象列表依次让位（不改写保存值），工作区至少 400px。Tab 拖动排序（`src/workspace/TabStrip.tsx` 的 `useTabDrag`）用指针事件 + transform 跟手，相邻标签用 WAAPI 做 FLIP；不引入动画库。
- `src/i18n/`：界面语言（跟随 `general.language`）、`useT()` / `t()` / `<Trans>`；文案目录在 `packages/i18n`，规则见 CLAUDE.md §11。
- 状态用 zustand，按领域拆 store（`shellStore` 管列宽、收起与当前功能，另有 `tabsStore`、`configStore`、`agentStore` 及各 feature 自己的 store），组件用 selector 订阅所需字段。
- 新增页面 = 新 `TabRenderer` + 在 `features/<name>/index.ts` 注册。不新开窗口、不做全屏页；Agent 窗口是同一窗口的第二种布局，它的内容同样是工作区 Tab。

## 10. 测试与验证

- `vitest`：包级单元测试放在源码旁 `*.test.ts`。内核必测：步数上限、loop guard、片段截断、审批矩阵、并行顺序、rollout 续跑、压缩检查点、Stop hook 续跑上限。
- `npm run check` 是提交前的完整门禁：Prettier 格式、`tsc`（渲染层 + 主进程与各包）、ESLint（boundaries、React hooks、类型感知规则）、knip（未使用的文件 / 导出 / 依赖）、vitest。CI（`.github/workflows/ci.yml`）跑同一套；boundaries 违规视为架构错误。工程细则见 `AGENTS.md`。
- UI 与 Figma 同名节点截图并排对照（CLAUDE.md §8）。

## 11. 不做的事（与 CLAUDE.md §7 对齐）

- 不把工具名硬编码进提示词 / 超时表 / 审批表。
- 不让 `wechat-bot` profile 拿到写文件、执行命令、截屏类工具。
- 不在渲染层直接读微信文件或调模型。
- 不写死演示数据；演示数据只在 `dev/fixtures`，只被测试和开发预览页（`dev/fixtures/*.html`）通过 mock bridge 加载。
- 不在 `src/`、`electron/` 写死界面文案；每条文案在 zh-CN 与 en-US 两个目录里成对存在（CLAUDE.md §11，`aiwc/no-hardcoded-cjk` 与 parity 测试强制）。

## 12. 多语言（i18n）

- **语言状态**：`general.language`（`zh-CN` 或 `en-US`，protocol 校验）。首次启动由主进程按 `app.getLocale()` 选定，之后以设置为准。渲染层 `configStore` 在 hydrate / set / 回滚时同步到 `src/i18n`；主进程在 `composition.ts` 订阅配置，切换时重建原生菜单（`index.ts`）。
- **文案目录**：`packages/i18n/src/locales/{zh-CN,en-US}/<命名空间>.ts`。zh-CN 的结构即类型，en-US 标注 `Messages[...]`，缺键或多键编译失败；`parity.test.ts` 校验两种语言占位符一致。
- **格式**：`{name}` 插值、`{n, plural, one {# item} other {# items}}`（`Intl.PluralRules`）、`{k, select, a {...} other {...}}`。缺参数时原样显示 `{name}`，缺键时显示键名并警告一次。
- **包内系统消息**：业务包不依赖 i18n。它们既有的中文报错、原因、进度登记在 `known` 命名空间，主进程在 IPC 返回与错误（`ipc/register.ts`）、推送与 Toast（`broadcast.ts`）两个边界用 `electron/main/localizePayloads.ts` 反查翻译；`known.test.ts` 校验每条模板仍能在包源码里找到。
- **不翻译**：模型提示词与工具 description、日志、微信数据本身、导出文件里的聊天内容。导出文件的标题与表头跟随导出时的界面语言。

## 13. 微信密钥获取与真实数据（macOS，2026-09-06 实测）

- **绝不显示假数据**：桌面 App 永远以 `wcdb` 模式运行真实微信数据基座。未配置账号/密钥时基座停在 `no_config` 空态（由 onboarding 引导），**不再退回 demo**。演示数据只在测试与开发预览页里通过 mock bridge 出现；`npm run dev:web` 在纯浏览器里只显示连接提示。
- **真实库路径**：微信 4.x 在 `~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<wxid_目录>/db_storage/{session,contact,message,...}`。reader/mirror/facade 已在真机 4.1.13 上实测：同步出 1008 会话 / 74 万消息 / 15 万媒体，FTS 检索可用。
- **db 密钥获取顺序**（`packages/substrate/src/key/acquireKeys.ts`，macOS）：
  1. **只读内存 helper** `wechat_memory_scan_helper <pid> <session.db>` —— 需 `task_for_pid`，打包 App 靠 `com.apple.security.cs.debugger` 权限 + 用户在「系统设置 › 隐私与安全性 › 开发者工具」授权。
  2. **崩溃转储扫描** `--dump <crashinfo/completed> <session.db>` —— 只读文件、**无需特权**，未签名的 dev 构建也能用；本机就是靠它拿到并校验了真实密钥。
  3. **登录挂钩** `wechat_xkey_helper <pid> <waitMs>` —— 附加到正在运行的微信，打印 `hook installed` 后等待用户在微信里**退出登录再登录**（默认等 120 秒，界面显示倒计时）。需要调试权限，SIP 开启时跳过；等待期间每秒检查微信进程，用户直接退出微信应用时立即结束并报「微信被退出」。
  4. **重启捕获兜底** `electron/main/wechat/relaunchCapture.ts` —— 关闭微信（SIGTERM，8 秒不退再 SIGKILL，**确认进程消失后**才启动）→ 按 bundle id `open -b com.tencent.xinWeChat` 启动并等主进程出现（重试一次）→ 在 120 秒内对新进程重试 1+2。只要它关过微信，返回前（成功 / 超时 / 取消 / 异常）一律确保微信重新在运行。系统已拒绝访问微信内存（`needsAuthorization`）时不触发：重启帮不上忙，只会打断用户。
  - 顺序与失败原因的取舍在 `key/macDbKeyFlow.ts`（依赖注入，单测覆盖）；`strategy: 'memory_scan'` 只走 1+2，不挂钩也不重启；`scope: 'image'` 只取图片密钥，完全不碰微信进程。
  - 关键点：helper 的第二个参数必须是具体的 `session.db` 文件（读取 SQLCipher salt 校验），不是 `db_storage` 目录。
  - 微信 4.1.13 **不经 CommonCrypto `CCKeyDerivationPBKDF`** 派生 WCDB 密钥，旧的 LLDB 断点在该版本上不触发，故以内存/转储扫描为主。
- **图片密钥**：`imageKeys.ts` 从 kvcomm 缓存码 + wxid 纯推导（XOR + AES），无需特权，已实测成功。
- **进度、取消与失败（2026-10-11）**：每个步骤带稳定代码——运行中的 `phase`（`reading_memory` / `reading_dumps` / `arming_hook` / `waiting_login` / `closing_wechat` / `launching_wechat` / `waiting_relaunch_login` / `deriving_image_key` / `scanning_image_key` / `verifying`，等待用户的阶段附 `waitUntil` 截止时间）与失败时的 `failure`（`login_timeout`、`wechat_exited`、`wechat_relaunch_failed`、`relaunch_timeout`、`sip_enabled`、`needs_authorization`、`not_found`、`cancelled`、`skipped`、`unexpected` 等，定义在 `@aiwc/protocol` 的 `keyAcquire.ts`）。界面按代码出文案（`src/platform/wechatKeys.ts` → kit `TaskProgress`，引导页与设置 › 账号共用），包里的中文 `detail` 只作诊断。`acquireKeys` 从不抛错，结束时每个步骤都是 `done` / `failed`（`StepTracker.finish`）。主进程同一时间只跑一次获取：`substrate:cancelAcquireKeys` 或新的请求通过 `AbortSignal` 中止上一次（杀掉 helper、停止轮询、把微信拉起来），被取消的一次不写入任何密钥、不弹结果 Toast。macOS 上若开始时微信在运行、结束时不在（用户等待时退出了微信），主进程会重新打开它。
- **打包签名**：`resources/macos/entitlements.mac.plist` 含 debugger 权限；`scripts/afterPack.cjs` 在打包时对 `wechat_memory_scan_helper` 用 `resources/macos/helper.entitlements.plist` 重新签名。
- **前置条件**：SIP 关闭 + 已安装 Xcode/命令行工具（仅重启捕获这条路用到 lldb）；用户需授权「开发者工具」TCC 才能走只读实时扫描，否则自动回退到崩溃转储/重启捕获/手动粘贴。

### 13.1 Windows（2026-09-16）

- **db 密钥**：`key/windowsMemoryScanner.ts` 只申请 `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`，按三条路依次尝试：
  1. **`Config.Cipher` 节点**（微信 4.1.13+）——WCDB 把每个库的密钥以 XOR 混淆的形式挂在 `com.Tencent.WCDB.Config.Cipher` 配置对象上，只要微信在登录状态、这个库被它打开过就能直接读出来，拿到的是**已派生**（`direct`）密钥，**不需要用户重新登录**。
  2. **裸 UUID 块**——4.1.x 登录过程里出现在内存里的账号密钥，`raw` 形式（还要过一遍 PBKDF2），通常只在刚登录时能扫到。
  3. **ASCII `x'<key><salt>'` 记录**——旧版本。
  只有当前登录账号的库会出现在第 1 条路里；`db_storage` 里其他历史账号的密钥不在内存中，界面会要求切到那个账号重新登录。
- **Windows 是「一库一密钥」（2026-09-16 真机实测）**：`packages/substrate/src/key/windowsKeys.realdb.test.ts` 在真机上逐库扫描的结果是 4 个库、4 把互不相同的密钥，全部为 `direct` 形态：

 | 库 | salt | 形态 |
 |---|---|---|
 | `session.db` | `fcbf391c…` | direct |
 | `contact.db` | `be79928f…` | direct |
 | `biz_message_0.db` | `85acbfb4…` | direct |
 | `message_0.db` | `20932641…` | direct |

 所以 `account.dbKeyRef` 存的那一把只是**会话库**的密钥，它是账号可用性的门槛，不是全账号的钥匙。其余库的密钥由 `key/dbKeyResolver.ts` 在读取时解析：先试存下来的密钥，不行就用 `collectWindowsConfigCipherKeys()` 把微信进程里所有 Config.Cipher 候选**一次性**收集起来（一次遍历约 2 秒），再用各库首页在本地逐个匹配（每个候选一次 AES）；命中即缓存，未命中的库进 30 秒负缓存，避免在查询循环里反复扫描。查询层的 `createBridgeQuery(bridge, keyFor)` 本来就是按 `dbPath` 取密钥的，两套引擎都按库缓存连接，所以这里不需要改引擎。
- **限制**：Windows 上读消息库需要微信进程在运行（候选密钥只存在于它的内存里）。微信没开时会话列表仍可用（会话库密钥已持久化），消息库会失败并记一条 warn。把按库密钥持久化进 `secretStore` 是待办。
- **候选密钥两种形态都要试**：Config.Cipher 里的 run 可能是 SQLCipher 原样使用的密钥，也可能是账号口令（要过 PBKDF2）。先对所有候选做便宜的直连校验，失败后再对最多 16 个候选做延迟的 PBKDF2 校验；扫描优先返回能打开整个账号的密钥（`fitsAccount`），只能开会话库的作为兜底返回并标 `accountWide: false`。
- **两个平台拿到的密钥形态不同、值也无关**：macOS 的 helper 找的是账号口令（`raw`，按各文件 salt 走 PBKDF2，因此一把通用），Windows 的 `Config.Cipher` 给的是按库派生、SQLCipher 原样使用的密钥（`direct`）；再加上两台机器的微信库本来就是两套各自随机加密的文件，同一个微信号在 Mac 和 Windows 上的密钥必然完全不同，互相不能用。`classifyKeyAgainstPage` 判别形态，两种形态在 WCDB 桥和 SQLCipher 引擎里都各自处理。
- `verifyAccount` 只做「目录形态 + 会话库密钥初筛」；`acquireKeys` 的「校验密钥」步骤用 `verifyDbKeyAcross` 报告这把密钥覆盖到哪些库，只覆盖会话库在 Windows 上是正常结果。
- **数据库引擎**：`resources/native` 里没有 Windows 的 WCDB 库，所以走纯 TypeScript 的 SQLCipher 引擎（`wcdb/sqlcipherBridge.ts`）：
  - `sqlcipherCodec.ts` 按 SQLCipher 4 的页格式（页 4096、reserved 80 = IV 16 + HMAC-SHA512 64、页 1 前 16 字节是 KDF salt）用 `node:crypto` 逐页解密；解密后的页保留 reserved 尾部，页头仍然声明 `reserved = 80`，因此**任何标准 SQLite 都能直接读**（SQLite 由页头第 20 字节推导 usable size，`sqlcipherBridge.test.ts` 有回归测试锁住这个前提）。
  - `decryptedCopy.ts` 把解密结果落在 `<引擎缓存目录>/wcdb-plain/<路径哈希>-<库名>-<salt>.db`（默认 `<dataRoot>/cache/media`，账号设了自定义缓存目录时在那里），**只读源库、从不回写微信目录**。副本名带 salt，换了库就不会复用旧副本。刷新是增量的：主库只在 size/mtime 变化时重扫，且只重解 IV 变过的页（副本自带上次的 IV，重启后也能接着增量）；WAL 帧叠加在上面，来自 WAL 的页把 reserved 尾部清零，等 checkpoint 后自动从主库恢复。
  - `sqliteWal.ts` 按 SQLite 的 WAL 恢复规则（校验头、盐一致、checksum 链）取到**最后一个完整提交**为止的帧。WCDB 跑在 WAL 模式下，不叠加 WAL 就会看不到最近的消息；微信正在写入造成的残帧会被 checksum 链挡掉。
  - 副本是明文聊天数据：目录与文件都是 owner-only（`0o700` / `0o600`，Windows 按 ACL），并且**不在 Agent `shell` 工具可读的范围里**（`composition.ts` 的 `protectedPaths`）。注意目前没有任何「清除缓存」入口：换账号后上一个账号的副本会留在 cache 目录里，直到用户自己删。
- **开发覆盖**：`AIWC_WCDB_ENGINE=wcdb|sqlcipher` 可强制引擎（在 macOS 上就是这样验证 SQLCipher 引擎的）；原生库存在但加载失败时会自动降级到 SQLCipher 引擎并记一条 warn，不会让账号打不开。

## 14. 办公平台连接器（飞书 / 钉钉 / 企业微信，2026-09-13）

**形态：确定性工具 + 内置技能 + 薄 UI，不是独立功能页。** 用户在 Agent 里说「把……整理成表格推到飞书」，Agent 用微信工具取数、按 `skills/office-table` 设计列、调用推送工具；连接、授权、结果都在对话里完成。设置 › 账号 › 办公平台只负责「看得见、可撤销」。

- **只经由官方 CLI**：`lark-cli`（`@larksuite/cli`）、`dws`（`dingtalk-workspace-cli`）、`wecom-cli`（`@wecom/cli`）。AIWC 不直接调各家 OpenAPI，也不保存任何平台凭证——凭证由 CLI 存在用户目录（`~/.lark-cli`、`~/.dws`、`~/.config/wecom`），和终端里用的是同一份。
- **包结构**（`packages/office`）：`cli/`（输出解析；进程与 PATH 探测在 `@aiwc/shell`）→ `platforms/{feishu,dingtalk,wecom}.ts`（各家命令与输出格式，唯一知道 CLI 细节的地方）→ `push/table.ts`（统一表格模型：列类型、取值归一、日期、选项）→ `service.ts`（会话、安装、状态缓存、推送记录）→ `tools/officeTools.ts`。
- **工具与风险**：`office_status`（read）、`office_connect`（write，只挂 `desktop-chat`：要有人在浏览器里完成）、`office_push_table`（send，确认卡片展示表格预览；同时挂 `cron`，定时任务模板要能无人值守推送，Autopilot 才放行）。表格以外的操作（发群消息、写文档、建日程）走通用 `shell` 工具直接调 CLI：办公包只贡献 `commandClassifier()` 和 `writableRoots()`（CLI 状态目录进沙箱白名单），没有单独的 office_cli。分级规则：已知读动词 = read；**其余写入 = send**（内容都会进厂商云端，和 `office_push_table` 同一个语义，不能「总是允许」）；凭证管理 / 删除 / 常驻监听 / 命中 CLI 凭证目录（`.lark-cli`、`.dws`、`.config/wecom`，无论哪个程序读写）= destructive。删除动词按「不是 flag、也不是 flag 取值」的词扫描，夹在参数中间的 `aitable --base-id b record delete` 一样拦得住。全部**不挂 `wechat-bot`**：远端联系人不能驱动「把本机聊天数据推到办公平台」。
- **授权流**（`office_connect` 一次调用跑完）：找 / 装 CLI → 飞书 `config init --new`（建应用）→ `auth login --no-wait --json` + `--device-code`；钉钉 `auth login --device --no-browser --recommend`；企业微信 `auth init --noninteractive --no-browser --output-qrcode`。CLI 打印的链接先校验 https + 平台域名，再由主进程 `shell.openExternal` 打开，并以 `office:session` 推给渲染层（步骤、链接、二维码、授权码、有效期）；校验不过就**当场失败**，不能把链接丢掉让 CLI 干等到超时。工具**阻塞等待**用户在浏览器完成，不需要用户回来回复；取消 / 回合中断会杀掉整个进程组。
- **自动安装**：本机没有 CLI 时 `npm install --prefix <dataRoot>/office/cli`，并**把 HOME 指到沙箱**——钉钉的 postinstall 会把技能铺进 ~/.claude、~/.agents 等 20 多个 Agent 目录，AIWC 不能替用户改其他工具的配置；npm 仍使用用户自己的 `.npmrc` 与缓存。
- **推送**：飞书 `+base-create --fields` + `+record-batch-create --json @file`（每批 200，`--as user` 保证表归用户所有）；钉钉 `+base-bootstrap` → `field list` 取 fieldId → `record create --records-file`（每批 100）；企业微信 `smartsheet create` + `records add`（每批 200，单选/多选按文本写，851003 给出规模限制说明）。追加：`target.pushId`（`<dataRoot>/office/pushes.jsonl`，只记标题、链接和 id，不记行内容）或表格链接；缺的列自动补。
- **渲染层扩展点**：`src/features/agent/toolCards.ts` 让功能按工具名注册「调用行下方的卡片」「确认卡片的说明句」「确认卡片的主体」。办公平台用它显示实时授权卡、推送结果卡和表格预览；Agent 面板不认识任何具体功能。

## 15. 定时任务（2026-09-13）

**形态：保存一段提示词，按计划无人值守地跑一次 Agent。** 左栏第四个功能「定时任务」列出任务（名称、计划、状态、开关），工作区 Tab 是编辑器（任务 · 执行时间 · 授权 · 模型 · 最近运行），空态提供模板。Figma 184-354 的卡片网格改成了 AIWC 的「对象列表 + Tab」。

- **协议**：`packages/protocol/src/tasks.ts`——`TaskSchedule`（daily / weekly / interval / cron）、`ScheduledTask`、`TaskRun`（status、threadId、summary、`denied[]`、toolCalls）、`TaskTemplate`；IPC `task:*`，事件 `task:changed` / `task:run`。
- **调度**（`electron/main/services/taskScheduler.ts`）：`taskTicker.ts` 一个定时器在最近的到点时刻醒来（至少每 30 秒），croner 只用来算时间（`taskTiming.ts`）；`tasks.json` + `runs.jsonl` + `heartbeat.json` 存在 `<dataRoot>/tasks`（`taskFiles.ts`）。计划种类另有 `once`（`at` 时刻跑一次后自动关闭）；`action: 'remind'` 只提醒（系统通知 + 常驻 Toast + 在创建它的 Agent 会话里 `postNote`），不调用模型。上一轮没跑完时到点的那次记为 `skipped`（`reason: previous_running`）。
- **补救**（`taskRecovery.ts`）：到点晚于 2 分钟的时刻算「错过」：心跳之后错过 = `app_not_running`，醒来间隔明显长于计划 = `machine_asleep`。`catchUp: 'once'`（默认）在错过后 12 小时内补跑最近一次（`trigger: catch_up`，带错过次数），否则只记一条 `missed`。运行开始时就写一行 `running`，启动时仍是 `running` 的记录改为 `interrupted`（`app_quit`）；退出时被中止的运行同样记 `interrupted`。失败原因由内核最后一条 `error` 事件的 code / status 决定（`model_unavailable` / `rate_limited` / `network` / `empty_result` / `truncated` / `content_filter`）；限流与网络失败且没有执行过任何非只读调用时，1 分钟、4 分钟后各重跑一次（不短于 Retry-After，`trigger: retry`）。模型回答为空的运行记为失败。
- **对话里管理**（`prompts/taskTools.ts`，注册在 `composeTasks`）：`task_create` / `task_update`（write；按调用**之后**的任务判定：结果是启用中的 Autopilot 任务即为 send 且不可「总是允许」，所以改一个 Autopilot 任务的指令、时间或恢复它也要确认）/ `task_list`（read）/ `task_delete`（destructive）。相对时间用 `in_minutes` 由主进程按真实时钟换算，过去的时间（超过 1 分钟）拒绝。结果 JSON 带任务 id，面板据此显示「打开任务」。
- **一次运行 = 一个新的 `cron` 线程**：`kernel.ensureThread({ channel: 'cron' }, { profile: 'cron', permissionMode: task.permissionMode, model })` + `kernel.runOnce`。提示词由 `prompts/tasks.ts` 包一层「无人值守：不要提问、被拒绝就跳过并汇报、结尾写总结」。`cron` 通道永不弹确认：任务的**权限模式**决定放行范围（Ask = 只读 + 记忆；Bypass = 加本机写入，默认；Autopilot = 加对外发送），矩阵会「问」的一律拒绝。被拒绝的调用连同 `risk` 收进 `TaskRun.denied`，编辑器里一键「改为 Bypass / Autopilot 并重跑」（`permissionModeFor`）；destructive 永远不会无人值守执行。模板自带所需模式（推飞书的模板是 Autopilot），用模板建的任务不会卡在没人回答的确认上。
- **结果**：完成 / 失败推 Toast（动作 = 打开任务 Tab）；运行记录里能「打开对话」把那条 cron 线程调进 Agent 面板（列表只列 desktop 线程，所以定时运行不会刷屏）。
- 渲染层：`src/features/tasks`（`taskStore` 订阅两条事件；`scheduleModel` 纯函数）；rail 增加 `tasks`、快捷键 ⌘4、Tab kind `task`、命令 `tab.openTask` / `agent.openThread` / `agent.expand`；`ObjectListRegistration.workspaceEmpty` 让功能自带工作区空态。

## 16. 模型请求：代理、用量与厂商方言（2026-10-11）

- **组装**：`electron/main/composeModels.ts` 建 ModelResolver、代理传输（`ai/modelFetch.ts`）和 `usage.db`（`ai/usageStore.ts`），composition 只拿 `models` 与 `modelOps`。
- **代理**：每个请求单独路由（`@aiwc/protocol` `modelNetwork.ts` 的 `bypassesProxy`）：本机回环与绕过规则直连；`system` 用 Electron `session.resolveProxy`（PAC / 系统设置）；`manual` 用 undici `ProxyAgent` / `Socks5ProxyAgent`，地址无效时请求失败而不是悄悄直连。kernel 不认识代理：`createLanguageModel(…, fetch)` / `testModel` / `discoverModels` 只接收注入的 `fetch`。Ollama 不走它。代理密码在 secretStore（`ai.proxy.password`）。
- **用量与调用记录**：resolver 返回的每个 ModelClient 由 `ai/meteredClient.ts` 包一层，`sample()` 结束时写一条记录：功能取 `SamplingRequest.purpose`（kernel 按线程 profile 标 agent / task / wechatBot，标题 / 压缩各自标），否则取 `models.forFeature(x)` 的默认（autoReply / clone / todo / memory）。`usage.db` = `calls`（上限 2000 条 / 30 天，正文仅在 `ai.callLog.recordContent` 开启时写入，已用 `ai/redact.ts` 去掉 Key）+ `usage_daily`（按本地日期 × 功能 × 模型累加，保留到用户清空）。`usage.db` 在 shell 工具的保护路径里。
- **厂商方言**：`modelProfiles.ts` 按 vendor 预设或接口域名识别 OpenAI 兼容方言，给出上下文、看图与思考开关；`aiSdk.ts` 的 `providerOptionsFor` 把推理档位映射成该厂商的请求字段（放在 `providerOptions[provider.id]`，由 @ai-sdk/openai-compatible 原样并入请求体）。OpenAI 兼容接口开启 `includeUsage` 以拿到流式 token 用量。
- **推理档位与附件**（2026-10-11）：`SamplingRequest.reasoningEffort` 按调用覆盖模型条目的档位（模型不支持该档时回落到条目设置）；Agent 轮次取 `ThreadSettings.reasoningEffort`（输入框工具栏，null = 跟随模型），标题、压缩、克隆反思传 `lowest` = 该模型允许的最低档（能关就关，预算型取最小 / Anthropic 关闭）。用户附件以 base64 `image` / `file` ContentPart 存在历史里；上限（数量 / 单个 / 合计）只在 `@aiwc/protocol` `attachments.ts` 定义一次，输入框行内提示、`agentOpGuard` 拒绝、草稿存储校验共用。发给模型时（`kernel/runtime/model/attachmentParts.ts`）：看得见图片的模型收图片，否则换成一句说明（`modelSupportsVision` = 模型条目的 `supportsVision`，即智能配置结果或用户的「图片」开关）；文本类文件解码内联、截到 10 万字；PDF 原样作文件；其他二进制只给文件名与大小。ContextManager 按大小估算附件 token。未发送的草稿经 `composer:*`（`ipcDomains/conversation.ts`）存在 `<dataRoot>/composer-drafts.json`（`services/draftStore.ts`，原子写、最多 50 份、超出总大小时旧草稿先丢附件）。

## 17. 扩展：MCP 服务器、用户 Hooks 与动态工作流（2026-10-11）

- **配置**：`<dataRoot>/extensions.json`（`electron/main/extensions/store.ts`，原子写 0600，坏条目逐条丢弃），不放进 `config.json`——它写的是应用会运行的命令，只能经 `mcp:*` / `hooks:*` 通道修改（`ipcDomains/extensions.ts`）。服务在主进程再次 zod 校验；**新增或改动的命令 / 地址（本地命令还包括它设置的环境变量名）、以及离开沙箱的 Hook，保存前由主进程弹原生确认框**（`ipc/extensions.ts`），渲染层绕不过。确认框显示完整命令：空白折叠、不可见字符写成 `<U+XXXX>`，超过 1000 字或 20 行的命令拒绝保存而不是截断显示（`extensions/confirmText.ts`）。本地命令的环境变量不能用会改变运行内容的名字（`PATH`、`HOME`、`NODE_OPTIONS`、`DYLD_*`、`LD_*`、`PYTHONPATH`、`BASH_ENV`、`NPM_CONFIG_*` 等，`isReservedMcpEnvName`，不区分大小写），启动时也会滤掉。环境变量与请求头的值存 secretStore（`mcp.<id>.<name>`），视图只回 `hasValue`。渲染层的 `file:write` 拒绝写入 `protectedDataPaths` 里的任何位置（符号链接解析后、忽略大小写比对），这些存储只能经各自的校验通道修改。该文件在 shell 工具的保护路径里，Agent 改不了它。
- **MCP 客户端**（`extensions/mcp/`，无第三方依赖：官方 SDK 依赖 express 等服务端包，而只用工具的客户端只需要 JSON-RPC + 三种传输）：`jsonRpc.ts`（请求超时、`notifications/cancelled`、应答 `ping`）、`transports.ts`（stdio：登录 shell 的 PATH、独立进程组、stderr 尾部；Streamable HTTP：`Mcp-Session-Id`、JSON 或 SSE 响应、关闭时 DELETE；旧版 SSE：只向同源 endpoint POST）、`client.ts`（initialize、分页 `tools/list`、`tools/call`、`list_changed`）、`manager.ts`（启动后台连接、按代数丢弃过期结果、断开即注销工具、退出时关闭全部连接）。
- **工具**：每个服务器工具一个 `defineTool`，名为 `mcp__<server>__<tool>`（不合法 / 过长 / 冲突的名字加原名哈希）。`risk` = 用户的单工具设置 ?? 服务器默认（默认 `write`）；服务器标了 `destructiveHint`（且没同时标 `readOnlyHint`）的工具一律 destructive，用户设置改不低它（`mcp:setToolPolicy` 拒绝给它设权限，界面也不显示权限下拉），`readOnlyHint` 不会降低风险。只读工具也挂 `subagent`；任何 MCP 工具都不挂 `wechat-bot`。stdio 以外的服务器 `offDevice`（§6）。输出按工具通用规则在记录时截断。
- **用户 Hooks**（`extensions/userHooks.ts` + `hookProtocol.ts`）：挂在同一个 kernel `HookRunner` 上（与 `hooks.ts` 的宿主 hook 同一套系统），事件 `SessionStart`（新会话第一条消息前，借 `thread.created` 标记）、`UserPromptSubmit`、`PreToolUse` / `PostToolUse`（按工具名正则匹配）、`Stop`。命令在工作区目录用登录 shell 运行，事件 JSON 走 stdin，按 Hook 设置在 shell 工具的 seatbelt 沙箱内运行；语义与 Claude Code / Codex 一致：退出码 2 = 拦截（stderr 为原因），JSON 输出的 `decision: block` / `continue: false` / `permissionDecision: deny` / `additionalContext` / `updatedInput`；其他退出码与超时不拦截，只记日志并显示在设置里。Hook 只能收紧：`permissionDecision: allow` 被忽略，审批照旧；`updatedInput` 改了参数时，router 对新参数重新分类并重新走审批矩阵——风险升高、放行键变了、或用户确认过的是旧参数，就重新询问（无人可问的定时任务直接拒绝）。
- **动态工作流**（kernel `runtime/workflow.ts` + `workflowEngine.ts`）：`workflow_run` 让模型把多步工作写成 DAG（最多 8 步、并发 ≤ 4、每步 8 分钟、整次 15 分钟，可中断），每步一个 `runChild` 子线程，前置步骤的结果（截断后）附在后续步骤的提示后；失败步骤的下游标为跳过；`output: 'json'` 的步骤解析 JSON 并检查顶层 `required`。进度经 `tool.progress.detail`（`WorkflowRunView`）推给面板，最终结果是同一结构（带截断的输出），所以重新载入的会话也能显示步骤列表。工作流本身是 `read`：每个写入在子线程里按父线程的权限模式单独审批。子线程不能再启动工作流（`DELEGATION_TOOLS`）。

## 18. 微信账号环境隔离（2026-10-11）

- `services/accountProfiles.ts` 在组合应用之前选择 `<userData>/aiwc/accounts/<SHA-256(账号目录标识)>`。`AppPaths.dataRoot` 及所有可变路径随账号迁移：config、secretStore、Agent 历史与索引、记忆、关系、回复规则/草稿/审计、定时任务、每日待办、手机通道、扩展、工作区、导出、用量与缓存；打包资源保持共享。自定义缓存追加 `aiwc-accounts/<账号摘要>`。账号标识不直接拼入路径。
- `active-account.json` 只记录明确选择的账号。`substrate:connect` 跨账号时先验证目标目录和已有密钥（尚无密钥时进入新账号的解锁页），再保存选择、停止旧账号任务、关闭通知与窗口并重启完整进程。禁止在旧组合根中只更换数据源。重启（含清除全部数据）只走 `index.ts` 的 `relaunch()`：`npm run dev` 下 vite-plugin-electron 会随 Electron 退出关掉开发服务器，所以由 `vite.config.ts` 启动的进程改为以退出码 75 结束、由它重新拉起 Electron（`electron/main/devRelaunch.ts`），打包版本仍用 `app.relaunch()`。已保存的自定义缓存目录重启后只有 `aiwc-accounts/<账号摘要>` 在文件白名单里，`config:set` / `substrate:connect` 原样提交它时跳过白名单检查（`cacheDirPolicy` 的 `saved`）。切换中的 IPC 被拒绝，旧事件与通知停止发布；新进程重新创建所有服务与界面状态。
- 自动回复、监控、定时任务、每日扫描和手机通道在用户点击「进入」、确认当前账号之后才启动。停在启动账号选择页不会运行上次账号的提醒。账号密钥获取和手动输入均写入明确目标账号的 secretStore，不改当前账号的密钥或选择；普通 `config:set` 不允许跨账号修改 wxid。
- 引导页的 `substrate:verifyAccount` 从所选账号的独立 secretStore 取数据库密钥；没有密钥立即拒绝，不能使用底层 `verifyAccount` 的无密钥目录检查作为解锁验证，也不回退到当前账号密钥。渲染层用 `keyTarget` 记录页面密钥归属，加载缓存、获取成功或手动替换数据库密钥时更新；`onboarding/accountVerification.ts` 先拒绝归属不一致的密钥并清除旧密钥的界面状态（不删除安全存储），再调用后台校验。验证失败的多语言提示要求重新获取，账号与密钥的可用状态撤销；账号、目录或密钥已变更后的旧结果忽略。底层无密钥目录检查仍供账号环境切换进入解锁页使用。
- Chromium 使用独立 `persist:account-<摘要>` 分区，媒体协议注册到对应分区，搜索历史/已打开会话等浏览器状态不再共享。文件白名单只允许当前账号目录；即使选择父目录，其他账号和旧公共存储仍被拒绝。聊天视频只开放当前账号的目录，不开放整个微信数据根目录。
- 旧版公共目录的历史无法可靠判断归属，保留原文件且不自动导入任何账号，也不启动旧任务。首次仅沿用外观、模型接入及账号连接配置；旧扩展、授权、自动回复和扫描设置不继承。切回已建立的新账号目录时恢复其自身数据。清除全部数据仍覆盖全部账号目录与 Chromium 分区。
- 开发版 macOS 包在 `scripts/aiwc-electron.cjs` 中将标准 Logo 写入 `electron.icns`，缓存路径含图片摘要；Dock、窗口图标和通知使用同一份品牌素材，通知授权界面的图标由应用包提供。
