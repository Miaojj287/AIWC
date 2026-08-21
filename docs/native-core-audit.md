# CipherTalk 原生核心审计

审计日期：2026-08-19

## 最终结论

桌面端与 CLI 的默认仓库、运行路径和发行资源已经切换为 open-only。
旧 WCDB 桥、取钥 hook、Dobby helper、Windows 私有扫描 DLL 和旧图片 `.node`
均已从版本控制与资源目录删除。开放组件缺失时程序会明确报错，不再静默加载闭源回退。
桌面端和 CLI 中旧桥的文件名、加载分支、鉴权错误码与不可达回退代码也已清除，
因此改名不会再触发历史私有桥的宿主名检查。

仓库根许可证为 CC BY-NC-SA 4.0，带非商业限制，因此整个项目更准确的称呼是
source-available，而不是 OSI 意义的开源软件。这里的“open-only”表示所有项目自有
原生核心均有可读源码和可重复构建入口；Tencent WCDB、Rust crates 等第三方代码
遵循各自上游许可证，详见 `THIRD_PARTY_NOTICES.md`。

## 当前原生文件

| 分发位置 | SHA-256 | 源码与构建入口 |
| --- | --- | --- |
| `resources/macos/libWCDBOpen.dylib` | `994b1c4dbf02ddce2ed794c51f73db695814e628ad0883af9f4a00c35b74c932` | `native/wcdb-open/`；官方 WCDB 2.1.15 + 开放 C Bridge |
| `resources/macos/wechat_memory_scan_helper` | `8f1cb29108ed4b45b55881ab3ba2545b9c26d2351fa6257cf6778ab5efb94e4a` | `native/macos-memory-scan/main.c` |
| `resources/wedecrypt/ciphertalk-image-native-macos-arm64.node` | `a05b2e55ecd46e1ebf583c0a563ccd24a672ab9994fe5538da68e72c39ab9518` | `native/image-decrypt/` Rust/N-API |

CLI 的三份 macOS 原生产物与上表逐字节相同。Windows 目录当前不分发旧二进制；
必须先通过源码构建脚本生成 `wcdb_open.dll` 和图片 `.node`。

## 能力状态

| 能力 | macOS | Windows |
| --- | --- | --- |
| 加密 DB/WAL 访问 | 开放 WCDB 默认且唯一 | 源码/脚本完成，待 Windows 构建实测 |
| DB key 静态记录扫描 | TypeScript + C helper | TypeScript，只读权限 |
| 图片 DAT 解密 | Rust 源码构建并通过 parity | 同源脚本完成，待 Windows 构建实测 |
| 图片 AES key 扫描 | 开放 C helper + Mach API | 尚无完整开放实现 |
| 账号发现 | 文件系统与数据库路径 | 文件系统路径；旧内存结构扫描已停用 |

当前功能边界：若微信进程中已经不存在 `x'<key><salt>'` 记录，开放扫描无法在登录后
任意时刻恢复 DB key。用户可在登录后尽快扫描，或手动填写自己数据库的 64 位密钥。
旧“登录瞬间 hook 动态捕获”实现已删除，不再作为不可审计的兜底。

## 改名问题

此前改名失败的根因不是 Authenticode 或 Apple 签名要求固定文件名，而是旧私有
`wcdb_api` 在应用层检查 `ciphertalk.exe`、相邻 DLL、marker 和品牌路径。
该桥现已删除。开放 WCDB Bridge 不检查宿主名称；MCP 启动、AppUserModelID、
安装包名称检查也已改为从 `package.json` 动态读取。

## 验证结果

- 开放 WCDB：明文、SQLCipher 4、WAL、参数绑定、多账号切换通过。
- 真实本地数据库：session、消息、zstd 内容、朋友圈接口通过，探针不打印敏感值。
- 本地 Electron 桌面端已实机启动；会话、消息缓存和 contact.db 路由预加载成功，进程保持稳定。
- 修复了开放 Bridge 读取结果时的指针复制崩溃，以及空路径 contact 查询误落到 session.db 的问题。
- macOS 内存助手：源码构建、签名、DB key+salt 和图片 AES 夹具通过。
- 图片原生模块：Rust 单测以及 V3 明文/XOR、V4/V1、V4/V2 parity 通过。
- CLI：严格类型检查、构建、8 个测试文件共 47 项测试通过。
- macOS 原生清单检查会把旧闭源文件视为禁止项并失败。
- Windows 真实进程、`wcdb_open.dll` 和 Rust `.node` 仍需 Windows 测试机验证。

## 可重复构建

```bash
npm run native:wcdb-open:macos
npm run native:macos-memory-scan
npm run native:image:build:macos
```

Windows：

```powershell
powershell -File native/wcdb-open/build-windows.ps1
powershell -File native/image-decrypt/build-windows.ps1
```

## 合规边界

这些实现仅用于用户有权访问的本机进程、账号和数据。不得用于绕过其他用户的系统
访问控制或秘密收集聊天数据。
