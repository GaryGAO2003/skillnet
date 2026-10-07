import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createServer } from '../src/server.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const stateFile = join(tmpdir(), `skillnet-http-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

let server; let base;

test.before(async () => {
  server = createServer({ dataDir, stateFile, port: 0, baseUrl: null });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => { server.close(); try { rmSync(stateFile, { force: true }); } catch {} });

test('GET /healthz', async () => {
  const j = await (await fetch(`${base}/healthz`)).json();
  assert.equal(j.ok, true);
  assert.ok(j.skills >= 5);
  assert.ok(j.bySource.skillnet >= 5);
});

test('GBK 编码的查询（中文 Windows 上 curl 的默认行为）也能搜到', async () => {
  // 小红书封面 in GBK, exactly what curl --data-urlencode sends on code page 936
  const j = await (await fetch(`${base}/api/skills/search?q=%d0%a1%ba%ec%ca%e9%b7%e2%c3%e6`)).json();
  assert.equal(j.query, '小红书封面');
  assert.ok(j.results.length > 0);
  assert.match(j.results[0].name, /封面/);
});

test('被拦截技能的页面不给任何安装方式（HTML 和 markdown）', async () => {
  const html = await (await fetch(`${base}/s/gh-33334444`)).text();
  assert.match(html, /无法安装/);
  assert.doesNotMatch(html, /给 AI 助手的安装说明|发给 AI|复制命令/);
  const md = await (await fetch(`${base}/s/gh-33334444.md`)).text();
  assert.match(md, /已被拦截/);
  assert.doesNotMatch(md, /安装 API/);
});

test('乱码查询（?????）返回 400 提示，而不是悄悄返回热门', async () => {
  const res = await fetch(`${base}/api/skills/search?q=%3F%3F%3F%3F%3F`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'garbled_query');
});

test('GET /api/skills/search 返回 JSON，封面技能第一', async () => {
  const res = await fetch(`${base}/api/skills/search?q=${encodeURIComponent('小红书封面')}`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const j = await res.json();
  assert.ok(j.total > 0);
  assert.equal(j.results[0].id, 's1');
  assert.ok('score' in j.results[0] && 'matched' in j.results[0]);
});

test('GET /api/categories', async () => {
  const j = await (await fetch(`${base}/api/categories`)).json();
  assert.equal(j.length, 8);
  assert.ok(j.find((x) => x.cat === '小红书').count >= 2);
});

test('/s/:id 含「给 AI 助手的安装说明」', async () => {
  const h = await (await fetch(`${base}/s/s1`)).text();
  assert.ok(h.includes('给 AI 助手的安装说明'));
  assert.ok(h.includes('<link rel="alternate" type="text/markdown"'));
});

test('/s/:id.md 返回 markdown', async () => {
  const res = await fetch(`${base}/s/s1.md`);
  assert.ok(res.headers.get('content-type').includes('text/markdown'));
  const md = await res.text();
  assert.ok(md.startsWith('# 小红书封面标题'));
});

test('首页转义反射的 HTML 输入', async () => {
  const h = await (await fetch(`${base}/?q=${encodeURIComponent('<script>x')}`)).text();
  assert.ok(h.includes('&lt;script&gt;x'));
  assert.ok(!h.includes('<script>x'));
});

test('download.zip 以 PK 开头且含 <slug>/SKILL.md', async () => {
  const buf = Buffer.from(await (await fetch(`${base}/api/skills/s1/download.zip`)).arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK');
  const files = unzipSync(new Uint8Array(buf));
  assert.ok(Object.keys(files).includes('xhs-cover/SKILL.md'));
});

test('github 技能的 download.zip → 404', async () => {
  const res = await fetch(`${base}/api/skills/gh-11112222/download.zip`);
  assert.equal(res.status, 404);
});

test('路径穿越被拒绝', async () => {
  const res = await fetch(`${base}/api/skills/s1/files/..%2f..%2fskills.json`);
  assert.equal(res.status, 400);
});

test('GET install 可用（web-fetch 客户端也能装）', async () => {
  const res = await fetch(`${base}/api/skills/s2/install?client=codex`);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.client, 'codex');
  assert.equal(j.target.user, '~/.agents/skills/jy-subtitle');
  assert.ok(Array.isArray(j.files));
});

test('files 路由返回原始文本', async () => {
  const res = await fetch(`${base}/api/skills/s1/files/SKILL.md`);
  assert.ok(res.headers.get('content-type').includes('text/plain'));
  const txt = await res.text();
  assert.ok(txt.includes('小红书封面标题'));
});

test('github 技能的 files 路由 302 跳转到 raw', async () => {
  const res = await fetch(`${base}/api/skills/gh-11112222/files/SKILL.md`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.ok((res.headers.get('location') || '').startsWith('https://raw.githubusercontent.com/'));
});
