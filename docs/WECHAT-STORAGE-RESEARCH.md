# 微信 4.1.15 本地存储调查与 AIWC 读取参考

调查日期：2026-10-14。目标：macOS 微信 4.1.15，构建号 270134。

本次使用相邻 `rea` 项目的 REA 6.4.0，对已安装客户端做静态分析，并只读检查本地目录、数据库/WAL 文件头和图片文件头。目的是为 AIWC 后续适配提供证据与调查入口，**没有修改生产读取逻辑**。

> **REA 分支实现更新（2026-10-15）：** §1–§7 是 2026-10-14 的静态与文件头研究快照，保留其当时“没有获取密钥 / 没有修改生产逻辑”的范围说明。后续登录材料研究与 REA 已接入实现另见 [登录密钥调查 §8](WECHAT-LOGIN-KEY-RESEARCH.md)；本文 §8 说明新的真实 reader 证据及尚未解决的存储语义。原工作区检查数量不作为 REA 分支验收结果。

## 1. 结论与证据边界

AIWC 的总体方向与本机存储结构一致：从账号目录发现数据库，跨消息分片读取，以镜像库提供检索，媒体按需定位与解码。更有价值的后续工作是补齐资源索引语义和增量同步完整性，而不是另写一套数据库读取器。

本文区分三种依据：

- **观察**：REA 的 Mach-O 元数据、客户端中的原始字符串、指定范围的指令，以及本机文件元数据和固定长度文件头。
- **源码事实**：当前 AIWC 实现已经做了什么；这不等于证明微信内部算法相同。
- **推断或待验证**：需要反编译、数据库 schema 或受控行为对照才能确定的语义。

本地账号目录可能由此前版本创建，不能把所有历史文件归因于 4.1.15。微信未停止写入，本次目录与文件头观察不是一致性数据库快照。没有读取聊天正文、获取密钥、附加进程或触发登录挂钩。

### 1.1 REA 成功取得的证据

| 操作 | Evidence ID | 用途 |
|---|---|---|
| `inspect_macho` | `ev_48d90c88616009e1b34111869f5c0131671d3c75aaa1edf7cb8749e85b9e8f43` | 业务库身份、架构、段/节、导入、函数起点表 |
| `trace_dylib_resolution` | `ev_482ce10281858777704be886cc36ea6e06c23d8b544ceb2099412d1c269c317d` | 包内动态库依赖与可静态解析的路径 |
| `inspect_native_dispatch_metadata`，目标为 WCDYWrapper | `ev_df245ab3a85e4df8ab90f508b42b992e3fdc4ad0d986794f99b2bb35a1815614` | 较小包装库的元数据；没有取得存储业务方法 |

完整证据保存在本机相邻目录 `rea-investigations/wechat-4.1.15-20261014/`。`investigation-ledger.json` 记录调查范围、证据 ID、AIWC 被审计文件哈希和验证结果。`storage-metadata.json` 只保留匿名账号标签、路径结构和聚合元数据；这类本机材料不放入仓库。

### 1.2 已知分析限制

- Hopper 未安装，Ghidra 与 IDA 未配置，所以没有得到完整函数反编译结果。
- 业务库为 357,747,072 字节；REA 的 Apple 静态元数据读取器拒绝超过 64 MiB 的输入。失败保存为 `rea-core-dispatch.json`，不是成功分析结果。
- REA 的 SQLite 检查只接受普通 SQLite 快照，不支持直接打开加密微信库。本次没有取得微信表的完整 schema。
- 补充 ARM64 扫描只寻找相邻 `ADRP + ADD` 构造的字段地址，函数起点来自 `LC_FUNCTION_STARTS`；它不是完整交叉引用或数据流分析。

## 2. 应该分析哪个客户端文件

真正的业务库是：

```text
/Applications/WeChat.app/Contents/Resources/wechat.dylib
SHA-256: a1709ba62cae1b8b2705137980e23983ed42dc88affe774c4442488b82b007fe
```

`Contents/MacOS/WeChat` 和 `Contents/Frameworks/wechat.dylib` 都很小；不能只分析它们便声称完成业务逆向。REA 记录的业务库包含 x86_64 和 arm64 两个切片，本次指令调查使用 arm64：

