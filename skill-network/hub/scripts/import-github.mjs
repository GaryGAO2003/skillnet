#!/usr/bin/env node
// import-github.mjs — turn data/github-allowlist.json into data/github.json.
// Pins each skill to a commit sha, lists its files, runs the safety scanner on
// text files, parses frontmatter, and writes normalized records.
//
// Usage: node scripts/import-github.mjs [--allowlist <path>] [--out <path>]
// Token: env GITHUB_TOKEN, else `gh auth token`, else unauthenticated (low rate limit).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { scanFiles } from '../src/safety.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = ['视频剪辑', '短视频运营', '小红书', '插画美术', '音乐', '摄影修图', 'UI/UX', '文案口播'];
const MAX_FILES = 40;
const MAX_BYTES = 200 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp4|mov|webm|mp3|wav|zip|7z|rar|gz|tar|pdf|woff2?|ttf|otf|exe|bin|wasm|psd|ai|sketch)$/i;
const JUNK = /(^|\/)(\.git|\.github\/workflows|node_modules|\.DS_Store|dist|build)(\/|$)/i;

function parseArgs(argv) {
  const out = { allowlist: 'data/github-allowlist.json', out: 'data/github.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allowlist') out.allowlist = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

const TOKEN = getToken();
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'skillnet-hub-import',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function ghJson(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: HEADERS });
  if (!res.ok) { const e = new Error(`GitHub ${res.status} ${path}`); e.status = res.status; throw e; }
  return res.json();
}

const encSeg = (p) => p.split('/').map(encodeURIComponent).join('/');

async function fetchRaw(repo, sha, relPath) {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${encSeg(relPath)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'skillnet-hub-import' } });
  if (!res.ok) throw new Error(`raw ${res.status} ${relPath}`);
  return res.text();
}

// Minimal YAML frontmatter: quoted / plain scalars + `>` and `|` block scalars.
function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2];
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const block = [];
      const baseIndent = (lines[i + 1] || '').match(/^(\s*)/)[1].length;
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].match(/^(\s*)/)[1].length >= baseIndent) && !/^[A-Za-z0-9_-]+:/.test(lines[i + 1])) {
        block.push(lines[++i].slice(baseIndent));
      }
      val = val.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim();
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    data[key] = val;
  }
  return data;
}

function slugify(name, dir) {
  if (name && /^[a-z0-9-]{1,64}$/.test(name)) return name;
  const basename = (dir.split('/').pop() || 'skill').toLowerCase();
  return basename.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';
}

function idFor(repo, path) {
  return 'gh-' + createHash('sha1').update(`${repo}/${path}`).digest('hex').slice(0, 8);
}

