# Third-party notices

## wx-cli / weixin-cli

The open Windows WeChat 4.x key-and-salt memory scanner in
`electron/services/windowsMemoryKeyScanner.ts` is an independent TypeScript
implementation informed by the public scanner design in:

- Project: `erbanku/weixin-cli`
- Source: <https://github.com/erbanku/weixin-cli>
- Referenced file: `src/scanner/windows.rs`
- License: Apache License 2.0

The implementation is read-only and uses documented Windows process inspection
APIs. It does not include or redistribute code from repositories removed by
their authors or by GitHub.

## Tencent WCDB

The reproducible open database bridge under `native/wcdb-open` builds Tencent
WCDB `v2.1.15` from its official source repository:

- Project: `Tencent/wcdb`
- Source: <https://github.com/Tencent/wcdb>
- Pinned commit: `a62d7f12191843e1f095e3c37f46785ed04ebde8`
- License: BSD 3-Clause License