| 属性 | 值 |
|---|---|
| 原始通用文件中的切片起点 | `0x0b010000`，184,614,912 字节 |
| arm64 切片大小 | 173,132,160 字节 |
| arm64 UUID | `8ACF7A2F-517C-32B4-9DFB-47E8849CD444` |
| 公开导出观察 | `_WeChatMain`、`_SetWeixinCallbackFunc`；符号清单可能不完整 |

业务库导入了 WCDYWrapper、文件访问和密码学相关接口；**导入存在不证明具体存储代码调用了它们，也不能据此恢复加密参数**。

## 3. 本地文件组织

### 3.1 账号根目录

本机观察到的主路径与 AIWC 的发现逻辑一致：

```text
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/
  <account-directory>/
    db_storage/
    msg/
    cache/
    config/
    resource/
    temp/
    business/
    apm_record/
```

目录名必须作为不可信路径片段处理。账号目录名和聊天会话 id 不能混用。AIWC 已有入口：[dbRoots.ts](../packages/substrate/src/discovery/dbRoots.ts)、[dbFiles.ts](../packages/substrate/src/wcdb/dbFiles.ts)。

### 3.2 数据库拆分

下面是本机目录结构和客户端字符串的共同线索；用途列仍需结合实际表确认：

| 相对 `db_storage` 的位置 | 读取参考 |
|---|---|
| `session/session.db` | 会话列表与变化检测；AIWC 查询会话表 |
| `contact/contact.db`、`contact/contact_fts.db` | 联系人与群信息、搜索辅助库 |
| `message/message_N.db` | 普通消息分片；不要只读第 0 个库 |
| `message/biz_message_N.db` | 公众号等业务消息分片；本机与普通消息放在同一目录 |
| `message/media_N.db` | 语音等媒体记录；本机位于 `message/`，不是独立 `media/` 目录 |
| `message/message_resource.db` | 独立资源数据库；本次优先调查对象 |
| `message/message_fts.db` | 微信自身搜索辅助库；AIWC 可以继续维护自己的 FTS |
| `hardlink/hardlink.db` | 媒体文件索引；完整表版本语义尚未验证 |
| `head_image/head_image.db`、`emoticon/emoticon.db` | 头像与表情资料 |
| `favorite/`、`sns/`、`general/`、`bizchat/` 等 | 扩展业务库；不能仅凭名字决定全部内容 |

客户端还包含 `biz_media_` 命名片段，本次本地目录里没有观察到对应文件。它是待验证候选，不应直接加入“必需数据库”列表。

AIWC 的 [dbFiles.ts](../packages/substrate/src/wcdb/dbFiles.ts) 已通过递归回退支持本机 `message/media_N.db` 位置。本文不需要改变这项行为。

### 3.3 WAL 是读取的一部分

观察到的非空 WAL 文件头为 SQLite WAL magic `0x377f0682`、版本 `3007000`、页大小 **4096**。主数据库文件没有普通 `SQLite format 3` 文件头。这与现有加密库/WAL 路径相容，但不足以独立证明 AES 模式、KDF 次数、reserved 大小或 HMAC 开关。

因此“复制 `.db` 再读”不能作为完整读取方案：最新已提交内容可能仍在 WAL。AIWC 的 [sqliteWal.ts](../packages/substrate/src/wcdb/sqliteWal.ts) 已验证 WAL 校验链、盐与提交边界，[decryptedCopy.ts](../packages/substrate/src/wcdb/decryptedCopy.ts) 把结果写到应用缓存；应继续复用。跨多个微信业务库的一致性不由单库 WAL 验证保证。

## 4. 消息与媒体文件的对应关系

### 4.1 消息正文与身份

在业务库的 arm64 `__cstring` 中直接观察到：`sort_seq`、`real_sender_id`、`download_status`、`server_seq`、`origin_source`、`message_content`、`compress_content`、`packed_info_data`。

其中 `sort_seq`、`real_sender_id`、`download_status`、`server_seq` 和三个正文/附加信息字段在同一个候选函数 `0x4cbf404` 中有地址构造指令，增加了它们与同一对象字段绑定相关的可信度；还不能据此宣称已经恢复完整建表 SQL。

AIWC 当前实现：

