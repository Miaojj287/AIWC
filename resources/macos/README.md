# macOS Native Resources

这个目录是 AIWC 的 macOS 原生产物落点。

当前仓库会长期保留的静态文件：

- `entitlements.mac.plist`
- `image_scan_entitlements.plist`

仓库内已有完整源码并可直接构建的文件：

- `wechat_memory_scan_helper`：只读扫描 WCDB key + salt 记录，并校验图片 AES key 候选
- `libWCDBOpen.dylib`：官方 Tencent WCDB 源码加开放 C Bridge

构建命令：

```bash
npm run native:wcdb-open:macos
npm run native:macos-memory-scan
```

应用只使用 `libWCDBOpen.dylib`。旧 WCDB 桥、取钥 hook、Dobby 和图片扫描 helper
已经从默认仓库与发行包移除；开放组件缺失时会明确报错，不再静默加载封闭回退。

检查是否齐全：

```bash
npm run native:macos:check
```

只构建仓库内有源码的 macOS 原生产物，不构建 Electron 应用：

```bash
npm run native:macos
```