async function processEntry(entry) {
  const { repo, path } = entry;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  const repoInfo = await ghJson(`/repos/${repo}`);
  const branch = repoInfo.default_branch || 'main';
  const commit = await ghJson(`/repos/${repo}/commits/${encodeURIComponent(branch)}`);
  const sha = commit.sha;
  const tree = await ghJson(`/repos/${repo}/git/trees/${sha}?recursive=1`);

  const blobs = (tree.tree || []).filter((t) => t.type === 'blob');
  // A root-level SKILL.md means the whole repo is the skill (scripts and assets
  // live in subfolders), so take the full tree, not just root files.
  const allInDir = blobs.filter((b) => !JUNK.test(b.path)
    && (dir === '' || b.path === path || b.path.startsWith(dir + '/')));
  allInDir.sort((a, b) => (a.path === path ? -1 : b.path === path ? 1 : 0)); // SKILL.md always listed + scanned
  // Past MAX_FILES we list/scan only a prefix; installs then go through the
  // pinned archive (archiveUrl) instead of per-file URLs.
  const truncated = allInDir.length > MAX_FILES;
  const inDir = allInDir.slice(0, MAX_FILES);

  const files = [];
  const textFiles = [];
  for (const b of inDir) {
    const rel = dir === '' ? b.path : b.path.slice(dir.length + 1);
    files.push({ path: rel, size: b.size || 0 });
    if (!BINARY_EXT.test(rel) && (b.size || 0) <= MAX_BYTES) {
      try { textFiles.push({ path: rel, content: await fetchRaw(repo, sha, b.path) }); } catch (err) { console.warn(`  ! 跳过 ${rel}: ${err.message}`); }
    }
  }
  files.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));

  const skillMd = textFiles.find((f) => f.path === 'SKILL.md') || textFiles.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  const fm = skillMd ? parseFrontmatter(skillMd.content) : {};
  const safety = scanFiles(textFiles);
  if (truncated) {
    safety.findings.push({ rule: 'partial-scan', severity: 'review', label: `文件太多（${allInDir.length} 个），只静态检查了前 ${MAX_FILES} 个`, file: '', line: null, excerpt: '' });
    if (safety.level === 'pass') safety.level = 'review';
  }

  const slug = slugify(fm.name, dir || repo.split('/')[1]);
  const rawBase = `https://raw.githubusercontent.com/${repo}/${sha}/${dir ? encSeg(dir) + '/' : ''}`;
  const url = `https://github.com/${repo}/tree/${sha}${dir ? '/' + encSeg(dir) : ''}`;

  return {
    id: idFor(repo, path),
    repo,
    path,
    dir,
    ref: sha,
    branch,
    slug,
    name: entry.title_zh,
    desc: entry.summary_zh,
    descOriginal: fm.description || null,
    cat: entry.cat,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    requires: entry.requires == null ? null : entry.requires,
    author: { login: repoInfo.owner.login, url: repoInfo.owner.html_url },
    stars: repoInfo.stargazers_count || 0,
    license: repoInfo.license && repoInfo.license.spdx_id && repoInfo.license.spdx_id !== 'NOASSERTION' ? repoInfo.license.spdx_id : null,
    pushedAt: repoInfo.pushed_at || null,
    fork: !!repoInfo.fork,
    files,
    fileCount: allInDir.length,
    truncated,
    safety: { level: safety.level, findings: safety.findings },
    url,
    rawBase,
    // codeload zips unpack to <repo-name>-<sha>/
    archiveUrl: `https://codeload.github.com/${repo}/zip/${sha}`,
    archiveRoot: `${repo.split('/')[1]}-${sha}${dir ? '/' + dir : ''}`,
  };
}

async function runPool(items, limit, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); } catch (err) {
        console.warn(`! 跳过 ${items[idx].repo} ${items[idx].path}: ${err.message}`);
        results[idx] = null;
      }
    }
  });
  await Promise.all(runners);
  return results.filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolve = (p) => (isAbsolute(p) ? p : join(ROOT, p.replace(/^\.\//, '')));
  const allowPath = resolve(args.allowlist);
  const outPath = resolve(args.out);

  if (!existsSync(allowPath)) { console.error(`找不到 allowlist：${allowPath}`); process.exit(1); }
  const allow = JSON.parse(readFileSync(allowPath, 'utf8'));
  if (!Array.isArray(allow) || !allow.length) { console.error('allowlist 为空'); process.exit(1); }
  console.log(`导入 ${allow.length} 条（token: ${TOKEN ? '有' : '无（匿名，限流严格）'}）…`);

  let entries = await runPool(allow, 4, processEntry);

  const catIdx = (c) => { const i = CATEGORIES.indexOf(c); return i === -1 ? 999 : i; };
  entries.sort((a, b) => catIdx(a.cat) - catIdx(b.cat) || (b.stars - a.stars));

  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');

  console.log(`\n写入 ${entries.length} 条 → ${outPath}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('id', 14) + pad('name', 22) + pad('cat', 12) + pad('stars', 7) + 'safety');
  console.log('-'.repeat(60));
  for (const e of entries) console.log(pad(e.id, 14) + pad((e.name || '').slice(0, 20), 22) + pad(e.cat, 12) + pad(e.stars, 7) + e.safety.level);
}

main().catch((err) => { console.error('导入失败：', err); process.exit(1); });
