import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/server.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'data');
const stateFile = join(tmpdir(), `skillnet-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

let server; let base;

test.before(async () => {
  server = createServer({ dataDir, stateFile, port: 0, baseUrl: null });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => { server.close(); try { rmSync(stateFile, { force: true }); } catch {} });

async function withClient(fn) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  try { return await fn(client); } finally { await client.close(); }
}

test('listTools 返回 3 个工具', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_skill', 'install_skill', 'search_skills']);
  });
});

test('search_skills 文本含封面技能', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'search_skills', arguments: { query: '小红书封面' } });
    const txt = res.content.map((c) => c.text).join('\n');
    assert.ok(txt.includes('小红书封面标题'));
    assert.ok(res.structuredContent && res.structuredContent.results[0].id === 's1');
  });
});

test('install_skill 返回目标目录与文件内容', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'install_skill', arguments: { id: 's1', client: 'claude-code' } });
    const txt = res.content.map((c) => c.text).join('\n');
    assert.ok(txt.includes('~/.claude/skills/xhs-cover'));
    assert.ok(txt.includes('--- SKILL.md ---'));
    assert.ok(txt.includes('小红书封面标题')); // SKILL.md 内容
  });
});

test('install_skill 对 block 技能返回错误结果', async () => {
  await withClient(async (client) => {
    const res = await client.callTool({ name: 'install_skill', arguments: { id: 'gh-33334444' } });
    assert.equal(res.isError, true);
    const txt = res.content.map((c) => c.text).join('\n');
    assert.ok(txt.includes('安全'));
  });
});

test('GET /mcp → 405 JSON-RPC', async () => {
  const res = await fetch(`${base}/mcp`);
  assert.equal(res.status, 405);
  const j = await res.json();
  assert.equal(j.error.code, -32000);
});
