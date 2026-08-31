# AIWC-CLI

`aiwc-cli` 提供 `aiwc` 命令，用于在命令行、脚本和自动化任务中读取 AIWC 兼容的微信本地数据。

这是AIWC仓库内的独立 Node/TypeScript 子项目。它和桌面版共享同一个 Git 仓库，但拥有自己的 `package.json`、锁文件、依赖、测试、构建产物和发布工作流。CLI 不启动 Electron，配置文件存放在 `~/.aiwc/config.json`。

桌面版和 CLI 在运行时互不依赖。需要同步数据层能力时，通过 `npm run sync:upstream` 做人工移植，不直接引用 Electron 模块。

macOS 的数据库访问只使用仓库源码构建的 `libWCDBOpen.dylib`，不依赖旧闭源
`libwcdb_api` 中写死的 AIWC 宿主名。可用 `CT_OPEN_WCDB_LIBRARY` 指向自定义构建。
Windows 开放 DLL 的接入代码已经就绪，发布前仍需在 Windows 上构建并验证
`native/win32-x64/wcdb_open.dll`。

macOS 自动取钥会先运行仓库 C 源码构建的只读内存扫描助手，并以本地加密数据库的
salt 校验候选，不再加载旧 `libwx_key.dylib`。构建根项目的
`native:macos-memory-scan` 会把助手同步到 CLI 原生资源目录。

Windows 自动取钥同样优先使用 CLI 内置的 TypeScript 只读进程扫描器；扫描器只申请
查询和读取权限，并用加密数据库头部 salt 校验候选；旧 `wx_key.dll` 已移除。
开放路径仍需在 Windows 实机上完成最终验证。

## 安装

**npm：**

```bash
npm install -g aiwc-cli
aiwc status
```

国内用户可使用 npmmirror 镜像加速：

```bash
npm install -g aiwc-cli --registry https://registry.npmmirror.com
```

更新：

```bash
npm install -g aiwc-cli@latest
```

卸载：

```bash
npm uninstall -g aiwc-cli
```

**pnpm：**

```bash
pnpm add -g aiwc-cli
aiwc status
```

更新：

```bash
pnpm update -g aiwc-cli
```

卸载：

```bash
pnpm remove -g aiwc-cli
```

## 开发

```bash
npm install
npm run dev -- status
npm run typecheck
npm test -- --run
```

从AIWC仓库根目录运行：

```bash
npm run cli -- status
npm run cli:typecheck
npm run cli:test
```

除非明确要做 CLI 发布构建，否则不要运行 `npm run build`。

## 交互模式

在真实终端中执行 `aiwc status` 会进入独立的全屏终端界面，直接列出带编号的命令菜单，无需按 Enter 继续。选择命令有两种方式：输入编号回车，或输入 `/命令`。

```bash
aiwc status
aiwc> 2              # 输入编号选择（无参命令直接执行，需参数的命令会填入命令名等你补全）
aiwc> /sessions --limit 20
aiwc> /messages "张三" --limit 50
aiwc> /exit
```

输入编号回车即可选中对应命令：无参命令（如 `/status`、`/sessions`）直接执行，需要参数的命令（如 `/messages`、`/export`）会把命令名填进输入行，等你补全参数后回车。也可以输入 `/` 打开命令候选区，用上下方向键选择、按 Enter 或 Tab 补全。输入 `/help` 查看完整命令列表。如果某些终端环境没有自动进入界面，可以使用 `--ui` 强制进入：

```bash
aiwc --ui status
```

脚本或管道场景可以显式指定 `--format` 或 `--quiet`，此时 `status` 只输出结果，不进入交互模式：

```bash
aiwc --format json status
aiwc --quiet status
```

## 配置

配置文件默认写入 `~/.aiwc/config.json`。可以通过命令配置，不需要手动编辑文件：

```bash
aiwc config set --db-path "C:/Users/你/Documents/WeChat Files/wxid_xxx/Msg" --wxid wxid_xxx
aiwc key set <64位十六进制密钥>
aiwc config show
```

交互模式中也可以配置：

```bash
/config set --db-path "C:/Users/你/Documents/WeChat Files/wxid_xxx/Msg" --wxid wxid_xxx
/key setup
/status
```

密钥配置是双向选择，不是失败后兜底。交互模式中执行：

```bash
/key setup
```

然后选择：

- 自动获取：从正在运行的微信进程提取密钥
- 手动填写：粘贴 64 位十六进制密钥

非交互命令也保留两种明确入口：

```bash
aiwc key get --save
aiwc key set <64位十六进制密钥>
```

## 发布

CLI 的验证和发布由父仓库中的 `.github/workflows/aiwc-cli.yml` 单独处理。该工作流只监听 `AIWC-CLI/**` 相关改动，不参与桌面版打包。

发布目标是 npm 官方公开包仓库：`https://registry.npmjs.org`。手动触发工作流并启用 `publish` 后，会以公开 npm 包 `aiwc-cli` 发布，用户安装后使用 `aiwc` 命令。国内用户可以等待 npmmirror 等镜像同步，或配置 npm 官方源安装。

发布时工作流会先读取 npm 官方仓库中的最新版本，再自动准备本次版本号。默认使用 `patch` 修订版本；需要小版本或大版本发布时，在手动触发工作流时将 `version_bump` 选择为 `minor` 或 `major`。如果已经在 `package.json` 中手动写入了高于 npm 最新版本的版本号，发布脚本会保留该手动版本。

## 命令

当前已注册的命令入口：

- `/status`：检查配置和数据库连接状态
- `/sessions`：列出会话
- `/messages <session>`：查询会话消息
- `/contacts`：列出联系人
- `/contact <contact>`：查看联系人详情
- `/key get|test|set`：密钥管理
- `/search`：全文搜索
- `/export`：导出聊天数据
- `/moments`：朋友圈数据
- `/mcp serve`：独立 MCP Server 模式
- `/help`：显示命令列表
- `/exit`：退出交互模式

部分高级命令目前只保留公开接口，会返回 `NOT_IMPLEMENTED`，等待对应服务完成移植。
