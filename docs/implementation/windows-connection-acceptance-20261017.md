# Windows 本地连接验收记录（2026-10-17）

> 后续修复已证实四库材料均驻留，原 15/19 是预分配尾部误判。19/19、真实聊天读取及全退出缓存恢复结果见 [2026-10-18 复验](windows-message-read-acceptance-20261018.md)。以下保留初轮历史结果，不能作为当前四库仍 locked 的结论。

## 范围

在原仓库中从 `origin/REA` 的 `2b8408d` 创建本地 `REA` 分支继续工作；原 `main` 的 `dce6fb4` 未改动，没有另建项目。开工工作区干净。本轮没有修改依赖清单、原生二进制、系统权限或微信登录状态。

本机未配置 Git 作者姓名和邮箱，未生成提交；36 个任务文件已暂存于 `REA`。交付原仓库父目录中的 `aiwc-windows-rea-20261017.patch`，以 `2b8408d` 为应用基线。补丁经过对当前暂存内容的反向检查，没有实际撤销任何修改。

已安装 x64 Weixin.dll 4.1.15.53 的身份与用户给出的 SHA-256 一致。REA 静态资源原始记录见 [PE 证据](weixin-4.1.15.53-pe-evidence.json)；没有可用反编译引擎，不能据此证明 WCDB 对象布局或登录生命周期。

## 实现与证据

- 显式连接在短生命周期 utility 中打开一次只读进程句柄，一次遍历可读 region；所有实际数据库共享候选池，不逐库重复扫描进程。
- 严格检查明文或旧混淆形式的 99 字节 keyspec；候选不是可信凭据。逐库匹配 salt，确定 raw/direct 形式，检查 AES / SQLite 结构及首页、第二页、末页 HMAC。未知格式和认证失败保持 locked。读取缓存副本时继续验证消费页和 WAL。
- 沿用账号绑定 bundle、私有交付、提交确认和 Electron safeStorage。补齐保留已有集合；权限拒绝或获取失败后重新核验旧缓存。普通启动、覆盖检查和进入不调用扫描器。
- 覆盖分母来自当前目录实际数据库清单，包括无缓存的 0/M；已消失的旧缓存条目不虚增分母，也不在状态查询时被删除。
- 只读已知微信目录配置，提供有上限的自定义根候选，再验证实际账号树；不遍历盘符，不从修改时间推断当前登录账号。
- 保存了完整连接但尚未完成可选模型设置时，重启也恢复外层连接页。中英文入口及覆盖文案同步复用现有翻译。

## 匿名现场结果

明确选择的测试账号有 19 个数据库，15 个通过认证，4 个 locked。15 个通过项均为 direct；未匹配项为消息相关 3 个、搜索相关 1 个，均为非空、页对齐的加密文件。没有证据支持把它们当成空库或已解锁。

研究探针首次耗时 9932 ms，预热后 2031 ms；针对所选账号的探针为 4203 ms。真实 Electron utility 私有获取为 3715 ms。这些是不同运行的采集耗时，不是全量历史同步或开发总耗时。

真实 Electron 39 使用独立应用数据目录和系统 safeStorage，未配置在线模型，验收输出只有聚合计数和布尔值：

| 场景 | 已观察结果 |
|---|---|
| 首次连接 | 连接页一次点击，生产私有交付与 secretStore 保存，15/19、修订号 1，reader ready |
| 正常补齐 | 不清空旧集合，15/19，修订号更新为 2；其余 4 库仍 locked |
| 取消补齐 | 15/19 和原修订号保留，进入可用 |
| 权限拒绝 | 临时在验收生成文件的 OpenProcess 边界返回拒绝；可见失败，旧覆盖和修订号保留 |
| 完整退出重启 | 新 Electron 进程恢复外层连接页及 15/19，等待进入 |
| 拒绝进程访问后读缓存 | 重启、覆盖检查、进入及 reader ready 共 0 次 OpenProcess；显式补齐产生 1 次拒绝，失败后进入不增加调用 |
| 中英文 | 实际切换 English，连接区域无中文残留，可见按钮未发现溢出 |

拒绝测试没有改变系统 ACL 或安全设置；临时修改仅位于生成的验收构建，结束后恢复。微信进程和源目录始终只读，未注入、写内存、挂调试器、提权、退出登录或重启微信。测试应用数据与临时读取副本在验收完成后清理，不进入提交。

## 工程检查边界

`npm run check` 已执行，但在格式检查停止：本机 Git CRLF 检出与仓库 Prettier 的 LF 规则冲突，报告 1448 个文件。未对整个仓库机械换行；只格式化本次修改文件。保持检出换行的 `prettier --check . --end-of-line auto` 通过，修改文件的正常 Prettier 和 ESLint 检查通过。类型检查、全仓库 lint 和 knip 均有通过记录。

全套测试已尝试两轮，未获得完整通过的结果。第一轮运行期间包含后续已修复的回归，随后停止；固定代码的第二轮完成 99 个 node 测试文件后，因严重资源等待停止，不能把部分结果写成全套通过。第二轮观察到的失败范围：

