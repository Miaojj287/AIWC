# AGENTS.md — AIWC 开发准则

> 给**开发本仓库**的所有编码 Agent 与贡献者：动手前读完本文件。它和应用运行时用户数据目录里的 `AGENTS.md`（用户给应用内 Agent 定的规则）无关。
> Claude Code 通过 `CLAUDE.md` 顶部的 `@AGENTS.md` 自动加载本文件；Codex、Cursor 等工具直接读取本文件。

## 0. 文档地图（冲突时按此顺序）

| 管什么 | 以哪份为准 |
|---|---|
| 安全与隐私红线 | 本文件 §6 |
| 工程规范：分层、代码、测试、协作 | 本文件 |
| 界面：视觉、组件、交互、多语言文案 | [`CLAUDE.md`](CLAUDE.md) §1–§11 |
| 行为规格与尺寸 | [`DESIGN-SPEC.md`](DESIGN-SPEC.md) |
| 进程模型、内核循环、上下文与工具规则 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 各包公开 API | `packages/<pkg>/src/index.ts`：导出即契约（`docs/PACKAGE-API.md` 是构建期计划，仅供参考） |

文档与代码不一致时，先确认哪边是对的，再在同一个改动里把另一边改过来。

## 1. 工作流程

### 1.1 开工前

1. `git status` 看清工作区。**这个仓库经常有多个 Agent 同时在同一个工作区里改代码**：只动任务需要的文件；每次改一个文件前重新读它；不回滚、不格式化、不"顺手修"别人未提交的改动；全仓库范围的机械改动（格式化、批量删导出、重命名）只在没有其他会话时做。
2. 读 §3 里对应层的规则，以及 ARCHITECTURE 的对应章节。
3. 先找再写：用 `rg` 搜同名、同义的函数、组件和工具（§4）。已有实现不够用就扩展它，不要另写一份。

### 1.2 收工前（完成的定义）

- `npm run check` 全绿（格式 → 类型 → lint → 死代码 → 测试）。只格式化自己改过的文件：`npx prettier --write <文件…>`；Prettier 不处理 Markdown 与 CSS（CSS 被样式测试按文本读取），这两类手工保持整洁。做不到全绿时，逐条写明哪些失败与本次改动无关、出在哪个文件。
- 行为改动有测试；修 bug 先写一个能复现的失败测试。
- 同步文档：行为变化 → DESIGN-SPEC；分层、流程、规则变化 → ARCHITECTURE；新的工程约定 → 本文件；新增界面文案 → 两种语言（CLAUDE.md §11）。
- 不留下：`console.*`（§2.4 的例外除外）、注释掉的代码、`debugger`、`.only`、没有原因的 `TODO`、临时文件。

### 1.3 不要做

- 为了让测试通过去改断言，却没先证明断言本身错了。
- 用 `as any`、`as unknown as`、`@ts-ignore`、`eslint-disable` 压掉报错而不写原因。
- 与任务无关的大范围重命名、搬文件、重排格式或"顺便重构"。
- 把演示数据、真实聊天内容、wxid、密钥写进代码、测试快照或文档。
- 给还没有后端能力的功能先做可点击的入口：先禁用，并用 tooltip 说明原因。

## 2. 代码规范（所有层通用）

### 2.1 TypeScript

- `strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax` 保持开启。类型一律 `import type`。
- 禁止 `any`（lint 报错）。唯一例外是 koffi FFI 等无类型原生边界：把 `any` 圈在一个文件里，并在 `eslint-disable` 后写明原因。工具集合一律用 `@aiwc/protocol` 的 `AnyToolDefinition`，不要再写 `ToolDefinition<any, any>`。
- 类型断言只用在已经验证过的值上。外部输入先校验再使用：IPC 请求、配置与 JSON 文件、JSONL 行、SQLite 行、模型输出的 JSON、网络响应、子进程输出。schema 用 zod 写在 `@aiwc/protocol`，类型用 `z.infer` 推导，不手写第二份。
- 联合类型用 `switch` 穷尽处理（lint `switch-exhaustiveness-check`）。一组字面量写成 `as const` 数组并由它派生类型（参考 `INVOKE_CHANNELS`），同一组字符串不在两处各写一遍。
- 非空断言 `!` 只在紧挨着的检查已经证明非空时使用；优先 `?.`、提前返回或显式判断。

### 2.2 命名、文件、注释

