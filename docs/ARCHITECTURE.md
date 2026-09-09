# AIWC 工程架构（Agent 内核 · 数据基座 · 通道 · 桌面壳）

> 与 `CLAUDE.md`（界面约束）、`DESIGN-SPEC.md`（行为规格）并列。本文回答"代码怎么分层、谁依赖谁、一次对话怎么跑、如何扩展"。
> 设计来源：Hermes 的产品形态（网关 + 有界记忆 + cron + 技能）、Codex 的运行时纪律（Thread/Turn/Step、类型化有界上下文、单一工具注册表、JSONL rollout）、AIWC_ORG 的微信数据层。

## 1. 一句话

**AIWC = 一个本地运行的微信数据工作台：数据基座只读微信，内核跑 Agent，通道层决定在哪听、往哪发，桌面壳只是其中一个通道。**

## 2. 目录与分层

```
AIWC/
├─ packages/protocol/    契约：ID、历史条目、上下文片段、工具、Op/Event、模型端口、网关、基座、记忆、配置、IPC
├─ packages/kernel/      Agent 内核：Thread → Turn → Step 循环、ContextManager、系统提示三层、压缩、工具注册/路由/分发、审批、hook、rollout、技能、子代理、模型适配
├─ packages/substrate/   微信数据基座：WCDB 桥、密钥获取、图片解密、消息归一化、SQLite 镜像（双 FTS5 + 向量）、微信工具集
├─ packages/gateway/     通道层：PlatformAdapter、MessageEvent 归一化、SessionKey、ReplyGate、观察上下文、自动回复队列、iLink 适配器、UI 注入发送
├─ packages/memory/      记忆：MEMORY/USER/SOUL/AGENTS 四个有界 Markdown、关系档案（克隆）、日记流水线、记忆工具
├─ electron/
│  ├─ main/              组合根：启动、窗口、配置、密钥、IPC、调度器、把各包接成一个应用
│  ├─ preload/           typed bridge（window.aiwc）
│  └─ hosts/             utility process 入口（substrateHost：WCDB 原生访问隔离）
├─ src/                  渲染层（React 19）：kit（组件库）→ shell（四列壳）→ workspace（Tab 容器）→ features（各页面）
├─ skills/               内置 SKILL.md
├─ dev/fixtures/         演示数据（仅 dev / web 模式）
└─ docs/                 本文、设计截图、决策记录
```

### 依赖规则（ESLint `boundaries` 强制）

| from | 允许 import |
|---|---|
| protocol | 无内部依赖 |
| kernel / substrate / gateway / memory | 只有 `@aiwc/protocol` 和自己 |
| electron | 全部（组合根） |
| src（渲染层） | 只有 `@aiwc/protocol` 类型；数据一律走 `window.aiwc` IPC |

四个业务包互不依赖：它们通过 protocol 里的接口（`SubstrateService`、`MemoryStore`、`GatewayOutbound`…）在组合根被注入。工具定义（`defineTool`）也在 protocol，所以 substrate / memory / gateway 可以导出工具而不依赖 kernel。

## 3. 进程模型

```
Renderer (React)  ──IPC(typed)──▶  Main (composition root)
                                     ├─ Kernel（进程内，Thread 实例）
                                     ├─ Gateway（iLink 长轮询、UI 注入、观察流）
                                     ├─ Memory / Diary scheduler（croner）
                                     └─ SubstrateClient ──MessagePort──▶ substrateHost (utility process)
                                                                          └─ WCDB(koffi 原生) / SQLite 镜像 / 解密
```

- 原生代码（koffi、better-sqlite3 读微信库）只在 `substrateHost` 里跑：崩了只重启这个进程。
- 内核跑在 main 进程，避免每个工具调用两跳。`KernelHost` 抽象保留把内核挪到 utility process 的余地。
- 渲染层必须连接桌面 preload；纯浏览器或桥接缺失时显示连接错误。mockBridge 仅供隔离测试使用，不会由应用加载。