| 文件 | 现象 |
|---|---|
| `packages/gateway/src/adapters/ilink/adapter.test.ts` | 媒体路径断言使用 POSIX 分隔符，生产文件未改动 |
| `packages/gateway/src/tools/gatewayTools.test.ts` | 既有媒体路径 / 联接相关用例失败，生产文件未改动 |
| `packages/shell/src/shell.test.ts` | preferred dirs 的平台路径假设失败，生产文件未改动 |
| `packages/substrate/src/demo/demo.test.ts` | 断言 POSIX `/base/img/a.jpg`，Windows 实际为盘符路径 |
| `electron/main/extensions/mcp/manager.test.ts` | 取消用例清理 hook 超时，生产文件未改动 |
| `packages/substrate/src/key/dbKeyResolver.test.ts` | 全套运行时联接创建 EPERM，独立用例通过 |
| `electron/main/security/pathAllowList.test.ts` | 全套运行时前置联接创建失败，独立安全用例通过，未跳过断言 |
| `electron/main/services/accountProfiles.test.ts` | 全套运行时联接创建 EPERM，独立用例通过 |

首次全套还观察到以下未修改文件的失败；这些结果不作为本次改动已通过的证据：

| 文件 | 现象 |
|---|---|
| `packages/gateway/src/core/mediaPolicy.test.ts` | 文件符号链接创建 EPERM |
| `electron/main/security/cacheDirPolicy.test.ts` | 缓存路径断言期待 POSIX 分隔符，实际为 Windows 路径 |
| `electron/main/services/chatFileStage.test.ts` | 文件符号链接创建 EPERM |
| `electron/main/security/wechatVideoAccess.test.ts` | 目录符号链接创建 EPERM |
| `src/features/agent/window/AgentWindow.test.tsx` | 切换会话用例超时，该轮整体存在严重资源等待 |

本次新增的四个失败回归先复现了候选间取消、枚举后文件消失及原生 open / close 异常时的清理问题，修正扫描器后独立重跑通过。没有为了通过测试而放宽路径守卫、修改系统设置或跳过安全断言。

最终连接相关回归覆盖 38 个文件、319 项用例：317 通过，2 项真实库用例因未显式提供环境配置跳过，退出码 0。范围包含完整 key / discovery 目录、账号 bundle 读取器、私有 utility / IPC、安全存储提交、覆盖、账号隔离、完整向导、设置连接页及中英文目录。

首次同范围组合运行中，路径白名单组前置准备未通过，四项安全用例未执行；随后该文件单独 12/12 通过（测试阶段 71 ms），再以 60 秒 hook 准备期限重跑上述 38 个文件全部通过。没有修改安全断言或跳过路径白名单用例。这个分组通过不能替代前述未通过的全仓库 `npm run check`。

复验命令（`node node_modules/vitest/vitest.mjs` 与 `npx vitest` 使用同一已安装 CLI）：

```text
npx vitest run packages/substrate/src/key packages/substrate/src/discovery packages/substrate/src/wcdb/wcdbSourceReader.test.ts packages/i18n electron/hosts/keyAcquireRuntime.test.ts electron/main/substrate/keyAcquireClient.test.ts electron/main/services/wechatCredentials.test.ts electron/main/ipc/wechatConnection.test.ts electron/main/ipc/substrate.test.ts electron/main/security/pathAllowList.test.ts electron/main/services/accountProfiles.test.ts electron/main/services/redact.test.ts src/features/onboarding src/features/settings/pages/WechatConnectionSection.test.tsx --maxWorkers=1 --no-file-parallelism --hookTimeout=60000
```

最终 `npm run lint`、`npm run knip`、本次代码 / JSON 文件的正常 Prettier 检查及 `git diff --check` 均通过。类型检查包含在最终成功的 `npm run build` 中。

## 最新生产构建复验

最终 `npm run build` 在 Windows 通过，包含最新源码的两份 TypeScript 项目、渲染层、main、substrateHost、keyAcquireHost 和 preload；没有修改原生二进制，因此未新增原生构建或安装包产物。现有 CSS highlight、zod 注释和 Rollup 选项告警不影响构建成功。

[匿名机器可读记录](windows-connection-acceptance-20261017.json) 对应这一版构建：

- 新建独立空白 AIWC 配置，自动发现本机自定义根，明确选择账号；连接前为 0/19，OpenProcess 0 次。
- 点击一次「连接微信」，保存为 15/19、修订号 1，OpenProcess 1 次。点击后 12357 ms 的首次观察已为此状态；这是包括测试调度和账号环境重启的观察上界，不是精确完成时间。
- 可选模型设置仍未完成时，账号环境已经显示外层连接页及「进入」。连接到实际新进程后确认 reader ready；没有把尚未退出的旧窗口当作新进程。
- 通过应用退出动作完整关闭实际账号进程，并独立确认该 PID 消失。在原生边界拒绝条件下重新启动新 Electron，恢复 15/19、修订号 1、外层进入按钮；启动、状态检查和点击进入共 0 次 OpenProcess。
- 同一条件下显式补齐产生 1 次拒绝；15/19 和修订号 1 保留，之后进入、reader ready 均未增加调用。
- 实际英文连接区域没有中文残留，可见按钮溢出数为 0。退出测试应用后，生成的 keyAcquireHost 已逐字恢复为构建原文。

自动发现复验使用标准 Windows APPDATA 与 USERPROFILE 环境。测试工具首次启动时未传 APPDATA，因此仅读取 Documents 默认位置，没有发现自定义目录；这轮失败没有被计作自动发现成功。补齐标准环境后未手填数据根，自动发现通过。生产代码在可选目录元数据缺失时仍允许用户浏览选择目录。

## 未证实

Windows WCDB 对象字段、创建 / 销毁路径、跨登录凭据生命周期及剩余 4 库的材料驻留条件仍未知。没有主动改变微信状态以促使这些库打开。三页采样不等于离线整库完整性审计，15/19 不等于全部消息历史可读。拒绝测试验证的是 AIWC 原生边界对拒绝的处理，不能扩大为系统安全策略已被修改并测试。
