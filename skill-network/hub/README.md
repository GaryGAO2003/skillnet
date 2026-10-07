# skillnet-hub

创作者 AI「技能」（Agent Skills）市场的**搜索 API + 远程 MCP 服务器**。

普通创作者（视频剪辑、短视频运营、小红书、插画美术、音乐、摄影修图、UI/UX、文案口播）把自己的 AI 技能（一个含 `SKILL.md` 的文件夹）分享给粉丝。接入本服务器的 AI 助手可以**搜索技能、查看详情、获取安装包**，再由助手把文件写进用户的 skills 目录——服务器本身从不执行任何脚本。

## 运行

```bash
npm install
npm start          # node src/server.js
npm test           # node --test
```

环境变量：`PORT`（默认 8787）、`PUBLIC_BASE_URL`（链接用，默认 `http://localhost:<PORT>`）、`STATE_FILE`（安装计数持久化，默认 `data/state.json`）。
Node 24 本地可跑，CI 用 Node 20，代码保持 Node 20 兼容。

## HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` | `{ok, skills, bySource}` |
| GET | `/llms.txt` | 给 AI 的用法说明（markdown） |
| GET | `/api/categories` | `[{cat, count}]`（8 个分类） |
| GET | `/api/skills/search?q=&cat=&limit=` | 搜索，`limit` 默认 5、最大 20 |
| GET | `/api/skills/:id` | 技能详情 |
| GET/POST | `/api/skills/:id/install?client=&ref=` | 安装包（GET 也行，方便只有网页抓取工具的 agent） |
| GET | `/api/skills/:id/files/<path>` | 原始文件（平台技能）/ 302 跳转到 GitHub raw |
| GET | `/api/skills/:id/download.zip` | 打包下载（仅平台技能） |
| GET | `/s/:id` · `/s/:id.md` | 技能页（HTML / markdown） |
| GET | `/?q=&cat=` | 首页（搜索框 + 分类 + 结果） |
| POST | `/mcp` | MCP Streamable HTTP（无状态）；GET/DELETE → 405 |

`client` 取值：`claude-code` `codex` `cursor` `openclaw` `claude-app` `other`。

## 连接 MCP

远程 MCP 走 Streamable HTTP（无状态模式），端点 `POST <base>/mcp`。三个工具：

- `search_skills {query, category?, limit?}` — 搜索，返回文本 + 结构化结果。
- `get_skill {id}` — 详情。
- `install_skill {id, client?, ref?}` — 返回文件和目标目录；**不写文件**，由 agent 写入，安装前请征得用户同意。

示例（Claude Code）：

```bash
claude mcp add --transport http skillnet http://localhost:8787/mcp
```

## 安装 skill-finder

`skills/skill-finder/SKILL.md` 是一个**可分发的元技能**：把它装进任意支持 Agent Skills 的助手，它就会教助手用本 API 搜索和安装创作者技能。命令里直接写了完整地址 `http://localhost:8787`（部署后改成正式域名）：不用 shell 变量，是为了让只放行了 `curl`/`printf` 的用户不必每次额外批准。中文关键词通过 `printf … | curl --data-urlencode "q@-"` 传入，因为中文 Windows 上 curl 会把命令行参数转成 GBK（服务端也会自动识别 GBK 作为兜底）。

```bash
cp -r skills/skill-finder ~/.claude/skills/skill-finder   # 或 ~/.agents/skills/…
```

## 导入 GitHub 技能

把 `data/github-allowlist.json` 里的仓库条目拉成 `data/github.json`（固定到 commit sha、列文件、跑安全扫描、解析 frontmatter）：

```bash
npm run import:github -- --allowlist data/github-allowlist.json --out data/github.json
```

Token 取自环境变量 `GITHUB_TOKEN`，否则尝试 `gh auth token`，都没有则匿名请求（限流严格）。并发 ≤4，单条失败跳过不中断。

## 数据布局

```
data/
  skills.json              平台技能 + 创作者（另一个 agent 维护）
  skills/<slug>/**         每个平台技能的文本文件（SKILL.md + 可选 references/*.md）
  github-allowlist.json    导入脚本的输入（另一个 agent 维护）
  github.json              导入脚本的输出（运行时可缺省，缺省即视为空）
  state.json               安装计数 + 日志（.gitignore，原子写入）
```

`data/skills.json` 缺失时服务器以空目录启动并打印警告，不会崩溃。

## 代码布局

```
src/catalog.js   加载 + 统一记录，get/search/install/fileContent/categories
src/search.js    归一化、停用词、同义词概念、打分（相关性优先）
src/safety.js    技能文件静态安全扫描（pass / review / block）
src/clients.js   各客户端的安装目标目录
src/store.js     安装计数 + 日志，原子 JSON 持久化
src/mcp.js       createMcpServer(catalog, {baseUrl}) + 3 个工具
src/pages.js     HTML / markdown 渲染（首页、技能页、llms.txt）
src/server.js    HTTP 路由 + /mcp；createServer() 供测试，直接运行即启动
scripts/import-github.mjs   GitHub 导入脚本
skills/skill-finder/SKILL.md  可分发的元技能
```

## 安全

`src/safety.js` 对技能文件做静态扫描：管道执行（`curl | sh`）、base64 解码执行、PowerShell 下载执行、带密码压缩包“前置依赖”、外泄/粘贴板主机、读取 SSH 私钥/浏览器 Cookie/钱包、`rm -rf /`、裸 IP 下载执行等判为 `block`（搜索永不返回，安装返回 403）；可执行脚本、网络请求、`eval/exec`、`sudo`、凭据字样等判为 `review`（搜索会降权并提示）。助手应当只读取与下载，**绝不执行**技能里的脚本。