## 4. 一次对话如何执行（Thread → Turn → Step）

1. 渲染层/网关提交 `Op{type:'turn.start'}`。Thread 把输入放进 mailbox；若有 turn 在跑且 mode='steer' 则并入当前 turn。
2. **Turn 开始**：`UserPromptSubmit` hook → 预压缩检查 → 组装 turn 级片段（记忆快照差量、关系档案、@ 引用、观察上下文）。
3. **Step**（一次采样请求）：冻结 `StepContext`（模型、工具路由、设置、片段），`ContextManager.forPrompt()` 生成历史，`ModelClient.sample()` 流式返回。
4. 工具调用：由 `ToolRouter.dispatch` 单一漏斗处理——校验 → 审批（`ApprovalGate.decide` / `ask`）→ `PreToolUse` → 执行（超时）→ `PostToolUse` → 记录时截断。并行安全的工具并发（读锁），其它串行（写锁），结果按调用顺序写回历史。
5. 有工具结果就进入下一 Step；直到模型不再调用工具、或触达 `maxStepsPerTurn`、或 loop guard（连续 3 次相同调用指纹 / A-B-A-B 交替）、或超时。
6. **Turn 结束**：`Stop` hook → `turn.completed` 事件 → rollout flush → 后台任务（标题生成、自动记忆抽取）。
7. 中断：`turn.interrupt` → 取消 token → 100ms 优雅期 → 硬中止 → 写入 `turn_aborted` 条目 → flush → 发 `turn.aborted`。

## 5. 上下文规则（内核强制，代码评审必查）

1. 不改写历史：只追加；压缩产生一个 `compaction_summary` 条目替换前缀，并记录检查点。
2. 系统提示三层：`stable`（身份 + 规则 + 技能索引 + 记忆**冻结快照**）→ `context`（线程来源、@ 引用）→ `volatile`（日期到天、上下文占用）。stable 层整个会话不变。
   `systemPrompt.byProfile` 可**整体替换** stable 的身份串（目前只有 `persona`：Agent 身份明文禁止冒充他人，与扮演直接冲突，只能换不能叠）；`skillsExcludedProfiles` 让无工具的线程不带技能索引。
3. 任何注入都是 `ContextFragment`：有 `kind`、`marker`、`tokenCap`；渲染后先截断再记录；`tokenCap ≤ 10k`。
4. 工具输出在**记录时**截断（默认 16k 字符，工具可覆盖），不是发送时。
5. 每个 Step 前做 world-state 差量：只有变化的段（权限模式、模型、工具表、AGENTS 规则）才追加一个片段。片段提供者可实现 `reset(threadId)`：历史被清空/回滚时内核会调用它，避免「已发过就不再发」的缓存把片段永久吞掉。
6. 压缩阈值 80%（可配），压缩摘要落盘可续；`context.usage` 每 Step 上报。

## 6. 工具规则

- 工具 = `defineTool({ name, description, inputSchema(zod), profiles, risk, parallelSafe, execute })`。
- `risk`：`read` / `write` / `send` / `destructive`。审批矩阵：

只有**高危动作**（对外发送 / 破坏性）会打断用户；读取永不询问。

| 模式 \ 风险 | read | write | send | destructive |
|---|---|---|---|---|
| Ask（默认） | 放行 | 问（白名单放行） | 问 | 问（不可总是允许） |
| Bypass | 放行 | 放行 | 问 | 问（不可总是允许） |

- `profiles` 决定挂载面：`desktop-chat` 全量；`wechat-bot` **只有 read + 发回原会话**；`cron` 只读 + 记忆写；`subagent` 只读且无 `delegate`；`persona` 无工具。
- 通道感知：`ToolContext.origin` 记录线程来源，发送类工具在 `wechat-*` 通道只能发回 `origin.chatId`。
- 新增一个工具：在对应包 `tools/` 下 `defineTool`，在包的 `index.ts` 导出，在 `electron/main/composition.ts` 注册。**不需要**改提示词、超时表、审批表（都从定义推导）。

