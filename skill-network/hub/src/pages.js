// pages.js — HTML + markdown renderers. Plain template strings, one shared CSS
// block, tiny inline JS for copy buttons. All interpolated data is HTML-escaped.
// The brand name is configurable; these SSR pages are fallback / SEO / utility
// surfaces (the SPA under public/ is the primary UI).

import { CATEGORIES } from './search.js';
import { allTargets } from './clients.js';
import { BRAND } from './brand.js';

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');

// The wordmark keeps the SkillNet dot accent for the default brand, otherwise the
// configured name is shown plainly.
function brandMark(brand) {
  return brand.name === 'SkillNet' ? 'Skill<span class="dot">Net</span>' : escapeHtml(brand.name);
}

// pre.light blocks (the copyable sentence, the agent instructions) are for people
// to read, so they wrap long URLs; dark pre blocks stay unwrapped shell commands.
const CSS = `
:root{
  --pink:#FF4D8D; --lemon:#E6FF4F; --sky:#5B8CFF; --mint:#2ED3A0;
  --ink:#17141C; --bg:#F7F5F2; --card:#fff; --muted:#6b6676; --line:#eceaf0;
  --shadow:0 10px 30px rgba(23,20,28,.08);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink:#F4F1F7; --bg:#141118; --card:#1e1a24; --muted:#a39fae; --line:#2b2633;
    --shadow:0 10px 30px rgba(0,0,0,.4);
  }
}
:root[data-theme="dark"]{
  --ink:#F4F1F7; --bg:#141118; --card:#1e1a24; --muted:#a39fae; --line:#2b2633;
  --shadow:0 10px 30px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:860px;margin:0 auto;padding:0 16px 64px}
.display{font-family:"Bricolage Grotesque","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",system-ui,sans-serif;font-weight:800;letter-spacing:-.02em;line-height:1.08}
header.top{padding:28px 0 8px}
.brand{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:26px}
.brand .dot{color:var(--pink)}
.tag{color:var(--muted);font-size:14px;margin-top:2px}
.searchbox{display:flex;gap:10px;margin:18px 0;flex-wrap:wrap}
.searchbox input[type=search]{flex:1;min-width:180px;padding:14px 16px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:16px;box-shadow:var(--shadow)}
.btn{display:inline-block;padding:12px 20px;border-radius:999px;border:0;background:var(--ink);color:var(--bg);font-weight:700;font-size:15px;cursor:pointer;text-decoration:none;text-align:center}
.btn.pink{background:var(--pink);color:#fff}
.btn.sky{background:var(--sky);color:#fff}
.btn.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 18px}
.chip{padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:14px;text-decoration:none;font-weight:600}
.chip.on{background:var(--lemon);color:#17141C;border-color:transparent}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px 20px;margin:14px 0;box-shadow:var(--shadow)}
.card h3{margin:.1em 0 .3em;font-size:19px}
.row{display:flex;gap:14px;align-items:flex-start}
.glyph{flex:0 0 auto;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,var(--pink),var(--sky));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;font-family:"Bricolage Grotesque",sans-serif}
.meta{color:var(--muted);font-size:14px}
.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.pill{font-size:12.5px;padding:4px 10px;border-radius:999px;background:var(--bg);border:1px solid var(--line);font-weight:600}
.pill.ok{background:rgba(46,211,160,.14);border-color:transparent;color:#128a66}
.pill.warn{background:rgba(255,171,64,.16);border-color:transparent;color:#9a5b00}
.pill.gh{background:rgba(91,140,255,.14);border-color:transparent;color:#2a51c9}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .pill.ok{color:#5ef0c4}:root:not([data-theme="light"]) .pill.warn{color:#ffce8a}:root:not([data-theme="light"]) .pill.gh{color:#9fb8ff}}
.ex{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0}
.ex .you{font-weight:700}
.ex .ai{color:var(--muted);white-space:pre-wrap;margin-top:4px}
pre{background:var(--ink);color:#f7f5f2;padding:14px;border-radius:14px;overflow:auto;font-size:13px;line-height:1.5}
pre.light{background:var(--bg);color:var(--ink);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.copy{margin-left:8px;font-size:12px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;font-weight:600}
.sect{margin-top:26px}
.sect h2{font-size:16px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px}
.tips{display:flex;gap:8px;flex-wrap:wrap}
.tipchip{padding:10px 16px;border-radius:999px;background:var(--lemon);color:#17141C;font-weight:800}
.muted{color:var(--muted)}
.foot{margin-top:40px;color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
`;

