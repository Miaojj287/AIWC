# 模型发现与参数能力

可用模型来自用户配置的接口，不维护静态模型推荐清单。首次确认接入、修改 Key / 接口后立即发现模型；AI 设置页对当前服务商在进入、窗口重新获得焦点和每 10 分钟检查缓存，支持手动刷新。新发现的模型在已有配置中默认不启用；首次接入自动启用。同步保留已有开关和有效参数，移除过的模型不会重新出现；接口不再返回的模型保留配置并标为不可用。手动添加的部署 ID 不依赖列表可见性。

后端处理 Anthropic / Gemini 分页、Ollama `/api/tags`、OpenAI 格式 `/models`。请求总超时 30 秒，循环分页、异常响应、鉴权与网络错误直接报告，不用旧模型伪装成功。不提供枚举接口的网关可手动添加模型。列表可见性不等于推理额度或工具调用能力验证，连接测试独立执行。

`packages/protocol/src/modelCapabilities.ts` 同时用于设置 UI 和推理适配器。Claude 原生能力字段、输入/输出上限优先采用 API 元数据；其他明确确认的型号使用兼容性规则；未知型号保持服务商默认参数，不猜测推理和快速模式。上下文预算是本地压缩预算，不是修改服务商的模型上限。OpenAI 新模型使用 Responses，旧普通模型保留 Chat Completions，均关闭响应存储。

核对日期：2026-09-07。扩展规则时应同时更新模型参数和请求序列化测试：

- [OpenAI 模型说明](https://developers.openai.com/api/docs/models/gpt-5.4)
- [OpenAI GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Claude 模型列表与能力字段](https://platform.claude.com/docs/en/api/models/list)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode)
- [Gemini Generate Content thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)

品牌 SVG 来源与许可见 `model-provider-icons-LICENSE.txt`。开发验证使用模拟返回和临时组件预览，不使用真实用户 Key。
