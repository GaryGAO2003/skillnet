// safety.js — static scanner for skill files.
// scanFiles([{path, content, binary?}]) -> {level, findings:[{rule,severity,label,file,line,excerpt}]}
// level: "block" (any block finding) > "review" (any review finding) > "pass".

const MAX_EXCERPT = 120;

const EXEC_EXT = /\.(sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|exe|bin)$/i;

const PRECEDENCE = { block: 3, review: 2, pass: 1 };

function clip(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > MAX_EXCERPT ? t.slice(0, MAX_EXCERPT) : t;
}

function lineOf(content, index) {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') n++;
  return n;
}

function lineText(content, index) {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  return content.slice(start, end);
}

// The hit's line plus `n` lines on each side.
function linesAround(content, index, n) {
  const ln = lineOf(content, index) - 1;
  return content.split('\n').slice(Math.max(0, ln - n), ln + n + 1).join('\n');
}

// Find the first regex match on a line that also satisfies `also` (regex) on the
// same line. Returns {index} or null.
function matchAll(content, re) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(content)) !== null) {
    out.push({ index: m.index, text: m[0] });
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

// ---- block-level patterns ---------------------------------------------------
const RE_PIPE_SHELL = /(?:curl|wget)[^\n|]{0,400}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python[\d.]*)\b/i;
const RE_BASE64_DECODE = /base64\s+(?:--decode|-d|-D)\b/;
const RE_PIPE_TO_SHELL = /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python[\d.]*)\b/i;
const RE_IEX = /(?:iex|invoke-expression)/i;
const RE_PS_DOWNLOAD = /(?:iwr|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient|new-object\s+net\.webclient)/i;
const RE_ARCHIVE = /https?:\/\/\S+\.(?:zip|7z|rar)\b/i;
const RE_PASSWORD = /(?:password|passwd|pwd|解压密码|密码|口令)\s*[:：=]?\s*[^\s]+/i;
const RE_EXFIL_HOST = /(?:pastebin\.com\/raw|glot\.io|transfer\.sh|webhook\.site|[\w.-]*\bngrok(?:-free)?\.(?:io|app|dev)\b)/i;
const RE_CMD_CONTEXT = /(?:curl|wget|iwr|invoke-|fetch\b|\bnc\b|ncat|-d\b|-F\b|-T\b|upload|scp|rsync|xargs|post\b)/i;
// Targets are the browser's cookie/password *databases* and key files, not the
// word "cookies" — creator docs say "cookies" for ordinary reasons.
const RE_SECRET_TARGET = /(~\/\.ssh|\/\.ssh\/|\bid_rsa\b|\bid_ed25519\b|login\s*data|cookies\.sqlite|(?:default|network|profile[^/\\\n]*)[/\\]cookies\b|keychain|metamask|exodus|electrum|wallet\.dat|application support\/[^\n]*wallet)/i;
// Command-shaped verbs only: plain words like "copy", "more", "type" or "less"
// sit next to those targets in ordinary prose (and "copy" is half of copywriting).
const RE_SECRET_VERB = /(\bcat\s+[~/."']|\bcp\s|\bscp\b|\brsync\b|\bsqlite3?\b|get-content|copy-item|compress-archive|\btar\s|\bzip\s|\bcurl\b|\bwget\b|\s-d\s|\s-F\s|--data|\bupload|\bbase64\b|\bxxd\b|\bopenssl\b|\bsecurity\s+find-|\btype\s+%)/i;
const RE_RM_RF = /\brm\s+-[a-z]*r[a-z]*\s+(?:--no-preserve-root\s+)?(\/|~)(?![\w])/i;
// Public IPs only: loopback/LAN URLs are how local tools (e.g. ComfyUI on
// 127.0.0.1:8188) are documented and are not a download source.
const RE_IP_URL = /https?:\/\/(?!(?:127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.))\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\/\S+/i;
const RE_IP_EXEC = /(chmod\s+\+x|\|\s*(?:sh|bash|zsh)\b|start-process|\.\/\S+|\.(?:exe|bin|sh)\b)/i;

// ---- review-level patterns --------------------------------------------------
const RE_NETWORK = /(curl|wget|fetch\(|requests\.|urllib|http\.get|http\.request|axios|invoke-webrequest|\biwr\b|net\.webclient|new\s+webclient|socket\.)/i;
const RE_EVAL = /\b(eval|exec)\s*\(/;
const RE_SUDO = /\bsudo\b/;
// Credential *handling* (keys, secret env vars, auth headers), not the bare
// words "token"/"password": creator docs say "设计 Token" and "烧了 230 亿 Token",
// and UI pattern tables list "Password Visibility".
const RE_CRED = /(api[_-]?key|access[_-]?token|secret[_-]?key|\b[A-Z][A-Z0-9_]*_(?:TOKEN|SECRET|PASSWORD)\b|password\s*[=:]\s*\S|bearer\s+[A-Za-z0-9._-]{8,}|authorization:\s*\S)/i;
const RE_PREREQ = /(prerequisite|先安装|需要安装|请先安装|前置|先下载|需要先下载)/i;
const RE_URL = /https?:\/\/[^\s)'"]+/i;
const RE_B64_BLOB = /[A-Za-z0-9+/]{200,}={0,2}/;
const STD_HOSTS = /(github\.com|raw\.githubusercontent\.com|githubusercontent\.com|npmjs\.(?:com|org)|registry\.npmjs|pypi\.org|files\.pythonhosted|gitlab\.com|bitbucket\.org|huggingface\.co|anthropic\.com|claude\.(?:com|ai)|openai\.com|google\.com|microsoft\.com|apple\.com|python\.org|nodejs\.org|ffmpeg\.org|adobe\.com|figma\.com|capcut\.(?:com|cn)|volcengine\.com|aliyun\.com|tencent\.com|wikipedia\.org)/i;

function nearby(indexA, listB, span) {
  for (const b of listB) if (Math.abs(b.index - indexA) <= span) return b;
  return null;
}

export function scanFiles(files) {
  const findings = [];
  const add = (rule, severity, label, file, index, content) => {
    findings.push({
      rule, severity, label, file,
      line: content != null && index != null ? lineOf(content, index) : null,
      excerpt: content != null && index != null ? clip(lineText(content, index)) : '',
    });
  };

  for (const f of files || []) {
    const file = f.path || '';
    if (f.binary) {
      findings.push({ rule: 'binary-file', severity: 'review', label: '二进制文件，无法静态审查', file, line: null, excerpt: '' });
      continue;
    }
    const content = typeof f.content === 'string' ? f.content : '';

    // ---- block rules ----
    for (const m of matchAll(content, RE_PIPE_SHELL)) add('pipe-to-shell', 'block', '把下载内容直接管道给 shell 执行', file, m.index, content);

    for (const m of matchAll(content, RE_BASE64_DECODE)) {
      const line = lineText(content, m.index);
      if (RE_PIPE_TO_SHELL.test(line)) add('base64-to-shell', 'block', '把 base64 解码后直接执行', file, m.index, content);
    }

    const iexHits = matchAll(content, RE_IEX);
    const dlHits = matchAll(content, RE_PS_DOWNLOAD);
    for (const h of iexHits) if (nearby(h.index, dlHits, 200)) { add('powershell-download-exec', 'block', 'PowerShell 下载并执行远程脚本', file, h.index, content); break; }

    const archiveHits = matchAll(content, RE_ARCHIVE);
    const pwHits = matchAll(content, RE_PASSWORD);
    for (const a of archiveHits) if (nearby(a.index, pwHits, 400)) { add('password-archive', 'block', '带密码的压缩包“前置依赖”，疑似诱导安装恶意包', file, a.index, content); break; }

    for (const m of matchAll(content, RE_EXFIL_HOST)) {
      const line = lineText(content, m.index);
      if (RE_CMD_CONTEXT.test(line)) add('exfil-host', 'block', '命令中出现外泄/粘贴板主机，可能上传你的数据', file, m.index, content);
    }

    const secretHits = matchAll(content, RE_SECRET_TARGET);
    for (const s of secretHits) {
      const start = content.lastIndexOf('\n', content.lastIndexOf('\n', s.index - 1) - 1) + 1;
      let end = content.indexOf('\n', content.indexOf('\n', s.index) + 1);
      if (end === -1) end = content.length;
      const window = content.slice(start, end);
      if (RE_SECRET_VERB.test(window)) add('read-secrets', 'block', '读取 SSH 私钥/浏览器 Cookie/钱包等敏感文件', file, s.index, content);
    }

    for (const m of matchAll(content, RE_RM_RF)) add('rm-rf-root', 'block', '删除根目录或主目录（rm -rf / 或 ~）', file, m.index, content);

    const ipHits = matchAll(content, RE_IP_URL);
    for (const ip of ipHits) if (RE_IP_EXEC.test(linesAround(content, ip.index, 2))) { add('raw-ip-exec', 'block', '从裸 IP 地址下载并执行程序', file, ip.index, content); break; }

    // ---- review rules ----
    if (EXEC_EXT.test(file)) findings.push({ rule: 'executable-file', severity: 'review', label: '可执行脚本/二进制文件，安装前请人工检查', file, line: 1, excerpt: '' });

    if (EXEC_EXT.test(file)) for (const m of matchAll(content, RE_NETWORK)) { add('network-in-script', 'review', '脚本中包含网络请求', file, m.index, content); break; }

    for (const m of matchAll(content, RE_EVAL)) { add('eval-exec', 'review', '动态执行代码（eval/exec）', file, m.index, content); break; }
    for (const m of matchAll(content, RE_SUDO)) { add('sudo', 'review', '使用 sudo 提权', file, m.index, content); break; }
    for (const m of matchAll(content, RE_CRED)) { add('credential-mention', 'review', '提到密钥/令牌/密码等敏感信息', file, m.index, content); break; }

    const prereqHits = matchAll(content, RE_PREREQ);
    if (prereqHits.length) {
      for (const u of matchAll(content, RE_URL)) {
        if (!STD_HOSTS.test(u.text) && nearby(u.index, prereqHits, 300)) { add('prereq-download', 'review', '“前置依赖”指向非官方来源的下载链接', file, u.index, content); break; }
      }
    }

    for (const m of matchAll(content, RE_B64_BLOB)) { add('base64-blob', 'review', '超长 base64 数据块', file, m.index, content); break; }
  }

  let level = 'pass';
  for (const f of findings) if (PRECEDENCE[f.severity] > PRECEDENCE[level]) level = f.severity;
  return { level, findings };
}
