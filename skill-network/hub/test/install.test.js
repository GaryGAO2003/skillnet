import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { loadCatalog, HttpError } from '../src/catalog.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const baseUrl = 'http://localhost:8787';
const stateFile = join(tmpdir(), `skillnet-install-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

test.after(() => { try { rmSync(stateFile, { force: true }); } catch {} });

test('每个客户端的安装目标目录正确', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  const b = c.install('s1', { client: 'claude-code' });
  assert.equal(b.target.user, '~/.claude/skills/xhs-cover');
  assert.equal(b.target.project, '.claude/skills/xhs-cover');
  assert.equal(b.target.windowsUser, '%USERPROFILE%\\.claude\\skills\\xhs-cover');
  assert.equal(b.source, 'skillnet');
  assert.ok(Array.isArray(b.files) && b.files.some((f) => f.path === 'SKILL.md' && typeof f.content === 'string'));
  assert.equal(b.installs, 4411); // seed 4410 + 1
});

test('安装计数递增并持久化（重载后仍在）', () => {
  const c2 = loadCatalog({ dataDir, stateFile, baseUrl });
  const b = c2.install('s1', { client: 'codex' });
  assert.equal(b.installs, 4412); // 从持久化的 1 次继续
});

test('block 技能 → 403', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  assert.throws(() => c.install('gh-33334444'), (e) => e instanceof HttpError && e.status === 403);
});

test('不存在 → 404', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  assert.throws(() => c.install('nope'), (e) => e instanceof HttpError && e.status === 404);
});

test('github 技能 → fileUrls 而非 content', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  const g = c.install('gh-11112222', { client: 'other' });
  assert.equal(g.files, null);
  assert.equal(g.zipUrl, null);
  assert.ok(g.fileUrls.length > 0);
  assert.ok(g.fileUrls[0].url.startsWith('https://raw.githubusercontent.com/'));
  assert.ok(g.notice.includes('GitHub'));
  assert.equal(g.creator.tipUrl, null); // 未认领
  assert.equal(g.sourceUrl, 'https://github.com/someone/xhs-helper/tree/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0/skills/xhs');
});

test('文件太多的 github 技能 → 不给残缺的 fileUrls，走固定版本的整包下载', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  const g = c.install('gh-55556666', { client: 'claude-code' });
  assert.equal(g.fileUrls, null);
  assert.ok(g.archiveUrl.startsWith('https://codeload.github.com/'));
  assert.ok(g.steps.some((s) => s.includes(g.archiveUrl)));
  assert.ok(g.steps.some((s) => s.includes(g.archiveRoot)));
  const app = c.install('gh-55556666', { client: 'claude-app' });
  assert.ok(app.steps[0].includes(app.archiveUrl)); // no dangling "zipUrl" for GitHub skills
});

test('claimed 技能带 tipUrl', () => {
  const c = loadCatalog({ dataDir, stateFile, baseUrl });
  const b = c.install('s2', { client: 'other' });
  assert.ok(b.creator.claimed);
  assert.ok(b.creator.tipUrl && b.creator.tipUrl.endsWith('/s/s2#tip'));
});
