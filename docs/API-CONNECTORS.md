# API 代理、SDK / Hook 事件接入

这些入口让本机工具主动提交真实计量和可追溯记录。它们不会读取所有软件的私有数据库，也不能自动获取网页聊天或订阅产品的全部用量。协议兼容、软件提供可配置入口、实际完成端到端验证是三件不同的事。

## 显式启用本机代理

默认不启用任何代理来源。在当前存档目录的 `config.json` 配置需要的上游，然后重启：

```json
{
  "capture": {
    "providers": {
      "openai": { "baseURL": "https://api.openai.com/v1" },
      "anthropic": { "baseURL": "https://api.anthropic.com/v1" },
      "gemini": { "baseURL": "https://generativelanguage.googleapis.com/v1beta" }
    }
  }
}
```

只加入需要的 provider，或设 `enabled: false`。配置中不放 API key。调用方继续使用自己的真实凭据；它们只经过内存并转交配置好的上游。上游需要 HTTPS；仅显式配置的本机测试/推理服务允许 loopback HTTP。拒绝带用户名、密码、查询密钥的 baseURL，不跟随上游重定向，不接受请求参数指定任意上游。

| 协议 | 调用方使用的本机 API 根地址 | 支持路由 |
| --- | --- | --- |
| OpenAI | `http://127.0.0.1:4173/api/capture/openai/v1` | `POST /chat/completions`、`POST /responses`；JSON `POST /embeddings`、`POST /images/generations`；`GET /models`、`GET /models/<id>` |
| Anthropic | `http://127.0.0.1:4173/api/capture/anthropic` | `POST /v1/messages`、`POST /v1/messages/count_tokens`；`GET /v1/models`、`GET /v1/models/<id>` |
| Gemini | `http://127.0.0.1:4173/api/capture/gemini` | `POST /v1beta/models/<model>:generateContent`、`:streamGenerateContent`；`GET /v1beta/models`、`GET /v1beta/models/<model>` |

只支持表中的固定路由，不代理 multipart 图片编辑、文件上传、Realtime、WebSocket、OAuth 或任意资源。模型名和可用额度仍由上游账号决定。模型列表/详情与 Anthropic `count_tokens` 仅供客户端发现和预估，始终跳过实际用量记录；即使响应附有 usage，也不会挖掘或增加成果。它们仍要求真实上游凭据、已启用的 provider、同源本机请求，并拒绝重定向。