// Google Fonts is often blocked in mainland China, and a render-blocking
// stylesheet on a dropped connection means a blank page until it times out.
// Load it async (media=print swap) so pages paint at once with system fonts;
// Chinese text always uses the system CJK fonts in the CSS stacks.
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" media="print" onload="this.media=\'all\'">';

const COPY_JS = `<script>
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-copy]'); if(!b) return;
  var t=b.getAttribute('data-copy');
  if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){var o=b.textContent;b.textContent='已复制';setTimeout(function(){b.textContent=o;},1200);});}
});
</script>`;

function doc({ title, body, head = '', brand = BRAND }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
${FONTS}
${head}
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
${body}
<div class="foot">${brandMark(brand)} · ${escapeHtml(brand.tagline)} · 安装前请先阅读 SKILL.md，绝不执行未知脚本。</div>
</div>
${COPY_JS}
</body>
</html>`;
}

const SEVERITY_ZH = { block: '拦截', review: '留意' };

function safetyPill(level) {
  if (level === 'review') return '<span class="pill warn">⚠ 需要留意</span>';
  if (level === 'block') return '<span class="pill warn">已拦截</span>';
  return '<span class="pill ok">安全检测通过</span>';
}

function cardFor(sm) {
  const creator = sm.source === 'github'
    ? `来自 GitHub · 作者未入驻 · ★${escapeHtml(sm.stars)}`
    : `${escapeHtml(sm.creator.name)}${sm.creator.claimed ? ' <span class="pill">已认领</span>' : ''} · ${fmtNum(sm.installs)} 人在用${sm.rating != null ? ` · ★${escapeHtml(sm.rating)}` : ''}`;
  return `<div class="card"><div class="row">
  <div class="glyph">${escapeHtml((sm.name || '').slice(0, 2))}</div>
  <div style="flex:1">
    <a href="/s/${escapeHtml(sm.id)}" style="text-decoration:none"><h3>${escapeHtml(sm.name)}</h3></a>
    <div class="meta">${creator}</div>
    <div style="margin:8px 0">${escapeHtml(sm.desc)}</div>
    <div class="pills">
      <span class="pill">${escapeHtml(sm.cat)}</span>
      ${sm.verified ? '<span class="pill ok">实测可用</span>' : ''}
      ${sm.source === 'github' ? '<span class="pill gh">GitHub</span>' : ''}
      ${safetyPill(sm.safety)}
      ${sm.requires ? `<span class="pill warn">需要：${escapeHtml(sm.requires)}</span>` : ''}
    </div>
  </div></div></div>`;
}

export function renderIndex({ q = '', cat = '', categories = [], results = [], brand = BRAND }) {
  const chips = ['<a class="chip' + (cat ? '' : ' on') + '" href="/browse">全部</a>']
    .concat(categories.map((c) => `<a class="chip${c.cat === cat ? ' on' : ''}" href="/browse?cat=${encodeURIComponent(c.cat)}">${escapeHtml(c.cat)} ${c.count}</a>`))
    .join('');
  const list = results.length
    ? results.map(cardFor).join('')
    : `<div class="card muted">没有找到匹配的技能。换更宽的关键词（只保留 2-4 个字）或点上面的分类看看。</div>`;
  const body = `
<header class="top">
  <div class="brand">${brandMark(brand)}</div>
  <div class="tag">${escapeHtml(brand.tagline)}。视频剪辑 · 小红书 · 插画 · 配色 · 出图 · 音乐 · 修图 · UI/UX · 口播文案</div>
</header>
<form class="searchbox" method="get" action="/browse">
  <input type="search" name="q" value="${escapeHtml(q)}" placeholder="想做什么？比如：小红书封面、剪映字幕、水彩插画配色" aria-label="搜索技能">
  ${cat ? `<input type="hidden" name="cat" value="${escapeHtml(cat)}">` : ''}
  <button class="btn pink" type="submit">搜索</button>
</form>
<div class="chips">${chips}</div>
${q ? `<div class="muted" style="margin-bottom:8px">「${escapeHtml(q)}」的结果（${results.length}）</div>` : ''}
${list}`;
  return doc({ title: q ? `${q} · ${brand.name}` : `${brand.name} · ${brand.tagline}`, body, brand });
}

function curlLines(d) {
  const dir = '~/.claude/skills/' + d.slug;
  const lines = [`mkdir -p ${dir}`];
  if (d.truncated) {
    lines.push(`curl -fL -o skill.zip "${d.archiveUrl}"`, 'unzip -q skill.zip', `cp -r "${d.archiveRoot}/." ${dir}/`);
    return lines.join('\n');
  }
  for (const f of d.fileUrls) lines.push(`curl -fL -o ${dir}/${f.path} "${f.url}"`);
  return lines.join('\n');
}

function agentBlock(d) {
  const lines = [];
  lines.push('给 AI 助手的安装说明 / For AI agents');
  lines.push('');
  lines.push(`技能 id：${d.id} · slug：${d.slug} · 来源：${d.source}`);
  lines.push('');
  lines.push('安装 API（按客户端选一个，GET 即可）：');
  for (const [c, url] of Object.entries(d.installApi)) lines.push(`  ${c}: ${url}`);
  lines.push('');
  lines.push('目标目录：');
  for (const t of d.installTargets) {
    if (!t.user && !t.project) { lines.push(`  ${t.client}: 下载 zip 后在设置里上传`); continue; }
    lines.push(`  ${t.client}: 用户级 ${t.user || '-'} | 项目级 ${t.project || '-'}`);
  }
  lines.push('');
  if (d.truncated) {
    lines.push(`文件太多（${d.fileCount} 个），请整包下载：${d.archiveUrl}`);
    lines.push(`解压后把 ${d.archiveRoot}/ 的全部内容复制到目标目录，不要执行任何脚本。`);
  } else {
    lines.push('文件直链（按原样写入目标目录，保持子目录结构，不要执行任何脚本）：');
    for (const f of d.fileUrls) lines.push(`  ${f.path}: ${f.url}`);
  }
  if (d.notice) { lines.push(''); lines.push(d.notice); }
  return lines.join('\n');
}

export function renderSkillPage(d, brand = BRAND) {
  const sendSentence = `请帮我安装这个 skill：${d.page}`;
  const creatorLine = d.source === 'github' && !d.creator.claimed
    ? `来自 GitHub · <a href="${escapeHtml(d.sourceUrl || '')}">@${escapeHtml(d.creator.handle)}</a> · 作者未入驻 · ★${escapeHtml(d.stars)}${d.license ? ` · ${escapeHtml(d.license)}` : ''}`
    : `${escapeHtml(d.creator.name)}${d.creator.claimed ? ' <span class="pill ok">已认领</span>' : ''}${d.githubLogin ? ` · GitHub @${escapeHtml(d.githubLogin)}` : ''}${d.creatorFull.fans ? ` · 粉丝 ${escapeHtml(d.creatorFull.fans)}` : ''} · ${fmtNum(d.installs)} 人在用${d.rating != null ? ` · ★${escapeHtml(d.rating)}（${escapeHtml(d.ratingCount)}）` : ''}`;

  const examples = (d.examples || []).map((e) => `<div class="ex"><div class="you">你说：${escapeHtml(e.you)}</div><div class="ai">它回：${escapeHtml(e.ai)}</div></div>`).join('');
  const findings = (d.safetyFindings || []).map((f) => `<li>[${escapeHtml(SEVERITY_ZH[f.severity] || f.severity)}] ${escapeHtml(f.label)}${f.file ? `<span class="muted">（${escapeHtml(f.file)}${f.line ? ':' + escapeHtml(f.line) : ''}）</span>` : ''}</li>`).join('');
  const versions = (d.versions || []).map((v) => `<li><b>${escapeHtml(v.v)}</b> <span class="muted">${escapeHtml(v.date)}</span> ${escapeHtml(v.note || '')}</li>`).join('');

  // The SSR page no longer handles tips itself — it hands off to the SPA where
  // tipping / reviewing / library live. Claimed creators get the tip wording.
  const appUrl = d.appUrl || `/#/skill/${d.id}`;
  const openSection = d.safetyLevel === 'block' ? '' : `
<div class="sect" id="tip">
  <h2>在 ${escapeHtml(brand.name)} 里打开</h2>
  <a class="btn pink" href="${escapeHtml(appUrl)}">在 ${escapeHtml(brand.name)} 里打开：${d.creator.claimed ? '打赏 · ' : ''}评价 · 收藏</a>
</div>`;

  const body = `
<header class="top"><a href="/" class="meta" style="text-decoration:none">← ${escapeHtml(brand.name)}</a></header>
<div class="card"><div class="row">
  <div class="glyph">${escapeHtml(d.glyph || (d.name || '').slice(0, 2))}</div>
  <div style="flex:1">
    <h1 class="display" style="font-size:26px;margin:.1em 0">${escapeHtml(d.name)}</h1>
    <div class="meta">${creatorLine}</div>
    <div class="pills">
      <span class="pill">${escapeHtml(d.cat)}</span>
      ${d.verified ? '<span class="pill ok">实测可用</span>' : ''}
      ${d.source === 'github' ? '<span class="pill gh">GitHub</span>' : ''}
      ${safetyPill(d.safetyLevel)}
      ${d.version ? `<span class="pill">${d.source === 'github' ? '提交 ' : 'v'}${escapeHtml(d.version)}</span>` : ''}
      ${d.requires ? `<span class="pill warn">需要：${escapeHtml(d.requires)}</span>` : ''}
    </div>
  </div>
</div>
<p style="font-size:17px">${escapeHtml(d.desc)}</p>
${d.video ? `<div class="meta">🎬 ${escapeHtml(d.video.platform || '')}《${escapeHtml(d.video.title || '')}》</div>` : ''}
</div>

${examples ? `<div class="sect"><h2>试试看</h2>${examples}</div>` : ''}

<div class="sect"><h2>安全检测</h2>
  <div>${safetyPill(d.safetyLevel)} ${d.safetyLevel === 'pass' ? '<span class="muted">未发现风险模式</span>' : ''}</div>
  ${findings ? `<ul>${findings}</ul>` : ''}
</div>

${versions ? `<div class="sect"><h2>版本</h2><ul>${versions}</ul></div>` : ''}

${d.safetyLevel === 'block' ? `<div class="sect"><h2>无法安装</h2>
  <div class="card">这个技能没有通过安全检测（原因见上方），已被拦截，不提供任何安装方式。<br><span class="muted">如果你是作者：去掉相关内容后重新提交，即可重新检测。</span></div>
</div>` : `<div class="sect"><h2>安装 · 三种方式</h2>

  <div class="card">
    <b>1 · 发给 AI</b>
    <div class="muted" style="margin:6px 0">把这句话发给你的 AI 助手，它会帮你装好：</div>
    <pre class="light"><code>${escapeHtml(sendSentence)}</code></pre>
    <button class="copy" data-copy="${escapeHtml(sendSentence)}">复制这句话</button>
  </div>

  ${d.zipUrl ? `<div class="card">
    <b>2 · 下载压缩包</b>
    <div class="muted" style="margin:6px 0">下载后解压到 skills 目录，或在 Claude 设置里上传。</div>
    <a class="btn sky" href="${escapeHtml(d.zipUrl)}">下载 ${escapeHtml(d.slug)}.zip</a>
  </div>` : `<div class="card"><b>2 · 从 GitHub 获取</b><div class="muted" style="margin:6px 0">这个技能托管在 GitHub，用下面的命令行或直链下载。</div><a class="btn ghost" href="${escapeHtml(d.sourceUrl || '')}">在 GitHub 查看</a></div>`}

  <div class="card">
    <b>3 · 命令行</b>
    <div class="muted" style="margin:6px 0">适合 claude-code 用户（其他客户端改一下目录即可）：</div>
    <pre><code>${escapeHtml(curlLines(d))}</code></pre>
    <button class="copy" data-copy="${escapeHtml(curlLines(d))}">复制命令</button>
  </div>
</div>

<div class="sect"><h2>给 AI 助手的安装说明</h2>
  <pre class="light"><code>${escapeHtml(agentBlock(d))}</code></pre>
  <button class="copy" data-copy="${escapeHtml(agentBlock(d))}">复制</button>
</div>`}

${openSection}
`;
  const head = `<link rel="alternate" type="text/markdown" href="/s/${escapeHtml(d.id)}.md">`;
  return doc({ title: `${d.name} · ${brand.name}`, body, head, brand });
}

