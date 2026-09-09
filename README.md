# AIWC

以微信消息为基座的本地 Agent 工作台。左边选功能，中间看和改，右边让 Agent 干活。

- **数据基座**：只读微信本地数据库（WCDB / SQLCipher），镜像到本机 SQLite（双 FTS5 + 向量），数据不出本机。
- **Agent 内核**：Thread → Turn → Step 循环、类型化有界上下文、单一工具注册表与审批矩阵、JSONL rollout 可续跑。
- **通道**：桌面对话、微信 iLink 机器人、UI 注入发送（带数据库读回验证与熔断）。
- **记忆与日记**：四个有界 Markdown 记忆文件、按联系人的关系档案（AI 克隆）、夜间日记流水线。

## 开发

```bash
npm install
npm run dev          # Electron + Vite（只读取真实微信数据库）
npm run dev:web      # 纯浏览器无本地连接时显示提示，不加载演示数据
npm run typecheck && npm run lint && npm test
```

## 打包

```bash
npm run build:mac    # DMG (arm64 + x64)
npm run build:win    # NSIS 安装包 (x64)
```

## 文档

- [`CLAUDE.md`](CLAUDE.md) 界面设计约束（防漂移）
- [`DESIGN-SPEC.md`](DESIGN-SPEC.md) 布局逻辑与行为规格
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 分层、进程模型、内核循环、上下文与工具规则
- [`docs/PACKAGE-API.md`](docs/PACKAGE-API.md) 各包公开 API 约定
- Figma：`https://www.figma.com/design/l1f9ojImxG3cosmDbtUZT2/AIWC`（Page 3）

## 目录

```
packages/protocol   契约（ID、历史条目、上下文片段、工具、Op/Event、模型端口、网关、基座、记忆、配置、IPC）
packages/kernel     Agent 内核（runtime + tooling）
packages/substrate  微信数据基座（wcdb / key / decrypt / mirror / facade / tools）
packages/gateway    通道层（iLink、UI 注入、回复闸门、自动回复队列）
packages/memory     记忆、关系档案、日记
electron/           主进程组合根、preload、utility process 入口
src/                渲染层（kit → shell → workspace → features）
skills/             内置 SKILL.md
resources/native/   随包分发的原生库（WCDB 开源桥、密钥扫描 helper、图片解密）
```

## 许可

本仓库暂不开放许可（UNLICENSED）。`resources/native` 内的二进制来源见各自 README。
