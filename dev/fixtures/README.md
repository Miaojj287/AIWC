# dev fixtures

演示数据与开发预览页，只被单元测试、mock bridge（`src/platform/mockBridge.ts`）、`DemoSourceReader` 和本目录的预览页（`*.html`，经 Vite 开发服务器打开）使用，**应用本身从不加载**：桌面端的 bridge 缺失时只报连接错误，不回退到演示数据。

- `demo-dataset.json`：由 `dev/fixtures/generate.ts` 生成的会话 / 联系人 / 消息（随机中文姓名、群名、消息），用于 UI 开发与 substrate 工具的单元测试。
- `agent-presentation.html`：Agent 对话流预览，含中间说明、工具、更正与输入框；查询参数 `lang=en`、`theme=light`、`streaming` 检查英文、浅色和生成状态。所有内容为虚构，不连接模型或微信。
- 不要把 Figma 稿里的演示文案（Fable 5、wxid_a8k9…、1,284 条等）写进任何源码。