- 文件名：React 组件 `PascalCase.tsx`，其余模块 `camelCase.ts`。测试与被测文件同名、放在旁边（`*.test.ts(x)`）。测试替身放同层的 `testing/` 目录，**不从生产入口导出**。
- 标识符用英文完整单词。布尔值 `is/has/can/should` 开头；回调 `onX`；工厂 `createX(deps)`；常量 `SCREAMING_SNAKE_CASE` 并带单位（`POLL_INTERVAL_MS`）。
- 超时、轮询间隔、上限、字节偏移、token 预算都写成具名常量，放在使用它的模块顶部。
- 代码注释用英文，只写"为什么"；每个公开导出写一行 TSDoc。仓库文档用中文。界面文案不写在代码里（CLAUDE.md §11）。
- 源文件只含可见字符：NUL 等控制字符用 Unicode 转义序列表示，不要原样粘贴进字符串。

### 2.3 模块大小与形态

- 一个模块只做一件事。文件超过 **400 行**就按职责拆分；**600 行**（不含空行和注释）是 lint 硬上限。函数超过约 80 行，或需要"第一步 / 第二步"式注释分段时，拆成具名函数。
- 已经偏大的文件只减不增，新逻辑放进新模块再接入：`electron/main/composition.ts`、`src/features/agent/agentStore.ts`、`packages/gateway/src/autoreply/autoReplyService.ts`、`src/features/settings/pages/AiPage.tsx`、`src/features/chat/ChatTab.tsx`、`packages/substrate/src/mirror/search.ts`。
- 服务统一写成 `createX(deps: XDeps): X`：依赖用对象注入（测试可替换），返回接口类型；持有资源的服务提供 `stop()` / `dispose()`。

### 2.4 错误、异步与资源

- 不吞错误。`catch` 只有三种写法：处理并降级（同时记日志）、包装后重抛（`new Error(message, { cause })`）、确实无害（写一行注释说明原因）。尽力而为的探测失败时，用注入的 logger 记 `debug`。
- 每个 Promise 要么 `await`，要么 `void promise.catch(handler)`（lint `no-floating-promises`）。用户操作触发的异步动作必须有可见反馈（Toast 或行内提示）；`.catch(() => undefined)` 只用于确实无害的场景。
- 外部调用必须有超时，长任务必须接受 `AbortSignal`：模型请求、网络、子进程、原生调用、跨进程 RPC。**超时就是失败**，不能当成"空结果"或"已发送"返回。
- 远端错误按结构化字段判断（HTTP 状态、`ret`、`errcode`、错误码），不做子串匹配。
- 定时器、监听、子进程、数据库句柄、文件描述符、文件监听：谁创建谁释放。`openSync` 必有对应的 `closeSync`（放在 `finally`）；订阅函数返回退订函数；`shutdown()` 按创建的逆序释放。
- 并发保护在锁内重新检查状态（`KeyedMutex` 等），不要"等上一个跑完再直接开始"。
- 日志：包里**不直接用 `console`**（lint 报错），用注入的 `logger(level, message, meta)`；主进程用 `electron/main/log.ts` 的 `logger.child(scope)`。允许用 console 的只有日志落盘器、`dev/`、测试和浏览器 mock。
- 日志、错误信息、事件载荷里不得出现密钥、Token 或完整聊天正文。
- 给用户看的错误是一句能照做的话（去改 Key / 重试 / 重新连接），不带堆栈；写进日志的错误带上 scope 和上下文。

### 2.5 控制流不看展示文本

- 不根据界面文字、翻译后的文案、错误信息或标题做判断：不写 `message.includes('尚未连接')`，不用 `[aria-label='…']` 选择器写样式，不用正则从 Tab 标题里抠名字。需要分支就传错误码、枚举或 id。

### 2.6 依赖

- 新增依赖要说明：为什么现有依赖做不到、体积、许可证（须与 MIT 兼容）、是否仍在维护。
- 原生依赖（koffi、`.node` 模块、`resources/native` 里的可执行文件）只能**懒加载**，并且只在 substrate 的 utility process 或 gateway 的注入器里加载；导入模块本身不得触发加载。
- 版本范围用 `^`；`prettier` 精确锁定，因为它的小版本会改变格式。改依赖时同时提交 `package-lock.json`。

## 3. 分层规则

依赖方向由 `eslint-plugin-boundaries` 强制，违反即架构错误：

