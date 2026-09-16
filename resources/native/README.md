# resources/native — 随包分发的原生组件

这些预编译文件由 electron-builder 打进安装包（`package.json` → `build.extraResources`），只在需要时懒加载：数据库与图片模块在 substrate 的 utility process 里加载，密钥 helper 只在用户发起「获取密钥」时启动（AGENTS.md §2.6、§3.3）。

| 文件 | 平台 | 作用 | 加载位置 | SHA-256 |
|---|---|---|---|---|
| `darwin-arm64/libWCDBOpen.dylib` | macOS arm64 | 打开微信的 WCDB（SQLCipher）数据库，执行只读查询 | `packages/substrate/src/wcdb/nativeLib.ts`（koffi） | `994b1c4dbf02ddce2ed794c51f73db695814e628ad0883af9f4a00c35b74c932` |
| `darwin-arm64/wechat_memory_scan_helper` | macOS arm64 | 只读扫描微信进程内存或崩溃转储，查找数据库密钥与图片密钥 | `packages/substrate/src/key/macosMemoryScanner.ts` | `42deb85ff92f0ad9ec9d7c114f5890712115f859c49039397b6fc90e6c11bfa0` |
| `darwin-arm64/wechat_xkey_helper` | macOS arm64 | 以调试器权限附加到微信进程，在下次登录时截获数据库密钥（需关闭 SIP 或授予开发者工具权限） | `macosMemoryScanner.ts` 的 `captureMacDbKeyViaHook` | `780135df9bdf5869c4676faa3b7cf97308c1e9a04ea35b98e91e0c7bb28ed6db` |
| `darwin-arm64/aiwc-image-native-macos-arm64.node` | macOS arm64 | 解密图片 `.dat`、转换 `wxgf` 容器；加载失败时回退到 TypeScript 实现 | `packages/substrate/src/decrypt/nativeImageDecrypt.ts` | `a05b2e55ecd46e1ebf583c0a563ccd24a672ab9994fe5538da68e72c39ab9518` |
| `win32-x64/aiwc-image-native-win32-x64.node` | Windows x64 | 同上 | 同上 | `de48c53eeb598b108f80527ae802f23377381ebeb12b865dccc1c4675b6b6433` |
| `image-native-manifest.json` | — | 图片原生模块的平台清单 | — | — |

两个 macOS helper 在打包时由 `scripts/afterPack.cjs` 用 `resources/macos/helper.entitlements.plist` 重新签名（ad-hoc）。

## 来源、构建与许可证

> **待维护者补齐，开源发布前必须完成（AGENTS.md §6）。** 每个文件需要写明：源码仓库与提交、构建命令、许可证、如何复现上表的哈希。
> `image-native-manifest.json` 声明的源码目录 `native/image-decrypt` 目前不在本仓库中。
> 当前只提供 macOS arm64 与 Windows x64 的产物；`package.json` 的 mac 打包目标还包含 x64，Intel 包里将缺少这些组件。

## 没有 WCDB 库的平台

`libWCDBOpen.*` 只有 macOS arm64 一份，**Windows 不需要 `wcdb_open.dll`**：`wcdb/engine.ts` 发现当前平台没有 WCDB 库时，改用纯 TypeScript 的 SQLCipher 引擎读微信库（解密成缓存副本后交给 `node:sqlite`，见 `docs/ARCHITECTURE.md` §13.1）。往这里放一个能用的 WCDB 库就会自动切回原生引擎；放了但加载失败会降级并记一条 warn。

## 开发时覆盖路径

| 环境变量 | 作用 |
|---|---|
| `AIWC_WCDB_ENGINE` | 强制数据库引擎：`wcdb`（原生，缺库时直接报错）或 `sqlcipher`（纯 TypeScript）；默认按有无原生库自动选择 |
| `AIWC_WCDB_LIBRARY` | 指定 WCDB 动态库路径 |
| `AIWC_WX_MEMORY_HELPER_PATH` | 指定内存扫描 helper 路径 |
| `AIWC_WX_XKEY_HELPER_PATH` | 指定登录截获 helper 路径 |
| `AIWC_IMAGE_NATIVE_PATH` | 指定图片原生模块路径；`AIWC_IMAGE_NATIVE=0` 关闭该模块 |
| `AIWC_FFMPEG_PATH` | 指定转换动图时使用的 ffmpeg |

更换任何文件时，同步更新上表的用途与哈希。