- [tableResolver.ts](../packages/substrate/src/wcdb/tableResolver.ts) 按 `Msg_<md5(sessionId)>` 找表，并跨分片、多表合并；这个命名公式是当前读取实现，尚未从微信函数恢复。
- [messageQueries.ts](../packages/substrate/src/wcdb/messageQueries.ts) 用分片内 `Name2Id.rowid` 解析发送者，优先 `sort_seq` 排序。
- [rowDecoders.ts](../packages/substrate/src/wcdb/rowDecoders.ts) 只在标准 Zstd 帧头成立时解压正文，再交给 XML/消息类型归一化。微信的字典压缩配置仍待验证。

### 4.2 图片目录与格式

本机观察到图片目录模式：

```text
msg/attach/<32位十六进制目录>/<YYYY-MM>/Img/<name>.dat
```

第一级确实长得像哈希；**尚未证明它一定等于 `md5(sessionId)`**。年月目录也不应未经对照便认定来自消息时间而非下载/落盘时间。

同一扩展名下存在两种明确文件头：

- `07 08 56 32 08 07`：V2 标识。样本的 15 字节头中，两段长度按 AIWC 当前格式解释时均在文件大小界限内；没有执行解密，不能据此单独证明密码学算法。
- `FF D8 FF`：JPEG 标识。样本里主要对应 `_t_M.dat`，也观察到 `_M.dat`。扩展名不表示一定加密。

本次样本没有 V1 或旧 XOR 格式，不能据此删除旧版本兼容逻辑。部分样本的 `st_nlink > 1` 证明本地确实有多链接文件，但未恢复索引表如何创建这些链接。

AIWC 的 [datDecryptCore.ts](../packages/substrate/src/decrypt/datDecryptCore.ts) 已支持普通图片、旧 XOR、V1/V2 与 wxgf 分流；[mediaResolver.ts](../packages/substrate/src/wcdb/mediaResolver.ts) 已支持 `_h`、`_t`、`_M` 变体。应保留文件头判断，不按后缀硬编码格式。

### 4.3 hardlink 与资源索引

客户端字符串中有 `file_name`、`file_size`、`modify_time`、`dir1`、`dir2`，以及可读的 `hardlink_info_v`、`CleanOldVersion...` 片段。AIWC 当前查询 `image/video/file_hardlink_info*`，经 Dir2Id 重建路径。**本次未验证这些精确表名、各版本表的迁移规则或 Dir2Id schema**。

值得优先追查的另一路是 `message_resource.db`。客户端中有 `MessageResource`、`save_name`、`session_usernam`、`db_resource_ty`、`download_statu` 等可读片段，其中一些是截短并相邻的常量，不能直接作为完整字段名。另有完整字段名 `chat_name_id`、`msg_create_time`、`msg_local_id`、`res_path`；后三项在候选函数 `0x4cd87b0` 中出现。可合理怀疑存在“消息身份 → 资源路径/下载状态”的结构，但目前没有证据把这些字段全部归到某个确切数据库表。

如果后续 schema 和调用路径证实这条关系，可以补成结构化资源定位，减少文件名猜测与全目录扫描。当前 [contentParsers.ts](../packages/substrate/src/wcdb/contentParsers.ts) 对 `packed_info_data` 的处理只是可打印字节提取与正则匹配，不是 protobuf 字段解码；没有取得字段定义前不能改成猜测性的解析器。

### 4.4 语音、视频和普通附件

- 观察到 `media_N.db` 与 `voice_data` 字符串；`voice_data` 地址构造位于 `0x4d33c00`。当前 AIWC 通过 `VoiceInfo%` 读取 BLOB，但表名与匹配字段还需 schema 验证。
- 视频目录模式为 `msg/video/YYYY-MM/`，样本中同时有缩略图和视频文件；缩略图存在不保证原视频已下载。
- 普通附件目录模式为 `msg/file/YYYY-MM/`。文件名能帮助定位，但同名、重命名和多次下载不能靠名称消歧。
- `cache/` 有另一些缩略图和临时媒体目录；不是聊天消息数据库的替代来源。

## 5. 下一轮反编译的具体入口

以下地址全部是**该 SHA-256 的 arm64 切片中未加 ASLR slide 的虚拟地址**，不是运行中进程地址。不得跨版本复用。补充材料 `arm64-field-references.json` 给出原始文件偏移与定位规则，`arm64-field-snippets.txt` 保存少量原始指令的解码。

