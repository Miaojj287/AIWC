# AIWC 项目架构与功能全解

> 生成日期：2026-08-28 · 基于仓库 `Miaojj287/AIWC`（main @ `d069808`）逐目录盘点
> 上游血缘：fork 自 `Miaojj287/AIWC` v2026.814.1（基线 `613dfef`），含 4 个自有提交与一批未提交工作区改动

---

## 目录

1. [项目定位与血缘](#1-项目定位与血缘)
2. [顶层技术栈](#2-顶层技术栈)
3. [代码规模总览](#3-代码规模总览)
4. [进程模型（多进程架构）](#4-进程模型多进程架构)
5. [渲染层架构（src/）](#5-渲染层架构src)
6. [主进程服务层（electron/services/）](#6-主进程服务层electronservices)
7. [原生层（native/）](#7-原生层native)
8. [密钥与解密端到端数据流](#8-密钥与解密端到端数据流)
9. [AIWC-CLI（aiwc 命令行）](#9-aiwc-cliaiwc-命令行)
10. [插件系统与 MCP](#10-插件系统与-mcp)
11. [AI 能力全景](#11-ai-能力全景)
12. [构建、打包与发布](#12-构建打包与发布)
13. [测试与评估体系](#13-测试与评估体系)
14. [与上游 AIWC 的差异（AIWC 增量）](#14-与上游-aiwc-的差异aiwc-增量)
15. [安全与合规边界](#15-安全与合规边界)
16. [附录：目录树速查](#16-附录目录树速查)

---

## 1. 项目定位与血缘

| 项 | 内容 |
| --- | --- |
| 产品名 | AIWC（fork 名 AIWC） |
| 一句话定位 | 现代化的微信聊天记录查看与分析工具（桌面端 + CLI + 手机遥控端） |
| 上游仓库 | `Miaojj287/AIWC`（git remote: `upstream`） |
| 本仓库 | `Miaojj287/AIWC`（git remote: `origin`） |
| fork 基线 | `613dfef` chore(release): v2026.814.1（2026-08-21） |
| 自有提交 | `d7ab3ff` 原生数据库与内存密钥支持、`2eb0841` 瞬时密钥捕获、`a0f9b52` 账号验证状态保持、`d069808` Windows 源码数据库后端 |
| 当前版本 | 2026.814.1（package.json），上游已至 v2026.827.0（48 个提交未同步） |
| 许可证 | CC BY-NC-SA 4.0（禁止商用；准确说是 source-available，非 OSI 开源） |
| 支持平台 | macOS arm64（AIWC 主力实测平台）、Windows 10/11（源码/脚本就绪，待实测） |
| 应用 ID | `com.aiwc.app` |

**开发者愿景**（上游 README，AIWC 继承）：① 为思念留下数字资产（聊天记录/语音/照片的留存）；② 为不公保留证据（把零散对话整理成可追溯的事实链）；③ 让聊天记录真正回到用户手中。

**AIWC 的分支使命**：把上游闭源二进制原生核心（数据库桥、取钥 hook、图片解密）全部替换为**有源码、可审计、可重复构建、纯读不注入**的开放实现（详见 §7、§14，审计报告见 `docs/native-core-audit.md`）。

---

## 2. 顶层技术栈

### 桌面壳与渲染

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 39（`electron/` 主进程 + `preload.ts`） |
| UI 框架 | React 19 + TypeScript 5.6 strict |
| 构建 | Vite 6（`vite-plugin-electron` / `vite-plugin-electron-renderer`）+ `tsc` 先行类型检查 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`）、Sass、CSS Modules |
| 组件库 | HeroUI React v3（项目内文档索引 `./.heroui-docs/react`，改动前必查）、Radix UI、antd 6（dev）、@lobehub/ui（dev） |
| 状态 | zustand 5（10 个 store） |
| 路由 | react-router-dom 7（`src/App.tsx`，约 41KB 单文件路由壳） |
| 动画 | GSAP、framer-motion / motion、Lottie（`@lottiefiles/dotlottie-react`） |
| 图表 | ECharts 6 |
| 虚拟列表 | react-window、virtua、`use-stick-to-bottom` |
| Markdown/代码 | streamdown + `@streamdown/{cjk,code,math,mermaid}`、shiki 语法高亮、marked |
| 富文本 | ansi-to-react（终端输出渲染） |

### 数据与 AI

| 类 | 依赖 |
| --- | --- |
| AI SDK | `ai` v7（ToolLoopAgent / streamText / generateText）+ `@ai-sdk/{openai,anthropic,google,openai-compatible,react,otel}` |
| 向量/检索 | 内嵌 embedding/rerank 服务（`ai/embeddingService.ts`、`ai/rerankService.ts`） |
| MCP | `@modelcontextprotocol/sdk` 1.27 |
| 语音 | `sherpa-onnx-node`（本地 Whisper 转写）、`silk-wasm`（微信语音解码）、`ffmpeg-static`（音视频） |
| 数据库 | `better-sqlite3`（纯 TS 解密后端）、WCDB 官方源码构建桥（koffi FFI） |
| 原生 FFI | `koffi` 2.9（Mach VM API、Windows Process API、WCDB C Bridge） |
| 图片 | `sharp`、Rust N-API 解密模块 |
| 其他 | zod 4、exceljs、jszip/adm-zip、qrcode、fzstd、undici、https-proxy-agent、OpenTelemetry（AI 调用遥测）、electron-store、electron-updater、es-toolkit |

---

## 3. 代码规模总览

| 区域 | 行数 | 说明 |
| --- | --- | --- |
| `src/`（渲染层） | ~68,000 | 40+ 页面、34 个组件目录、10 个 store |
| `electron/`（主进程） | ~93,000 | 35 个 IPC handler 模块、80+ 服务、7 个工具进程入口 |
| `AIWC-CLI/` | ~5,000 | 11 个命令的独立 CLI 子项目 |
| `native/` | ~670 | `main.c` 498 行（C）+ `lib.rs` 174 行（Rust），另有构建脚本 |

---

## 4. 进程模型（多进程架构）

```
┌────────────────────────────────────────────────────────────────────┐
│ Main (electron/main.ts + electron/main/*)                          │
│  · BrowserWindow/Tray/自动更新/GPU 策略/授权检查/启动诊断            │
│  · 全局单例服务: DatabaseService/ConfigService/LogService           │
│  · 模块化 IPC 注册 (electron/main/ipc/register.ts)                 │
│  · 协议: 本地文件协议 + plugin:// 协议 + 插件导航守卫               │
├────────────────────────────────────────────────────────────────────┤
│ Renderer (src/main.tsx → App.tsx, react-router)                    │
│  · 通过 preload 暴露的 window.electronAPI 与主进程通信              │
├────────────────────────────────────────────────────────────────────┤
│ Preload (electron/preload.ts, 1063 行)                             │
│  · contextBridge 暴露 electronAPI；约 40 条事件通道转发             │
├────────────────────────────────────────────────────────────────────┤
│ Utility Process × 4 (Electron UtilityProcess, 隔离崩溃)            │
│  · wcdbUtilityProcess    — 数据库连接与查询（OpenWcdbBridge）       │
│  · aiAgentUtilityProcess — AI Agent 引擎（ReAct 循环）              │
│  · aiExportUtilityProcess— AI 导出任务                              │
│  · exportUtilityProcess  — Excel/HTML 导出任务                      │
├────────────────────────────────────────────────────────────────────┤
│ Worker × 2 (worker_threads)                                        │
│  · transcribeWorker      — 语音转写（本地 Whisper）                 │
│  · imageDecryptWorker    — 图片 DAT 批量解密（Rust N-API）          │
├────────────────────────────────────────────────────────────────────┤
│ 外部进程                                                           │
│  · electron/mcp.ts       — MCP stdio 服务进程（aiwc-mcp）     │
│  · wechat_memory_scan_helper — macOS 内存扫描 C 程序（fork 新增）   │
└────────────────────────────────────────────────────────────────────┘
```

**开发模式**：`npm run dev` → 先清 `dist-electron/` 再起 Vite（端口 5321，被占用自动向后顺延 100 个端口尝试）。

### IPC 面（`electron/main/ipc/`，35 个模块）

`accountHandlers` · `activationHandlers` · `agentCanvasHandlers` · `agentWorkspaceHandlers` · `aiHandlers` · `appHandlers` · `appUpdateHandlers` · `authHandlers` · `cacheHandlers` · `chatHandlers` · `codexSubscriptionHandlers` · `configHandlers` · `dataHandlers` · `dataManagementHandlers` · `dbPathHandlers` · `deviceConnectHandlers` · `exportHandlers` · `localCodingAgentHandlers` · `logHandlers` · `mcpHandlers` · `mediaHandlers` · `notifyHandlers` · `petHandlers` · `pluginHandlers` · `relayOneHandlers` · `skillHandlers` · `snsHandlers` · `sttHandlers` · `systemHandlers` · `voiceRealtimeHandlers` · `wcdbHandlers` · `windowHandlers` · `wxKeyHandlers`，由 `register.ts` 统一装配。

### preload 事件通道（主→渲染推送）

`wxkey:status` · `wcdb:{decryptProgress,change}` · `stt:{partialResult,downloadProgress}` · `stt-whisper:{gpu-download-progress,download-progress}` · `tts:streamEvent` · `voice-realtime:event` · `video:downloadProgress` · `imageKey:progress` · `image:{updateAvailable,cacheResolved}` · `imageViewer:setImageList` · `reply-tile:{update,skip,retry,enabledChanged,continue,auto-status}` · `plugin:{event,changed}` · `persona:{progress,chunk,buildProgress}` · `pet:{windowMove,notify,contextMenuOpened,bubbleFrame,bubble,agentState,agentProgress}` · `relayOne:{statusChanged,providerApplied}` · `localCodingAgent:event` · `moments:filterUser` · `splash:fadeOut` · `window:navigate` 等。

---

## 5. 渲染层架构（src/）

### 5.1 页面（`src/pages/`，40+）

| 分类 | 页面 |
| --- | --- |
| 入口/引导 | `WelcomePage`（新用户引导：密钥获取→图片密钥→安全防护→连接数据库 5 步）、`SplashPage`、`AgreementPage` |
| 聊天 | `ChatPage`（聊天主界面）、`ChatHistoryPage`、`ChatSummaryWindow`、`PersonaChatPage`（AI 分身聊天）、`DiaryPage`（日记） |
| Agent | `agent/AgentPage` + 17 个配套组件（ReasoningCanvas、ReasoningEffortControl、Mentions、ApprovalBar、PromptToolbar、SubAgentProgress、UsageStats、ShareCard、RecordsMenu、MemoryIntro、CodeWorkspacePanel 等） |
| 数据 | `DataManagementPage`、`export/ExportPage`（导出向导）、`MomentsWindow`（朋友圈）、`PersonasPage`（AI 分身）、`PetsPage`（桌面宠物） |
| 窗口类 | `ImageWindow`、`VideoWindow`、`PetWindow`、`ReplyTileWindow`（回复磁贴）、`PosterStyleWindow`、`BrowserWindowPage`、`SkillPreviewWindow` |
| 设置/系统 | `SettingsPage`（设置中心，含 settings 子模块）、`ActivationPage`（激活）、`LockScreen`（应用锁）、`ChannelDiagnosticsPage`（通道诊断）、`McpPage`（MCP 管理） |

### 5.2 组件（`src/components/`，34 目录）

- **ai/**：AI 提供商 Logo、AI 摘要设置、ChatGPT 订阅授权、LocalCodingAgent 设置、RelayOne 账户/余额、代理状态
- **ai-elements/**：AI 聊天渲染积木——artifact、chain-of-thought、chart-block、code-block、conversation、hold-to-talk-submit、loader、message、prompt-input、reasoning、shimmer、sources、terminal、tool、web-preview
- **settings/**：SettingsLayout、settingsStore、useSettingsConfig、QuoteStyleOptionCard、tabs/、ui/
- **ui/**：22 个基础组件（aie-button、badge、button-group、collapsible、command、dialog、dock-two、dropdown-menu、hover-card、input、mac-os-dock、select、spinner、textarea、tooltip 等）
- **通用**：Sidebar、TitleBar、BottomDock、RouteGuard、DeviceConnectDialog、RemotePhoneCard/Dialog、ImagePreview、JsonViewerModal、JumpToDateDialog、DateRangePicker、DecryptProgressOverlay、LottieView、LivePhotoIcon、MessageContent、WhatsNewModal、ChatBackground

### 5.3 功能域（`src/features/`）

| 域 | 内容 |
| --- | --- |
| `aiagent/transport/` | `ipcChatTransport.ts`、`personaChatTransport.ts`（AI 对话双通道：桌面 Agent 与 AI 分身） |
| `home/` | 液体玻璃动效（LiquidGlassBall/Bubble）、随机瞬间气泡（randomMoment） |
| `pets/` | 桌面宠物（PetSprite、PetContext、useIdleFlair、petStates） |
| `plugins/` | 插件宿主 UI（PluginHost、PluginViewPage、PluginChatToolbar、pluginUiKit、PluginIcon） |

### 5.4 状态（`src/stores/`，zustand）

`appStore` · `chatStore` · `authStore` · `themeStore` · `imageStore` · `pluginStore` · `activationStore` · `titleBarStore` · `updateStatusStore`

### 5.5 hooks / lib / services / utils / types

- **hooks**：`useDeviceConnectStatus`、`useMcpSkillsData`、`usePlatformInfo`
- **lib**：`realtimeVoiceCall`（实时通话）、`voiceRecorder`、`ttsPlayer`、`localCodingAgent`、`appVersion`、`utils` + 四家 TTS 目录（`aliyunQwenTtsCatalog`、`stepfunTtsCatalog`、`volcengineTtsCatalog`、`xiaomiMimoTtsCatalog`）
- **services**（渲染侧）：`ipc`（统一 IPC 封装）、`chatSessions`、`database`、`config`、`relayOne`、`wcdbConnection`
- **utils**：`crypto`、`base64`、`lruCache`、`liquidGlass`、`linkify`、`wechatEmoji`、`windowChrome`
- **types**：`electron.d.ts`（IPC 类型契约）、`ai.ts`、`models.ts`、`account.d.ts`、`relayOne.ts` 等

---

## 6. 主进程服务层（electron/services/）

### 6.1 数据访问核心（AIWC 的招牌）

| 文件 | 职责 |
| --- | --- |
| `wcdbService.ts` / `wcdbCore.ts` | 数据库服务编排：自动选择开源后端（`openWcdbBridge`）或源码后端（`sourceWcdbBridge`）；`CT_WCDB_BACKEND=legacy` 可回退排障 |
| `openWcdbBridge.ts` | **fork 新增**：koffi FFI 直连源码构建的腾讯官方 WCDB v2.1.15 C Bridge（无 Electron 依赖、无许可/设备绑定/网络请求），可在 utility process 运行 |
| `sourceWcdbBridge.ts` | **fork 新增**（`d069808`）：Windows 纯 TS SQLCipher 4 解密后端——better-sqlite3 + crypto PBKDF2-SHA512(256k)/AES-256-CBC 页级解密，含 WAL 帧处理与缓存 |
| `wxKeyService.ts` / `wxKeyServiceMac.ts` | 密钥获取服务编排（fork 重写：从 hook 注入改为只读内存扫描） |
| `macosMemoryKeyScanner.ts` | **fork 新增**：koffi FFI Mach VM 遍历（task_for_pid / mach_vm_region / mach_vm_read_overwrite），纯 TS 版密钥扫描 |
| `windowsMemoryKeyScanner.ts` | **fork 新增**：OpenProcess(PROCESS_VM_READ) + VirtualQueryEx + ReadProcessMemory 纯读扫描；瞬时 raw key（双 UUIDv4）快照 + 延迟 PBKDF2 验证 |
| `memoryDbKeyPattern.ts` | **fork 新增**：跨平台共享的 `x'<64hex key><32hex salt>'` 字节模式提取器 |
| `messageDbScanner.ts` | 微信 DB 目录扫描（定位 MicroMsg/账号目录） |
| `dbAdapter.ts` / `dbPathService.ts` / `dbStoragePaths.ts` | 数据库适配、路径解析、存储路径 |
| `chat/`（16 文件） | 会话/消息/联系人查询层：`sessionList`、`sessionDetail`、`messageQueries`、`messageMapper`、`contactQueries`、`contentParsers`、`rowDecoders`、`tableResolver`、`weComResolver`（企业微信）、`emoji`、`media`、`accountUtils` |
| `snsService.ts` | 朋友圈数据 |
| `imageDecryptService.ts` / `imageDecryptWorkerPool.ts` / `nativeImageDecrypt.ts` / `datDecryptCore.ts` / `imageComplete.ts` | 图片 DAT 解密：Rust N-API（V3 XOR / V4 AES+XOR）+ 工作线程池 + 完整性处理 |
| `imageKeyService.ts` | XOR/AES 图片密钥管理 |

### 6.2 AI 服务（`ai/` 与 `agent/`）

- **`ai/`**：`aiService`（统一模型调用）、`providers/`（base + catalog，多服务商目录）、`openaiCompatibleStreamSanitizer`、`openaiResponsesSanitizer`、`codexModelsPayload`、`codexSubscriptionService/Auth`（Codex 订阅）、`proxyService/proxyFetch`、`embeddingService`、`rerankService`、`imageGenService`、`ttsService` + 各家 TTS 协议（aliyunQwen/volcengine）、`volcengineRealtimeService`、`personaRealtimeCall`、`telemetry`（OpenTelemetry）、附使用指南（`Ollama使用指南.md`、`自定义AI服务使用指南.md`）
- **`agent/`**：`engine.ts`（**ReAct 编排引擎**：AI SDK `ToolLoopAgent` 流式产出 UIMessageChunk；默认温度 0.2；REPLY_DEEP 最多 10 步；总超时 60 分钟；工具审批密钥）、`tools/`（**28 个工具**，见 §11）、`prompts.ts`、`provider.ts`（模型创建 + 原生联网搜索工具）、`resolveProviderConfig.ts`、`cache.ts`（Anthropic 缓存控制）、`compaction.ts`/`aiCompaction.ts`（上下文压缩）、`conversationStore.ts`/`conversationSchema.ts`、`guards.ts`（循环防护、工具超时）、`toolApproval.ts`/`toolPolicy.ts`/`mcpToolPolicy.ts`、`progress.ts`、`runtimeCache.ts`、`persona/`（AI 分身）、`codeWorkspaceService`（代码工作区）、`canvasTypes`/`agentCanvasStore`、`aiExport*`（AI 导出校验/运行器）、`wcdbProxyClient`/`mcpProxyClient`/`agentCapabilityProxyClient`（跨进程代理）、`arkContextFetch`/`googleCacheFetch`

### 6.3 手机遥控（`remote/`，共 2,534 行）

`gateway.ts`（1042 行，局域网 HTTP + SSE 网关 + WebRTC 桥接）、`remoteControl.ts`（DTLS 指纹钉扎、设备令牌与吊销、ICE 重启）、`cloneHandlers.ts`（500 行，克隆构建——AI 分身克隆好友）、`aiSettingsHandlers.ts`（445 行，手机端 AI 配置 RPC）、`voiceHandlers.ts`（通话转录/实时音频）、`wechatHandlers.ts`、`agentRpcRegistry.ts`。配套渲染端 `RemotePhoneCard/Dialog`、`DeviceConnectDialog`。

### 6.4 MCP（`mcp/` + 顶层）

`server.ts`（MCP stdio 服务）、`runtime.ts`、`dispatcher.ts`、`tools.ts`、`readService.ts`、`proxyService.ts`、`bootstrap.ts`、`presentation.ts`、`result.ts`、`types.ts`；顶层 `mcpClientService.ts`（作为 MCP 客户端接入外部服务）。

### 6.5 检索与记忆（`retrieval/`、`search/`、`memory/`）

`retrievalEngine` + `rrf`（倒数排名融合）+ `retrievalTypes`；`chatSearchIndexService`、`messageVectorService`（消息向量化）；`memory/`：`memoryDatabase`、`memorySchema`、`evidenceService`（证据链）、`nightlyMemoryService`（夜间记忆整合）。

### 6.6 语音（转写/合成）

`voiceTranscribeService`（编排）、`voiceTranscribeServiceWhisper`（本地 sherpa-onnx）、`voiceTranscribeServiceOnline`（在线）、`sttOnline/`（aliyun/openaiCompatible/volcano 三提供商）、`transcribeWorker.ts`（260 行，转写 worker）。

### 6.7 桌面集成与自动化

`wechatWindowTracker.ts`（**工作区正在改**：macOS 前台激活 + 合成按键输入，CGEvent 修饰键残留修复）、`autoReplyService.ts`（**工作区正在改**：全自动回复队列，发送后核验 + 补按回车兜底）、`shortcutService.{win32,darwin,unsupported}.ts`、`replyTileService.ts`（回复磁贴）、`petService.ts`/`petReminderService.ts`、`randomMomentService.ts`、`monitorBridge.ts`、`activationService.ts`、`appUpdateService.ts`、`notifyService.ts`。

### 6.8 平台与商业

`relayone/`（RelayOne 模型中转计费：`relayOneService`、`relayOneSessionStore`）、`localCodingAgent/`（本地编码 Agent：`localCodingAgentService`、`shadowWorkspace` 影子工作区、`adapters`）、`deviceConnect/`（微信机器人 `weixinBotService`、iLink 客户端、`weixinVoiceService`）、`systemAuthService.ts`、`platformService.ts`。

### 6.9 导出

`exportService.ts`、`exportUtilityProcess.ts`（204 行）、`htmlExportGenerator.ts`、`databaseExportService.ts`、`dataManagementService.ts`、`exportProcessService.ts`。

---

## 7. 原生层（native/）

> AIWC 的核心资产。上游对应物全部是闭源二进制；这里全部有源码、可重复构建。

### 7.1 `native/wcdb-open/` — 数据库桥（替换私有 wcdb_api）

- 构建腾讯官方 WCDB **v2.1.15**（固定 commit `a62d7f1...`）开源源码 + 开放 C Bridge
- `build-macos.sh`：构建 → **校验 commit** → 拷贝 `libWCDBOpen.dylib` 到 `resources/macos/` 与 `AIWC-CLI/native/darwin-arm64/`
- `build-windows.ps1`：产出 `wcdb_open.dll`（VS C++ + CMake，源固定，未在 Windows 实测）
- 生成的 dylib 含 SQLCipher 与 C Bridge；**不含**旧桥的设备绑定与云租约客户端

### 7.2 `native/macos-memory-scan/main.c`（498 行，替换 Dobby hook）

只读 Mach VM 密钥扫描器，三种模式：

| 模式 | 调用 | 功能 |
| --- | --- | --- |
| 内存扫描 | `<pid> <db-root>` | 遍历进程 RW 内存区（每区≤512MB、2MB 分块、重叠读取），匹配 `x'<64hex><32hex>'` 记录，盐来自本地加密 DB 文件头 16 字节 |
| 崩溃转储 | `--dump <dump-path> <db-root>` | 扫描微信崩溃转储（.dmp）文件找 key |
| 图片密钥 | `--image <pid> <ciphertext-hex>` | 在内存中找图片 AES key（三种候选形态：非字母数字分隔的 32 位、UTF-16、可打印 16 字节），用密文 ECB 解密验证 |

核心算法细节：
- **盐收集**：fts 遍历 DB 目录，跳过 `SQLite format 3` 明文头，其余前 16 字节视为盐（上限 1000）
- **瞬时 raw key**（工作区新增）：收集双 UUIDv4 结构（32 字节，8 字节对齐 + 非对齐双通道，上限 4096），随后用 PBKDF2-SHA512 **256,000 次迭代**派生，AES-256-CBC 解密首 4000 字节验证（`0x10 0x00 … 0x50 0x40 0x20 0x20` 魔数）
- **并行验证**：GCD `dispatch_apply` + 互斥锁提前退出
- 输出 JSON（`success/key/attached/regions/bytes/rawCandidates` 等）

### 7.3 `native/image-decrypt/`（Rust 174 行，N-API，替换闭源 .node）

`decryptDatNative(input, xorKey, aesKey)`：
- **V3**：纯 XOR（密钥 0-255），明文直通 + 去尾部 NUL
- **V4/V1**：头含 AES 尺寸/XOR 尺寸字段，AES-128-ECB 解密 + 严格 PKCS7 校验 + XOR 尾部；V1 内置默认 AES key `cfcd208495d565ef`
- **V4/V2**：AES key 由调用方传入（≥16 位 ASCII）
- 输出：数据 + 扩展名识别（gif/png/jpg/webp）+ `wxgf`/HEVC 识别
- 带 Rust 单测（明文直通、XOR 解密）

### 7.4 产物与审计

- `resources/macos/`：`libWCDBOpen.dylib`、`wechat_memory_scan_helper`（三份原生产物 SHA-256 见 `docs/native-core-audit.md`）
- `resources/wedecrypt/`：`aiwc-image-native-macos-arm64.node`
- CLI 的 macOS 原生产物与桌面端**逐字节相同**
- `scripts/check-macos-native.js`：清单检查，旧闭源文件视为禁止项直接失败

---

## 8. 密钥与解密端到端数据流

### macOS（已实机验证）

```
微信运行 → collectEncryptedDbSalts(DB 目录, 前16字节盐, ≤1000)
        → wechat_memory_scan_helper <pid> <db-root>
            或 TS 扫描器 macosMemoryKeyScanner(koffi)
        → 匹配 x'<64hex><32hex>' 记录 / 双 UUIDv4 raw key
        → PBKDF2-SHA512 256k + AES-256-CBC 验证首字节魔数
        → 64 位十六进制 DB key
        → OpenWcdbBridge(libWCDBOpen.dylib) 连接 session.db/contact.db…
        → 消息解码: silk 语音 → silk-wasm；zstd → fzstd；DAT 图片 → Rust N-API
```

关键边界（审计文档明示）：若微信进程里已不存在 `x'<key><salt>'` 记录，开放扫描无法在登录后任意时刻恢复 DB key；用户可登录后尽快扫描或手动填 64 位密钥。旧「登录瞬间 hook 捕获」已删除。

### Windows（源码就绪，待实测）

```
tasklist 解析 Weixin.exe（按工作集排序）
→ OpenProcess(PROCESS_VM_READ|QUERY_INFORMATION)
→ VirtualQueryEx 遍历 RW 页（≤512MB 区、2MB 块、98B 重叠）
→ 快照双 UUIDv4 raw key（首轮建立基线不验证；seenRawCandidates 跨轮去重）
→ 读完全程后延迟 PBKDF2 验证（防 key 在验证期间消失）
→ 或直接匹配 x'…' 记录
→ sourceWcdbBridge（纯 TS SQLCipher 页解密 + WAL 处理）→ better-sqlite3 查询
```

---

## 9. AIWC-CLI（aiwc 命令行）

独立子项目（`AIWC-CLI/`，MIT，npm 包 `aiwc-cli`，bin `aiwc`，tsup 构建 + vitest）。桌面端打包显式排除该目录；有自己的工作流（`.github/workflows/aiwc-cli.yml`）。

| 命令 | 功能 |
| --- | --- |
| `aiwc status` | 环境/密钥/数据库状态 |
| `aiwc init` | 初始化配置 |
| `aiwc key` | 密钥管理（接入 fork 的 Windows 内存扫描器） |
| `aiwc sessions` | 会话列表 |
| `aiwc messages` | 消息查询（关键词过滤 + 分页） |
| `aiwc contacts` | 联系人（克隆排序优化） |
| `aiwc export` | 数据导出 |
| `aiwc moments` | 朋友圈 |
| `aiwc search` | 全文搜索 |
| `aiwc mcp` | MCP 服务（供 Claude Code 等接入微信数据） |

服务层：`db/`（`openWcdbBridge.ts` + `rowDecoders.ts` **fork 新增**、`wcdbCore`、`messageDbScanner`、`dbAdapter`、`wcdbService`）、`keyService`、`searchService`、`export/`、`sns/`、`mcp/`、`windowsMemoryKeyScanner.ts`（**fork 新增**）；另有 `interactiveShell`、`commandRunner`、`formatters/`、`advancedService`。

---

## 10. 插件系统与 MCP

### 插件 SDK（`plugin-sdk/`）

- `aiwc-plugin-sdk.js` / `.d.ts` / `ui.js` / `ui.d.ts` / `cli.cjs` + test
- 宿主能力示例：`favorites.list`（微信收藏查询，上游 PR #350 合并后 AIWC 修复了解析与分页缺陷）
- 示例插件（`examples/plugins/`）：`favorites`（收藏查询导出）、`heroui-starter`（UI 起步模板）、`ui-gallery`（UI 组件画廊）
- 协议：`plugin://` 自定义协议 + 导航守卫；插件管理服务 `pluginManagerService.ts`

### MCP 双角色

1. **作为 MCP 服务端**：`scripts/aiwc-mcp(.cmd)` + `aiwc-mcp-bootstrap.cjs` + `mcp-runner.js`，随安装包分发（extraFiles），对外暴露微信数据工具
2. **作为 MCP 客户端**：`mcpClientService.ts` 接入外部 MCP；Agent 侧 `mcpExternal` 工具、`mcpToolPolicy` 策略
3. **内置技能**（`skills/`，随包分发为 builtin-skills）：`ct-mcp-copilot`（MCP 副驾驶）、`frontend-design`（前端设计）

---

## 11. AI 能力全景

### Agent 引擎（`agent/engine.ts`）

- AI SDK `ToolLoopAgent` ReAct 循环，流式 `toUIMessageStream`
- 温度 0.2（按 providerKind/推理模型自适应）、推理强度（reasoning effort）控制
- 超时体系：Agent 总 60 分钟 / 最终回复恢复 5 分钟 / 标题 2 分钟 / 回复建议 10 分钟
- 循环守卫：重复工具调用检测、工具超时（withToolTimeouts）
- 上下文：prompt 优化、压缩（compaction/aiCompaction）、启动记忆缓存（warmStartupMemory）
- 工具审批：带密钥校验的审批机制（AgentApprovalBar 渲染端）

### 工具集（`agent/tools/`，28 个）

| 类 | 工具 |
| --- | --- |
| 聊天检索 | `searchMessages`、`semanticSearch`、`getContext`、`getTimeline`、`chatStats`、`querySql`（SQL 查询） |
| 联系人/群 | `listContacts`、`listGroups`、`groupMembers`、`groupMemberRanking` |
| 媒体 | `mediaHistory`、`inspectMediaImage`、`transcribeVoiceMessage`、`stickers`、`sendSticker`、`sendRandomImage`、`sendMediaFromHistory`、`sendWechatFile` |
| 内容生成 | `generateImage`、`canvas`（canvas_create/edit/replace/rename）、`codeWorkspace`、`exportChat` |
| 知识 | `memory`（长期记忆）、`delegateAnalysis`（子代理）、`mcpExternal`、`capabilities`、`updatePlan`（计划模式）、`personaControl`（分身控制）、`moments`（朋友圈） |

### 其他 AI 面

- **多服务商**：OpenAI/Anthropic/Google/OpenAI 兼容/Ollama/Codex 订阅/RelayOne 中转；模型目录与 logo 快照脚本（`fetch-models-dev-*`）
- **AI 分身（Persona）**：PersonasPage 自画像管理、克隆好友（手机遥控端 cloneHandlers）、PersonaChatPage
- **实时语音**：hold-to-talk、实时通话（volcengineRealtime、personaRealtimeCall、realtimeVoiceCall lib）
- **本地编码 Agent**：localCodingAgent + 影子工作区（shadowWorkspace），设置项 `LocalCodingAgentSettings`
- **检索评测**：`evaluation/retrieval/`（score.cjs + baseline.example.jsonl，`npm run eval:retrieval`）

---

## 12. 构建、打包与发布

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发（清 dist-electron → Vite，端口 5321 起自动顺延） |
| `npm run build` | 完整构建：tsc → vite build → electron-builder（NSIS/DMG）→ 写 size 到 yml |
| `npm run build:win` / `build:mac` | 平台构建 + 更新清单（mac 先跑原生检查 + patch dmg-builder） |
| `npm run native:wcdb-open:{macos,windows}` | 构建 WCDB 开放桥 |
| `npm run native:macos-memory-scan` | 构建内存扫描 C 程序 |
| `npm run native:image:build:macos` | 构建 Rust 图片解密 .node（`build:sync` 同步产物） |
| `npm run mcp` / `mcp:probe` | 运行/探测 MCP stdio 服务 |
| `npm run cli:*` | 进入 CLI 子项目（dev/install/typecheck/test/sync） |
| `npm run eval:retrieval` | 检索评估 |

### 打包配置（package.json `build`）

- **Windows**：NSIS（oneClick:false、perMachine:false、allowToChangeInstallationDirectory、zh_CN、自定义安装器头图/侧图 `build/*.bmp`、installer.nsh）
- **macOS**：DMG + hardenedRuntime + entitlements（`resources/macos/entitlements.mac.plist`）
- `asarUnpack`：ffmpeg/silk/sherpa-onnx/fzstd/better-sqlite3/sharp/koffi/ai SDK/zod/undici 等原生与动态加载依赖
- `extraResources`：resources/（排除 whisper）、electron/assets、AI 使用指南、图标、内置宠物 `public/aiwcji`、发布公告、内置技能
- `extraFiles`：`aiwc-mcp.cmd` + bootstrap（MCP 注册入口）
- 排除：`AIWC-CLI/**`、`native/**` 等源码目录
- 更新：electron-updater（publish: github）+ `generate-update-manifest.js` + `send-telegram-release.js`

### scripts/（53 个脚本）

构建类（clean-dist-electron、run-electron-builder、patch-dmg-builder、build-macos-icon、generate-installer-assets）· 发布类（update-readme-version、prepare-release-announcement、generate-{update-manifest,force-update-manifest,release-body,release-context}、add-size-to-yml、send-telegram-release）· 原生类（check-macos-native、check-image-native、sync-image-native、probe-open-wcdb-real、probe-macos-memory-key）· 测试类（test-* 12 个 + run-bundled-node-test、run-electron-node-test、test-agent-qa-independent）· 冒烟类（smoke-* 4 个）· MCP 类（aiwc-mcp、mcp-runner、mcp-probe、test-mcp-stdio-lifecycle）。

### CI（.github/workflows/）

`aiwc-cli.yml`（CLI 独立发布）+ 上游遗留工作流。

---

## 13. 测试与评估体系

| 层 | 内容 |
| --- | --- |
| 原生 | Rust 单测（`lib.rs`）、`test-image-native-parity`（V3/V4/V1/V2 parity）、`test-macos-memory-helper`（密钥+盐+图片 AES 夹具）、`test-open-wcdb-bridge`、`probe-open-wcdb-real`（真实本地库探测） |
| Windows | `test-windows-memory-key-scanner`（bundled-node-test 跑，含 UUIDv4 提取与 PBKDF 验证用例） |
| CLI | vitest，8 个测试文件 47 项测试（含 `windowsMemoryKeyScanner.test.ts`） |
| Agent | `test-agent-conversation-schema`、`test-agent-context-reset`、`test-agent-qa-independent`、`test-codex-models-payload`、`test-openai-compatible-stream-sanitizer` |
| 其他 | `test-mcp-stdio-lifecycle`、`test-video-lookup`、`test-dat-v3-plaintext`、`test-ffmpeg-stdin-epipe`、检索评估 `evaluation/retrieval` |

---

## 14. 与上游 AIWC 的差异（AIWC 增量）

### 14.1 四个自有提交（78 文件，+4,336/−1,644）

| 提交 | 内容 |
| --- | --- |
| `d7ab3ff` feat: add native database and memory key support | 开放原生栈全套：`native/wcdb-open/`、`native/macos-memory-scan/`、`native/image-decrypt/`；`openWcdbBridge.ts`（桌面+CLI）、`rowDecoders.ts`、`macosMemoryKeyScanner.ts`、`windowsMemoryKeyScanner.ts`、`memoryDbKeyPattern.ts`；重写 `wcdbCore.ts`/`keyService.ts`/`wxKeyServiceMac.ts`；删除全部旧闭源二进制（libWCDB/libdobby/libwcdb_api/libwx_key/xkey_helper/WCDB.dll/wcdb_api.dll/wx_key.dll/旧 .node）；`docs/native-core-audit.md`、`THIRD_PARTY_NOTICES.md` |
| `2eb0841` fix: capture transient WeChat database keys | Windows 瞬时密钥：UUIDv4 raw key 快照 + 延迟 PBKDF 验证 + 跨轮去重 + deadline/字节上限 |
| `a0f9b52` fix: preserve verified account state after key capture | WelcomePage 引导流：`validatedWxid` 权威结果优先、`isAccountVerified` 状态保持 |
| `d069808` fix: add source database backend for Windows | `sourceWcdbBridge.ts`：Windows 纯 TS SQLCipher 页解密后端 |

### 14.2 未提交工作区改动（进行中）

`native/macos-memory-scan/main.c`（+214：崩溃转储模式、双 UUIDv4 收集、GCD 并行验证）· `electron/services/wxKeyServiceMac.ts`（+94：新扫描器接入、启动时序）· `wechatWindowTracker.ts`（+56：CGEvent 修饰键残留修复、微信 4.x 忽略 activate 的兜底）· `autoReplyService.ts`（+47：发送核验失败补按回车 + 临时 debug 日志）· `macos-memory-scan/build.sh`、`resources/macos/wechat_memory_scan_helper`、`AIWC-CLI/native/darwin-arm64/wechat_memory_scan_helper`、`scripts/test-macos-memory-helper.ts`

### 14.3 上游新进展（48 提交未同步）

v2026.819→v2026.827：RelayOne 密豆充值/托管密钥、模型静默加载、云端授权检查、推送中转（端到端加密）、ICE 重启、代码工作区+Canvas 增强、低频工具按需挂载、远程断线续跑修复等。⚠️ 上游仍走闭源路线（`b7f0c77` 更新了 `libwcdb_api.dylib`），**两条技术路线已明确分叉**，合流成本随时间增长。

---

## 15. 安全与合规边界

- 扫描器**纯读**：macOS 用 task_for_pid 读内存、Windows 只用 PROCESS_VM_READ|QUERY_INFORMATION，**零写入、零注入、零 hook**
- 密钥验证不落盘不打印敏感值（探针输出脱敏）
- 改名自由：旧私有桥的宿主名检查已随桥一起删除；MCP 启动/AppUserModelID/安装包名从 package.json 动态读取
- 第三方归因：`THIRD_PARTY_NOTICES.md`（WCDB BSD-3、weixin-cli 设计参考 Apache-2.0）
- 许可证 CC BY-NC-SA 4.0：禁售、禁商用；`docs/native-core-audit.md` 载明合规边界（仅限用户有权访问的本机数据）

---

## 16. 附录：目录树速查

```
AIWC/
├── src/                    # 渲染层（React 19 + zustand + react-router）
│   ├── pages/              # 40+ 页面（chat/agent/export/settings/moments/pets…）
│   ├── components/         # 34 目录（ai、ai-elements、settings、ui、通用）
│   ├── features/           # aiagent/home/pets/plugins 四域
│   ├── stores/             # 10 个 zustand store
│   ├── hooks/ lib/ services/ types/ utils/
│   └── App.tsx main.tsx    # 路由壳与入口
├── electron/               # 主进程（~93k 行）
│   ├── main.ts preload.ts mcp.ts
│   ├── main/               # context、ipc(35)、windows、workers、startup、protocols
│   ├── services/           # 80+ 服务（agent/ai/chat/mcp/remote/retrieval/memory/…）
│   ├── *UtilityProcess.ts *Worker.ts   # 4 工具进程 + 2 worker
│   └── types/ assets/
├── native/                 # AIWC 开放原生核心
│   ├── wcdb-open/          # 官方 WCDB 2.1.15 源码构建 + C Bridge
│   ├── macos-memory-scan/  # main.c 只读 Mach VM 密钥扫描器
│   └── image-decrypt/      # Rust N-API 图片 DAT 解密
├── AIWC-CLI/         # aiwc 命令（11 命令，独立发布）
├── plugin-sdk/             # 插件 SDK（js/d.ts/ui/cli）
├── skills/                 # ct-mcp-copilot、frontend-design
├── examples/plugins/       # favorites、heroui-starter、ui-gallery
├── docs/                   # native-core-audit.md、superpowers/
├── evaluation/retrieval/   # 检索评测
├── scripts/                # 53 个构建/发布/测试/原生脚本
├── resources/              # macos 原生产物、wedecrypt .node、whisper
├── public/                 # 图标、宠物资源、视频、字体、emoji
└── build/                  # 安装器位图资源
```
