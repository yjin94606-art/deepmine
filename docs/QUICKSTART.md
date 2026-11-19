# Your first dig

[Play the fictional sample in your browser](https://yjin94606-art.github.io/deepmine/). To dig through your own work, choose the download for your computer below.

## Open the game

- **Windows x64.** [Download the offline installer](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-windows-x64-setup.exe) and open it. The game opens in your browser. Next time, launch **Deepmine** from Start. The [portable ZIP](https://github.com/yjin94606-art/deepmine/releases/download/v1.1.0/deepmine-v1.1.0-windows-x64.zip) also includes Node.js. Extract it and open **Open Deepmine.cmd**.
- **macOS.** Install Node.js 20 or newer, extract the source ZIP, then double-click **Open Deepmine.command**.
- **Linux.** Install Node.js 20 or newer, extract the source ZIP, then run `sh open-deepmine.sh` in the extracted folder.

Keep the launcher window open while you play. It opens the game in your browser using a local address. If the browser does not open, copy the address from the launcher.

Windows Setup is unsigned and may show an unknown publisher. The portable ZIP is available on the same release page. GitHub also hosts SHA-256 checksums for all three downloads.

## Try the sample

Choose **Try a sample mine**. The first descent starts automatically and pauses when the drill finds the botanist portrait. Read the note, choose **Continue digging**, and use the date rail or scroll up the shaft to revisit an earlier layer. All of the work in the sample is fictional.

## Bring your own work

Return to the project picker. Select a recent Codex or Claude Code project, or browse to the folder where you keep your files. Enter the mine, work in that project as usual, then come back and dig. The launcher reopens the same project next time. Select its name in the mine to switch projects. Returning to an earlier project restores its progress.

Token usage comes from the records your tools provide. A folder of drawings can provide finds even if no usage log is available. The game shows unknown usage when it has no measurement. To see what it found, open the archive chest and choose **Personal survey log**. It includes reported tokens, distinct work files and metres dug for the project day.

### Supported inputs

| Tool or source | What Deepmine uses |
| --- | --- |
| Codex and Claude Code | Session records scoped to the selected project, with timestamps and reported token counts |
| Git and local work folders | Commits, observed file changes and available versions of your work |
| OpenAI, Anthropic and Gemini API calls | Provider-reported usage through the optional local capture proxy |
| Other tools | Per-call JSONL imports, editor hooks or local events, depending on what the tool provides |

Use one metering route per call. For example, if a call is already counted through the capture proxy, importing it again from another source can double-count it.

## Saves and privacy

Normal digging uses local files. By default, a new install saves to `%LOCALAPPDATA%\Deepmine` on Windows, `~/Library/Application Support/Deepmine` on macOS, or `$XDG_DATA_HOME/deepmine` on Linux (`~/.local/share/deepmine` when unset).

Close the previous launcher before upgrading. Windows Setup places each version in its own folder under `%LOCALAPPDATA%\Programs\Deepmine` and updates the Start menu shortcut. To remove an installed version, close it and delete its version folder. You can remove the Deepmine shortcut from Start. Your saves live in the separate data folder listed above. If an older installation has a `.deepmine` directory, keep it with the project or point `DEEPMINE_DATA_DIR` at it when launching the new version. If you already use a custom data directory, keep that setting.

AI-written notes can send work evidence to your configured Codex account when enabled. Saved conversation excerpts are a separate option. Decoding a daily GitHub treasure map or enabling a public news source requires internet access. The sample and basic digging work offline.

For connection diagnostics, run `npm run doctor` from the source package. On Windows, the portable launcher's `"Open Deepmine.cmd" --diagnostics` option produces a summary you can review before sharing.