| 调查对象 | 候选函数起点 | 具体字段引用指令 |
|---|---|---|
| 文件名、目录字段绑定 | `0x4cae920` | `file_name: 0x4caea40`；`dir1: 0x4caeb2c`；`dir2: 0x4caeb78` |
| 消息字段绑定 | `0x4cbf404` | `sort_seq: 0x4cbf530`；`message_content: 0x4cbf7d0`；`compress_content: 0x4cbf818`；`packed_info_data: 0x4cbf860` |
| 消息资源路径字段 | `0x4cd87b0` | `msg_create_time: 0x4cd8880`；`msg_local_id: 0x4cd88cc`；`res_path: 0x4cd8918` |
| 语音对象字段 | `0x4d33c00` | `chat_name_id: 0x4d33c3c`；`voice_data: 0x4d33d78` |
| 另一处 packed_info_data 使用 | `0x4d9173c` | `0x4d918ac` |

先从这些地址确认字段绑定对象与被调用函数，再追到写入者、序列化者、表创建和查询者。不能把字段注册函数误当成 `packed_info_data` 的解析函数。

## 6. 对 AIWC 的建议优先级

### 6.1 可先用合成测试验证的读取完整性风险

这些结论来自当前源码，不依赖反编译结果，也没有作为本次修改实施：

| 优先级 | 问题与触发条件 | 后续改动方向 |
|---|---|---|
| P1 | `messageQueries.ts` 单分片查询失败后继续返回其余结果；`facade/sync.ts` 仍推进会话 watermark。较旧的失败分片消息可能以后被跳过 | 返回读取完整性状态；不完整页不推进完整会话游标，或按分片维护游标 |
| P1 | `sessionQueries.ts` 对变化会话倒序 `LIMIT 200`，reader 随后推进最大时间；一次超过 200 个变化会话时会漏掉剩余部分 | 完整分页或达到上限时触发全量刷新；处理相同 timestamp 的分页边界 |
| P1 | `bridge.ts` 保留超安全整数为字符串，但 `messageMapper.ts` 把 `serverId` 再转 Number，并用于语音匹配和身份 | 贯穿十进制 string/bigint；使用超 `2^53 - 1` 的合成 ID 回归测试 |
| P1 | hardlink 的目录、文件名直接 join，图片读取前缺少统一路径边界校验 | 校验路径片段、规范化路径及 realpath 包含关系，在读取前拒绝越界 |
| P2 | hardlink/dat/voice 缓存是模块级 Map；reader 关闭没有统一清理 | 把缓存归 reader/media resolver 实例所有，关闭时释放 |
| P2 | 独立 hardlink/media 目录不在监听清单；语音库列表只在 open 时枚举 | 在媒体变化时更新索引与库清单；兼容本机位于 message 目录的媒体库 |
| P2 | 文件重名兜底在月份目录找到候选，却用 `join(root, name)` 检查大小 | 让匹配回调得到候选完整路径，并用月份子目录内路径校验 |

### 6.2 必须先取得微信语义证据的适配项

1. 恢复 `packed_info_data` 字段定义，确认每种媒体的文件名、尺寸、类型和资源身份如何编码。
2. 确认 `message_resource.db` 的 schema、关联键、下载状态及保存路径；避免把“没下载”当成“找不到”。
3. 确认 hardlink 表版本是否并存、旧记录是否迁移；之后再决定跨版本表查询。
4. 确认 `sort_seq` 的唯一性、跨分片顺序、回补和撤回更新方式；单一 `seq > watermark` 的正确性需要这些前提。
5. 确认正文的 WCDB 压缩配置与字典，数据库 KDF/HMAC 参数；文件头匹配不足以证明这些值。

## 7. 可重复执行的验证

在 `rea` 根目录，使用满足其版本要求的现有 Node.js：

```sh
node scripts/rea.mjs inspect-macho /Applications/WeChat.app/Contents/Resources/wechat.dylib --json
node scripts/rea.mjs trace-dylib-resolution /Applications/WeChat.app --json
node scripts/rea.mjs providers --json
```

输出可能较大，应存为独立本地材料再查看摘要。不要为完成本次调查改 REA 的输入预算或自动安装反编译器。

