# 途中资讯

游戏里原称「井下电台」的功能现在位于 **设置 → 途中资讯**。开启后可以在挖掘途中读一条有标题、发布时间和来源的消息。资讯单独计数，Token、可挖深度和作品数仍由项目记录决定。

项目附带一份 [field-news skill](../skills/field-news/SKILL.md)。现有的资讯工具可以按下方格式生成当日 JSON，交给深矿在本机读取。

## 藏宝图与档案箱

当天主动挖掘累计 12 米，会发现一张藏宝图。点右下角的档案箱，再点「展开藏宝图」，深矿才会访问 GitHub，取回所有语言的今日热门仓库榜首、项目简介和读取时间。榜单可能在当天变化，归档保留展开那一刻的项目。点「去看项目」打开仓库，点「放进档案箱」按日期收好。已解读的地图可以离线回看。断网时未解读的地图在当天仍可重试。试玩矿坑的示例地图会单独标明。[GitHub 官方每日榜](https://github.com/trending?since=daily)

## 触发与配置

途中资讯默认关闭，关闭时游戏不会发出资讯请求。当天主动挖掘累计达到 20、80、160 米，各解锁一个位置。可以等挖完再开启，到设置里读已经解锁的条目。切换速度只影响到达这些位置所花的时间。每个项目按配置的时区在午夜重新累计。

开启后，游戏优先读取本机当日资讯文件，默认文件名为应用数据目录下的 `field-news.json`。允许公共来源时，可以从 Hacker News 官方热门列表读取当天的条目。来源不可用时可以在当天再试。

```json
{
  "fieldNews": {
    "enabled": true,
    "feedPath": "today-news.json"
  }
}
```

相对 `feedPath` 按配置文件所在目录解析。以上示例会读同目录下的 `today-news.json`。本地文件缺失或不可用时，可以使用已启用的 Hacker News 后备来源。有效的本地文件若没有当日条目，资讯列表显示为空。

需要指定来源时，在本机运行 setup。下面是四种独立用法，任选需要的一条，随后重启服务。

```sh
node scripts/setup.cjs --project "/absolute/project" --news-feed "/absolute/feed.json" --local-news-only
node scripts/setup.cjs --project "/absolute/project" --no-news
node scripts/setup.cjs --project "/absolute/project" --news
node scripts/setup.cjs --project "/absolute/project" --public-news
```

`--local-news-only` 将来源限定为本机资讯文件，`--public-news` 允许使用 Hacker News 作为后备。服务端的 `--no-news` 和 `--news` 决定此项目是否允许采集资讯。浏览器里的「途中资讯」开关决定玩家是否要读，当次选择会保存在该浏览器。

用示例文件检查当天的本地交付。

```sh
node scripts/field-news.cjs --feed "/absolute/path/today-news.json" --timezone Asia/Shanghai --date 2026-11-18
```

需要直接查看 Hacker News 的当天结果时，可以运行以下命令。

```sh
node scripts/field-news.cjs --live --timezone Asia/Shanghai
```

没有 `--live` 时，CLI 不会把无效本地文件回退到网络。CLI 不保存文件、不安装插件、不启动定时器；输出为带 ready / empty / disabled / error 状态的运行结果。它与下面的外部 feed schema 不同，不能直接把运行结果重命名为 feed。

## 外部 skill 交付合同

```json
{
  "schemaVersion": 1,
  "date": "2026-11-18",
  "timezone": "Asia/Shanghai",
  "generatedAt": "2026-11-18T10:00:00+08:00",
  "source": {
    "id": "public-news-skill",
    "label": "实际使用的公开新闻来源",
    "url": "https://example.com/news",
    "language": "zh-CN"
  },
  "items": [
    {
      "id": "stable-source-item-id",
      "title": "示例占位标题；实际交付必须换成已核验的新闻",
      "url": "https://example.com/news/item",
      "publishedAt": "2026-11-18T09:00:00+08:00",
      "summary": "可选的短摘要，须根据公开来源概括。"
    }
  ]
}
```

示例不是新闻数据。date 与 timezone 必须匹配请求；generatedAt 与每条 publishedAt 均需明确时区、属于该本地日期、不能在未来；条目发布时间不晚于 feed 生成时间。标题上限 240 字符、可选摘要 400 字符，拒绝控制字符和 HTML。最多接收 100 条、文件上限 256 KB，默认展示最多 6 条；相同 ID / URL 去重。无效或异日条目被剔除并计入说明。

URL 仅接受不含用户凭据的公共 HTTP(S) 链接，拒绝本机/私网 IP、常见内部域、非默认端口和明显携带凭据的 query。模块不跟随这些新闻链接，也不抓文章全文。外部 feed 的来源与内容由交付方负责核验；格式校验不能证明报道真实，更不能证明其“热度”。外部 feed 不会获得模块捏造的排名。

## 公共来源的真实含义

内置来源使用 [Hacker News 官方 API 文档](https://github.com/HackerNews/API) 定义的 [`topstories.json`](https://hacker-news.firebaseio.com/v0/topstories.json) 和对应 `item/<id>.json`。它只读取当前榜单中的 story，排除 jobs、删除/失效项、未来或非目标日条目。`rank` 是抓取时榜单中的实际位置；`publishedAt` 对 HN 表示帖子提交时间，**不是外链文章发表时间**。这是以英文为主的科技社区来源，不能称为中文全网热搜。

默认最多检查前 24 个不同帖子，最多 3 个并发请求；每次请求上限 1.5 秒、最多重试一次，整次采集上限 6 秒。网络失败或被限流时返回明确状态；部分成功会标记 partial。结果缓存 15 分钟、错误冷却 30 秒，并发请求共享一次采集。显式刷新可绕过成功缓存，不能绕过短错误冷却。跨日不沿用前一日内容；历史日期不会用当前榜单冒充历史热度。

固定请求只去 HN 官方 API，不带账号、Cookie、项目名、源文件、对话、Token 或产物。服务无需模型调用。采集应在游戏循环之外异步进行；无网或无合格条目时继续开挖，不能用虚构新闻补位。

## 集成 API 与验证

```js
const { createService } = require('./scripts/field-news.cjs');
const news = createService({
  enabled: true,
  timezone: 'Asia/Shanghai',
  configDirectory: '/absolute/path/to/deepmine/.deepmine',
  feedPath: 'today-news.json'
});
const result = await news.get({ unlocked: true });
// Explicit refresh: news.get({ explicit: true, force: true })
// Local-feed-only: createService({ enabled:true, publicEnabled:false, ... })
news.close();
```

结果含 `status,date,timezone,source,items,fetchedAt,notes`；条目含 `id,title,url,publishedAt,sourceId,language`，HN 另有 rank / discussionUrl，外部 feed 可带 summary。可选 `partial,checked,cached,generatedAt` 描述采集状态。`diagnostics()` 只返回计数与启用/活动状态。调用方须将内容当作纯文本渲染，外链由用户主动打开，并设置相应 opener / referrer 隔离。

本模块 12 项测试验证触发门槛、本地优先、日期/时区、URL、并发与缓存、超时重试、停用和缺网状态。2026-11-18 04:01 UTC 的真实 HN 采集在 Asia/Shanghai 日期 2026-11-18 返回 6 条合格记录；检查了 18 个条目，达到时间预算后明确标记 partial。该结果只证明当次公开 API 连通与日期筛选有效，不保证随时有 6 条，也不证明外链报道内容已独立核实。
