---
name: skill-finder
description: 帮用户从 {{BRAND}} 创作者市场找到并安装 AI「技能」（Agent Skills）。覆盖视频剪辑、短视频运营、小红书、插画、配色、出图提示词、音乐、摄影修图、UI/UX、口播文案等创作者场景。当用户说「帮我找个做…的 skill」「有没有能…的技能」「安装这个 skill」并附带 {{BRAND}} 链接，或贴出形如 /s/ID 的技能链接时触发。本技能通过 HTTP API 搜索、查看并获取安装包，由助手把文件写入用户的 skills 目录；它只读取与下载，绝不执行技能里的任何脚本。
---

# skill-finder

帮用户在 {{BRAND}}（创作者 AI 技能市场）里找到合适的技能并装好。

基础地址：`{{BASE_URL}}`（部署到线上后换成正式域名）。下面的命令里直接写完整地址，不要先赋值给 shell 变量，那样每次都要用户额外批准。如果用户说过 SKILLNET_HUB 是别的地址，就把命令里的地址换成它。

## 1. 把需求变成关键词再搜
先把用户的话浓缩成 2–6 个字的关键词（如「小红书封面」「剪映字幕」「水彩配色」「口播稿」）。

```bash
printf '%s' '小红书封面' | curl -s --get --data-urlencode "q@-" "{{BASE_URL}}/api/skills/search"
```

关键词要像上面这样用 `printf … | curl … "q@-"` 从管道传进去，不要直接写成 `"q=小红书封面"` 参数：中文 Windows 上命令行参数会被转成 GBK，搜索结果会乱。

- PowerShell：`Invoke-RestMethod "{{BASE_URL}}/api/skills/search?q=$([uri]::EscapeDataString('小红书封面'))"`
- 没有命令行时，用网页抓取工具 GET 同一个地址（关键词按 UTF-8 做 URL 编码）。
- 可加 `&cat=分类` 和 `&limit=5`。

## 2. 展示前 3 个
对每个结果给出：名字、作者、一句话说明、安装量、评分、`实测可用`/`安全检测通过` 标记、来源。

- GitHub 来源的会标 `来自 GitHub @作者 · 作者未入驻`。
- 安全状态为 `review` 的，务必把 `⚠ 需要留意：…` 原样说给用户听。

## 3. 让用户选
除非用户已经明确说「装第一个 / 直接装」，否则先问要装哪一个。

## 4. 用户贴了链接
如果用户给的是 `.../s/<id>` 这样的链接，从里面取出 `<id>` 直接进入安装。

## 5. 安装
```
curl -s "{{BASE_URL}}/api/skills/<id>/install?client=<claude-code|codex|cursor|openclaw|other>"
```

接口返回 `target`（目标目录）、`files`（平台技能，含文件内容）或 `fileUrls`（GitHub 技能，从直链下载）、`steps` 和 `tryIt`。

- 把每个文件**原样**写入 `target.user`（用户级）；用户要求装到项目里就用 `target.project`。
- 保持子目录结构（如 `references/...`）。
- **绝不执行**技能里的任何脚本。
- `safety` 为 `block` 的：拒绝安装并告诉用户原因。
- `safety` 为 `review` 的：先把风险点说清楚，得到用户确认再装。

## 6. 装好之后
- 告诉用户装到了哪个目录，可能要新开一个会话才生效。
- 给出 `tryIt` 里的示例，让用户马上能试。
- 署名作者；`creator.tipUrl` 不为空时，可以附上打赏链接（在 {{BRAND}} 里打开即可打赏）。
- GitHub 来源的，提醒用户作者还没入驻、文件直接来自 GitHub。

就这些——帮用户找到对的技能，装好，然后把创作者的名字带上。