本次 `npm run check` 完整通过：格式、类型、lint、死代码和测试均通过，437 个测试文件、3379 个测试成功，5 个真实数据测试按无显式配置跳过。它验证的是当前 AIWC 工作区，不证明本文待验证的微信内部语义。本文是研究资料，未改变 DESIGN-SPEC、ARCHITECTURE 或产品行为。

## 8. REA 读取实现更新（2026-10-15）

后续 [登录密钥调查](WECHAT-LOGIN-KEY-RESEARCH.md) 找到了该版本已打开 codec 中每库派生材料。REA 已实现版本绑定的只读 helper、账号私有 safeStorage 凭据集合，以及不访问进程的每库 resolver；常规连接先打开文字数据，图片由独立动作补齐。生产路径和权限边界见该报告 §8 与 [ARCHITECTURE §13](ARCHITECTURE.md)。§1 的“没有读取正文或获取密钥”只描述本次最初文件头调查，后续端到端验证另列如下。

生产 helper 在本机 82 个候选文件中认证 24 个，不以此推断登录身份。后续真实 reader 选用认证后的会话、联系人和全部发现消息分片，读取 1024 会话、17580 联系人、6 个分片及 200 条消息，输出仅保留聚合计数，未保留正文、凭据或账号标识。reader 关闭后用同一内存 bundle 重开，无需再次访问微信进程；源主数据库文件及同级清单未变，临时明文缓存已删除。现场微信保持运行、存在 8 个 WAL；这不是微信退出或 Electron 跨进程恢复的现场验收，也不保证跨库一致性快照。

真实 Electron 后续验证另见 `electron-safeStorage-rea-sanitized.json`：采集 497 ms，24 条逐库材料经系统 safeStorage 加密保存，新 SecretStore 实例重载后集合一致；覆盖认证耗时 76 ms，24/25 个库可认证，所选会话、联系人及全部消息分片可用，1 个未覆盖库仍明确报告。配置只含引用，数据库 ACK 在保存后发出；2 个 utility 正常退出，0 次强制终止、0 个残留 helper、stderr 0 字节，临时账号环境全部清除。材料只经私有消息和加密文件流转，脱敏输出不含正文或凭据，未使用网络。此项证明本机加密保存与新存储实例重载，仍未重启整个 Electron、未退出微信。

每库凭据账号强制使用现有 SQLCipher 只读源文件 / 应用缓存副本路径，不直接在微信目录建立数据库连接。单库 WAL 仍复用 `sqliteWal.ts` 的盐、checksum 链与完整提交检查，再认证解密页面。合成加密库测试覆盖 committed WAL 叠加、salt 变化、错误账号材料、源文件 / 清单不变与 reader 重开。

§6.1 的失败分片风险在 REA 凭据读取路径新增了防线：任何必需消息分片缺少凭据或不能读取时明确失败，镜像同步不把不完整页当成空结果推进会话 watermark。已保存联系人或分片消失也保留 locked 状态。其余大量变化会话分页、超安全整数身份、媒体目录边界、缓存归属和资源索引语义仍须独立审计；本轮连接实现不能作为这些风险均已修复的证据。`packed_info_data`、`message_resource.db`、hardlink 表迁移、跨分片排序和压缩字典等微信内部语义仍按 §6.2 保留未知，不能从密钥认证成功推断它们已被恢复。

§7 的全套检查数量属于最初研究工作区。REA 分支最终 `npm run check` 已通过：格式、类型、lint、knip 全绿，434 个测试文件、3412 个测试通过，4 个真实数据库测试按无显式数据配置跳过；生产构建也通过。工程结果、真实 reader 与 Electron safeStorage 现场证据各有上述范围，SIP 开启、正式签名、Intel、其他微信版本，以及整个 Electron 重启和微信退出生命周期仍待验证。

REA 完整启动验收：使用独立临时 userData 启动最终生产构建，渲染层成功调用 `app:getInfo`，183 个 IPC 通道完成注册，数据后台就绪，应用退出码为 0，关闭清理完成。运行使用本工作目录独立安装的 Electron；未改动主工作区或现有 AIWC 用户目录。此项为无账号的启动测试，真实凭据链路验证见上面的 safeStorage 独立实测。