| 层 | 路径 | 可以依赖 |
|---|---|---|
| 契约 | `packages/protocol` | 无 |
| 内核 / 数据基座 / 通道 / 记忆 / 多语言 | `packages/{kernel,substrate,gateway,memory,i18n}` | `@aiwc/protocol` |
| 组合根 | `electron/` | 全部 |
| 渲染层 | `src/` | `@aiwc/protocol`、`@aiwc/i18n` |
| 开发工具 | `dev/` | 全部（生产代码不得依赖 `dev/`） |

- 跨包只从入口导入（`@aiwc/<pkg>`），不得深引 `@aiwc/<pkg>/…`（lint 报错）。入口只导出真正被其他层使用的符号；`npm run knip` 报出的无人使用的导出直接删掉，不留"以后可能用"。
- 新增一个包：同步 `tsconfig.base.json` 的 paths、`vite.config.ts` 与 `vitest.config.ts` 的 alias、`eslint.config.js` 的 boundaries 元素与规则、`knip.json`（若有新入口）、ARCHITECTURE §2 与上表。

### 3.1 `packages/protocol`（契约）

- 只放类型、zod schema、常量和**无副作用的纯函数**。不得 import `node:*`、DOM 或第三方运行时（zod 除外）。
- 一个契约枚举只定义一次：`XSchema` → `z.infer` 得类型 → `.options` 得列表。安全判定（是否机器人上下文、是否群聊 id、记忆文件名单）也只在这里定义一次，判定不了时拒绝。
- 改 protocol 就是改所有层的契约：同一个改动里更新所有实现、mock 和测试。
- 新增 IPC 通道：`InvokeMap` / `EventMap` → `INVOKE_CHANNELS` / `EVENT_CHANNELS`（有编译期完整性检查）→ `electron/main/ipc/<域>.ts` 的 handler（含入参校验）→ 渲染层调用 → 测试。

### 3.2 `packages/kernel`（Agent 内核）

- ARCHITECTURE §4–§6 是硬规则：历史只追加；所有注入都是带 `kind` / `marker` / `tokenCap` 的 `ContextFragment`（用 `createFragment` / `truncateToTokens`，不要自己截断）；工具输出在记录时截断。
- 工具只通过 `defineTool` 定义。`risk` 取工具里**最危险的那个动作**；动作风险不同就拆成多个工具（例如 `skill_manage` 与 `skill_delete`）。审批、挂载面和超时从定义字段推导，不按工具名或前缀匹配，也不把工具名写进提示词。
- 内部模型调用（标题、压缩、反思）使用与线程同样本地 / 在线属性的模型，不得悄悄回退到云端默认模型。
- 压缩和任何有上限的历史渲染：保留上一份摘要，按整行、从新到旧截取；用超过上限的输入写测试。
- 内核不知道微信、Electron 与界面；需要的能力经 `ports.ts` 注入。

### 3.3 `packages/substrate`（微信数据基座）

- **只读**：永远不写微信数据库和微信目录；只有自己的镜像库（`mirror`）可写。
- 只有一套归一化实现（消息类型、群聊判定、XML 与发送者前缀解析），`wcdb/` 与 `normalize/` 不得各写一份。不对明文列做 hex / base64 猜测，只在确认是 zstd 帧时解压。
- 只有一个只读 SQL 守卫（`shared/sqlGuard.ts`），在门面层校验一次；工具说明里宣称支持的语句必须真的能通过守卫。拼接标识符用 `quoteIdent`，值一律参数化。
- 原生访问（WCDB、密钥扫描、图片解密）只在 utility process（`electron/hosts/substrateHost.ts`）里运行，调用方经 RPC；每个 RPC 方法和子进程都有超时；扫描保持只读，需要授权时返回 `needsAuthorization`，不自行提权。
- 由微信数据拼出的路径片段要拒绝 `.` 与 `..`，输出只落在 `cacheDir` 内。缓存挂在 reader / mirror 实例上并在 `close()` 时清理，不用跨账号存活的模块级全局变量。
- 读取与微信版本相关的结构（表名、XML 字段、偏移）时注明适配的版本与出处。

### 3.4 `packages/gateway`（通道与自动回复）

