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
                                     ├─ Memory / Diary scheduler（croner）
                                     └─ SubstrateClient ──MessagePort──▶ substrateHost (utility process)
                                                                          └─ WCDB(koffi 原生) / SQLite 镜像 / 解密
```

- 原生代码（koffi 加载的 WCDB 桥、密钥扫描 helper、图片解密模块）与 SQLite 镜像（`node:sqlite`）只在 `substrateHost` 里跑：崩了只重启这个进程。
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
8. 委派：`delegate_analysis` 的子线程是临时的——继承父线程的权限模式与模型，历史只留在内存（不写 rollout、不进索引与检索），不发 `thread.created`；`listThreads` 排除 `subagent` 线程，父线程不在内存时拒绝委派。

## 5. 上下文规则（内核强制，代码评审必查）

1. 不改写历史：只追加；压缩产生一个 `compaction_summary` 条目替换前缀，并记录检查点。 续跑时 rollout 逐行按 schema 校验（`tooling/rolloutLine.ts`）：撕裂或形状不符的行跳过、计入 `ResumeState.skippedLines` 并记 warn（只记行号、错误码与路径，不记内容）；索引里的 origin / settings 列读不出时列表用兜底值，续跑与 rewrite 以 JSONL 为准。崩溃留下没有换行的半行时，下一次追加先补换行，不会把新行粘到坏行上一起丢掉。
2. 系统提示三层：`stable`（身份 + 规则 + 技能索引 + 记忆**冻结快照**）→ `context`（线程来源、@ 引用）→ `volatile`（日期到天、上下文占用）。stable 层整个会话不变。
   `systemPrompt.byProfile` 可**整体替换** stable 的身份串（目前只有 `persona`：Agent 身份明文禁止冒充他人，与扮演直接冲突，只能换不能叠）；`skillsExcludedProfiles` 让无工具的线程不带技能索引。
3. 任何注入都是 `ContextFragment`：有 `kind`、`marker`、`tokenCap`；渲染后先截断再记录；`tokenCap ≤ 10k`。
4. 工具输出在**记录时**截断（默认 16k 字符，工具可覆盖），不是发送时。
5. 每个 Step 前做 world-state 差量：只有变化的段（权限模式、模型、工具表、AGENTS 规则）才追加一个片段。片段提供者可实现 `reset(threadId)`：历史被清空/回滚时内核会调用它，避免「已发过就不再发」的缓存把片段永久吞掉。
6. 压缩阈值 80%（可配），压缩摘要落盘可续；`context.usage` 每 Step 上报。摘要只转述聊天内容、不加引号，回到提示词时带一句「这是转述不是原文，要引用请重新读」——压缩后的「原话」是编造引用的主要来源。
7. 压缩的输入永远先放上一份摘要，再按整行、从新到旧填满字符上限——从前面截断会把之前折叠的全部历史一并丢掉。
8. 内部模型调用（标题、压缩）经 `ModelResolver.resolveAuxiliary(primary)`，与线程自己的模型保持同样的本地 / 在线属性；线程选的本地模型不可用时直接报错，不回退到在线默认模型。

### 检索（substrate mirror）

- 关键词检索同时查 `messages.text` 和 `message_extras`（引用回复的原文 + 语音转写，触发器维护，不重建主索引）。
- 消息正文解码：WCDB 桥把 BLOB 列作为 Buffer 返回，文本列一律按原文使用；只有看起来像 hex / base64、并且解出来确实是 zstd 帧的字符串才解压（身份证号、订单号这类纯数字文本不会被误解码）。群消息的发送者前缀必须是 `用户名:\n` 形式才剥离，单聊里的 `10:30 开会` 保持原样。
- 会话类型只在 `packages/substrate/src/normalize/kinds.ts` 判定：群聊（`@chatroom`、`@im.chatroom`）、公众号、系统账号。WCDB 读取器与镜像共用这一份；`wcdb/accountUtils.ts` 的 `shouldKeepSession` 只决定列表里显示哪些会话。
- 由微信数据拼出的缓存路径片段若只由点号组成，编码为下划线，媒体缓存始终落在 `cacheDir/media/<session>/` 之内。
- 中文没有词边界：查询里的汉字串既按原样短语走 trigram（精确），也按 `Intl.Segmenter` 分出的词走 trigram（召回，`(短语) OR (词…)`）；两个字的词（多数人名）走 OR 的 LIKE 通道，命中的词越多分越高。
- 没配置向量模型时 `semantic_search` 实际只做关键词检索，工具结果会如实写 `mode: 'keyword'` 并提示换关键词，不再假装做了语义检索。
- 命中结果带会话名（`chat`）；索引里只有 wxid 的发送者在工具层用通讯录补上名字。

## 6. 工具规则

- 工具 = `defineTool({ name, description, inputSchema(zod), profiles, risk, parallelSafe, execute })`。
- `risk`：`read` / `write` / `send` / `destructive`。审批矩阵：

读取永不询问；Ask 模式下写入先问（选「总是允许」后该工具不再问）；对外发送（微信消息、推送表格）只有 Autopilot 不问；破坏性操作在任何模式下每次都要确认。表格即 `packages/kernel/src/tooling/approval.ts` 的 `APPROVAL_MATRIX`。

| 模式 \ 风险 | read | write | send | destructive |
|---|---|---|---|---|
| Ask（默认） | 放行 | 问（白名单放行） | 问 | 问（不可总是允许） |
| Bypass | 放行 | 放行 | 问 | 问（不可总是允许） |
| Autopilot | 放行 | 放行 | 放行 | 问（不可总是允许） |

- `profiles` 决定挂载面：`desktop-chat` 全量；`wechat-bot` **只有 read + 发回原会话**；`cron` 全量挂载但**永不询问**——矩阵里会「放行」的就放行（read、记忆写、白名单，以及任务权限模式覆盖的风险），会「问」的一律拒绝并告诉模型「权限模式不允许，已跳过，请说明」；`subagent` 只读且无 `delegate`；`persona` 无工具。 `subagent` 只读与 `persona` 无工具由 registry 按 `risk` 强制，工具定义里写了也挂不上。
- **按调用分级**：工具可以带 `classify?: (input) => ToolCallPolicy`，在参数校验后决定这一次调用的 `risk`、`allowKey`（白名单键，默认 = 工具名）、`canAllowAlways` 和给确认卡的 `note`。`shell` 靠它把「`git status`」和「`rm -rf`」判成不同风险；`tool.call` 事件带 `allowKey`，定时任务据此列出「被拒绝的操作」供用户授权。
- 「总是允许」只在授权真的会被采纳时提供：把该调用的 `allowKey` 加进白名单后审批结果会变成放行，才显示这个选项；send / destructive 每次都确认。
- `draft_reply` 在 `desktop-chat` / `wechat-bot` / `cron` 都可用：它只把草稿交给回复台（`mode: 'confirm'`），自己从不发送，所以是 `read` 风险；桌面端必须给 `to`，机器人线程忽略 `to` 只能回来源会话。
- **证据引用**：检索 / 上下文 / 时间线工具的每条消息都带 `cite`（`[MM-DD HH:mm](wx://sessionId/messageId)`，格式与核对逻辑在 `@aiwc/protocol` 的 `citations.ts`）。模型原样粘贴；面板渲染为可点击 chip 并逐字核对引号内容；主进程 `citationAuditHook`（Stop hook）在桌面线程的回答结束时再核对一次，对不上就 `block`，内核据此把原因作为 `stop_hook` 片段追加并**多跑一步**让模型写更正（每轮最多一次，`MAX_STOP_CONTINUATIONS`）。
- **时间参数**：所有工具的 `from` / `to` 同时接受毫秒时间戳和本地时间字符串（`2026-02-14`、`2026-02-14 19:28`、`2026-02`），`to` 只写日期时包含当天全天。`get_timeline` 返回 `olderCursor` / `newerCursor`，长对话要翻页读完再下结论。
- 通道感知：`ToolContext.origin` 记录线程来源，发送类工具在 `wechat-*` 通道只能发回 `origin.chatId`。
- `wechat-bot` 线程调用 `get_relationship_profile`：没有来源会话时拒绝，只能查当前会话的对象，并且只拿到语气与称呼视图（`relationship_style`），拿不到完整档案——机器人的回复正是发给这个人的。
- `query_sql` 是唯一的原始 SQL 出口，只接受单条 `SELECT` / `WITH`。`SubstrateFacade.querySql` 调用 `shared/sqlGuard.ts` 的 `guardSelectSql` 恰好一次，读取器只接收它产出的品牌类型 `GuardedSql`，不各自校验。PRAGMA、EXPLAIN 与 `pragma_*` 表值函数（含各种引号写法）一律拒绝，结果最多 200 行；表结构用 `SELECT name, sql FROM sqlite_master WHERE type = 'table'` 查看。
- 新增一个工具：在对应包 `tools/` 下 `defineTool`，在包的 `index.ts` 导出，在 `electron/main/composition.ts` 注册。**不需要**改提示词、超时表、审批表（都从定义推导）。
- 工具的 `risk` 取其中最危险的那个动作；动作风险不同就拆成多个工具。例如 `skill_manage`（新建 / 修改，`write`，可「总是允许」）与 `skill_delete`（`destructive`，每次都问）。

### 6.1 命令行（`@aiwc/shell`，2026-09-13）

Agent 有一个通用 `shell` 工具，让它能像 Cursor / Hermes 这类通用 Agent 一样直接用本机命令（各家 CLI、git、脚本）。注入防御放在框架里，而不是靠「不给命令行」：

- **不挂 `wechat-bot`**：远端联系人的消息永远驱动不了本机命令。提示词把聊天记录、文件、网页里的文字一律声明为数据。
- **逐条分级**（`classify.ts`）：按 `;`/`&&`/`|` 拆段，每段查词表——只读命令（ls / cat / git status / grep…）是 read；`git commit`、包管理器安装、写文件是 write；`rm -rf`、`chmod -R`、`sudo`、`defaults write`、把 `curl` 管给解释器、读到密钥路径再联网等是 destructive（永远不可「总是允许」）。`allowKey` 是「可执行文件 + 子命令」前缀（`shell:git commit`、`shell:lark-cli base`），「总是允许」只放行同一前缀。各包可以注册 `SegmentClassifier`（办公连接器注册了三家 CLI 的动词表）。
- **沙箱**（`sandbox.ts`）：macOS 用 `sandbox-exec` seatbelt——可读整机、可写 `<dataRoot>/workspace`、临时目录和各 CLI 状态目录、可联网，但**读不到** `secrets.bin`、镜像库、索引库、记录库。Linux / Windows 目前没有沙箱（`sandboxed: false` 会写进输出）。命令想跳出沙箱要带 `escalate: true` + `reason`，风险至少 write、不可「总是允许」，确认卡会标出「沙箱外运行」。
- **进程**：argv-only spawn（`/bin/zsh -lc` 登录 shell 的 PATH），进程组 kill，超时 1s–10min，输出截断，退出码与 hint（超时 / 沙箱拒绝 / 命令不存在）一起返回。
- 设置：`agent.shellSandbox: 'auto' | 'off'`。

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

## 8. 记忆与日记

- `MEMORY.md`（当下事实）、`USER.md`（我是谁）、`SOUL.md`（Agent 人格）、`AGENTS.md`（用户规则）——四个有界 Markdown，`§` 分隔条目，写入加锁 + 漂移检测；系统提示里用冻结快照并显示占用百分比。
- `forget` 必须带上条目原文，审批摘要展示这段原文；该序号处的文字已经变了（文件被改动或重排）时，存储层抛 `MemoryEntryMismatchError` 拒绝，工具把最新列表还给模型。
- 记忆包里的每次模型调用都有截止时间 `MODEL_CALL_TIMEOUT_MS`（5 分钟），与调用方的 `AbortSignal` 合并。
- 会变成路径的 id 先校验：联系人 id 经 `folderNameFor` 编码（`.`、`..` 也会编码）且断言落在关系档案目录内；记忆文件名只放行四个文件：清单是 `@aiwc/protocol` 的 `MEMORY_FILES`，IPC 入口先用 `isMemoryFile` 拒绝，存储层再用 `assertMemoryFile` 断言，渲染层的文案表按这份清单派生。跨进程文件锁在所有路径上关闭文件描述符。
- 关系档案（克隆）按联系人一个文件夹：`profile.json`（card + deep + stats）、`samples.jsonl`、`pairs.jsonl`、`notes.jsonl`、`corrections.jsonl`、`status.json`、`reflected.json`。
  - 构建：读消息 → 补转语音 → 轮次合并 → 分块 map-reduce（块按时间分散取，不只取最近）→ 私聊语料不足时用**群聊发言**补风格/深层画像（群聊回复错位，绝不产出问答对）。
  - 聊天：`persona` 线程换掉 stable 身份，`<persona>`（stable，人设）+ `<persona_notes>`（turn，去重，扮演纠正）+ `<persona_recall>`（turn，按当前这句检索 `pairs.jsonl` 的真实回复 + 基座里的真实聊天片段）。
  - 回路：试聊里的「不像 TA」和定期 `clone:reflect` 把用户的纠正写进 `notes.jsonl`，下一轮起强制遵守。
  - 编辑画像（`clone:updateProfile`）先经 zod 校验：顶层只允许 `card` / `deep` / `samples`，类型或长度不对整条拒绝；这三者内部的未知键丢弃，不写进 `profile.json`。只记录改动的键或样本，原文不截断；重新克隆时应用不上的纠正写警告日志。
  - 卡片的受众：用户自己的线程与克隆线程拿完整卡片；面向第三方的线程（机器人私聊、群）只拿 `<relationship_style audience="third_party">`，即语气与称呼，并附「私密信息不得透露」。
- 日记 = 调度作业：选材（FTS/统计而非关键词表）→ 按会话小结 → 日综合 → 写 `diaries/YYYY-MM-DD.md`（末尾 `## 记忆线索`）→ 回灌 MEMORY。失败时写降级版。同一日期的运行串行执行，拿到锁后重新检查已存条目，不同日期可以并行；`stop()` 中止进行中的运行，被取消的运行不写文件。
- 用户数据目录：`<userData>/aiwc/{config.json, secrets.bin, rollouts/, index.db, memory/, relationships/, diaries/, skills/, pets/, logs/}`。
- AI 宠物（Codex Pets 格式）：`pets/<id>/{pet.json, spritesheet.webp|png, meta.json}`；内置宠物随包放在 `resources/pets`，启动时复制进来。`electron/main/services/petService.ts` 负责图库（codex-pets.net）、下载、zip 导入与文件头校验；IPC 为 `pet:*`，状态语义见 DESIGN-SPEC「AI 宠物」。

## 9. 渲染层结构

- `src/kit/`：唯一的组件库（按钮 5 种、开关、输入、下拉、分段、chip、徽标、Toast、tooltip、右键菜单、popover、对话框 4 种、抽屉、空态 4 种、骨架、进度、头像、列表项、设置行、Tab、卡片）。页面**不得**自造这些。
- `src/shell/`：WindowChrome、四列布局、IconRail、ObjectList、AgentPanel（可收起）、快捷键；另有 Agent 窗口的布局帧 `AgentWindowFrame.tsx` + `agentWindowLayout.ts`（侧栏 | 对话 | 按需工作区栏，列宽持久化在 `ui.agentWindow*`）。壳层样式只挂 `shell-*` 类，不用 data-testid / aria-label 选择器（`shell.css.test.ts` 检查）。
- Agent 有两个界面、一套状态：`src/features/agent/useAgentSurface.ts` + `ThreadConversation.tsx` + `threadMenus.ts` 同时驱动右侧面板（`AgentPanel`）与整窗的 Agent 窗口（`window/AgentWindow`）。`ui.shellMode` 决定 `App` 挂载 `Shell` 还是 `AgentWindow`；切换只经 `shell.setMode` / `shell.toggleMode`（`src/app/shellMode.ts`）。Agent 窗口把普通的 `Workspace` 作为右侧工作区栏常驻挂载（隐藏时也挂着，`tab.*` 命令因此始终有处理者），`tabsStore.openSeq` 每次 `open()` 自增用于重新显示它。规则见 CLAUDE.md §12。
- 错误边界：`@/kit` 的 `ErrorBoundary`（错误态 +「重试」重新挂载子树）包住每个 Tab 宿主、对象列表主体（按 rail 功能加 key）与 Agent 面板；`main.tsx` 在 `<App/>` 外再包一层兜底。
- 会话列表加载失败按 `substrate:status.connection` 分类（`sessionListModel.ts` 的 `listFailureView`），不看错误文字。
- 基于 `substrate:listSessions` 的列表一律分页并在服务端搜索（会话列表、自动回复规则列表、复制规则弹窗）；按 id 已知的对象（规则、克隆）用 `substrate:getSession` 单独补齐，不会被分页藏掉。
- 导出「当前筛选」时请求带上发送者筛选 `senderIds`；主进程先用 zod 校验请求（非法即拒绝，不当作「无筛选」），再在 `services/exporter.ts` 的 `collectSessionExportMessages` 逐条过滤一次，不依赖基座是否执行了筛选。
- `src/workspace/`：Tab 容器 + `tabRegistry`；每类 Tab 是一个 `TabRenderer`，页面在 `src/features/*` 里注册。
- `src/platform/`：`bridge.ts`（取 `window.aiwc`，缺失时报连接错误，从不回退到模拟数据）、`hooks.ts`（`invoke` / `useInvoke` / `useBridgeEvent`）。
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
  3. **重启捕获兜底** `electron/main/wechat/relaunchCapture.ts` —— 关闭并重启微信后对新登录进程重试 1+2（仅在前两步都失败时触发）。
  - 关键点：helper 的第二个参数必须是具体的 `session.db` 文件（读取 SQLCipher salt 校验），不是 `db_storage` 目录。
  - 微信 4.1.13 **不经 CommonCrypto `CCKeyDerivationPBKDF`** 派生 WCDB 密钥，旧的 LLDB 断点在该版本上不触发，故以内存/转储扫描为主。
- **图片密钥**：`imageKeys.ts` 从 kvcomm 缓存码 + wxid 纯推导（XOR + AES），无需特权，已实测成功。
- **打包签名**：`resources/macos/entitlements.mac.plist` 含 debugger 权限；`scripts/afterPack.cjs` 在打包时对 `wechat_memory_scan_helper` 用 `resources/macos/helper.entitlements.plist` 重新签名。
- **前置条件**：SIP 关闭 + 已安装 Xcode/命令行工具（仅重启捕获这条路用到 lldb）；用户需授权「开发者工具」TCC 才能走只读实时扫描，否则自动回退到崩溃转储/重启捕获/手动粘贴。

## 14. 办公平台连接器（飞书 / 钉钉 / 企业微信，2026-09-13）

**形态：确定性工具 + 内置技能 + 薄 UI，不是独立功能页。** 用户在 Agent 里说「把……整理成表格推到飞书」，Agent 用微信工具取数、按 `skills/office-table` 设计列、调用推送工具；连接、授权、结果都在对话里完成。设置 › 账号 › 办公平台只负责「看得见、可撤销」。

- **只经由官方 CLI**：`lark-cli`（`@larksuite/cli`）、`dws`（`dingtalk-workspace-cli`）、`wecom-cli`（`@wecom/cli`）。AIWC 不直接调各家 OpenAPI，也不保存任何平台凭证——凭证由 CLI 存在用户目录（`~/.lark-cli`、`~/.dws`、`~/.config/wecom`），和终端里用的是同一份。
- **包结构**（`packages/office`）：`cli/`（输出解析；进程与 PATH 探测在 `@aiwc/shell`）→ `platforms/{feishu,dingtalk,wecom}.ts`（各家命令与输出格式，唯一知道 CLI 细节的地方）→ `push/table.ts`（统一表格模型：列类型、取值归一、日期、选项）→ `service.ts`（会话、安装、状态缓存、推送记录）→ `tools/officeTools.ts`。
- **工具与风险**：`office_status`（read）、`office_connect`（write）、`office_push_table`（send，确认卡片展示表格预览）。表格以外的操作（发群消息、写文档、建日程）走通用 `shell` 工具直接调 CLI：办公包只贡献 `commandClassifier()`（三家 CLI 动词的风险与 `allowKey`，凭证管理 / 删除 / 常驻监听判为 destructive）和 `writableRoots()`（CLI 状态目录进沙箱白名单），没有单独的 office_cli。全部**不挂 `wechat-bot`**：远端联系人不能驱动「把本机聊天数据推到办公平台」。
- **授权流**（`office_connect` 一次调用跑完）：找 / 装 CLI → 飞书 `config init --new`（建应用）→ `auth login --no-wait --json` + `--device-code`；钉钉 `auth login --device --no-browser --recommend`；企业微信 `auth init --noninteractive --no-browser --output-qrcode`。CLI 打印的链接先校验 https + 平台域名，再由主进程 `shell.openExternal` 打开，并以 `office:session` 推给渲染层（步骤、链接、二维码、授权码、有效期）。工具**阻塞等待**用户在浏览器完成，不需要用户回来回复；取消 / 回合中断会杀掉整个进程组。
- **自动安装**：本机没有 CLI 时 `npm install --prefix <dataRoot>/office/cli`，并**把 HOME 指到沙箱**——钉钉的 postinstall 会把技能铺进 ~/.claude、~/.agents 等 20 多个 Agent 目录，AIWC 不能替用户改其他工具的配置；npm 仍使用用户自己的 `.npmrc` 与缓存。
- **推送**：飞书 `+base-create --fields` + `+record-batch-create --json @file`（每批 200，`--as user` 保证表归用户所有）；钉钉 `+base-bootstrap` → `field list` 取 fieldId → `record create --records-file`（每批 100）；企业微信 `smartsheet create` + `records add`（每批 200，单选/多选按文本写，851003 给出规模限制说明）。追加：`target.pushId`（`<dataRoot>/office/pushes.jsonl`，只记标题、链接和 id，不记行内容）或表格链接；缺的列自动补。
- **渲染层扩展点**：`src/features/agent/toolCards.ts` 让功能按工具名注册「调用行下方的卡片」「确认卡片的说明句」「确认卡片的主体」。办公平台用它显示实时授权卡、推送结果卡和表格预览；Agent 面板不认识任何具体功能。

## 15. 定时任务（2026-09-13）

**形态：保存一段提示词，按计划无人值守地跑一次 Agent。** 左栏第四个功能「定时任务」列出任务（名称、计划、状态、开关），工作区 Tab 是编辑器（任务 · 执行时间 · 授权 · 模型 · 最近运行），空态提供模板。Figma 184-354 的卡片网格改成了 AIWC 的「对象列表 + Tab」。

- **协议**：`packages/protocol/src/tasks.ts`——`TaskSchedule`（daily / weekly / interval / cron）、`ScheduledTask`、`TaskRun`（status、threadId、summary、`denied[]`、toolCalls）、`TaskTemplate`；IPC `task:*`，事件 `task:changed` / `task:run`。
- **调度**（`electron/main/services/taskScheduler.ts`）：每个启用的任务一个 croner job（间隔类用锚点 + 一次性定时器，锚点只在计划改变时重置）；`tasks.json` + `runs.jsonl` 存在 `<dataRoot>/tasks`。上一轮没跑完时到点的那次记为 `skipped`。
- **一次运行 = 一个新的 `cron` 线程**：`kernel.ensureThread({ channel: 'cron' }, { profile: 'cron', permissionMode: task.permissionMode, model })` + `kernel.runOnce`。提示词由 `prompts/tasks.ts` 包一层「无人值守：不要提问、被拒绝就跳过并汇报、结尾写总结」。`cron` 通道永不弹确认：任务的**权限模式**决定放行范围（Ask = 只读 + 记忆；Bypass = 加本机写入，默认；Autopilot = 加对外发送），矩阵会「问」的一律拒绝。被拒绝的调用连同 `risk` 收进 `TaskRun.denied`，编辑器里一键「改为 Bypass / Autopilot 并重跑」（`permissionModeFor`）；destructive 永远不会无人值守执行。模板自带所需模式（推飞书的模板是 Autopilot），用模板建的任务不会卡在没人回答的确认上。
- **结果**：完成 / 失败推 Toast（动作 = 打开任务 Tab）；运行记录里能「打开对话」把那条 cron 线程调进 Agent 面板（列表只列 desktop 线程，所以定时运行不会刷屏）。
- 渲染层：`src/features/tasks`（`taskStore` 订阅两条事件；`scheduleModel` 纯函数）；rail 增加 `tasks`、快捷键 ⌘4、Tab kind `task`、命令 `tab.openTask` / `agent.openThread` / `agent.expand`；`ObjectListRegistration.workspaceEmpty` 让功能自带工作区空态。

