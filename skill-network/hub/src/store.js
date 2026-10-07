// store.js — install counts + daily aggregates with atomic JSON persistence.
//
// State shape (v2):
//   {
//     version: 2,
//     installs: { [id]: n },                 // real installs (excludes seed)
//     daily:    { [id]: { 'YYYY-MM-DD': n } },
//     byClient: { [id]: { [client]: n } },
//     byRef:    { [id]: { [ref]: n } },
//     log: [{ id, client, ref, ts }],        // capped at 1000
//     demo: { installs, daily, byClient, byRef }   // same shape, cleared on demo re-seed
//   }
//
// v1 state ({ installs, log }) is migrated transparently: daily/byClient/byRef are
// rebuilt from the (capped) log so some history survives the upgrade.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG_CAP = 1000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyBucket() {
  return { installs: {}, daily: {}, byClient: {}, byRef: {} };
}

function emptyState() {
  return { version: 2, ...emptyBucket(), log: [], demo: emptyBucket() };
}

function bump(obj, key, by = 1) {
  if (key == null || key === '') return;
  obj[key] = (Number(obj[key]) || 0) + by;
}
function bump2(obj, k1, k2, by = 1) {
  if (k1 == null || k2 == null || k2 === '') return;
  if (!obj[k1]) obj[k1] = {};
  obj[k1][k2] = (Number(obj[k1][k2]) || 0) + by;
}

function normBucket(b) {
  const e = emptyBucket();
  if (!b || typeof b !== 'object') return e;
  for (const k of ['installs', 'daily', 'byClient', 'byRef']) {
    if (b[k] && typeof b[k] === 'object') e[k] = b[k];
  }
  return e;
}

export function createStore(stateFile) {
  let state = emptyState();

  if (stateFile && existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
      state = {
        version: 2,
        installs: parsed && typeof parsed.installs === 'object' && parsed.installs ? parsed.installs : {},
        daily: parsed && typeof parsed.daily === 'object' && parsed.daily ? parsed.daily : {},
        byClient: parsed && typeof parsed.byClient === 'object' && parsed.byClient ? parsed.byClient : {},
        byRef: parsed && typeof parsed.byRef === 'object' && parsed.byRef ? parsed.byRef : {},
        log: Array.isArray(parsed && parsed.log) ? parsed.log : [],
        demo: normBucket(parsed && parsed.demo),
      };
      // Migrate v1 (no daily aggregates): rebuild from the log.
      if (!parsed.daily && Array.isArray(parsed.log)) {
        for (const e of parsed.log) {
          const date = (e.ts || '').slice(0, 10) || today();
          bump2(state.daily, e.id, date);
          bump2(state.byClient, e.id, e.client || 'other');
          if (e.ref) bump2(state.byRef, e.id, e.ref);
        }
      }
    } catch (err) {
      console.warn(`[store] 无法解析 ${stateFile}，从空状态开始：${err.message}`);
      state = emptyState();
    }
  }

  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!stateFile) return;
    try {
      const dir = dirname(stateFile);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      renameSync(tmp, stateFile);
    } catch (err) {
      console.warn(`[store] 写入 ${stateFile} 失败：${err.message}`);
    }
  }
  // Install counts are written synchronously (a reload must see the latest count,
  // and the payload is tiny). Exit handlers remain as a safety net.
  function persist() { flush(); }
  if (stateFile) {
    process.once('exit', flush);
    process.once('SIGINT', () => { flush(); process.exit(0); });
    process.once('SIGTERM', () => { flush(); process.exit(0); });
  }

  const merged = (id, field) => {
    const a = state[field][id] || {};
    const b = state.demo[field][id] || {};
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = (Number(out[k]) || 0) + Number(v || 0);
    return out;
  };

  return {
    getInstalls(id) {
      return (Number(state.installs[id]) || 0) + (Number(state.demo.installs[id]) || 0);
    },
    recordInstall(id, client, ref) {
      const date = today();
      bump(state.installs, id);
      bump2(state.daily, id, date);
      bump2(state.byClient, id, client || 'other');
      if (ref) bump2(state.byRef, id, ref);
      state.log.push({ id, client: client || 'other', ref: ref || null, ts: new Date().toISOString() });
      if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP);
      persist();
      return this.getInstalls(id);
    },
    // Daily install series (real + demo) for a skill: { 'YYYY-MM-DD': n }.
    dailySeries(id) { return merged(id, 'daily'); },
    clientBreakdown(id) { return merged(id, 'byClient'); },
    refBreakdown(id) { return merged(id, 'byRef'); },
    // Sum of installs on/after `sinceDate` (inclusive, 'YYYY-MM-DD').
    installsSince(id, sinceDate) {
      const d = merged(id, 'daily');
      let n = 0;
      for (const [date, c] of Object.entries(d)) if (date >= sinceDate) n += Number(c) || 0;
      return n;
    },
    hasDemo(id) {
      return Object.keys(state.demo.daily[id] || {}).length > 0
        || (Number(state.demo.installs[id]) || 0) > 0;
    },
    // --- demo seeding (idempotent): clear then re-add ---
    clearDemo() {
      state.demo = emptyBucket();
      persist();
    },
    recordDemoInstall(id, { date, client = 'other', ref = null, n = 1 }) {
      bump(state.demo.installs, id, n);
      bump2(state.demo.daily, id, date || today(), n);
      bump2(state.demo.byClient, id, client, n);
      if (ref) bump2(state.demo.byRef, id, ref, n);
      persist();
    },
    flush,
    getState() { return state; },
  };
}
