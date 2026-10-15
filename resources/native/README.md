# resources/native — 随包分发的原生组件

这些预编译文件由 electron-builder 打进安装包（`package.json` → `build.extraResources`），只在需要时懒加载：数据库与图片模块在 `substrateHost` 的 utility process 里加载，密钥 helper 只在用户主动连接或补齐图片时由短生命周期的 `keyAcquireHost` 启动（AGENTS.md §2.6、§3.3）。已有每库凭据的账号使用纯 TypeScript 的 SQLCipher 引擎读取源文件；没有 WCDB 库的平台（如 Windows）也使用该引擎，见下文。

| 文件 | 平台 | 作用 | 加载位置 | SHA-256 |
|---|---|---|---|---|
| `darwin-arm64/libWCDBOpen.dylib` | macOS arm64 | 打开微信的 WCDB（SQLCipher）数据库，执行只读查询 | `wcdb/nativeLib.ts` 定位路径 → `wcdb/engine.ts` 选引擎 → `wcdb/openWcdbBridge.ts`（koffi 实际加载） | `994b1c4dbf02ddce2ed794c51f73db695814e628ad0883af9f4a00c35b74c932` |
| `darwin-arm64/wechat_memory_scan_helper` | macOS arm64 | 用户主动补齐图片时只读扫描图片 AES 材料；REA 不调用旧数据库 / 转储入口 | `packages/substrate/src/key/macosMemoryScanner.ts`（`keyAcquireHost`） | `42deb85ff92f0ad9ec9d7c114f5890712115f859c49039397b6fc90e6c11bfa0` |
| `darwin-arm64/wechat_codec_helper` | macOS arm64 | 用户主动连接时，只读检查已打开的 WCDB codec，返回逐库认证后的派生凭据；不附加调试器、不重启微信 | `packages/substrate/src/key/macosCodecScanner.ts`（utility process） | `5334155c9939dc5cccc38b71777c19d896e6861bad807de6af9285153305b691` |
| `darwin-x64/wechat_codec_helper` | macOS x64 | 明确返回 `unsupported_version`；Intel codec 布局尚未验证 | 同上 | `490081397afd68cb94a745d0dd432800d746ee9c3fb206ab2f43491d5785a565` |
| `darwin-arm64/aiwc-image-native-macos-arm64.node` | macOS arm64 | 解密图片 `.dat`、转换 `wxgf` 容器；加载失败时回退到 TypeScript 实现 | `packages/substrate/src/decrypt/nativeImageDecrypt.ts` | `a05b2e55ecd46e1ebf583c0a563ccd24a672ab9994fe5538da68e72c39ab9518` |
| `win32-x64/aiwc-image-native-win32-x64.node` | Windows x64 | 同上 | 同上 | `de48c53eeb598b108f80527ae802f23377381ebeb12b865dccc1c4675b6b6433` |
| `image-native-manifest.json` | — | 历史遗留清单，**代码不读取它**（图片模块按文件名约定定位）；补齐来源时一并决定删除还是改成真实清单 | — | — |

macOS helper 在打包时由 `scripts/afterPack.cjs` 用 `resources/macos/helper.entitlements.plist` 重新签名（ad-hoc），遍历 `darwin-arm64` 与 `darwin-x64` 中的实际产物。新的 codec helper 签名失败会中止打包，避免分发一个无法执行已声明权限检查的连接组件。

## 来源、构建与许可证

> **待维护者补齐，开源发布前必须完成（AGENTS.md §6）。** 每个文件需要写明：源码仓库与提交、构建命令、许可证、如何复现上表的哈希。
> `image-native-manifest.json` 声明的源码目录 `native/image-decrypt` 目前不在本仓库中。
> 旧组件当前只提供 macOS arm64 与 Windows x64 的产物；`package.json` 的 mac 打包目标还包含 x64，Intel 包里缺少旧组件。新的 codec helper 两种架构都有产物，其中 x64 明确返回不支持。

### REA codec helper

`wechat_codec_helper` 的源文件全部在 [`native/wechat-codec`](../../native/wechat-codec)，许可证为本仓库 MIT，源码头标记 `SPDX-License-Identifier: MIT`。代码根据本机微信 4.1.15（270134）静态分析与只读运行观察独立实现，没有复制微信指令或引入第三方原生依赖。证据和适配边界见 [`docs/WECHAT-LOGIN-KEY-RESEARCH.md`](../../docs/WECHAT-LOGIN-KEY-RESEARCH.md)；研究来源记录 `ev_48d90c88616009e1b34111869f5c0131671d3c75aaa1edf7cb8749e85b9e8f43`。