- `ReplyGate` 保持确定性，只判断界面上看得见、用户能撤销的条件（ARCHITECTURE §7）。
- 发送类工具在 `wechat-*` 通道只能发回来源会话（`withOriginGuard`）；目标会话从来源重建，不信任调用方传来的名称。
- UI 键盘注入：每次按键前确认前台是微信（所有平台）；按名称搜索会话前确认名称唯一；发送后用数据库读回验证，失败即熔断，只能由用户恢复。
- 入站的微信文本是第三方数据：进入提示词时放进有上限的片段，并中和其中的标签字符（参考 `formatObservedLine`），不能当成指令。
- 所有出站都写审计记录。

### 3.5 `packages/memory`（记忆、克隆、日记）

- 四个 Markdown 记忆文件有字数上限；写入走 store（加锁 + 漂移检测），不绕过 store 直接写文件。
- 会变成路径片段的 id（联系人 id、记忆文件名、日期）一律视为不可信：校验，并断言解析后的路径仍在 store 根目录内（参考 `folderNameFor`、`assertMemoryFile`）。
- JSONL 追加写；读取时跳过并记录坏行，不因一行损坏丢掉整个文件。
- 调用模型的流程（克隆、日记）必须可取消、有超时，失败时写降级结果和原因。
- 由第三方聊天内容提炼出的事实，没有来源标注和用户确认，不得写进主人的记忆文件。

### 3.6 `electron/`（组合根与主进程）

- `composition.ts` 只做接线：创建、注入、转发事件。业务判断（能不能发、要不要熔断、配置变化检测）写成 `services/` 里有测试的函数，再注入。
- IPC handler 保持薄：**校验入参 → 调服务 → 返回**。渲染层输入视为不可信：写文件、删除、揭示密钥、打开路径或 URL、发送消息、执行密钥获取的通道必须在运行时校验（zod 或封闭集合判断），参考 `ipc/agentOpGuard.ts`。永远不用渲染层传来的字符串直接拼文件系统路径。
- 安全基线不得放松：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；拦截导航与新窗口；文件访问经 `security/pathAllowList.ts`；外链只经 `app:openUrl` 的协议白名单。
- 主进程不写死主题色，颜色从 `@aiwc/protocol` 的调色板取。抛给渲染层的错误文案用 `electron/main/i18n.ts` 的 `t()`。
- 打包目标与原生产物保持一致：`build.mac` / `build.win` 里的每个架构，都要有对应的 `resources/native/<platform>-<arch>` 二进制，并在 `scripts/afterPack.cjs` 里签名。

### 3.7 `src/`（渲染层）

- 分层从低到高：`kit`（唯一组件库）→ `platform`（IPC、格式化、跨功能共享逻辑）→ `workspace`（Tab 容器）→ `shell`（四列壳）→ `features/*`（页面）→ `app`（注册与命令）。只依赖同层或更低层。
- **feature 之间不互相 import**。需要协作时走 `workspace/tabRegistry`、`shell/objectListRegistry`、`app/commands`；多个 feature 共用的逻辑下沉到 `src/platform`（非 UI）或 `src/kit`（UI）。每个命令只有一个处理者。
- 现存的违规等待迁移，**不得新增**：`src/app/commands.ts` 与 `shortcuts.ts` 是全局命令总线，被各层引用，按 platform 层对待；`src/shell/AgentColumn.tsx` 直接挂载 agent 与 pets；feature 互相引用的有 agent→settings、agent→pets、settings→pets、settings→office、office→agent、autoreply↔replydesk、diary→file→agent。
- 数据只经 `@/platform`（`invoke`、`useInvoke`、`useBridgeEvent`）；组件里不直接碰 `window.aiwc`。同一个远端资源（例如 `substrate:status`）只由一个 store 订阅。
- 组件只从 `@/kit` 入口导入；kit 缺能力就给 kit 加导出或参数（并补进 Kit 画廊），不深引 `@/kit/...` 内部文件（ESLint `no-restricted-imports` 强制，`src/kit` 自身除外），不在页面里自造按钮、菜单、弹窗（CLAUDE.md §3）。
- 状态：zustand 按领域一个 store；组件用 selector 订阅所需字段；能算出来的不存。渲染函数和 `setState` 的更新函数保持纯净：不发 IPC、不写 ref、不改 store。
- Effect 只用来同步外部系统（订阅、定时器、IPC）并清理；"props 变了就重置 state"用 `key` 重新挂载，不用 effect 抄 props。effect 里要读最新值、但这个值不该触发 effect 时，用 `useEffectEvent`（React 19.2）。`react-hooks/exhaustive-deps` 报错不得直接关闭；唯一常见的例外是在 cleanup 里自增计数型 ref，就地写明原因。
- 每个 Tab、对象列表主体和 Agent 面板都包在错误边界里，单个页面出错不能让整个窗口空白。
- Agent 有两个界面——右侧面板与整窗的 Agent 窗口（CLAUDE.md §12）——但只有一套状态与动作：`src/features/agent/useAgentSurface.ts`（状态、订阅、动作、弹窗）+ `ThreadConversation.tsx`（消息流、输入框、工具栏、宠物）+ `threadMenus.ts`（会话菜单）。任何 Agent 功能改动都改这三处，不得只在 `AgentPanel.tsx` 或 `window/` 之一实现；`AgentPanel.test.tsx` 与 `window/AgentWindow.test.tsx` 必须同时通过。布局切换只经 `shell.setMode` / `shell.toggleMode`（`src/app/shellMode.ts`），布局帧与 `shell-agent-*` 类在 `src/shell/AgentWindowFrame.tsx`。
- 样式只用 token 映射出的类（CLAUDE.md §2、`src/kit/README.md`）；禁止 hex、`text-[Npx]`、`leading-[Npx]`、`bg-[#…]`、内联颜色。固定颜色表面（头像色块、「我」的气泡、危险按钮）上的文字用固定白色，不用随强调色变化的 token。
- 每个列表或区域都有空态、加载、错误、无结果四态（kit `EmptyState`）；可能超过约 200 行的列表从后端分页（尊重 `hasMore`）并虚拟化。
- 同一个破坏性或数据外发动作的每个入口（按钮、菜单、右键、快捷键）使用同一个确认或说明。