export function renderSkillMarkdown(d, brand = BRAND) {
  const L = [];
  L.push(`# ${d.name}`);
  L.push('');
  if (d.source === 'github' && !d.creator.claimed) L.push(`来自 GitHub @${d.creator.handle}（作者未入驻） · ★${d.stars}${d.license ? ` · ${d.license}` : ''} · 分类：${d.cat}`);
  else L.push(`作者：${d.creator.name}${d.creator.claimed ? '（已认领）' : ''}${d.githubLogin ? ` · GitHub @${d.githubLogin}` : ''} · ${fmtNum(d.installs)} 人在用${d.rating != null ? ` · ★${d.rating}` : ''} · 分类：${d.cat}`);
  L.push('');
  L.push(d.desc);
  if (d.requires) { L.push(''); L.push(`**依赖**：${d.requires}`); }
  if (d.video) { L.push(''); L.push(`演示视频：${d.video.platform || ''}《${d.video.title || ''}》`); }
  if (d.examples && d.examples.length) {
    L.push('', '## 示例');
    for (const e of d.examples) { L.push('', `- 你说：${e.you}`, `  它回：${e.ai}`); }
  }
  L.push('', '## 安全检测', '', `级别：${d.safetyLevel}`);
  for (const f of d.safetyFindings || []) L.push(`- [${SEVERITY_ZH[f.severity] || f.severity}] ${f.label}${f.file ? `（${f.file}）` : ''}`);
  if (d.versions && d.versions.length) {
    L.push('', '## 版本');
    for (const v of d.versions) L.push(`- ${v.v}（${v.date}）${v.note || ''}`);
  }
  if (d.safetyLevel === 'block') {
    L.push('', '## 安装', '', '这个技能没有通过安全检测，已被拦截，不提供安装。请不要从其他来源安装它。');
    return L.join('\n') + '\n';
  }
  L.push('', '## 安装', '', `发给 AI：请帮我安装这个 skill：${d.page}`);
  L.push('', '安装 API：');
  for (const [c, url] of Object.entries(d.installApi)) L.push(`- ${c}: ${url}`);
  L.push('', '文件：');
  if (d.truncated) L.push(`- 共 ${d.fileCount} 个文件，请整包下载：${d.archiveUrl}（解压后取 ${d.archiveRoot}/）`);
  else for (const f of d.fileUrls) L.push(`- ${f.path}: ${f.url}`);
  if (d.notice) { L.push('', d.notice); }
  if (d.appUrl) { L.push('', `在 ${brand.name} 里打开（打赏 · 评价 · 收藏）：${d.appUrl}`); }
  return L.join('\n') + '\n';
}