用 macOS Xcode Command Line Tools 构建：`bash scripts/buildWechatCodecHelper.sh`。脚本先运行合成数据库、错误密钥、页篡改、错误页号/盐、版本及 provider 绑定、保留 keyspec（格式、长度与显式 salt 校验）、取消与期限测试，再构建 arm64 helper 和 x64 不支持版本入口，并使用现有 helper entitlements 签名。链接系统 CommonCrypto 和 Mach；无新增库，最低部署版本 macOS 12。上表哈希来自该脚本；更换 Xcode/SDK 或签名后应重新记录产物哈希。可用 `shasum -a 256 resources/native/darwin-*/wechat_codec_helper` 和 `codesign --verify --strict <文件>` 复验。

适配只接受 `/Contents/Resources/wechat.dylib` 的整个 universal 文件 SHA-256 `a1709ba62cae1b8b2705137980e23983ed42dc88affe774c4442488b82b007fe`，并核对已加载 arm64 镜像 UUID `8ACF7A2F-517C-32B4-9DFB-47E8849CD444`、路径和 codec provider 的 KDF/AES 指针。读取前未命中此版本立即返回 `unsupported_version`。访问目标进程仍受 `task_for_pid` 权限限制；失败返回 `needs_authorization`。本机 SIP 关闭环境成功不证明普通 SIP 开启分发环境能够读取；helper 不改变系统设置、签名或微信状态。

调用约定为 `wechat_codec_helper <pid> <corePath> <dbPath…>`（最多 128 个库），必须用私有 stdout 管道，终端执行拒绝输出凭据。返回一条有界 JSON：`version: 1`、结构化 `status`、`entries`；成功条目按入参的 0 基 `index` 关联，含 `saltHex`、`keyHex` 和 `form: direct`。失败与取消不含条目，调用方不得记录原始 stdout。每条输出都完成所选数据库第一页 AES 字段校验以及第一页、第二页和末页的 HMAC 校验；只有一页/两页时验证所有实际存在的这些页。派生缓冲未认证的库继续检查同一已绑定子上下文中保留的 XOR 混淆 `x'<key>[salt]'`（67 / 99 字节）；显式 salt 必须与所选库一致，解码后沿用相同逐页认证与 `direct` 输出，不保存输入字符串。扫描最多 4 GiB、45 秒、4096 个 provider 已绑定的 codec，优先驻留可读写堆，跳过大于 256 MiB 的单块。所有目标操作只有读内存/读文件；不使用 attach、目标函数调用、内存写入或线程/寄存器修改。局部候选和输出缓冲在返回前擦除，SIGTERM/SIGINT 或父进程退出中止扫描并清除未交付凭据。

2026-10-15 本机只读复验：82 个候选文件中 24 个完成上述页认证，耗时 0.617 秒、stderr 为 0 字节。这个数量含历史目录，仅说明所选文件可被当前进程的候选验证，不用于推断登录身份。运行结果只保留匿名计数；凭据不写入测试、报告或日志。

2026-10-15 图标库补齐复验：按微信进程实际打开的唯一图标库选择同账号目录，25 个数据库全部完成认证，图标库三页 HMAC 全部通过，生产 helper 耗时 588 ms。源主库大小及修改时间未变，私有 stdout 未留存；不再使用文件修改时间选择账号。

## 没有 WCDB 库的平台

`libWCDBOpen.*` 只有 macOS arm64 一份，**Windows 不需要 `wcdb_open.dll`**：`wcdb/engine.ts` 发现当前平台没有 WCDB 库时，改用纯 TypeScript 的 SQLCipher 引擎读微信库（解密成缓存副本后交给 `node:sqlite`，见 `docs/ARCHITECTURE.md` §13.1）。已有每库凭据的 REA 账号强制使用该只读副本路径，即使存在原生库或开发环境请求 `wcdb`；其他账号仍按原生库可用性选择，自动模式下加载失败会降级并记一条 warn。

## 开发时覆盖路径

| 环境变量 | 作用 |
|---|---|
| `AIWC_WCDB_ENGINE` | 请求数据库引擎：`wcdb`（原生，缺库时直接报错）或 `sqlcipher`（纯 TypeScript）；已有每库凭据时始终使用只读副本引擎 |
| `AIWC_WCDB_LIBRARY` | 指定 WCDB 动态库路径 |
| `AIWC_WX_MEMORY_HELPER_PATH` | 指定图片内存扫描 helper 路径 |
| `AIWC_IMAGE_NATIVE_PATH` | 指定图片原生模块路径；`AIWC_IMAGE_NATIVE=0` 关闭该模块 |
| `AIWC_FFMPEG_PATH` | 指定转换动图时使用的 ffmpeg |

更换任何文件时，同步更新上表的用途与哈希。

REA 分支移除了未使用的登录挂钩二进制和调用路径；普通连接只使用 codec helper。原 memory helper 只用于用户主动发起的图片补齐，不再用于数据库连接。
