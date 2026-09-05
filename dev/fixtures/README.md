# dev fixtures

演示数据，只在 `npm run dev:web`（mock bridge）和 `DemoSubstrate` 下加载，**绝不进入打包产物的默认路径**。

- `demo-dataset.json`：由 `dev/fixtures/generate.ts` 生成的会话 / 联系人 / 消息（随机中文姓名、群名、消息），用于 UI 开发与 substrate 工具的单元测试。
- 不要把 Figma 稿里的演示文案（Fable 5、wxid_a8k9…、1,284 条等）写进任何源码。
