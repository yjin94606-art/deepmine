# 深矿 · Deepmine

[English](../README.md) · **[网页试玩](https://yjin94606-art.github.io/deepmine/)** · **[下载 Windows x64 安装版](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-windows-x64-setup.exe)** · [macOS / Linux](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-source.zip) · [接入自己的工具](CONNECTORS.md)

**今天花掉的 Token，能在地下走多远？** 深矿是一款在自己电脑上玩的像素挖掘游戏。它读取你所选项目里的 AI 用量和作品记录，算出当天可挖的深度。钻头撞开岩层时，掉出来的可能就是你今天改了三遍的那张角色立绘。

![内置试玩实录：钻头向下破岩，黄围巾植物学家出土。点继续后恢复挖掘，再从时间轴回到旧矿层。](launch/digging-loop-zh.gif)

*实机录自内置的虚构项目。那枚叶子发夹改了两次，终于完整地露在刘海外面。* [静态大图](demo-portrait.png)

## 下载与试玩

Windows 用户打开安装包就能试玩，下次从开始菜单打开 **Deepmine**。所有版本都内置离线试玩矿坑。[下载深矿 v1.1.0](https://github.com/yjin94606-art/deepmine/releases/tag/v1.1.0)

| 电脑 | 下载 | 首次启动 |
| --- | --- | --- |
| Windows x64 | [离线安装版](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-windows-x64-setup.exe) · [便携版](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-windows-x64.zip) | 双击安装包。使用便携版时，解压后打开 **Open Deepmine.cmd** |
| macOS | 文件名以 `-source.zip` 结尾，需 Node.js 20+ | 双击 **Open Deepmine.command** |
| Linux | 同一份源码包，需 Node.js 20+ | 运行 `sh open-deepmine.sh` |

打开后，点 **先试玩一次挖掘** 就能亲手挖到动图里的角色，无需账号或密钥。准备好挖自己的作品时，选 **选择自己的项目**，从 Codex、Claude Code 最近项目中选一个，或浏览平常存作品的文件夹，点 **进入矿坑**。以后双击同一个启动文件就能回来。保留启动窗口，浏览器未自动打开时可使用窗口里显示的网址。[首次连接与升级](CONNECT-CODEX.md)

## 一天的作品，在岩壁上是什么样

- **一天能分几次挖。** 新的用量和作品记录会增加可挖深度，中途退出会记住位置。速度可选 1×、1.5×、3×。跨日后，打开矿坑会补上可结算的旧记录。右下角的个人测绘簿按项目时区列出当天的 Token、作品文件数和亲手挖过的米数。[个人测绘簿](PERSONAL-SURVEY.md) · [示例温室项目的实机截图](launch/personal-survey-zh.png)
- **一件作品有自己的模样。** 图片沿用原作构图和颜色；一段 PCM WAV 门铃声会在录音机上露出自己的波形；花束销量表会长成由原始数字决定高低的柱状图。出土时钻头停下，让你看清作品和小记。资料有限时，游戏用作品类型的造型来展示。
- **沿矿坑往上翻，就是过去的项目。** 用滚轮、触屏或左侧日期回到旧矿层，悬停读介绍，点开看详情。你也能挪动展品、出售换取金币，再给矿道添置陈设。[作品与版本回看](REPLAY.md)

![三种作品的不同画法：河口手记里的白鹭、门铃录音的波形、花束销量图；最右是栈桥路线图。](launch/work-objects.png)

## 它能读到什么

| 来源 | 游戏能用到的记录 |
| --- | --- |
| Codex、Claude Code | 所选项目会话中报告的 Token 和时间，以及能够和文件版本对应的作品记录 |
| 本地 Git、作品文件夹 | 提交、改动和可读的文件内容。来源缺少用量时，Token 显示为「未知」 |
| OpenAI、Anthropic、Gemini API | 可选的本机代理记录上游返回的用量，也支持导入逐次调用的 JSONL |
| 编辑器和自定义程序 | 通过 Hook 或本地事件接口提供作品、用量和记忆。以工具实际提供的字段为准 |

同一笔调用选一个计量入口，可避免跨来源重复计数。[全部连接方式](CONNECTORS.md) · [API 与 Hook 示例](API-CONNECTORS.md)

## 什么会离开电脑

核心玩法在本机运行。启动器打开本地浏览器，项目记录、作品预览、存档和个人测绘都留在这台电脑。普通玩家无需部署服务器。

- **AI 创作小记**、**保存对话摘录**默认关闭。启用 AI 小记会让已登录的 Codex 使用作品线索和你的账号额度。另选「结合创作过程」才会发送与该作品匹配的讨论节选。
- 主动挖满 12 米可以展开当天的 GitHub 藏宝图。展开时读取 GitHub Trending，归档后可离线回看。另有可选的途中资讯，启用公共来源时会访问 Hacker News；API 代理会访问你配置的上游。[途中资讯](FIELD-NEWS.md)
- 新安装的默认存档位置为 Windows 的 `%LOCALAPPDATA%\Deepmine`、macOS 的 `~/Library/Application Support/Deepmine`，或 Linux 的 `$XDG_DATA_HOME/deepmine`（默认 `~/.local/share/deepmine`）。[存档与升级](CONNECT-CODEX.md)

## 从源码运行

安装 Node.js 20 或更高版本，在解压后的源码根目录运行即可打开游戏，无需安装 npm 运行时依赖。

```sh
npm run open
```

`npm run doctor` 检查来源连接，`npm run check` 做语法检查，`npm test` 运行回归。项目代码按 MIT 许可发布，随包的模型和运行库保留各自许可。[参与贡献与反馈](../CONTRIBUTING.md) · [测试记录](TESTING.md) · [MIT 许可](../LICENSE) · [第三方资源](../vision/README.md)
