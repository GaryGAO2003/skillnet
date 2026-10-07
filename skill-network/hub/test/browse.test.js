import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, cpSync, mkdtempSync } from 'node:fs';
import { createServer } from '../src/server.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const root = mkdtempSync(join(tmpdir(), 'sn-browse-'));
const dataDir = join(root, 'data');
cpSync(fixtures, dataDir, { recursive: true });

let server; let base; let ck;
const J = (cookie) => (cookie ? { 'content-type': 'application/json', cookie } : { 'content-type': 'application/json' });
const cookieOf = (res) => { const sc = res.headers.get('set-cookie'); return sc ? sc.split(';')[0] : null; };
const post = (p, b, c) => fetch(`${base}${p}`, { method: 'POST', headers: J(c), body: JSON.stringify(b || {}) });

test.before(async () => {
  server = createServer({ dataDir, stateFile: join(dataDir, 'state.json'), dbFile: null, port: 0, baseUrl: null });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const s = await post('/api/auth/signup', { name: '访客', handle: 'visitor', password: 'password123', role: 'user' });
  ck = cookieOf(s);
});
test.after(() => { server.close(); try { rmSync(root, { recursive: true, force: true }); } catch {} });

test('GET /api/home 形状完整', async () => {
  const j = await (await fetch(`${base}/api/home`)).json();
  assert.ok(Array.isArray(j.collections) && j.collections.length > 0);
  assert.ok(j.collections[0].title && Array.isArray(j.collections[0].skills));
  assert.ok(Array.isArray(j.hot) && j.hot.length <= 8 && j.hot.length > 0);
  assert.ok(Array.isArray(j.fresh) && j.fresh.length <= 8);
  assert.ok(Array.isArray(j.creators) && j.creators.length <= 6);
  assert.equal(j.categories.length, 8);
  // SkillSummary superset fields present
  const sm = j.hot[0];
  for (const k of ['glyph', 'pal', 'likes', 'liked', 'video', 'version', 'updated', 'pick', 'owner']) assert.ok(k in sm, `缺少字段 ${k}`);
  assert.equal(sm.liked, null); // logged out
  assert.ok(sm.pal >= 0 && sm.pal <= 7);
});

test('GET /api/rank 各类型', async () => {
  for (const type of ['hot', 'new', 'fav', 'rating']) {
    const j = await (await fetch(`${base}/api/rank?type=${type}&limit=5`)).json();
    assert.equal(j.type, type);
    assert.ok(Array.isArray(j.items));
  }
  const hot = await (await fetch(`${base}/api/rank?type=hot&limit=5`)).json();
  // hot sorted by installs desc
  for (let i = 1; i < hot.items.length; i++) assert.ok(hot.items[i - 1].installs >= hot.items[i].installs);
});

test('like 切换：liked 与 likes 计数', async () => {
  const base0 = (await (await fetch(`${base}/api/skills/s1`, { headers: { cookie: ck } })).json()).likes;
  const on = await (await post('/api/skills/s1/like', {}, ck)).json();
  assert.equal(on.liked, true);
  assert.equal(on.likes, base0 + 1);
  const off = await (await post('/api/skills/s1/like', {}, ck)).json();
  assert.equal(off.liked, false);
  assert.equal(off.likes, base0);
});

test('follow 切换：following 与 followers 计数', async () => {
  const on = await (await post('/api/creators/momo/follow', {}, ck)).json();
  assert.equal(on.following, true);
  assert.ok(on.followers >= 1);
  const off = await (await post('/api/creators/momo/follow', {}, ck)).json();
  assert.equal(off.following, false);
});

test('library：加入/移除；hasUpdate=false 当已看到当前版本', async () => {
  const add = await (await fetch(`${base}/api/me/library/s1`, { method: 'POST', headers: J(ck) })).json();
  assert.equal(add.inLibrary, true);
  const lib = await (await fetch(`${base}/api/me/library`, { headers: { cookie: ck } })).json();
  const item = lib.items.find((x) => x.id === 's1');
  assert.ok(item);
  assert.equal(item.hasUpdate, false);
  const del = await (await fetch(`${base}/api/me/library/s1`, { method: 'DELETE', headers: J(ck) })).json();
  assert.equal(del.inLibrary, false);
});

test('二维码：skill 与 creator 的 QR 都是合法 SVG', async () => {
  const r1 = await fetch(`${base}/api/skills/s1/qr.svg`);
  assert.ok(r1.headers.get('content-type').includes('image/svg+xml'));
  const svg1 = await r1.text();
  assert.ok(svg1.trim().startsWith('<svg') && svg1.includes('</svg>'));
  const r2 = await fetch(`${base}/api/creators/momo/qr.svg`);
  assert.ok((await r2.text()).includes('<svg'));
});

test('app shell：/ 注入 window.__SN__（含 brand）', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes('window.__SN__'));
  assert.ok(html.includes('"brand"') && html.includes('SkillNet'));
});

test('静态资源路径穿越被拒', async () => {
  const res = await fetch(`${base}/assets/..%2f..%2fpackage.json`);
  assert.ok(res.status === 400 || res.status === 404);
});

test('/browse 支持 ?q= 与 ?cat=', async () => {
  const h = await (await fetch(`${base}/browse?q=${encodeURIComponent('封面')}`)).text();
  assert.ok(h.includes('封面'));
  const c = await (await fetch(`${base}/browse?cat=${encodeURIComponent('小红书')}`)).text();
  assert.ok(c.includes('小红书'));
});

test('skill-finder 模板渲染：替换了 {{BRAND}} 与 {{BASE_URL}}，且 zip 可下载', async () => {
  const md = await (await fetch(`${base}/skill-finder/SKILL.md`)).text();
  assert.ok(!md.includes('{{BRAND}}') && !md.includes('{{BASE_URL}}'));
  assert.ok(!md.includes('http://localhost:8787')); // the hard-coded address is gone
  assert.ok(md.includes('/api/skills/search')); // BASE_URL substituted into the commands
  assert.ok(md.includes('SkillNet'));
  const zip = await fetch(`${base}/skill-finder.zip`);
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK');
  const getf = await (await fetch(`${base}/get-finder`)).text();
  assert.ok(getf.includes('让你的 AI 自己来这里找 skill'));
});

test('vendor/fflate.js 可从 node_modules 提供', async () => {
  const res = await fetch(`${base}/vendor/fflate.js`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('javascript'));
});