### 3.8 界面文案与多语言

见文末「多语言硬规则」与 CLAUDE.md §11。

## 4. 先复用：常见需求用哪个

| 需求 | 用这个 |
|---|---|
| 构造上下文片段、按 token 截断 | `@aiwc/protocol`：`createFragment`、`truncateToTokens` |
| 渲染层调用主进程 | `src/platform/hooks.ts`：`invoke`、`useInvoke`、`useBridgeEvent` |
| 结果反馈 / 普通确认 / 危险确认 / 长任务 | `@/kit`：`toast`、`ConfirmDialog`、`DangerDialog`、`ProgressDialog` |
| 列表四态、`···` 与右键菜单 | `@/kit`：`EmptyState`、`MenuSpec` + `DropdownMenu` / `ContextMenu` |
| 渲染层时间、数字、体积格式化 | `src/platform/format.ts` |
| 媒体文件转成可加载的 URL | `src/platform/mediaUrl.ts`：`toMediaUrl` |
| 主进程文件访问白名单 | `electron/main/security/pathAllowList.ts` |
| IPC 入参校验范例 | `electron/main/ipc/agentOpGuard.ts` |
| 只读 SQL 校验 | `packages/substrate/src/shared/sqlGuard.ts` |
| 原子写、文件锁、进程内互斥 | `packages/memory/src/internal/fsx.ts`（memory 包内部） |
| 界面文案 | `@/i18n` 的 `useT` / `t`；主进程 `electron/main/i18n.ts` |
| 工作台 ↔ Agent 窗口切换、Agent 会话动作菜单 | `runCommand('shell.setMode' / 'shell.toggleMode')`（`src/app/shellMode.ts`）；`src/features/agent/threadMenus.ts` |
| 测试替身 | 内核 `packages/kernel/src/runtime/testing/`；通道 `packages/gateway/src/testing/fakeAdapter.ts`；基座 `packages/substrate/src/tools/testing/fakeSubstrate.ts`；IPC `electron/main/ipc/testing/handlerHarness.ts` |

**已知的重复实现，合并前不要再加第三份。** 新代码直接写到目标位置，合并时一并迁移旧调用方：

