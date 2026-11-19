# Contributing to Deepmine

Deepmine runs locally with Node.js 20 or newer. From a checkout, run `npm run open` and choose **Try a sample mine** on the project picker. To test with a real folder, use a temporary folder with files you created for the test. The collector and game work without installing npm dependencies.

## Reproduce a bug

Include the action you took, the expected result and what appeared. For a counting problem, a small invented sequence such as “two calls with 10 and 20 tokens” is enough. For a visual problem, include the browser, window size and whether you used a mouse, touch or keyboard.

The launcher can print a short diagnostic report for an issue. Run the command from the unzipped folder. Read the output before posting.

| Download | Command |
| --- | --- |
| Windows, PowerShell | `& ".\Open Deepmine.cmd" --diagnostics` |
| macOS or Linux | `sh ./open-deepmine.sh --diagnostics` |
| Source checkout | `node scripts/doctor.cjs --share` |

The report lists the application and runtime versions plus availability of the project, service and supported sources. Use synthetic input and crop personal details from screenshots. For a vulnerability, follow [private reporting](SECURITY.md).

## Verify a change

```sh
npm run check
npm test
```

For connector changes, cover a second sync of the same record and explain how to reproduce the original behavior. For game changes, check touch or keyboard interaction alongside the desktop view. Use a fresh folder for records, secrets and generated output. Browser checks run separately in CI. See the [test record](docs/TESTING.md) and [release instructions](docs/GITHUB-LAUNCH.md).

## 中文反馈

请写清在哪一步遇到了问题、原本期待什么、实际看到了什么。计量问题可以用虚构的两次调用复现；界面问题请注明输入方式和浏览器。上面的诊断命令也可以在首次选项目前运行。公开反馈只需这份简报和复现步骤，安全问题请走私下反馈途径。