## 7. 通道与自动回复

- 入站统一 `MessageEvent`；`buildSessionKey(source)`：dm 按对方隔离，群按「群 + 人」隔离。
- `ReplyGate` 是**确定性闸门**，只判三件事：不是自己发的 / 消息类型可回 / 该会话的规则启用且未被熔断暂停。过闸后才调用模型起草。闸门里不放任何 UI 上看不见的条件——那正是「规则开着却不回」的来源，全局总开关也因此删掉了。
- 没有规则覆盖的群消息以 `observed` 形式存入观察缓冲，之后该会话真的回复时作为**仅 API 可见**的片段回放，不进历史当用户轮次。
- 规则产出的草稿只有一种模式：`auto`（倒计时后发送）。`confirm` / `suggest` 只留给用户自己要来的东西——Agent 的 `draft_reply` 交接、回复台里的「暂缓」和手动重试。
- 本机微信的观察端是 `autoReplyMonitor`：订阅 substrate 的 DB 变更 + 3s 轮询，静默窗口 5s 后才入闸。第一次看到某会话（= 规则刚开启 / 应用刚启动 / 刚重连）会**补回一次**：最后一条若是对方发的就直接回，不等下一条。这个动作幂等——回完最后一条就是我们自己的了。`triggerNow(sessionId)` 是它的手动版本（IPC `autoreply:triggerNow`），跳过静默窗口并带 `force` 绕过判重。
- 两条发送通道信任级别不同：iLink 发送走 API 校验；UI 键盘注入必须做 **DB 读回验证**，失败即整体熔断（halt），需手动恢复。
- 所有出站都进审计记录（`AutoReplyRecord` / `outbound` 事件）。

## 8. 记忆与日记

- `MEMORY.md`（当下事实）、`USER.md`（我是谁）、`SOUL.md`（Agent 人格）、`AGENTS.md`（用户规则）——四个有界 Markdown，`§` 分隔条目，写入加锁 + 漂移检测；系统提示里用冻结快照并显示占用百分比。
- 关系档案（克隆）按联系人一个文件夹：`profile.json`（card + deep + stats）、`samples.jsonl`、`pairs.jsonl`、`notes.jsonl`、`corrections.jsonl`、`status.json`、`reflected.json`。
  - 构建：读消息 → 补转语音 → 轮次合并 → 分块 map-reduce（块按时间分散取，不只取最近）→ 私聊语料不足时用**群聊发言**补风格/深层画像（群聊回复错位，绝不产出问答对）。
  - 聊天：`persona` 线程换掉 stable 身份，`<persona>`（stable，人设）+ `<persona_notes>`（turn，去重，扮演纠正）+ `<persona_recall>`（turn，按当前这句检索 `pairs.jsonl` 的真实回复 + 基座里的真实聊天片段）。
  - 回路：试聊里的「不像 TA」和定期 `clone:reflect` 把用户的纠正写进 `notes.jsonl`，下一轮起强制遵守。
- 日记 = 调度作业：选材（FTS/统计而非关键词表）→ 按会话小结 → 日综合 → 写 `diaries/YYYY-MM-DD.md`（末尾 `## 记忆线索`）→ 回灌 MEMORY。失败时写降级版。
- 用户数据目录：`<userData>/aiwc/{config.json, secrets.bin, rollouts/, index.db, memory/, relationships/, diaries/, skills/, logs/}`。

## 9. 渲染层结构