// SSR page encouraging users to install the skill-finder meta-skill.
export function renderGetFinder({ brand = BRAND, baseUrl = '' } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const sentence = `请帮我安装这个 skill：${base}/skill-finder/SKILL.md`;
  const targets = allTargets('skill-finder').filter((t) => t.user || t.project);
  const dirs = targets.map((t) => `  ${t.client}: 用户级 ${t.user || '-'}${t.project ? ` | 项目级 ${t.project}` : ''}`).join('\n');
  const body = `
<header class="top"><a href="/" class="meta" style="text-decoration:none">← ${escapeHtml(brand.name)}</a>
  <h1 class="display" style="font-size:30px;margin:.2em 0">让你的 AI 自己来这里找 skill</h1>
  <div class="tag">装上 skill-finder 这个「元技能」，以后直接对你的 AI 助手说想做什么，它会来 ${escapeHtml(brand.name)} 搜索、挑选并安装合适的创作者技能。</div>
</header>

<div class="sect"><h2>1 · 最简单：发一句话</h2>
  <div class="card">
    <div class="muted" style="margin-bottom:6px">把这句话发给支持 Agent Skills 的 AI 助手（Claude Code、Codex、Cursor…）：</div>
    <pre class="light"><code>${escapeHtml(sentence)}</code></pre>
    <button class="copy" data-copy="${escapeHtml(sentence)}">复制这句话</button>
  </div>
</div>

<div class="sect"><h2>2 · 下载压缩包</h2>
  <div class="card">
    <div class="muted" style="margin-bottom:6px">下载后解压到 skills 目录，或在 Claude 设置里上传。</div>
    <a class="btn sky" href="/skill-finder.zip">下载 skill-finder.zip</a>
    · <a class="btn ghost" href="/skill-finder/SKILL.md">查看 SKILL.md</a>
  </div>
</div>

<div class="sect"><h2>3 · 手动安装位置（按客户端）</h2>
  <div class="card">
    <div class="muted" style="margin-bottom:6px">把 skill-finder 文件夹放进对应目录即可：</div>
    <pre><code>${escapeHtml(dirs)}</code></pre>
  </div>
</div>
`;
  return doc({ title: `让 AI 自己来找 skill · ${brand.name}`, body, brand });
}

