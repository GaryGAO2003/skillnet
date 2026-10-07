// server.js — node:http routes + stateless MCP at /mcp.
// createServer() returns an http.Server (not listening) for tests; running the
// file directly starts it.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadCatalog, HttpError } from './catalog.js';
import { createMcpServer } from './mcp.js';
import { renderIndex, renderSkillPage, renderSkillMarkdown, renderLlmsTxt } from './pages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const BODY_LIMIT = 1024 * 1024; // 1 MB

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(text);
}

function sendHtml(res, status, html) {
  sendText(res, status, html, 'text/html; charset=utf-8');
}

// On Chinese Windows (code page 936), curl percent-encodes non-ASCII command-line
// args as GBK, not UTF-8 — and that is exactly how agents call this API from Git
// Bash. URLSearchParams would silently turn those bytes into U+FFFD, so decode
// each param as UTF-8 when it is valid and fall back to GBK otherwise.
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const GBK = new TextDecoder('gbk');

function decodeComponent(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '+') bytes.push(0x20);
    else if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(ch, 'utf8'));
  }
  const buf = Uint8Array.from(bytes);
  try { return UTF8_STRICT.decode(buf); } catch { return GBK.decode(buf); }
}

function queryParam(url, name) {
  for (const pair of url.search.slice(1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (decodeComponent(eq === -1 ? pair : pair.slice(0, eq)) !== name) continue;
    return eq === -1 ? '' : decodeComponent(pair.slice(eq + 1));
  }
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'too_large', '请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function mcpError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

export function createServer(opts = {}) {
  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8787;
  const baseUrl = (opts.baseUrl || process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const dataDir = opts.dataDir || join(__dirname, '..', 'data');
  const stateFile = opts.stateFile || process.env.STATE_FILE || join(dataDir, 'state.json');

  const catalog = loadCatalog({ dataDir, stateFile, baseUrl });

  async function handleMcp(req, res) {
    if (req.method === 'GET' || req.method === 'DELETE') return mcpError(res, 405, 'Method not allowed.');
    if (req.method !== 'POST') return mcpError(res, 405, 'Method not allowed.');

    let parsed;
    try {
      const raw = await readBody(req, BODY_LIMIT);
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      return mcpError(res, err.status === 413 ? 413 : 400, err.status === 413 ? '请求体过大' : 'Parse error.');
    }

    // Stateless: fresh server + transport per request, closed on response end.
    const mcp = createMcpServer(catalog, { baseUrl, version: PKG.version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (err) {
      if (!res.headersSent) mcpError(res, 500, 'Internal server error.');
    }
  }

  const server = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let url;
    try { url = new URL(req.url, baseUrl); } catch { return sendJson(res, 400, { error: 'bad_request', message: '无法解析 URL' }); }
    const path = url.pathname;
    const method = req.method;

    try {
      if (path === '/mcp') return await handleMcp(req, res);

      if (method === 'GET' && path === '/healthz') {
        const c = catalog.counts();
        return sendJson(res, 200, { ok: true, skills: c.total, bySource: { skillnet: c.skillnet, github: c.github } });
      }

      if (method === 'GET' && path === '/llms.txt') {
        return sendText(res, 200, renderLlmsTxt({ baseUrl, counts: catalog.counts() }), 'text/markdown; charset=utf-8');
      }

      if (method === 'GET' && path === '/api/categories') {
        return sendJson(res, 200, catalog.categories());
      }

      if (method === 'GET' && path === '/api/skills/search') {
        const q = queryParam(url, 'q') || '';
        // A query lost in transcoding ("?????" from non-GBK Windows code pages,
        // or U+FFFD) would silently fall back to "most popular" — say so instead.
        if (q.includes('�') || /^[\s?]{2,}$/.test(q)) {
          return sendJson(res, 400, { error: 'garbled_query', message: '搜索词在传输中变成了乱码。请把中文按 UTF-8 做 URL 编码，例如：printf \'%s\' 关键词 | curl --get --data-urlencode "q@-" <地址>' });
        }
        const cat = queryParam(url, 'cat') || null;
        let limit = parseInt(url.searchParams.get('limit') || '5', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 5;
        if (limit > 20) limit = 20;
        const hits = catalog.search(q, { category: cat, limit });
        return sendJson(res, 200, { query: q, total: hits.length, results: hits.map((h) => h.summary) });
      }

      let m;
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/install$/)) && (method === 'GET' || method === 'POST')) {
        if (method === 'POST') { try { await readBody(req, BODY_LIMIT); } catch { /* body optional */ } }
        const id = decodeURIComponent(m[1]);
        const client = queryParam(url, 'client') || 'other';
        const ref = queryParam(url, 'ref') || null;
        const bundle = catalog.install(id, { client, ref });
        return sendJson(res, 200, bundle);
      }

      if ((m = path.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/)) && method === 'GET') {
        const id = decodeURIComponent(m[1]);
        const rel = decodeURIComponent(m[2]);
        const out = catalog.fileContent(id, rel);
        if (out.redirect) { res.writeHead(302, { Location: out.redirect }); res.end(); return; }
        return sendText(res, 200, out.content, 'text/plain; charset=utf-8');
      }

      if ((m = path.match(/^\/api\/skills\/([^/]+)\/download\.zip$/)) && method === 'GET') {
        const id = decodeURIComponent(m[1]);
        const { slug, files } = catalog.zipFiles(id);
        const entries = {};
        for (const f of files) entries[`${slug}/${f.path}`] = strToU8(f.content);
        const zipped = zipSync(entries, { level: 6 });
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${slug}.zip"`,
        });
        return res.end(Buffer.from(zipped));
      }

      if ((m = path.match(/^\/api\/skills\/([^/]+)$/)) && method === 'GET') {
        const id = decodeURIComponent(m[1]);
        const r = catalog.get(id);
        if (!r) return sendJson(res, 404, { error: 'not_found', message: '技能不存在' });
        return sendJson(res, 200, catalog.detail(r));
      }

      if ((m = path.match(/^\/s\/(.+)\.md$/)) && method === 'GET') {
        const id = decodeURIComponent(m[1]);
        const r = catalog.get(id);
        if (!r) return sendText(res, 404, '# 404\n技能不存在\n', 'text/markdown; charset=utf-8');
        return sendText(res, 200, renderSkillMarkdown(catalog.detail(r)), 'text/markdown; charset=utf-8');
      }

      if ((m = path.match(/^\/s\/([^/]+)$/)) && method === 'GET') {
        const id = decodeURIComponent(m[1]);
        const r = catalog.get(id);
        if (!r) return sendHtml(res, 404, '<!doctype html><meta charset=utf-8><h1>404</h1><p>技能不存在</p>');
        return sendHtml(res, 200, renderSkillPage(catalog.detail(r)));
      }

      if (path === '/' && method === 'GET') {
        const q = queryParam(url, 'q') || '';
        const cat = queryParam(url, 'cat') || '';
        const hits = catalog.search(q, { category: cat || null, limit: q || cat ? 20 : 12 });
        return sendHtml(res, 200, renderIndex({ q, cat, categories: catalog.categories(), results: hits.map((h) => h.summary) }));
      }

      return sendJson(res, 404, { error: 'not_found', message: '未找到该路径' });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message, ...(err.extra || {}) });
      console.error('[server] 未处理错误：', err);
      if (!res.headersSent) return sendJson(res, 500, { error: 'internal', message: '服务器内部错误' });
    }
  });

  server.catalog = catalog;
  server.baseUrl = baseUrl;
  return server;
}

// Start when run directly.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = createServer();
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, () => {
    const c = server.catalog.counts();
    console.log(`skillnet-hub listening on ${server.baseUrl} (${c.total} skills: ${c.skillnet} skillnet, ${c.github} github)`);
  });
}
