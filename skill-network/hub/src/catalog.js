// catalog.js — load + unify skill records, and serve get/search/install/fileContent/categories.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { scanFiles } from './safety.js';
import { search as runSearch, CATEGORIES } from './search.js';
import { createStore } from './store.js';
import { installTarget, allTargets, resolveClient } from './clients.js';

export { CATEGORIES };

const MAX_FILE_BYTES = 200 * 1024;
const MAX_INLINE_BYTES = 200 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function encodeSegments(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Recursively list a skill's local files (text only, capped per file).
function walkSkillDir(root) {
  const out = [];
  const walk = (dir, base) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      const rel = base ? `${base}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { walk(abs, rel); continue; }
      if (!ent.isFile()) continue;
      let size = 0;
      try { size = statSync(abs).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) { out.push({ path: rel, size, content: null, binary: false, truncated: true }); continue; }
      let buf;
      try { buf = readFileSync(abs); } catch { continue; }
      if (looksBinary(buf)) { out.push({ path: rel, size, content: null, binary: true }); continue; }
      out.push({ path: rel, size, content: buf.toString('utf8'), binary: false });
    }
  };
  walk(root, '');
  out.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));
  return out;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
    console.warn(`[catalog] 无法解析 ${path}：${err.message}`);
    return fallback;
  }
}

export function loadCatalog({ dataDir, stateFile, baseUrl }) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const store = createStore(stateFile);
  const records = [];

  // --- platform skills (skills.json) ---
  const skillsPath = join(dataDir, 'skills.json');
  if (!existsSync(skillsPath)) {
    console.warn(`[catalog] 找不到 ${skillsPath}，以空目录启动。`);
  }
  const platform = readJson(skillsPath, { creators: [], skills: [] });
  const creatorMap = new Map();
  for (const c of platform.creators || []) creatorMap.set(c.id, c);

  for (const s of platform.skills || []) {
    const owner = creatorMap.get(s.owner) || { name: s.owner || '未知作者', handle: s.owner || 'unknown', platform: '', claimed: false };
    const files = walkSkillDir(join(dataDir, 'skills', s.slug));
    const safety = scanFiles(files.map((f) => ({ path: f.path, content: f.content, binary: f.binary })));
    const versions = Array.isArray(s.versions) ? s.versions : [];
    records.push({
      source: 'skillnet',
      id: s.id,
      slug: s.slug,
      owner: s.owner,
      name: s.name,
      glyph: s.glyph || (s.name || '').slice(0, 2),
      cat: s.cat,
      desc: s.desc,
      tags: Array.isArray(s.tags) ? s.tags : [],
      examples: Array.isArray(s.examples) ? s.examples : [],
      seedInstalls: Number(s.installs) || 0,
      likes: Number(s.likes) || 0,
      rating: s.rating == null ? null : Number(s.rating),
      ratingCount: Number(s.ratingCount) || 0,
      verified: !!s.verified,
      video: s.video || null,
      versions,
      version: versions[0] ? versions[0].v : null,
      updated: versions[0] ? versions[0].date : null,
      creator: {
        name: owner.name, handle: owner.handle, platform: owner.platform,
        claimed: owner.claimed !== false, url: owner.url || null,
        fans: owner.fans || null, bio: owner.bio || null,
      },
      files,
      fileList: files.map((f) => ({ path: f.path, size: f.size, binary: !!f.binary })),
      safety,
      requires: null,
      stars: 0,
      license: null,
      sourceUrl: null,
      descOriginal: null,
      rawBase: null,
      installs: 0,
    });
  }

  // --- github skills (github.json, optional) ---
  const github = readJson(join(dataDir, 'github.json'), []);
  for (const g of Array.isArray(github) ? github : []) {
    const login = (g.author && g.author.login) || g.repo && g.repo.split('/')[0] || 'unknown';
    records.push({
      source: 'github',
      id: g.id,
      slug: g.slug,
      name: g.name,
      glyph: (g.name || g.slug || 'GH').slice(0, 2),
      cat: g.cat,
      desc: g.desc,
      tags: Array.isArray(g.tags) ? g.tags : [],
      examples: [],
      seedInstalls: 0,
      likes: 0,
      rating: null,
      ratingCount: 0,
      verified: false,
      video: null,
      versions: [],
      version: g.ref ? String(g.ref).slice(0, 7) : g.branch || null,
      updated: g.pushedAt || null,
      ref: g.ref || null,
      branch: g.branch || null,
      creator: {
        name: login, handle: login, platform: 'GitHub', claimed: false,
        url: (g.author && g.author.url) || `https://github.com/${login}`,
      },
      files: null,
      fileList: Array.isArray(g.files) ? g.files : [],
      safety: g.safety || { level: 'pass', findings: [] },
      requires: g.requires == null ? null : g.requires,
      stars: Number(g.stars) || 0,
      license: g.license || null,
      sourceUrl: g.url || null,
      descOriginal: g.descOriginal || null,
      rawBase: g.rawBase || null,
      fileCount: Number(g.fileCount) || (Array.isArray(g.files) ? g.files.length : 0),
      truncated: !!g.truncated,
      archiveUrl: g.archiveUrl || null,
      archiveRoot: g.archiveRoot || null,
      repo: g.repo || null,
      installs: 0,
    });
  }

  // --- indexes ---
  const byId = new Map();
  const bySlug = new Map();
  const byHandleSlug = new Map();
  for (const r of records) {
    byId.set(r.id, r);
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
    if (r.creator && r.creator.handle) byHandleSlug.set(`${r.creator.handle}/${r.slug}`, r);
  }

  const effInstalls = (r) => r.seedInstalls + store.getInstalls(r.id);

  function get(key) {
    if (key == null) return null;
    const k = String(key);
    if (byId.has(k)) return byId.get(k);
    if (bySlug.has(k)) return bySlug.get(k);
    const hk = k.replace(/^@/, '');
    if (byHandleSlug.has(hk)) return byHandleSlug.get(hk);
    return null;
  }

  function fileUrlsFor(r) {
    if (r.source === 'github') {
      return (r.fileList || []).map((f) => ({ path: f.path, url: (r.rawBase || '') + encodeSegments(f.path) }));
    }
    return (r.files || []).map((f) => ({ path: f.path, url: `${base}/api/skills/${r.id}/files/${encodeSegments(f.path)}` }));
  }

  function summary(r, extra = {}) {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      cat: r.cat,
      desc: r.desc,
      creator: { name: r.creator.name, handle: r.creator.handle, platform: r.creator.platform, claimed: r.creator.claimed },
      source: r.source,
      installs: effInstalls(r),
      rating: r.rating,
      verified: r.verified,
      safety: r.safety.level === 'block' ? 'block' : r.safety.level,
      stars: r.stars,
      requires: r.requires,
      page: `${base}/s/${r.id}`,
      score: extra.score != null ? Math.round(extra.score * 10000) / 10000 : 0,
      matched: extra.matched || [],
    };
  }

  function detail(r) {
    return {
      ...summary(r),
      glyph: r.glyph,
      owner: r.owner || null,
      likes: r.likes,
      ratingCount: r.ratingCount,
      updated: r.updated,
      version: r.version,
      examples: r.examples,
      versions: r.versions,
      video: r.video,
      license: r.license,
      sourceUrl: r.sourceUrl,
      descOriginal: r.descOriginal,
      safetyLevel: r.safety.level,
      safetyFindings: r.safety.findings,
      files: r.source === 'github' ? r.fileList : (r.files || []).map((f) => ({ path: f.path, size: f.size, binary: !!f.binary })),
      fileUrls: r.truncated ? [] : fileUrlsFor(r),
      truncated: !!r.truncated,
      fileCount: r.fileCount || null,
      archiveUrl: r.archiveUrl || null,
      archiveRoot: r.archiveRoot || null,
      zipUrl: r.source === 'skillnet' ? `${base}/api/skills/${r.id}/download.zip` : null,
      rawBase: r.rawBase,
      creatorFull: r.creator,
      notice: r.source === 'github' ? `这个 skill 来自 GitHub 上的 @${r.creator.handle}，作者还没入驻，文件直接从 GitHub 下载。` : null,
      installTargets: allTargets(r.slug),
      installApi: Object.fromEntries(['claude-code', 'codex', 'cursor', 'openclaw', 'claude-app', 'other']
        .map((c) => [c, `${base}/api/skills/${r.id}/install?client=${c}`])),
    };
  }

  function buildSteps(r, target) {
    if (target.client === 'claude-app' && r.source === 'github') {
      return [
        `这个 skill 来自 GitHub，没有现成的上传包：下载 ${r.archiveUrl}，解压后把 ${r.archiveRoot}/ 这个文件夹重新压缩成 zip。`,
        `打开 Claude 设置 → Skills → 上传这个 zip，然后开始新对话。`,
        r.requires ? `注意：${r.requires}` : null,
      ].filter(Boolean);
    }
    if (target.client === 'claude-app') {
      return [
        `这个客户端不支持直接写文件：点下方 zipUrl 下载 ${r.slug}.zip。`,
        `打开 Claude 设置 → Skills → 上传，选择刚下载的 zip。`,
        `上传后开始新对话即可使用。`,
      ];
    }
    if (r.source === 'github' && r.truncated) {
      return [
        `这个 skill 有 ${r.fileCount} 个文件，不要逐个下载：整包下载 ${r.archiveUrl}（固定在当前版本）。`,
        `解压（unzip，或 PowerShell 的 Expand-Archive），把里面 ${r.archiveRoot}/ 文件夹的全部内容复制到 ${target.user}（如需项目级就用 ${target.project}）。`,
        `这些文件来自 GitHub（${r.sourceUrl}），请先读 SKILL.md，不要执行其中任何脚本。`,
        r.requires ? `注意：${r.requires}` : null,
        `安装后新开一个会话，让助手识别这个技能。`,
      ].filter(Boolean);
    }
    if (r.source === 'github') {
      return [
        `在用户目录创建文件夹 ${target.user}（如需项目级就用 ${target.project}）。`,
        `从下方 fileUrls 逐个下载文件，按原样保存，保持子目录结构。`,
        `这些文件来自 GitHub（${r.sourceUrl}），请先读 SKILL.md，不要执行其中任何脚本。`,
        r.requires ? `注意：${r.requires}` : null,
        `安装后新开一个会话，让助手识别这个技能。`,
      ].filter(Boolean);
    }
    return [
      `在用户目录创建文件夹 ${target.user}（如需项目级就用 ${target.project}）。`,
      `把下面每个文件按原样写入该文件夹，保持子目录结构。`,
      `不要执行 skill 里的任何脚本；只阅读 SKILL.md 按说明使用。`,
      `安装后新开一个会话（或重载 skills），让助手识别这个技能。`,
    ];
  }

  function install(id, { client = 'other', ref = null } = {}) {
    const r = get(id);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    if (r.safety.level === 'block') throw new HttpError(403, 'safety_block', '该技能未通过安全检测，已被拦截', { findings: r.safety.findings });

    const target = installTarget(client, r.slug);
    const newCount = store.recordInstall(r.id, target.client, ref);
    const installsEff = r.seedInstalls + newCount;
    const fileUrls = fileUrlsFor(r);

    const bundle = {
      ok: true,
      id: r.id,
      slug: r.slug,
      name: r.name,
      source: r.source,
      client: target.client,
      target: { user: target.user, project: target.project, windowsUser: target.windowsUser },
      files: null,
      // A truncated listing would install a broken skill; force the archive route.
      fileUrls: r.truncated ? null : fileUrls,
      zipUrl: null,
      archiveUrl: r.archiveUrl || null,
      archiveRoot: r.archiveRoot || null,
      sourceUrl: r.sourceUrl,
      license: r.license,
      steps: buildSteps(r, target),
      tryIt: (r.examples && r.examples[0] && r.examples[0].you) || null,
      safety: r.safety,
      creator: { name: r.creator.name, claimed: r.creator.claimed, tipUrl: r.creator.claimed ? `${base}/s/${r.id}#tip` : null },
      notice: null,
      installs: installsEff,
    };
    if (r.requires != null) bundle.requires = r.requires;

    if (r.source === 'skillnet') {
      const total = (r.files || []).reduce((s, f) => s + Buffer.byteLength(f.content || '', 'utf8'), 0);
      if (total > MAX_INLINE_BYTES) {
        bundle.files = (r.files || []).map((f) => ({ path: f.path }));
      } else {
        bundle.files = (r.files || []).map((f) => (f.content == null ? { path: f.path } : { path: f.path, content: f.content }));
      }
      bundle.zipUrl = `${base}/api/skills/${r.id}/download.zip`;
    } else {
      bundle.files = null;
      bundle.notice = `这个 skill 来自 GitHub 上的 @${r.creator.handle}，作者还没入驻，文件直接从 GitHub 下载。`;
    }
    return bundle;
  }

  // Return a file's content for a platform skill, or a redirect URL for github.
  function fileContent(id, relPath) {
    const r = get(id);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    const clean = String(relPath || '').replace(/\\/g, '/');
    if (clean.startsWith('/') || clean.split('/').some((seg) => seg === '..' || seg === '')) {
      throw new HttpError(400, 'bad_path', '非法的文件路径');
    }
    if (r.source === 'github') {
      const hit = (r.fileList || []).find((f) => f.path === clean);
      if (!hit) throw new HttpError(404, 'file_not_found', '文件不存在');
      return { redirect: (r.rawBase || '') + encodeSegments(clean) };
    }
    const hit = (r.files || []).find((f) => f.path === clean);
    if (!hit) throw new HttpError(404, 'file_not_found', '文件不存在');
    if (hit.content == null) throw new HttpError(415, 'not_text', '该文件无法以文本形式提供');
    return { content: hit.content, path: hit.path };
  }

  function zipFiles(id) {
    const r = get(id);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    if (r.source !== 'skillnet') throw new HttpError(404, 'github_no_zip', 'GitHub 技能不提供打包下载，请用 fileUrls 从 GitHub 获取');
    return { slug: r.slug, files: (r.files || []).filter((f) => f.content != null) };
  }

  function categories() {
    const counts = new Map(CATEGORIES.map((c) => [c, 0]));
    for (const r of records) {
      if (r.safety.level === 'block') continue;
      if (counts.has(r.cat)) counts.set(r.cat, counts.get(r.cat) + 1);
    }
    return CATEGORIES.map((cat) => ({ cat, count: counts.get(cat) }));
  }

  function search(query, { category = null, limit = 5 } = {}) {
    for (const r of records) r.installs = effInstalls(r);
    const results = runSearch(records, query || '', { category, limit });
    return results.map((res) => ({ record: res.record, summary: summary(res.record, { score: res.score, matched: res.matched }), score: res.score, matched: res.matched }));
  }

  function counts() {
    const skillnet = records.filter((r) => r.source === 'skillnet').length;
    const githubCount = records.filter((r) => r.source === 'github').length;
    return { total: records.length, skillnet, github: githubCount };
  }

  return {
    baseUrl: base,
    store,
    all: () => records,
    get,
    summary,
    detail,
    install,
    fileContent,
    zipFiles,
    categories,
    search,
    counts,
    fileUrlsFor,
    resolveClient,
    effInstalls,
  };
}