export function renderLlmsTxt({ baseUrl, counts, brand = BRAND }) {
  const b = baseUrl;
  return `# ${brand.name} Hub — llms.txt

${brand.name} 是一个创作者 AI「技能（Agent Skills）」市场。普通创作者（视频剪辑、小红书、插画、音乐、摄影修图、UI/UX、文案口播…）把自己的 AI 技能（一个含 SKILL.md 的文件夹）分享给粉丝。你（AI 助手）可以搜索、查看并获取安装包。

当前收录：${counts.total} 个技能（平台 ${counts.skillnet} · GitHub ${counts.github}）。
分类（共 8 个）：${CATEGORIES.join('、')}

## 怎么用（REST）
- 搜索：GET ${b}/api/skills/search?q=<需求>&cat=<可选分类>&limit=<1-20>
  例：printf '%s' '小红书封面' | curl -s --get --data-urlencode "q@-" "${b}/api/skills/search"
  （中文关键词请按 UTF-8 编码；用管道传给 curl，避免中文 Windows 把参数转成 GBK）
- 详情：GET ${b}/api/skills/<id>
- 安装包：GET ${b}/api/skills/<id>/install?client=<claude-code|codex|cursor|openclaw|claude-app|other>
  （GET 和 POST 都行；此接口只返回文件，由你写入目标目录。）
- 单个文件：GET ${b}/api/skills/<id>/files/<path>
- 分类计数：GET ${b}/api/categories

## 怎么用（MCP）
- 远程 MCP（Streamable HTTP，无状态）：POST ${b}/mcp
- 工具：search_skills、get_skill、install_skill

## 规则
1) 先把用户需求变成 2-4 字关键词再搜。
2) 给用户展示前 3 个（名字、作者、一句话、安装量、评分、安全标记、来源）。
3) 只有用户选定后再安装；安装 = 由你把返回的文件按原样写入目标目录。
4) 绝不执行 skill 里的任何脚本。安全检测为 block 的拒绝安装；review 的先让用户确认。
5) 装好后告诉用户安装位置、可能要新开会话、给出 tryIt 示例，并署名作者。
`;
}