| 重复的实现 | 目前位置 | 目标位置 |
|---|---|---|
| `sleep` | kernel `runtime/util/deferred.ts`、gateway `core/emitter.ts`、memory `internal/fsx.ts`、`electron/main/wechat/relaunchCapture.ts` | `@aiwc/protocol` 的 `util/` |
| `createEmitter` | kernel `runtime/emitter.ts`、gateway `core/emitter.ts` | `@aiwc/protocol` 的 `util/` |
| `errorMessage` | substrate `shared/errors.ts`、gateway `core/emitter.ts`、`src/features/settings/hooks.ts`、`src/features/agent/agentStore.ts` | 包与主进程用 `@aiwc/protocol` 的 `util/`；渲染层用 `src/platform` |
| `formatClock` | gateway `autoreply/template.ts`、memory `internal/time.ts`、`src/platform/format.ts` | `@aiwc/protocol` 的 `util/`（渲染层继续经 `src/platform/format.ts`） |
| `startOfDay` | `src/platform/format.ts`、`src/features/chat/filters.ts`、`src/features/autoreply/recordModel.ts` | `src/platform/format.ts` |
| `debounce` | `electron/main/windows/windowState.ts`、substrate `shared/async.ts` | `@aiwc/protocol` 的 `util/` |
| 路径包含判断 `isWithinRoot(s)` | `electron/main/security/pathAllowList.ts`、gateway `core/mediaPolicy.ts` | 一处共享实现，两边导入 |
| 自动回复规则校验 `validateRule` | `electron/main/services/autoReplyRules.ts`、`src/features/autoreply/ruleModel.ts` | `@aiwc/protocol`（主进程强制，渲染层做行内提示） |
| 机器人上下文判定（依据不一致：有的看 `profile`，有的看 `channel` / `origin`） | substrate `tools/botScope.ts`、gateway `tools/gatewayTools.ts`、memory `tools/relationshipTools.ts` | `@aiwc/protocol` 里的一个函数 |
| 群聊 id 判定（gateway 两处只认 `@chatroom`，漏掉 `@im.chatroom`） | substrate `normalize/kinds.ts`、gateway `core/originGuard.ts`、gateway `adapters/ilink/adapter.ts` | `@aiwc/protocol` |
| 导出格式清单 | `@aiwc/protocol` 的 `ipc.ts`、`electron/main/services/exporter.ts`、`src/features/chat/ExportDialog.tsx` | protocol 里一个 `as const` 列表 |
| 会话分页加载 | `src/shell/objectList/SessionList.tsx`、`src/features/autoreply/sessionPaging.ts` | `src/platform` 里的一个 hook |
| `autoreply:status` 的读取与缓存（一份资源两个 store） | `src/features/replydesk/store.ts`、`src/features/autoreply/AutoReplyControl.tsx` | `src/platform/replyDesk.ts`，两个功能都从它读 |
| 日记线索拆分 `splitCues`（两份语义不同） | memory `diary/diaryStore.ts`、`src/features/diary/diaryModel.ts` | 主进程返回已拆好的正文与线索，删掉渲染层副本 |
| Markdown 渲染 | `src/features/agent/markdownParser.ts`、`src/features/file/markdown/` | `src/kit` 里的一个 Markdown 模块 |
| 密钥获取与账号激活界面逻辑 | `src/features/settings/`、`src/features/onboarding/` | `src/platform/wechatKeys.ts` 与 `src/platform/account.ts` |
| 媒体 URL 编码 | `electron/main/security/pathAllowList.ts`、`src/platform/mediaUrl.ts`、`src/shell/objectList/sessionListModel.ts` | 一个编码器，主进程与渲染层共用 |

同名但语义不同、不要合并的：kernel 与 memory 的 `truncateChars`（返回值不同）、`renderTranscript`（输入不同）。改动其中之一时顺手改名，避免误用。

## 5. 测试

- 框架 vitest：`node` 项目跑 `packages/**`、`electron/**`、`dev/**`；`jsdom` 项目跑 `src/**`。测试与源码一样要通过 typecheck 与 lint。
- 测行为，不测实现：组件测试用 role、label、文本查询；不断言 Tailwind 类名（样式约束写成 lint 规则）。
- 不依赖真实时间和随机数：注入 `clock` / `now` / `random`，或用 `vi.useFakeTimers()`；不要用 `sleep` 等异步结果，等事件或手动 flush。
- 安全相关的测试使用真实实现（真实 `ApprovalGate`、真实路径白名单），不用永远放行的替身。
- 需要真实微信数据的测试命名为 `*.realdb.test.ts`，没有数据时必须跳过；不得把真实数据写进仓库。
- 必须有测试的东西：审批矩阵、loop guard、步数上限、片段截断、rollout 续跑、压缩；`ReplyGate`、origin guard、熔断；sqlGuard、密钥校验、解密、消息解码；IPC 入参校验、路径白名单；各 feature 的 `*Model.ts`、reducer、store。

