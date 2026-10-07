# skillnet-hub

创作者 AI「技能」（Agent Skills）市场的**本地后端**：搜索 API + 账号/上传/打赏/社交 + 远程 MCP 服务器。

普通创作者（视频剪辑、短视频运营、小红书、插画美术、音乐、摄影修图、UI/UX、文案口播）把自己的 AI 技能（一个含 `SKILL.md` 的文件夹）分享给粉丝。粉丝搜索、安装到自己的 AI 工具，并给创作者打赏。接入本服务器的 AI 助手可以**搜索技能、查看详情、获取安装包**，再由助手把文件写进用户的 skills 目录——服务器本身从不执行任何脚本。

前端 SPA 由另一套代码维护，位于 `public/`（`/` 提供应用外壳，缺省时回退到服务端渲染的列表页）。

## 运行

```bash
npm install
npm start          # node src/server.js
npm test           # node --test
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 监听端口 |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | 链接与 QR 用的基准地址；`https` 时 cookie 带 `Secure` |
| `STATE_FILE` | `data/state.json` | 安装计数 + 日活聚合（原子写） |
| `DB_FILE` | `data/db.json` | 账号/会话/上传/打赏/评价/点赞/关注/收藏/通知（原子写，防抖，退出时落盘） |
| `BRAND_NAME` | `SkillNet` | 品牌名（占位可改），用于页面、llms.txt、MCP 说明、skill-finder |
| `BRAND_TAGLINE` | `创作者的 AI 技能市场` | 品牌副标题 |
| `DEMO_MODE` | 开启 | 设为 `0` 关闭演示登录 |
| `DEMO_PASSWORD` | `demo1234` | 种子账号的演示密码（仅本地演示用） |
| `PAYMENT_PROVIDER` | `demo` | 打赏支付通道；目前只有 `demo`（永远成功，不涉及真实资金） |
| `GITHUB_TOKEN` | 无 | 认领校验时拉取 GitHub raw 用（可选） |

Node 24 本地可跑，CI 用 Node 20，代码保持 Node 20 兼容（`npx -y -p node@20 node --test` 可本地验证）。

## 品牌可配置

品牌名是占位符（`SkillNet`）。`src/brand.js` 导出 `BRAND = { name, tagline }`，由 `BRAND_NAME` / `BRAND_TAGLINE` 覆盖，页面、`llms.txt`、MCP 说明和 skill-finder 都用它。技术标识（MCP 服务器名 `skillnet-hub`、slug、cookie 名 `sn_session`）保持不变。

## 演示账号与登录（仅本地）

首次启动会把 `data/skills.json` 里的创作者播种为账号（保留 id `c1`–`c4`：`ajie` `momo` `leo` `uimiao`，角色 creator），外加普通用户 `u1`（handle `zhou`，小周）。密码统一取 `DEMO_PASSWORD`（默认 `demo1234`）——**这些是本地演示凭据**。

- `POST /api/auth/demo {as:"<handle>"}` → 以该种子账号登录（`DEMO_MODE≠0` 时可用）。
- `GET /api/auth/demo?as=<handle>&next=<path>` → 设置 cookie 并 302 到 `next`（默认 `/`，仅允许同源相对路径）；用于截图/演示自动化。

## 打赏（仅演示）

只打赏、不卖技能。金额为 1–500 的整数元（UI 给 6/18/50）。平台抽成 10%：`fee = round(amount*0.1,2)`，`net = amount - fee`。支付走 `src/payments.js` 的 **demo 通道**（`method:'demo'`，永远成功，**不涉及真实资金**），接口化以便日后接入微信支付/支付宝/爱发电。只有「作者已认领」的技能可被打赏（平台账号，或已认领的 GitHub 技能），且不能给自己打赏。

## HTTP 接口

所有返回 JSON；错误为 `{error, message}`（中文）。登录态用 HttpOnly cookie `sn_session`（SameSite=Lax，30 天）。受保护的 `POST/PATCH/DELETE`（含上传）必须是 `Content-Type: application/json`——这是 CSRF 防护。`Access-Control-Allow-Origin: *` 只加在公共 GET 接口与 `/mcp` 上，且从不发送 `Allow-Credentials`。

### 公共浏览
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` · `/llms.txt` · `/api/categories` | 健康检查 / 给 AI 的说明 / 8 个分类计数 |
| GET | `/api/home` | `{collections, hot[8], fresh[8], creators[6], categories}` |
| GET | `/api/rank?type=hot\|new\|fav\|rating&cat=&limit=20` | 榜单 |
| GET | `/api/skills/search?q=&cat=&limit=` | 搜索（结果为 SkillSummary） |
| GET | `/api/skills/:id` | 详情（含 `liked/inLibrary/canTip/reviews/ratingCount/qr/appUrl`） |
| GET/POST | `/api/skills/:id/install?client=&ref=` | 安装包 |
| GET | `/api/skills/:id/files/<path>` · `/download.zip` · `/qr.svg` | 文件 / 打包 / 二维码 |
| GET | `/api/creators?limit=12` · `/api/creators/:handle` · `/api/creators/:handle/qr.svg` | 创作者 |
| GET | `/s/:id` · `/s/:id.md` · `/browse?q=&cat=` · `/get-finder` | 服务端渲染页 |
| GET | `/skill-finder/SKILL.md` · `/skill-finder.zip` | 模板化的元技能 |
| POST | `/mcp` | MCP Streamable HTTP（无状态）；GET/DELETE → 405 |

