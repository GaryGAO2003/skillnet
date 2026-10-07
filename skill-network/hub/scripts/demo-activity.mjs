#!/usr/bin/env node
// demo-activity.mjs — seed synthetic installs + tips so a fresh dashboard has
// something to show. Everything written here is marked as demo data (installs in
// the store's demo namespace, tips with demo:true) so the dashboard can label it
// "含演示数据". Idempotent: re-running clears prior demo data first, so it
// replaces rather than accumulates.
//
//   npm run demo:activity

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDb } from '../src/db.js';
import { loadCatalog } from '../src/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(ROOT, 'data');
const stateFile = process.env.STATE_FILE || join(dataDir, 'state.json');
const dbFile = process.env.DB_FILE || join(dataDir, 'db.json');

const round2 = (x) => Math.round(x * 100) / 100;

// Deterministic PRNG so repeated runs reproduce the same demo data.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261007);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const dateNDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const REFS = ['BV1x7', '笔记·封面点击率提升3倍', 'BV1Gh4y1x', '小红书·水彩配色', 'douyin·3分钟写歌',
  '视频·我的Vlog策划', 'BV1qk4y1z', '笔记·胶片感修图', '抖音·黄金3秒', 'xhs·租房改造'];
const CLIENTS = ['claude-code', 'claude-code', 'codex', 'cursor', 'claude-app', 'other'];
const TIPPERS = ['小鹿拍拍', '阿May', '弹唱少女', '夜猫子剪辑', '想变强的插画生', '咖啡续命', '周末爬山队',
  '一只柴犬', '野生产品经理', '练习生小K', '爱做饭的工程师', '追光的人'];
const TIP_AMOUNTS = [6, 6, 6, 18, 18, 18, 18, 50, 50, 9, 12, 30];

function main() {
  const db = loadDb({ dbFile, dataDir });
  const catalog = loadCatalog({ dataDir, stateFile, baseUrl: '', db });
  const store = catalog.store;

  // Only platform (seed) skills belonging to seed creators get demo activity.
  const seedSkills = catalog.all().filter((r) => r.source === 'skillnet' && !r.uploaded && r.safety.level !== 'block');
  if (seedSkills.length === 0) { console.error('没有找到平台技能，先确认 data/skills.json 存在。'); process.exit(1); }

  // --- idempotency: wipe previous demo data ---
  store.clearDemo();
  db.clearDemoTips();

  // --- synthetic installs over the last 30 days ---
  let totalInstalls = 0;
  for (const r of seedSkills) {
    const base = Math.max(1, Math.round(Math.sqrt(r.seedInstalls || 100) / 9)); // ~1-10/day
    for (let d = 29; d >= 0; d--) {
      const date = dateNDaysAgo(d);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.35 : 1;
      const noise = 0.5 + rnd(); // 0.5 - 1.5
      const n = Math.round(base * weekend * noise);
      if (n <= 0) continue;
      // split the day into 1-3 (client, ref) chunks
      const chunks = 1 + Math.floor(rnd() * 3);
      let left = n;
      for (let c = 0; c < chunks; c++) {
        const part = c === chunks - 1 ? left : Math.max(1, Math.round(left / (chunks - c)));
        left -= part;
        if (part <= 0) continue;
        store.recordDemoInstall(r.id, { date, client: pick(CLIENTS), ref: pick(REFS), n: part });
        totalInstalls += part;
        if (left <= 0) break;
      }
    }
  }

  // --- ~40 demo tips to tippable seed skills ---
  const tippable = seedSkills.filter((r) => catalog.tippable(r));
  const TIP_COUNT = 40;
  let tipNet = 0;
  for (let i = 0; i < TIP_COUNT; i++) {
    const r = pick(tippable);
    const amount = pick(TIP_AMOUNTS);
    const fee = round2(amount * 0.1);
    const net = round2(amount - fee);
    const ts = new Date(Date.now() - Math.floor(rnd() * 30) * 86400000 - Math.floor(rnd() * 86400000)).toISOString();
    db.addTip({ skillId: r.id, fromUserId: null, fromName: pick(TIPPERS), amount, fee, net, method: 'demo', demo: true, ts });
    tipNet += net;
  }

  store.flush();
  db.flush();
  console.log(`演示数据已写入（含演示数据会在作者面板标注）：`);
  console.log(`  安装：${totalInstalls} 次，覆盖 ${seedSkills.length} 个平台技能，近 30 天`);
  console.log(`  打赏：${TIP_COUNT} 笔（demo），净收入合计约 ¥${round2(tipNet)}`);
  console.log(`  state: ${stateFile}`);
  console.log(`  db:    ${dbFile}`);
}

main();