列表分页允许 Anthropic `limit` / `after_id` / `before_id`，Gemini `pageSize` / `pageToken`（数值上限 1000）；Gemini 支持 query `key` 或凭据 header。拒绝其他 query、重复参数、GET 请求体及任意 URL 目标。`nonMetered` 诊断仅统计成功透传的此类查询，不代表 Token 或工作量。已核对 [OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list)、[Claude Models](https://platform.claude.com/docs/en/api/models/list)、[Claude Count tokens](https://platform.claude.com/docs/en/api/messages/count_tokens) 与 [Gemini Models](https://aistudio.google.com/api-reference/models/list-models) 官方入口；测试通过不等于所有客户端版本已实装验证。

OpenAI Chat 流式请求会加入 `stream_options.include_usage: true`。只在成功响应完整结束、取得合法 usage 和稳定 response ID 后记入。Chat 需要 `[DONE]`，Responses 需要 completed，Anthropic 需要 message_stop，Gemini SSE 需要完成标记和正常流结束。缺 usage、失败、截断、超时或客户端提前断流均不伪造成功记录，即便真实上游可能已产生费用。诊断因此不是账单对账。

可选 `X-Deepmine-Source` 标签仅允许 `cursor`、`opencode`、`cline`、`continue`、`aider`、`custom`，形成 `api-<provider>-<tag>` 来源；这是调用方声明，不是自动鉴定软件。可选 `X-Deepmine-Session-Id` 关联真实会话；省略时用响应 ID 建立单次调用分组，不能将其数量理解为真实聊天会话数。不要同时用自动日志、代理与 Hook 重报同一次调用；不同来源之间不能凭 Token 数字推断重复。

请求体最多 8 MB，JSON 计量解析最多 8 MB，单个 SSE 元数据帧最多 2 MB。响应内容照常透传；超出计量解析能力时诊断为未记录。成功 ID 在进程内去重，持久化事件层负责跨重启去重。存储错误不伪装成已保存的计量。

## 计量关系

| 协议 | 归一化 |
| --- | --- |
| OpenAI Chat | `prompt_tokens + completion_tokens = total_tokens`；缓存和 reasoning 是包含关系。 |
| OpenAI Responses | `input_tokens + output_tokens = total_tokens`；details 中缓存和 reasoning 不重复加算。 |
| OpenAI Embeddings | `prompt_tokens` 为输入，生成输出为 0，要求 total 与输入一致；由响应 ID 或上游 request-id 引用。 |
| OpenAI Images JSON | 只使用响应中确实提供的 usage；无 usage 的图片仍透传但不计 Token，绝不根据图片数量或大小估算。 |
| Anthropic | 完整输入为普通 input + cache read + cache creation，再加 output；缓存字段缺失时不猜成零。 |
| Gemini | 完整输入取 prompt 与已报告 tool-use prompt；输出由 total 减完整输入，包含已报告 thinking；检查 candidates/thoughts 与总量一致，不再次把 thinking 加到 total。 |

未报告缓存或推理字段保留未知。对不能满足包含关系的 usage，保留诊断并不写入。支持上述协议不等于支持 Azure 专用路由、Vertex AI 专用路由、各厂商自定义代理或所有旧版本。

协议参考：[OpenAI Chat](https://platform.openai.com/docs/api-reference/chat/create)、[OpenAI Responses](https://platform.openai.com/docs/api-reference/responses)、[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Anthropic cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content)。当前验证使用本机模拟 JSON/SSE 响应，没有发起付费真实调用，不应把协议样例通过写成各厂商账号实测通过。

## 软件接入范围

| 软件 | 官方公开入口 | 本实现可以诚实承诺的范围 |
| --- | --- | --- |
| OpenCode | provider 的 `settings.baseURL` 可以指向代理。 | 在可配置 provider 模式中使用上述协议地址；不覆盖其 OAuth/WebSocket 模式。见 [Providers](https://opencode.ai/docs/providers/)。 |
| Cline | OpenAI Compatible provider 提供 Base URL、API Key 与模型配置。 | 可手动配置兼容端点；不是自动采集所有 Cline provider。见 [OpenAI Compatible](https://docs.cline.bot/provider-config/openai-compatible)。 |
| Continue | 模型配置支持 `apiBase`。 | 选择支持的 API provider 和 HTTP 模式；不是所有模型后端都适用。见 [Configuration reference](https://docs.continue.dev/reference)。 |
| Aider | 通过 `OPENAI_API_BASE` 配置兼容端点。 | 仅经过该地址的兼容调用可捕获；模型别名和 key 仍按 Aider 设置。见 [OpenAI-compatible APIs](https://aider.chat/docs/llms/openai-compat.html)。 |
| Cursor | 本地 Agent 提供 `afterFileEdit` Hook；BYOK 请求仍经过 Cursor 后端。 | 已实现下面的本地文件编辑桥接，保留真实路径与指纹；内建 Token 仍未知。不能承诺云端模式访问本机代理，不建议公开本机端口。见 [Hooks](https://cursor.com/docs/hooks)、[Bring your own API key](https://cursor.com/help/models-and-usage/api-keys)。 |

以上四种可配置地址的产品，已核对官方配置文档；本轮没有逐一安装并运行完整客户端。无法取得真实 usage 的 Hook 只能提交输出或记忆，不能用字数、运行时间或文件数估算 Token。

## Cursor 本地文件编辑桥接

`integrations/editor-hook.cjs` 接收 Cursor 官方 `afterFileEdit` 的 JSON stdin，使用 `file_path`、`conversation_id` 与 `generation_id`；`edits`、邮箱、模型参数和 transcript 不转发，也不读取 transcript 文件。该 Hook 记录 Agent 报告的编辑与当前文件指纹，不验证代码正确性或任务完成状态，不提供 Cursor 内建 Token。未接入 Tab、shell 写文件或人工编辑的事件。

先在这台电脑运行 `node scripts/setup.cjs --project "项目的绝对路径"`，再启动 `npm start`。将 `integrations/cursor-hooks.example.json` 的 `afterFileEdit` 条目合并到该项目的 `.cursor/hooks.json`，把命令中的示例路径换成本机 DEEPMINE 的真实路径；已有 Hook 应保留，不要直接覆盖整份配置。macOS / Linux 同样使用 Node，将路径换成对应绝对路径即可。项目换到其他电脑时重新配置项目路径，不复制本机 key。

```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [{
      "command": "node \"C:/path/to/deepmine/integrations/editor-hook.cjs\"",
      "timeout": 5
    }]
  }
}
```

桥接从当前存档目录的 `config.json` 读取项目，使用配置的 `ingestionKey` 或同一目录内的 `ingestion.key`；示例中不写密钥。默认从同一存档找到正在运行的深矿，核对项目与服务身份后向该回环端口发送事件。也可以在 Hook 命令后加 `--port 4174` 显式指定端口；不接受 Hook 输入指定目标 URL。服务若用代码自定义数据目录，须使应用配置中的 key 与服务一致。

只处理所选项目内真实文件，拒绝项目外路径、符号链接/目录连接、硬链接、隐藏项、依赖目录及凭据/配置文件。文件上限 32 MB、stdin 上限 2 MB。内容只在内存计算 SHA-256，提交的是相对文件路径、类型、指纹、修改时间和来源。稳定 ID 由项目、会话、generation、路径和指纹确定；相同通知经过事件库重启仍只保留一条。相同 ID 的不一致元数据会被服务拒绝，不覆盖原记录。

所有正常处理与失败路径均返回空 JSON、退出码 0；诊断仅在 stderr 给出有界错误代码，无正文、密钥或私人路径。HTTP 等待最多 1.5 秒，整个进程有 4 秒截止。服务离线、缺少配置或文件不可读时跳过，此桥接没有离线补发队列。不会修改真实 Cursor 全局设置。本轮通过 12 项临时文件与模拟 HTTP 测试，包含真实 CLI stdin、持久化重启、链接越界与离线路径；未宣称已安装并实测 Cursor 客户端。

## 结构化事件：SDK 与 Hook

`POST /api/events` 接受 JSON，并要求本机 `X-Deepmine-Key`。密钥由本地服务创建，保存在应用数据目录的 `ingestion.key`；不要发布、贴进截图或写入工具全局共享配置。事件必须指定所选项目在**这台电脑**的绝对路径、稳定 ID、来源、会话标识与带时区时间。重复事件不增加计量，冲突 ID 返回冲突；失败的持久化可重试。

用量事件示例（示例数值不是个人用量）：

```json
{
  "schemaVersion": 1,
  "kind": "usage",
  "id": "provider-response-001",
  "source": "custom-hook",
  "projectPath": "/path/to/project",
  "timestamp": "2026-11-18T12:00:00+08:00",
  "sessionId": "session-001",
  "usage": { "inputTokens": 100, "cachedInputTokens": 40, "outputTokens": 20, "totalTokens": 120 }
}
```

使用真实单次增量，不提交会话累计数。可选 `reasoningOutputTokens` 与 `cacheWriteInputTokens` 必须是已有输出/输入的子集。其他两种事件保持上述公共字段，替换 kind 和唯一 payload：

```json
{
  "kind": "output",
  "output": {
    "type": "image",
    "title": "矿井地图",
    "summary": "导出工具报告已保存此文件。",
    "files": ["exports/mine-map.png"],
    "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

上面的指纹是格式占位，真实事件须使用文件实际 SHA-256。类型限 web、document、image、audio、video、slides、table、code、file；文件必须为项目相对路径，不能传入隐藏凭据目录或绝对路径。事件声明和实际文件扫描是不同来源，不能把一份文件重复统计为两份工作完成量。

### 为作品附上生成经过

绘图软件、写作工具或代理在成功写出文件之后，可以通过 SDK 的 `recordOutput` 或上述 HTTP 入口提交生成回执。将 `receipt` 加到 `output` 中。事件的 `timestamp` 填写生成操作完成的时间，`source` 填写实际生成工具的稳定标识。下面的路径、哈希和时间仅用于展示格式。

```json
{
  "status": "completed",
  "operation": "create",
  "path": "exports/mine-map.png",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sourceRef": "draw-call:example-008",
  "usage": {"inputTokens": 900, "cachedInputTokens": null, "outputTokens": 600, "totalTokens": 1500},
  "title": "矿井剖面图",
  "requestedAt": "2026-11-18T09:15:00+08:00",
  "request": "画一张能看到不同岩层的矿井剖面图。"
}
```

若供应商报告了专用于此次作品的模型调用用量，可将它填入可选的 `receipt.usage`。它用于给该文件版本报价。涉及多个产物或只有整场会话用量时省略。每日用量仍由原本的计量入口负责，展示报价不会再次计入每日账本。

每份回执关联一个文件。生成工具须在输出成功后对实际写出的字节计算 SHA-256，使其与 `output.fingerprint` 一致。`path` 与 `output.files` 中的唯一路径一致。`operation` 可选 `create` 或 `edit`。`sourceRef` 使用能定位该次调用的稳定标识。`title` 可省略。真实用户原话最多 220 个字符，与 `requestedAt` 成对提供。开启项目的对话记忆后才保存新原话，关闭时游戏隐藏历史回执中的原话。

日志采集器也能核对 Codex 已完成的新增文件和图像生成，以及 Claude Code 已确认的文件写入和部分编辑回执。历史版本按路径及内容指纹补全，多次同步不会增加物件或重复计算 Token。同一版本出现多个互相冲突的来源时，游戏会撤回该项归因。

```json
{
  "kind": "memory",
  "memory": {
    "title": "选定四种地层",
    "summary": "本次讨论确定保留四种地层及可追溯的来源展示。",
    "objectType": "memory",
    "sourceRef": "message:decision-001"
  }
}
```

记忆是工具或 AI 主动提交的短条目，标题最多 120、摘要最多 500 字符，必须引用会话消息或任务 ID；不是整个提示词、回复或工具日志。它不能自动证明对应工作已完成。允许用户选择保存的短摘要，不接受 `prompt`、`reply`、`apiKey`、`secret` 等任意附加字段。字段校验无法保证摘要作者没有误写敏感信息，提交端应仅提供用户希望保留的内容。

输出与记忆的规范化公共记录包含 projectId，不带绝对 projectPath；用量内部记录暂为旧导入兼容保留本机路径，不应直接发布。Hook 的完成信号不等于模型 usage；若没有真实计量，只提交 output / memory。

## 模块集成合同与诊断

`api-capture.cjs` 提供 `createCapture({projectPath, projectId, providers, onEvent})`，返回 `handle(req,res)`、`diagnostics()`、`close()`。HTTP 主服务应在只读路由限制前分流 capture，保留 loopback、Host 与同源限制。`onEvent` 必须等待持久化，失败时 reject。

`event-ingest.cjs` 提供 `normalizeEvent(raw,{projectPath,projectId,now})` 和 `createIngest({projectPath,projectId,onEvent,now})`。`ingest(raw)` 返回 accepted/duplicate/conflict/rejected/failed；模块不自行写文件，主服务事件库负责持久化和跨进程去重。时区由采集配置控制每日聚合，事件本身保留带时区时间。

来源诊断只保存计数、错误代码、provider 与时间，不保存 Authorization、key 参数、请求体、响应体或上游错误正文。代理必然在内存经过正文以转发它，但不会将正文写入事件库；不要把“正文不落盘”误写成“正文从不经过代理”。查看 `/api/connectors` 了解启用来源与失败情况。静态 Sites 不运行这些本机入口，不发布真实事件或个人文件。