### 账号
`POST /api/auth/signup {name, handle(^[a-z0-9_]{3,20}$), password(≥8), role, platform?, bio?}` → 201 `{me}`（scrypt+随机盐哈希）；`POST /api/auth/login {handle,password}`（错误 401 `bad_credentials`，限流 5 次/分钟/IP+handle → 429）；`POST /api/auth/logout`；`GET /api/me`。

### 交互（需登录，401 `login_required`）
`POST /api/skills/:id/like`（切换，返回 `{liked,likes}`）；`POST /api/creators/:handle/follow`（切换，返回 `{following,followers}`）；`POST /api/skills/:id/reviews {rating 1-5, text≤500}`（每人一条，upsert）；`POST /api/skills/:id/tips {amount}`（400 `not_tippable`/`cannot_tip_self`/`bad_amount`）；`POST`/`DELETE /api/me/library/:id`；`GET /api/me/library`（带 `seenVersion/hasUpdate`）；`GET /api/me/notifications` · `POST /api/me/notifications/read`。

### 创作者工具（需登录）
- `POST /api/skills`（上传，体积上限 4 MB，上传限流 20 次/小时）。
- `POST /api/skills/:id/versions {files, note}`（仅作者，次版本号自增 1.0→1.1→…→1.10，通知收藏者与关注者）。
- `PATCH /api/skills/:id`（仅作者，改 name/cat/desc/tags/video/examples/glyph）。
- `GET /api/me/skills` · `GET /api/me/dashboard`（安装/打赏汇总、30 天日活、byClient、byRef、每技能、最近打赏；含演示数据时 `demoData:true`）。

### 认领（GitHub 冷启动）
`POST /api/skills/:id/claim` → 稳定的认领码；把它写进仓库 `SKILL.md` 后 `POST /api/skills/:id/claim/verify`（从 raw.githubusercontent.com 校验），成功后作者显示为该用户 + `GitHub @login`，并可被打赏。

## 上传格式

```jsonc
POST /api/skills   // Content-Type: application/json
{
  "meta": { "name": "小红书封面助手", "cat": "小红书", "desc": "一句话说明",
            "tags": ["封面"], "video": {"platform":"小红书","title":"…"},
            "examples": [{"you":"…","ai":"…"}], "glyph": "封面" },
  "files": [{ "path": "SKILL.md", "content": "---\nname: xhs-cover\ndescription: …\n---\n…", "encoding": "utf8" },
            { "path": "assets/cover.png", "content": "<base64>", "encoding": "base64" }]
}
```

