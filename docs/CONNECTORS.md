# 本机来源接入

深矿读取你明确选择的项目、受支持的本地日志和输出目录，也接受工具主动提交的结构化事件。它不会自动接管所有 AI 软件、读取网页账号或还原全部会员账单。每台电脑需要自己的本地路径和配置；当前没有跨电脑自动同步。

运行环境为 Node.js 20+，没有第三方 npm 依赖。Windows 已有实机运行；macOS/Linux 的路径和协议处理有隔离样例覆盖，但尚未在实机验收。以下跨平台路径示例是配置方式，不是平台认证。

## 设置项目

从 GitHub 首次安装、主要使用 Codex 时，在源码目录运行 `npm run connect:codex`。从这台电脑的会话列表中选一个项目，程序会保存选择并启动。每台电脑使用自己的 Codex 主目录和存档。[Codex 首次连接与排查](CONNECT-CODEX.md)

在应用源码目录执行：

```powershell
npm run setup -- --project "D:\Work\my-project" --outputs "exports,images" --no-ai
npm start -- --no-ai
```

macOS/Linux 使用本机路径：

```sh
npm run setup -- --project "/home/me/work/my-project" --outputs "exports,images" --no-ai
npm start -- --no-ai
```

`setup` 新建配置时，省略 `--outputs` 会关闭输出目录扫描。`connect:codex` 为首次选择的普通项目默认收录项目目录。项目可以没有 Git。设置写入本机应用数据目录，各平台路径见 [README](../README.md#数据与发布边界)。修改配置后重启服务。

`--no-ai` 推荐保持开启：它关闭旧版可选的 Codex 语义解读服务，不关闭本地计量、输出或记忆。新建设置默认关闭该服务，当前矿坑的文件物件也不依赖它。读取 Claude Code 的已有日志不要求安装 Codex CLI。

| setup 参数 / 配置 | 含义 |
| --- | --- |
| `--project` / `projectPath` | 必填，本机已经存在的项目目录。 |
| `--scope` / `scopePath` | 会话 cwd 的目录边界，必须包含项目，默认项目本身。扩大边界会包含其他会话，不代表这些调用都对应当前文件。 |
| `--codex-root` / `codexRoot` | 覆盖 `CODEX_HOME`，否则使用用户目录下 `.codex`。 |
| `--claude-root` / `claudeRoot` | 覆盖 `CLAUDE_CONFIG_DIR`，否则使用用户目录下 `.claude`。 |
| `--usage-import` / `usageImports` | 逗号分隔的单次调用 `.ndjson` / `.jsonl` 文件，配置为数组。 |
| `--outputs` / `outputDirs` | 逗号分隔的项目相对输出目录，配置为数组。 |
| `--timezone` / `timezone` | IANA 时区，如 `Asia/Shanghai`、`Europe/Berlin`；默认本机时区。日期归属和结算采用该设置。 |
| `--locale` / `locale` | `auto`、`zh-CN`、`en`、`ja`。自动时参考近期项目对话，浏览器仍可手动覆盖。 |
| `--history-days` / `historyDays` | 每次采集回填范围，默认 365，允许 1–10000。不是历史保留期限。 |
| `--memories` / `memories.enabled: true` | 主动启用项目范围内的有限对话节选；默认不启用。 |
| `--no-memories` | 停止后续日志记忆采集，不删除已经归档的记录。 |
| `--capture` | 逗号分隔的 `openai,anthropic,gemini`，显式配置需要的代理来源；默认没有代理。 |
| `--openai-base-url`、`--anthropic-base-url`、`--gemini-base-url` | 设置选定协议的固定上游，不在地址中填写凭据。详见 [API 接入](API-CONNECTORS.md)。 |
| `--no-capture` | 关闭所有已配置代理来源。 |
| `--no-codex` / `--codex`、`--no-claude` / `--claude`、`--no-imports` / `--imports` | 关闭或重新启用对应日志/导入来源。 |
| `--no-ai` / `--ai` | 关闭或显式启用旧版可选 Codex 语义解读。推荐关闭。 |

运行 `npm run setup -- --help` 查看设置参数；`npm run doctor` 读取配置并诊断当前矿坑实际使用端口的来源状态。不要把 setup 的全部参数直接当作 server 命令参数；一般先保存配置，再运行 `npm start -- --no-ai`。

## Codex 与 Claude Code 用量

Codex 读取 `sessions` 与 `archived_sessions` 中的项目归属和累计 Token 事件，用相邻增量、会话标识去重与跨日基线归一化。缓存已经包含在输入中，不能再次相加。缺少可靠增量基线、格式不支持或扫描不完整时保留诊断，不猜出完整计量。

Claude Code 适配器扫描 `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`，也处理受支持的嵌套 subagent 日志。Windows 的 `~` 对应当前用户目录；`CLAUDE_CONFIG_DIR` 可覆盖根目录。记录须带匹配的 cwd、`sessionId`、时区时间、`message.id` 和 `message.usage`；可选 `requestId` 帮助去重。

同一 message/request 的副本只计一次；流式重复采用一致的较大计数，冲突调用排除并提示不完整。子代理的独立调用计入，重复父消息不再叠加；不会把会话终局累计量再加到单次调用上。

Claude 输入按普通输入、缓存读取和缓存创建归一化：

```text
inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
cachedInputTokens = cache_read_input_tokens
cacheWriteInputTokens = cache_creation_input_tokens
totalTokens = inputTokens + output_tokens
```

缺少必要缓存字段时完整输入保留未知，已知输出仍可显示。未报告的推理计数不填零。这些是处理过的 Token 数，不是价格、会员额度或工作质量。

格式参考：[Claude 会话浏览器示例](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)、[配置路径](https://code.claude.com/docs/en/settings)、[Hooks 与 subagent](https://code.claude.com/docs/en/hooks)、[缓存计量](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。本地日志不是永久不变的协议，适配器未覆盖所有历史版本、账号和系统组合。已删除、尚未落盘和其他电脑的日志不在当前采集范围内。

## 通用单次调用导入

其他工具可导出 UTF-8 NDJSON/JSONL，每行一个 JSON 对象。例如：

```json
{"schemaVersion":1,"id":"call-001","source":"my-editor","projectPath":"/home/me/work/my-project","timestamp":"2026-11-18T12:00:00+08:00","sessionId":"session-001","usage":{"inputTokens":100,"cachedInputTokens":40,"outputTokens":20,"totalTokens":120}}
```

这是格式示例，不是个人真实用量。`id` 必须稳定标识一次调用，`source` 为工具标记；计数必须是**单次调用增量**，不能填累计账单或会话总量。输入包含缓存，`totalTokens = inputTokens + outputTokens`；未知缓存可为 `null`。没有真实 Token 计量时，不能用图片数量、字数、运行时间或估算成本代替。

`projectPath` 须与这台电脑选择的项目规范化路径完全一致。`source + id` 重复只计一次，冲突的计数、会话或时间会排除该调用并给出诊断。`codex`、`claude`、`claude-code` 等保留标记不能伪作通用导入来源。不同别名重报仍可能造成重复，不能同时用日志、代理和 Hook 导入同一次调用。

只接受定义内的字段；不接收任意正文、工具载荷、`cumulative` 或 extra 数据。最多配置 20 个显式文件，扫描也有行数和大小预算；截断时提示不完整。

## API、SDK 与其他软件

本机代理支持 OpenAI Chat Completions / Responses、Anthropic Messages、Gemini GenerateContent 的指定 JSON/SSE 路由，默认关闭。仅完成且返回合法 usage 的请求进入计量；断流、失败、缺 usage 不会伪造成功数据。调用方使用自己的上游凭据；模型内容仍会到配置好的上游，代理不是离线模型。

`POST /api/events` 接受用量、输出和记忆，要求 `X-Deepmine-Key`。服务生成的密钥位于当前存档目录的 `ingestion.key`。所有事件都需要所选项目、稳定 ID、来源、会话与时间；重复不增发，冲突被拒绝。不要公开密钥或把它写进共享配置。

- Node.js 工具可用 `integrations/deepmine.mjs` 的 `createDeepmine()`，再调用 `recordUsage`、`recordApiResponse`、`recordOutput` 或 `recordMemory`。
- Hook 可调用 `npm run record -- --file event.json`，或从标准输入传入一个结构化事件；辅助脚本读取本应用配置与本机密钥。
- OpenCode、Cline、Continue、Aider 提供相应的可配置 API 地址模式，可尝试对接支持的协议；并非所有 provider、OAuth 或流式传输模式都兼容，尚未逐个客户端完成实测。
- Cursor 云端请求不能访问本机 `127.0.0.1`。本地可用的 Hook/导出桥只能提交软件实际提供的输出、记忆或真实计量，不因此获得 Cursor 全量用量。

完整路由、消息结构、SDK 示例、官方客户端配置出处和验证限制见 [API-CONNECTORS](API-CONNECTORS.md)。不建议为接入云端客户端而把本地服务公开到公网。

## 输出文件与当前图片预览

配置 `outputDirs` 后，可记录网页、文档、图片、音频、视频、幻灯片、表格、代码和普通文件。文件按修改时间归入设置的回填范围，生成内容指纹，并写入本地历史。复制旧文件、恢复备份或重新保存可能改变修改时间；它不是可靠的创作时间，也不证明文件已经完成或由某 AI 生成。

扫描仅限项目内显式目录，跳过隐藏项、凭据/密钥命名、依赖目录和符号链接。当前预算为 500 个输出、5000 个目录条目、单文件 32 MB、总读取 64 MB；超限会留下覆盖说明。生成指纹会在本机读取文件字节，不会把它们发送给旧版语义服务。

同日 Git 与输出引用重叠路径时按规则去重，保留相应来源关系；多个文件分组展示，不按提交数量铸造奖品。已经归档的输出观察不会因为文件后来删除而自动消失。

`GET /api/preview?path=...` 只提供当前快照引用的项目内 PNG、JPEG、WebP、GIF，最多 8 MB，并再次验证路径边界。它显示**当前文件**，不是提交时或观察时版本；删除后预览可能不可用。SVG/HTML 等主动内容不开放，不提供任意路径浏览。演示模式不会请求真实文件预览。

## 对话节选、AI 记录与自动语言

日志记忆需通过 setup 的 `--memories` 主动启用。采集限于选定 cwd 范围：Codex 最终回复，或带 `[[DEEPMINE_MEMORY]]` 标记的受支持助手消息；不收集子代理中间过程来冒充最终结果。保留最多 500 字符的节选，并附时间、来源与消息引用。当前日志扫描每天最多选取三条，扫描也有文件数与字节预算。

日志节选在界面标为“对话节选”。工具通过 `/api/events` 显式提交的结构化短记忆标为“AI 记录”，并要求 `sourceRef`；两者都不是自动核实过的完成结论。关闭日志记忆不删除以前保存的记录，也不代表撤销工具已主动提交的事件。

语言自动模式可在本机参考该项目近期用户消息，使用中文、英文或日文启发式判定；只输出语言偏好，不把原始用户消息存进快照。即使没有启用记忆，此本地语言识别仍可运行。手动界面语言优先，随后是设置的 locale/近期对话偏好，最后参考浏览器语言。原始标题与节选不擅自翻译。

## 长期历史与结算

服务将归档放在存档目录的 `history/`，按项目隔离；事件另存在 `events/`。默认每次回填最近 365 天，`--history-days` 可调整回填范围，已经保存的更早日期不会因此滚出。来源临时离线时保留此前观测值；当前来源状态仍单独显示为缺失或异常，不能把历史值当作实时连接正常的证明。

v0.14 的每日用量深度为 `min(300, floor(14 × log2(1 + totalTokens / 500)))`。有可见成果时增加 12 米，再为每个文件类别、每个记忆组各增加 18 米。记忆最多三组。未知用量只按已观察到的成果计算。旧存档从升级当天启用新比例。

过去日期自动结算，关机期间由下次启动补齐。今天新增先保留待挖，点击“开挖”后进度由服务持久化、限制在已记录目标内；刷新、回看和重复点击不会增发。切换项目使用对应项目的历史；更换时区会影响日期归属，现有历史时区不匹配时会保留原文件并报错，不静默重写。

## 诊断与公开范围

`GET /api/connectors` 返回来源状态、配置能力和诊断，不返回认证或原始日志。状态包括 connected、partial、missing、error、disabled。一个工具缺失不会让另一个已知来源全部变成零；合计只代表已经观测的范围。

`snapshot.usageSources` 列出真实来源，`days[].usageSourceIds` 在有记录时关联当天来源。旧归档缺少关联时，界面显示登记来源与“当日覆盖未知”。`sources.codex` 是兼容汇总通道，不能仅凭字段名把 Claude 或事件用量标成 Codex。所有日期采用配置时区；缓存包含在输入内，推理包含在输出内，不能再加一次。

计量快照不保存完整会话正文或工具载荷；启用的短记忆是另一个明确保存的内容入口。旧版可选 AI 解读如果主动启用，Git 标题、哈希和相对路径会发送到模型，不能宣称全程离线。

真实记录只用于本机。源码包通过白名单排除 `.deepmine/`、密钥、日志、私人输出与截图。Sites 上的 v0.10 静态示例展示历史画面，最新版随本机服务提供。
