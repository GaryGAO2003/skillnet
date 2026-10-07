import test from 'node:test';
import { search as rawSearch } from '../src/search.js';

test('英文同义词按整词匹配：ui 不命中 guide/build，script 不命中 description', () => {
  const docs = [
    { id: 'a', name: 'Build guide', desc: 'A quick guide to build things', descOriginal: 'Long description of a javascript build', cat: '文案口播', installs: 9999, safety: { level: 'pass' } },
    { id: 'b', name: 'Figma UI review', desc: '设计稿评审', cat: 'UI/UX', installs: 1, safety: { level: 'pass' } },
  ];
  assert.deepEqual(rawSearch(docs, '界面').map((h) => h.record.id), ['b']);
  assert.deepEqual(rawSearch(docs, '分镜').map((h) => h.record.id), []);
  const plural = [{ id: 'c', name: 'Prompts pack', desc: 'midjourney prompts', cat: '插画美术', installs: 1, safety: { level: 'pass' } }];
  assert.deepEqual(rawSearch(plural, '提示词').map((h) => h.record.id), ['c']);
});
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCatalog } from '../src/catalog.js';
import { extractConcepts } from '../src/search.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const baseUrl = 'http://localhost:8787';
const mk = () => loadCatalog({ dataDir, stateFile: null, baseUrl });
const ids = (r) => r.map((x) => x.record.id);

test('小红书封面 → 封面技能排第一', () => {
  const r = mk().search('小红书封面', { limit: 5 });
  assert.ok(r.length > 0);
  assert.equal(r[0].record.id, 's1');
});

test('帮我找个做小红书封面的skill → 封面技能排第一（停用词被剥离）', () => {
  const r = mk().search('帮我找个做小红书封面的skill', { limit: 5 });
  assert.equal(r[0].record.id, 's1');
  assert.ok(r[0].matched.includes('小红书'));
  assert.ok(r[0].matched.includes('封面'));
});

test('首图（同义词）也能找到封面技能', () => {
  const r = mk().search('首图', { limit: 5 });
  assert.equal(r[0].record.id, 's1');
});

test('剪映字幕 → 字幕技能排第一', () => {
  const r = mk().search('剪映字幕', { limit: 5 });
  assert.equal(r[0].record.id, 's2');
});

test('水彩插画配色 → 配色技能排第一', () => {
  const r = mk().search('水彩插画配色', { limit: 5 });
  assert.equal(r[0].record.id, 's3');
});

test('分类硬过滤', () => {
  const r = mk().search('', { category: '小红书', limit: 20 });
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => x.record.cat === '小红书'));
});

test('被 block 的技能永不返回', () => {
  const r = mk().search('小红书封面下载', { limit: 20 });
  assert.ok(!ids(r).includes('gh-33334444'));
  assert.ok(ids(r).includes('s1'));
});

test('无关查询（区块链 智能合约）返回空', () => {
  const r = mk().search('区块链 智能合约', { limit: 5 });
  assert.equal(r.length, 0);
});

test('相关性优先：封面技能压过更火但只部分命中的文案技能', () => {
  const r = mk().search('小红书封面', { limit: 5 });
  const order = ids(r);
  assert.equal(order[0], 's1');
  const i1 = order.indexOf('s1');
  const i5 = order.indexOf('s5'); // 小红书爆款文案, installs 99999, 只命中「小红书」
  if (i5 !== -1) assert.ok(i1 < i5, '封面技能必须排在更火的部分命中技能之前');
});

test('空查询返回最热门', () => {
  const r = mk().search('', { limit: 3 });
  assert.equal(r[0].record.id, 's5'); // installs 99999 最高
});

test('每个结果带 score 和 matched', () => {
  const r = mk().search('小红书封面', { limit: 3 });
  assert.ok(typeof r[0].summary.score === 'number');
  assert.ok(Array.isArray(r[0].summary.matched));
});

test('概念抽取：greedy longest-match 不会把 edit 匹进 editor', () => {
  const c = extractConcepts('editor');
  assert.ok(c.every((x) => x.term !== 'edit'));
});
