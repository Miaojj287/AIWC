# Open WCDB bridge

This directory replaces the private `wcdb_api` database layer with Tencent's
official open-source WCDB C bridge.

The macOS build is pinned to WCDB `v2.1.15`, commit
`a62d7f12191843e1f095e3c37f46785ed04ebde8`. The script verifies that commit
before copying build output into both desktop resources and the CLI native directory.

```bash
npm run native:wcdb-open:macos
```

On a Windows x64 developer machine with Visual Studio C++ and CMake:

```powershell
npm run native:wcdb-open:windows
```

This generates `resources/wcdb_open.dll` and
`AIWC-CLI/native/win32-x64/wcdb_open.dll` with the same official C Bridge. The
Windows build script is source-pinned but has not yet been executed in the
current macOS-only audit environment.

The generated `libWCDBOpen.dylib` contains SQLCipher and the WCDB C bridge. It
does not contain AIWC's previous device binding or cloud lease client.

Current status: the source build and generic row query adapter work on macOS
arm64 in both the desktop app and CLI.

```bash
npm run dev
```

构建产物存在时应用会自动选择开源后端。需要对照旧实现排障时使用
`CT_WCDB_BACKEND=legacy npm run dev`。

The adapter has passed encrypted `session.db`, WAL, parameter binding, compressed
message, moments and account-switching compatibility probes. Both desktop and CLI
select it automatically when the source-built library is present.
