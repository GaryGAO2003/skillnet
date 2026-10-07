import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadCatalog } from '../src/catalog.js';

// Optional: exercise the real data/ if the other agents have produced it.
const realDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const hasReal = existsSync(join(realDir, 'skills.json'));

test('加载真实 data/（存在时）', { skip: hasReal ? false : '没有真实 data/skills.json，跳过' }, () => {
  const c = loadCatalog({ dataDir: realDir, stateFile: null, baseUrl: 'http://localhost:8787' });
  const counts = c.counts();
  assert.ok(counts.total >= 0);
  // 每条记录都应有 id、cat 和安全结论
  for (const r of c.all()) {
    assert.ok(r.id && r.cat);
    assert.ok(['pass', 'review', 'block'].includes(r.safety.level));
  }
});