校验：≤60 个文件、解码后总计 ≤2 MB、单文件 ≤500 KB；路径归一化（`\`→`/`，拒绝绝对路径与 `..`）；若所有路径共享同一个顶层文件夹则剥离；必须有根 `SKILL.md`，其 frontmatter 含 `name`（匹配 `^[a-z0-9-]{1,64}$`，作为该作者下唯一的 slug）和 `description`；只允许文本文件与图片（png/jpg/jpeg/gif/webp/svg），拒绝可执行文件与压缩包；跑安全扫描，`block` 返回 422 且不保存。保存成功后立即进入目录，API 与 MCP 可搜到。文件落在 `data/uploads/<skillId>/<version>/<path>`。

## 连接 MCP

远程 MCP 走 Streamable HTTP（无状态），端点 `POST <base>/mcp`。三个工具：`search_skills`、`get_skill`、`install_skill`（**不写文件**，由 agent 写入，安装前请征得用户同意）。

```bash
claude mcp add --transport http skillnet http://localhost:8787/mcp
```

## skill-finder（可分发元技能）

`skills/skill-finder/SKILL.md` 是模板（`{{BRAND}}`、`{{BASE_URL}}`），服务端按当前品牌与地址渲染后在 `/skill-finder/SKILL.md` 与 `/skill-finder.zip` 提供；`/get-finder` 是引导页。把它装进任意支持 Agent Skills 的助手，它就会教助手用本 API 搜索和安装创作者技能。

## 演示数据

```bash
npm run demo:activity   # node scripts/demo-activity.mjs
```

为种子创作者写入近 30 天的合成安装（含工作日噪声、来源 ref、客户端）与约 40 笔演示打赏（`demo:true`），让作者面板有东西可看。**幂等**：重跑会先清掉旧的演示数据再写，不会累加；一切都标记为演示数据，面板会标注「含演示数据」。

## 导入 GitHub 技能

```bash
npm run import:github -- --allowlist data/github-allowlist.json --out data/github.json
```

把 `data/github-allowlist.json` 里的仓库拉成 `data/github.json`（固定 commit sha、列文件、跑安全扫描、解析 frontmatter）。Token 取自 `GITHUB_TOKEN`，否则 `gh auth token`，都没有则匿名。

## 数据布局

```
data/
  skills.json              平台技能 + 创作者（种子账号的来源）
  skills/<slug>/**         每个平台技能的文本文件
  collections.json         首页编辑精选合辑
  github-allowlist.json    导入脚本输入 ·  github.json  导入脚本输出（可缺省）
  state.json               安装计数 + 日活聚合（.gitignore，原子写）
  db.json                  账号/社交/上传/打赏…（.gitignore，首启播种，原子写）
  uploads/<id>/<ver>/**    上传技能的文件（.gitignore）
```

## 代码布局

```
src/brand.js     可配置品牌名
src/catalog.js   加载 + 统一记录（平台/GitHub/上传），get/search/install/summary/detail、有效评分、认领视图
src/search.js    归一化、停用词、同义词概念、打分（相关性优先）
src/safety.js    技能文件静态安全扫描（pass / review / block）
src/clients.js   各客户端的安装目标目录
src/store.js     安装计数 + 日活/客户端/来源聚合（含 demo 命名空间），原子持久化
src/db.js        账号/会话/上传/打赏/评价/点赞/关注/收藏/通知 JSON 持久化 + 首启播种
src/auth.js      scrypt 密码哈希、会话 cookie、内存限流
src/uploads.js   上传校验（路径/大小/类型/frontmatter/顶层剥离）与落盘
src/payments.js  打赏支付通道（demo）
src/qr.js        二维码 SVG（uqr）
src/mcp.js       createMcpServer(catalog,{baseUrl,brand}) + 3 个工具
src/pages.js     HTML / markdown 渲染（列表页、技能页、get-finder、llms.txt）
src/app.js       组装 db+catalog+payments，组合操作（home/rank/creators/dashboard/tip/upload/versions/claim）
src/server.js    HTTP 路由 + /mcp + 应用外壳/静态资源；createServer() 供测试，直接运行即启动
scripts/import-github.mjs   ·  scripts/demo-activity.mjs
skills/skill-finder/SKILL.md  模板化的可分发元技能
```

## 安全

`src/safety.js` 对技能文件做静态扫描：管道执行（`curl | sh`）、base64 解码执行、PowerShell 下载执行、带密码压缩包“前置依赖”、外泄/粘贴板主机、读取 SSH 私钥/浏览器 Cookie/钱包、`rm -rf /`、裸 IP 下载执行等判为 `block`（搜索永不返回，安装/上传拒绝）；可执行脚本、网络请求、`eval/exec`、`sudo`、凭据字样等判为 `review`。助手应当只读取与下载，**绝不执行**技能里的脚本。
