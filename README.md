# AIWC

以微信消息为基座的本地 Agent 工作台。左边选功能，中间看和改，右边让 Agent 干活。

- **数据基座**：只读微信本地数据库，按平台自动选引擎——有原生 WCDB 库时走它，没有时（如 Windows）走纯 TypeScript 的 SQLCipher 引擎，把库解密成缓存副本再交给 `node:sqlite`；随后镜像到本机 SQLite（双 FTS5 + 向量），数据不出本机。
- **Agent 内核**：Thread → Turn → Step 循环、类型化有界上下文、单一工具注册表与审批矩阵、JSONL rollout 可续跑。
- **通道**：桌面对话、微信 iLink 机器人、UI 注入发送（带数据库读回验证与熔断）。
- **记忆与每日待办**：四个有界 Markdown 记忆文件、按联系人的关系档案（AI 克隆）、可选的每日待办（默认关闭；按你设的周期扫描你勾选的群聊，整理摘要和可勾选的待办）。
- **命令行**：受分级与 macOS 沙箱约束的 `shell` 工具，写入与对外发送按风险分级审批。
- **定时任务**：按 cron 计划在无人值守线程里跑提示词，权限用授权清单限定。
- **办公平台**：飞书 / 钉钉 / 企业微信连接器，经各家官方 CLI 建表与推送。

## 开发

需要 Node.js 22.12 及以上（见 `.nvmrc` 与 package.json 的 `engines`）。

```bash
npm install
npm run dev          # Electron + Vite（只读取真实微信数据库）
npm run dev:web      # 纯浏览器无本地连接时显示提示，不加载演示数据
npm run check        # 提交前全套：格式 · 类型 · lint · 死代码 · 测试（CI 同一套）
```

参与开发前先读 [`AGENTS.md`](AGENTS.md)：分层规则、代码规范、测试要求与安全红线都在里面。

## 打包

```bash
npm run build:mac    # DMG (arm64 + x64)
npm run build:win    # NSIS 安装包 (x64)
```

## 文档

- [`AGENTS.md`](AGENTS.md) 开发准则：工作流程、代码规范、分层规则、测试、安全红线
- [`CLAUDE.md`](CLAUDE.md) 界面设计约束（防漂移）与多语言规则
- [`DESIGN-SPEC.md`](DESIGN-SPEC.md) 布局逻辑与行为规格
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 分层、进程模型、内核循环、上下文与工具规则
- [`docs/PACKAGE-API.md`](docs/PACKAGE-API.md) 各包公开 API 的构建期计划（现行契约以各包 `src/index.ts` 为准）
- Figma：`https://www.figma.com/design/l1f9ojImxG3cosmDbtUZT2/AIWC`（Page 3）

## 目录

```
packages/protocol   契约（ID、历史条目、上下文片段、工具、Op/Event、模型端口、网关、基座、记忆、配置、IPC）
packages/kernel     Agent 内核（runtime + tooling）
packages/substrate  微信数据基座（wcdb / key / decrypt / mirror / facade / tools）
packages/gateway    通道层（iLink、UI 注入、回复闸门、自动回复队列）
packages/memory     记忆、关系档案、每日待办
packages/i18n       界面文案目录（zh-CN / en-US）
packages/shell      命令行：进程运行、命令分级、macOS 沙箱、shell 工具
packages/office     办公平台连接器（飞书 / 钉钉 / 企业微信，经各家官方 CLI）
electron/           主进程组合根、preload、utility process 入口
src/                渲染层（kit → shell → workspace → features）
skills/             内置 SKILL.md
resources/native/   随包分发的原生库（WCDB 开源桥、密钥扫描 helper、图片解密），说明见该目录 README
```

## 微信数据库密钥

微信的本地数据库是加密的，AIWC 需要密钥才能读。密钥只在本机获取、加密存放在系统钥匙串里，不会离开这台机器：

- **macOS**：从微信进程内存或崩溃转储里只读扫描出账号口令；登录时截获需要调试器权限，界面上会先说明前提与影响，不会自动触发。
- **Windows**：从微信进程内存里读按库派生的密钥。

两个平台拿到的密钥形态不同、互相不能用；细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §13。

## 许可

[MIT](LICENSE)。
