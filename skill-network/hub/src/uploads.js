// uploads.js — validate + normalize an uploaded skill (files + SKILL.md
// frontmatter) and write it to data/uploads/<skillId>/<version>/<path>.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HttpError } from './catalog.js';

const MAX_FILES = 60;
const MAX_TOTAL = 2 * 1024 * 1024;   // 2 MB decoded
const MAX_PER_FILE = 500 * 1024;     // 500 KB

const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv',
  'py', 'js', 'mjs', 'cjs', 'ts', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'rb', 'pl', 'lua', 'r', 'toml', 'ini', 'cfg', 'conf', 'env',
  'html', 'htm', 'css', 'xml', 'svg', 'srt', 'vtt', 'sql', 'tex',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const BLOCKED_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'apk',
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'class', 'o', 'a', 'lib',
  'iso', 'img',
]);

function extOf(path) {
  const base = path.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i === -1 ? '' : base.slice(i + 1).toLowerCase();
}

// Minimal YAML frontmatter reader: the `---` block at the top, simple key: value
// pairs (quotes stripped). Enough for `name` and `description`.
export function parseFrontmatter(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const m = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(s);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[mm[1]] = v;
  }
  return out;
}

function normalizePath(raw) {
  let p = String(raw || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!p) throw new HttpError(400, 'bad_path', '文件路径不能为空');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw new HttpError(400, 'bad_path', `非法的绝对路径：${raw}`);
  const segs = p.split('/');
  if (segs.some((s) => s === '..' || s === '')) throw new HttpError(400, 'bad_path', `非法的文件路径：${raw}`);
  return segs.join('/');
}

// validateUpload(files) -> { files:[{path, encoding, content(utf8 string)|null, data(Buffer), binary}], slug, frontmatter }
export function validateUpload(rawFiles) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) throw new HttpError(400, 'no_files', '没有要上传的文件');
  if (rawFiles.length > MAX_FILES) throw new HttpError(400, 'too_many_files', `文件数量超过上限（最多 ${MAX_FILES} 个）`);

  let total = 0;
  const files = [];
  for (const f of rawFiles) {
    const path = normalizePath(f && f.path);
    const encoding = f && f.encoding === 'base64' ? 'base64' : 'utf8';
    const ext = extOf(path);
    if (BLOCKED_EXT.has(ext)) throw new HttpError(400, 'bad_file_type', `不允许的文件类型（${path}）：可执行文件和压缩包不能上传`);
    const isImage = IMAGE_EXT.has(ext);
    const isText = TEXT_EXT.has(ext);
    if (!isImage && !isText) throw new HttpError(400, 'bad_file_type', `不支持的文件类型（${path}）：只允许文本文件和图片`);

    let data;
    if (encoding === 'base64') {
      try { data = Buffer.from(String(f.content || ''), 'base64'); } catch { throw new HttpError(400, 'bad_encoding', `无法解码 base64 文件：${path}`); }
    } else {
      data = Buffer.from(String(f.content == null ? '' : f.content), 'utf8');
    }
    if (data.length > MAX_PER_FILE) throw new HttpError(400, 'file_too_large', `单个文件超过 500 KB：${path}`);
    total += data.length;
    if (total > MAX_TOTAL) throw new HttpError(400, 'upload_too_large', '所有文件解码后总大小超过 2 MB');

    const binary = encoding === 'base64' && !(ext === 'svg');
    files.push({ path, encoding, data, content: binary ? null : data.toString('utf8'), binary });
  }

  // Strip a shared single top folder (e.g. a zipped "my-skill/" wrapper).
  const tops = files.map((f) => f.path.split('/')[0]);
  const top = tops[0];
  if (top && tops.every((t) => t === top) && files.every((f) => f.path.length > top.length + 1)) {
    for (const f of files) f.path = f.path.slice(top.length + 1);
  }

  // Require a root SKILL.md with frontmatter name + description.
  const skillMd = files.find((f) => f.path === 'SKILL.md');
  if (!skillMd) throw new HttpError(400, 'missing_skill_md', '缺少根目录下的 SKILL.md');
  const fm = parseFrontmatter(skillMd.content);
  if (!fm || !fm.name || !fm.description) {
    throw new HttpError(400, 'bad_frontmatter', 'SKILL.md 需要包含 frontmatter（--- 包起来），且至少有 name 和 description 两个字段');
  }
  if (!/^[a-z0-9-]{1,64}$/.test(fm.name)) {
    throw new HttpError(400, 'bad_frontmatter', `frontmatter 的 name 只能用小写字母、数字和连字符（1-64 位）作为技能标识，例如 name: my-cover-helper；当前是「${fm.name}」`);
  }

  return { files, slug: fm.name, frontmatter: fm };
}

// Write validated files to <dataDir>/uploads/<skillId>/<version>/<path>.
// join() maps the POSIX path segments onto the platform separator on disk.
export function saveFiles(dataDir, skillId, version, files) {
  const root = join(dataDir, 'uploads', skillId, String(version));
  for (const f of files) {
    const abs = join(root, ...f.path.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.data);
  }
  return root;
}