## 6. 安全与隐私红线

- 微信数据只在本机处理；只有用户配置的模型服务商会收到内容，并且界面要说明数据去向（CLAUDE.md §6）。线程选的是本地模型，就不得有任何内容发往在线模型。
- 密钥只存 `secretStore`（系统 safeStorage 加密），配置文件里只存引用；日志、错误、事件、崩溃报告里不得出现明文。
- 访问微信进程只由用户显式发起：内存与崩溃转储扫描保持只读；需要调试器权限的登录时截获（`wechat_xkey_helper`）必须在界面上说明前提与影响，不得自动触发。
- 删除、覆盖、清空、撤回、对外发送必须二次确认；Agent 工具里这类动作的 `risk` 必须是 `destructive` 或 `send`。
- `resources/native` 中的每个二进制都要在 `resources/native/README.md` 写明用途、加载位置、来源、构建方式与哈希；来源不明的二进制不得加入仓库；不再使用的 entitlements 和二进制立即删除。

## 7. Git 与协作

- 分支：`feat/…`、`fix/…`、`refactor/…`、`docs/…`、`chore/…`。
- 提交信息用 Conventional Commits：`<type>(<scope>): <祈使句>`，scope 取包名或 feature 名，例如 `fix(gateway): treat send timeout as failure`。一个提交只做一件事；格式化、重命名等机械改动单独提交。不写 `<FE develop>` 这类没有信息的提交信息。
- 不提交：`.env*`、密钥、真实聊天数据、日志、`.tmp/`、`Example/`、构建产物。
- PR 描述写清楚做了什么、为什么、怎么验证（命令与截图），以及对 ARCHITECTURE / DESIGN-SPEC / CLAUDE.md 的影响。

## 8. 常用命令

```bash
npm run dev                    # Electron + Vite
npm run check                  # 提交前全套：格式 · 类型 · lint · 死代码 · 测试
npx prettier --write <文件…>   # 只格式化自己改过的文件
npm run lint:fix               # ESLint 自动修复
npm run knip                   # 未使用的文件 / 导出 / 依赖
npx vitest run <路径>          # 只跑相关测试
```

## 多语言硬规则（摘自 CLAUDE.md §11，完整版以那里为准）

界面同时支持 **简体中文（zh-CN）** 和 **English（en-US）**。

1. **任何可见文案都成对提交。** 按钮、标题、说明、`aria-label`、`title`、`placeholder`、tooltip、Toast、报错、确认弹窗、空态、菜单、主进程抛给界面的错误、导出文件标题——在同一个改动里同时写进 `packages/i18n/src/locales/zh-CN/…` 与 `packages/i18n/src/locales/en-US/…` 的同一个键。改中文就同步改英文，删功能就两边一起删。
2. **代码里不写死文案。** 组件用 `const t = useT()`（`@/i18n`）；非组件用 `import { t } from '@/i18n'` 并在用到时调用（不要放进模块顶层常量）；主进程用 `electron/main/i18n.ts` 的 `t`。句子里夹元素用 `<Trans>`，不要拆句拼接。
3. **zh-CN 是参考目录**，en-US 按 `Messages[...]` 类型标注：缺键 / 多键编译失败；两种语言的 `{占位符}` 必须一致（`packages/i18n/src/parity.test.ts`）。英文复数用 ICU `{n, plural, one {…} other {…}}`。
4. **不翻译**：模型提示词与工具 description、日志、微信数据本身、测试 / mock 数据。业务包（`packages/kernel|substrate|gateway|memory|protocol`）不依赖 i18n：新写的用户可见结果返回稳定代码；包里已有的中文系统消息登记在 `known` 命名空间（zh-CN 值 = 包里原文），由主进程在 IPC / 推送边界（`electron/main/localizePayloads.ts`）翻译——改了包里的这类句子要同步改 `known`（`packages/i18n/src/known.test.ts` 会报过期条目）。
5. **收尾必须全绿**：`npm run typecheck`、`npx vitest run packages/i18n`、`npx eslint src electron`（规则 `aiwc/no-hardcoded-cjk` 拦截硬编码中文），并在「设置 › 常规 › 语言」切到 English 检查改过的界面没有中文残留、没有截断变形。
