# 参与开发

感谢参与 AIWC。工程规则只写在一个地方：[`AGENTS.md`](AGENTS.md)（人和编码 Agent 共用）。界面约束见 [`CLAUDE.md`](CLAUDE.md)，架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 准备环境

```bash
nvm use            # Node.js 22，见 .nvmrc
npm install
npm run dev        # Electron + Vite
```

应用只读取本机真实的微信数据库。没有微信数据时，可以只跑测试，或打开 `dev/fixtures/*.html` 预览页（经 `npm run dev:web` 的开发服务器）。

## 提交前

```bash
npm run check      # 格式 · 类型 · lint · 死代码 · 测试，CI 跑同一套
```

- 行为改动带测试；修 bug 先写一个能复现问题的失败测试。
- 新增或修改界面文案时，同时补齐 `zh-CN` 与 `en-US`（CLAUDE.md §11）。
- 只格式化自己改过的文件：`npx prettier --write <文件…>`。

## 提交与 PR

- 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/)：`<type>(<scope>): <祈使句>`，例如 `fix(substrate): keep numeric text messages intact`。
- 一个 PR 只做一件事；格式化、重命名这类机械改动单独提交。
- PR 描述写清楚：做了什么、为什么、怎么验证（命令、截图），以及是否影响 ARCHITECTURE、DESIGN-SPEC 或 CLAUDE.md。

## 安全问题

涉及密钥、微信数据外泄或越权发送的问题，请不要在公开 issue 里贴复现数据；先私下联系维护者。安全与隐私红线见 AGENTS.md §6。
