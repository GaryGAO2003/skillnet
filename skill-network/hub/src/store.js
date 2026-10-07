// store.js — install counts + install log with atomic JSON persistence.
// State shape: { installs: { [id]: n }, log: [{ id, client, ref, ts }] } (log capped at 1000).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const LOG_CAP = 1000;

function emptyState() {
  return { installs: {}, log: [] };
}

export function createStore(stateFile) {
  let state = emptyState();

  if (stateFile && existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
      state = {
        installs: parsed && typeof parsed.installs === 'object' && parsed.installs ? parsed.installs : {},
        log: Array.isArray(parsed && parsed.log) ? parsed.log : [],
      };
    } catch (err) {
      console.warn(`[store] 无法解析 ${stateFile}，从空状态开始：${err.message}`);
      state = emptyState();
    }
  }

  function persist() {
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

  return {
    getInstalls(id) {
      return Number(state.installs[id]) || 0;
    },
    recordInstall(id, client, ref) {
      state.installs[id] = (Number(state.installs[id]) || 0) + 1;
      state.log.push({ id, client: client || 'other', ref: ref || null, ts: new Date().toISOString() });
      if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP);
      persist();
      return state.installs[id];
    },
    getState() {
      return state;
    },
  };
}
