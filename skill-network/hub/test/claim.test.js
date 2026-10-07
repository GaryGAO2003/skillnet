import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, cpSync, mkdtempSync } from 'node:fs';
import { createServer } from '../src/server.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const root = mkdtempSync(join(tmpdir(), 'sn-claim-'));
const dataDir = join(root, 'data');
cpSync(fixtures, dataDir, { recursive: true });

// Injectable fetch: returns the default branch, and a SKILL.md whose contents we
// control per test.
let skillMdContent = 'nothing here';
function mockFetch(url) {
  const u = String(url);
  if (u.startsWith('https://api.github.com/repos/')) return Promise.resolve({ ok: true, json: async () => ({ default_branch: 'main' }) });
  if (u.startsWith('https://raw.githubusercontent.com/')) return Promise.resolve({ ok: true, text: async () => skillMdContent });
  return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
}

let server; let base; let ck;
const J = (cookie) => (cookie ? { 'content-type': 'application/json', cookie } : { 'content-type': 'application/json' });
const cookieOf = (res) => { const sc = res.headers.get('set-cookie'); return sc ? sc.split(';')[0] : null; };
const post = (p, b, c) => fetch(`${base}${p}`, { method: 'POST', headers: J(c), body: JSON.stringify(b || {}) });

test.before(async () => {
  server = createServer({ dataDir, stateFile: join(dataDir, 'state.json'), dbFile: null, port: 0, baseUrl: null, fetchImpl: mockFetch });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const s = await post('/api/auth/signup', { name: '认领者', handle: 'claimer', password: 'password123', role: 'creator' });
  ck = cookieOf(s);
});
test.after(() => { server.close(); try { rmSync(root, { recursive: true, force: true }); } catch {} });

test('认领码生成稳定，验证失败→400，命中后→claimed 且可打赏', async () => {
  const gen = await (await post('/api/skills/gh-11112222/claim', {}, ck)).json();
  assert.match(gen.code, /^skillnet-claim-[0-9a-f]{10}$/);
  assert.ok(gen.instructions.includes(gen.code));
  // stable per user+skill
  const gen2 = await (await post('/api/skills/gh-11112222/claim', {}, ck)).json();
  assert.equal(gen2.code, gen.code);

  // code not present yet → 400 claim_not_found
  skillMdContent = '# xhs helper\n没有认领码';
  const miss = await post('/api/skills/gh-11112222/claim/verify', {}, ck);
  assert.equal(miss.status, 400);
  assert.equal((await miss.json()).error, 'claim_not_found');

  // inject the code into the repo SKILL.md → verify succeeds
  skillMdContent = `# xhs helper\n<!-- ${gen.code} -->\n`;
  const ok = await post('/api/skills/gh-11112222/claim/verify', {}, ck);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.claimed, true);
  assert.equal(j.skill.creator.handle, 'claimer');
  assert.equal(j.skill.creator.claimed, true);
  assert.equal(j.skill.githubLogin, 'someone');

  // now tippable: a different viewer sees canTip true
  const vs = await post('/api/auth/signup', { name: '路人', handle: 'passerby', password: 'password123' });
  const vck = cookieOf(vs);
  const detail = await (await fetch(`${base}/api/skills/gh-11112222`, { headers: { cookie: vck } })).json();
  assert.equal(detail.canTip, true);
  const tip = await post('/api/skills/gh-11112222/tips', { amount: 18 }, vck);
  assert.equal(tip.status, 200);
  assert.equal((await tip.json()).creator.handle, 'claimer');
});
