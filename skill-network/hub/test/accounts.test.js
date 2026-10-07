import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, cpSync, mkdtempSync } from 'node:fs';
import { createServer } from '../src/server.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
function tempData() {
  const dir = mkdtempSync(join(tmpdir(), 'sn-acct-'));
  cpSync(fixtures, join(dir, 'data'), { recursive: true });
  return join(dir, 'data');
}

const dataDir = tempData();
let server; let base;

test.before(async () => {
  server = createServer({ dataDir, stateFile: join(dataDir, 'state.json'), dbFile: null, port: 0, baseUrl: null });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => { server.close(); try { rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const J = (cookie) => (cookie ? { 'content-type': 'application/json', cookie } : { 'content-type': 'application/json' });
const cookieOf = (res) => { const sc = res.headers.get('set-cookie'); return sc ? sc.split(';')[0] : null; };

test('signup 设置 cookie（HttpOnly/Lax/Path=/，http 下无 Secure），返回 201 {me}', async () => {
  const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: '小测', handle: 'tester1', password: 'supersecret', role: 'user' }) });
  assert.equal(res.status, 201);
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /sn_session=/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Path=\//);
  assert.match(sc, /Max-Age=/);
  assert.doesNotMatch(sc, /Secure/);
  const j = await res.json();
  assert.equal(j.me.handle, 'tester1');
  assert.equal(j.me.role, 'user');
});

test('重复 handle → 409 handle_taken', async () => {
  const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'x', handle: 'tester1', password: 'supersecret', role: 'user' }) });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'handle_taken');
});

test('非法输入 → 400（handle 规则、密码 ≥8）', async () => {
  const bad1 = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'x', handle: 'AB', password: 'supersecret' }) });
  assert.equal(bad1.status, 400);
  const bad2 = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'x', handle: 'okhandle', password: 'short' }) });
  assert.equal(bad2.status, 400);
});

test('login 正确/错误密码，logout，/api/me', async () => {
  await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'L', handle: 'loginuser', password: 'password123', role: 'creator' }) });
  const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J(), body: JSON.stringify({ handle: 'loginuser', password: 'wrongpass1' }) });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'bad_credentials');

  const ok = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J(), body: JSON.stringify({ handle: 'loginuser', password: 'password123' }) });
  assert.equal(ok.status, 200);
  const cookie = cookieOf(ok);
  const meRes = await fetch(`${base}/api/me`, { headers: { cookie } });
  assert.equal((await meRes.json()).me.handle, 'loginuser');

  const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: J(cookie) });
  assert.equal((await out.json()).ok, true);
  const after = await fetch(`${base}/api/me`, { headers: { cookie } });
  assert.equal((await after.json()).me, null);
});

test('登录限流：同一 IP+handle 每分钟 5 次，第 6 次 429', async () => {
  await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'R', handle: 'ratetest', password: 'password123' }) });
  let got429 = false;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: J(), body: JSON.stringify({ handle: 'ratetest', password: 'definitelywrong' }) });
    if (i < 5) assert.equal(res.status, 401);
    else got429 = res.status === 429;
  }
  assert.ok(got429, '第 6 次应被限流为 429');
});

test('CSRF 守卫：表单 content-type 被拒（415）', async () => {
  const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: J(), body: JSON.stringify({ name: 'C', handle: 'csrfuser', password: 'password123' }) });
  const cookie = cookieOf(signup);
  const res = await fetch(`${base}/api/skills/s1/like`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: 'rating=5' });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error, 'bad_content_type');
});

test('演示登录（默认开启）：POST 以 seed handle 登录', async () => {
  const res = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: J(), body: JSON.stringify({ as: 'momo' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).me.handle, 'momo');
  // GET variant 302s to a same-origin next
  const g = await fetch(`${base}/api/auth/demo?as=momo&next=/browse`, { redirect: 'manual' });
  assert.equal(g.status, 302);
  assert.equal(g.headers.get('location'), '/browse');
  // open-redirect protection: external next falls back to /
  const g2 = await fetch(`${base}/api/auth/demo?as=momo&next=https://evil.example`, { redirect: 'manual' });
  assert.equal(g2.headers.get('location'), '/');
});

test('未登录访问受保护接口 → 401 login_required', async () => {
  const res = await fetch(`${base}/api/me/dashboard`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'login_required');
});

test('DEMO_MODE=0 时演示登录关闭 → 404', async () => {
  const d2 = tempData();
  const srv = createServer({ dataDir: d2, stateFile: join(d2, 'state.json'), dbFile: null, port: 0, baseUrl: null, env: { ...process.env, DEMO_MODE: '0' } });
  await new Promise((r) => srv.listen(0, r));
  const b2 = `http://localhost:${srv.address().port}`;
  try {
    const res = await fetch(`${b2}/api/auth/demo`, { method: 'POST', headers: J(), body: JSON.stringify({ as: 'momo' }) });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'demo_disabled');
  } finally {
    srv.close();
    try { rmSync(dirname(d2), { recursive: true, force: true }); } catch {}
  }
});