- `src/kit/`：唯一的组件库（按钮 5 种、开关、输入、下拉、分段、chip、徽标、Toast、tooltip、右键菜单、popover、对话框 4 种、抽屉、空态 4 种、骨架、进度、头像、列表项、设置行、Tab、卡片）。页面**不得**自造这些。
- `src/shell/`：WindowChrome、四列布局、IconRail、ObjectList、AgentPanel（可收起）、快捷键。
- `src/workspace/`：Tab 容器 + `tabRegistry`；每类 Tab 是一个 `TabRenderer`，页面在 `src/features/*` 里注册。
- `src/platform/`：`bridge.ts`（取 `window.aiwc` 或 mock）、`ipc hooks`。
- 状态用 zustand，按领域拆 store：`uiStore`（列宽/收起/主题）、`tabsStore`、`agentStore`、`substrateStore`、`configStore`。
- 新增页面 = 新 `TabRenderer` + 在 `features/<name>/index.ts` 注册。不新开窗口、不做全屏页。

## 10. 测试与验证

- `vitest`：包级单元测试放在源码旁 `*.test.ts`。内核必测：步数上限、loop guard、片段截断、审批矩阵、并行顺序、rollout 续跑、压缩检查点。
- `npm run typecheck` 与 `npm run lint` 必须为零错误；boundaries 违规视为架构错误。
- UI 在 `dev:web` 模式下与 `docs/design/figma/*.png` 并排对照。

## 11. 不做的事（与 CLAUDE.md §7 对齐）

- 不把工具名硬编码进提示词 / 超时表 / 审批表。
- 不让 `wechat-bot` profile 拿到写文件、执行命令、截屏类工具。
- 不在渲染层直接读微信文件或调模型。
- 不写死演示数据；演示数据只在 `dev/fixtures` 并只在 web / dev 模式加载。

## 12. 微信密钥获取与真实数据（macOS，2026-09-06 实测）

- **绝不显示假数据**：桌面 App 永远以 `wcdb` 模式运行真实微信数据基座。未配置账号/密钥时基座停在 `no_config` 空态（由 onboarding 引导），**不再退回 demo**。演示数据只在浏览器 `npm run dev:web`（mock bridge）或显式 `AIWC_SUBSTRATE=demo` 时出现。
- **真实库路径**：微信 4.x 在 `~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<wxid_目录>/db_storage/{session,contact,message,...}`。reader/mirror/facade 已在真机 4.1.13 上实测：同步出 1008 会话 / 74 万消息 / 15 万媒体，FTS 检索可用。
- **db 密钥获取顺序**（`packages/substrate/src/key/acquireKeys.ts`，macOS）：
  1. **只读内存 helper** `wechat_memory_scan_helper <pid> <session.db>` —— 需 `task_for_pid`，打包 App 靠 `com.apple.security.cs.debugger` 权限 + 用户在「系统设置 › 隐私与安全性 › 开发者工具」授权。
  2. **崩溃转储扫描** `--dump <crashinfo/completed> <session.db>` —— 只读文件、**无需特权**，未签名的 dev 构建也能用；本机就是靠它拿到并校验了真实密钥。
  3. **重启捕获兜底** `electron/main/wechat/relaunchCapture.ts` —— 关闭并重启微信后对新登录进程重试 1+2（仅在前两步都失败时触发）。
  - 关键点：helper 的第二个参数必须是具体的 `session.db` 文件（读取 SQLCipher salt 校验），不是 `db_storage` 目录。
  - 微信 4.1.13 **不经 CommonCrypto `CCKeyDerivationPBKDF`** 派生 WCDB 密钥，旧的 LLDB 断点在该版本上不触发，故以内存/转储扫描为主。
- **图片密钥**：`imageKeys.ts` 从 kvcomm 缓存码 + wxid 纯推导（XOR + AES），无需特权，已实测成功。
- **打包签名**：`resources/macos/entitlements.mac.plist` 含 debugger 权限；`scripts/afterPack.cjs` 在打包时对 `wechat_memory_scan_helper` 用 `resources/macos/helper.entitlements.plist` 重新签名。
- **前置条件**：SIP 关闭 + 已安装 Xcode/命令行工具（仅重启捕获这条路用到 lldb）；用户需授权「开发者工具」TCC 才能走只读实时扫描，否则自动回退到崩溃转储/重启捕获/手动粘贴。
