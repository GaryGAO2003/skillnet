// server.js — node:http routes for the full creator hub + stateless MCP at /mcp.
// createServer() returns an http.Server (not listening) for tests; running the
// file directly starts it.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HttpError } from './catalog.js';
import { createApp } from './app.js';
import { createMcpServer } from './mcp.js';
import { renderIndex, renderSkillPage, renderSkillMarkdown, renderLlmsTxt, renderGetFinder } from './pages.js';
import { getBrand } from './brand.js';
import {
  SESSION_COOKIE, parseCookies, buildSessionCookie, clearSessionCookie, createRateLimiter, verifyPassword,
} from './auth.js';
import { qrSvg } from './qr.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BODY_LIMIT = 1024 * 1024;        // 1 MB
const UPLOAD_LIMIT = 4 * 1024 * 1024;  // 4 MB (upload bodies)

const MIME = {
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function publicCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(text);
}
function sendHtml(res, status, html) { sendText(res, status, html, 'text/html; charset=utf-8'); }

// GBK-tolerant query-param decoding (Chinese Windows curl sends GBK-encoded args).
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const GBK = new TextDecoder('gbk');
function decodeComponent(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '+') bytes.push(0x20);
    else if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 1, i + 3))) { bytes.push(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(ch, 'utf8'));
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
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'too_large', '请求体过大')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// CSRF guard: authenticated mutations (and the auth endpoints) must be JSON.
async function readJsonBody(req, limit = BODY_LIMIT) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) throw new HttpError(415, 'bad_content_type', '请求必须是 application/json');
  const raw = await readBody(req, limit);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'bad_json', '请求体不是合法的 JSON'); }
}

function mcpError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'local';
}

// Serve a file from publicDir with path-traversal protection.
function serveStatic(res, publicDir, relPath) {
  const target = normalize(join(publicDir, relPath));
  if (target !== publicDir && !target.startsWith(publicDir + sep)) {
    return sendJson(res, 400, { error: 'bad_path', message: '非法路径' });
  }
  if (!existsSync(target) || !statSync(target).isFile()) return sendJson(res, 404, { error: 'not_found', message: '文件不存在' });
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=300' });
  res.end(readFileSync(target));
}

export function createServer(opts = {}) {
  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8787;
  const baseUrl = (opts.baseUrl || process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const dataDir = opts.dataDir || join(ROOT, 'data');
  const stateFile = opts.stateFile || process.env.STATE_FILE || join(dataDir, 'state.json');
  // dbFile defaults to null (in-memory) so tests never write a db.json; the
  // production entry point (isMain, below) passes a real path.
  const dbFile = opts.dbFile !== undefined ? opts.dbFile : (process.env.DB_FILE || null);
  const env = opts.env || process.env;
  const brand = opts.brand || getBrand(env);
  const demoMode = (env.DEMO_MODE || '') !== '0';
  const secure = baseUrl.startsWith('https');
  const publicDir = join(ROOT, 'public');
  const finderPath = join(ROOT, 'skills', 'skill-finder', 'SKILL.md');

  const app = createApp({ dataDir, stateFile, dbFile, baseUrl, env, brand });
  const catalog = app.catalog;
  const db = app.db;

  const loginLimiter = createRateLimiter({ max: 5, windowMs: 60 * 1000 });
  const uploadLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

  function setSession(res, token) { res.setHeader('Set-Cookie', buildSessionCookie(token, { secure })); }
  function clearSession(res) { res.setHeader('Set-Cookie', clearSessionCookie({ secure })); }
  function me(user) { return { me: user ? db.publicUser(user) : null }; }
  function requireUser(user) { if (!user) throw new HttpError(401, 'login_required', '请先登录'); return user; }

  function renderFinder() {
    const tpl = existsSync(finderPath) ? readFileSync(finderPath, 'utf8') : '';
    return tpl.split('{{BRAND}}').join(brand.name).split('{{BASE_URL}}').join(baseUrl);
  }

  function appShell() {
    const indexPath = join(publicDir, 'index.html');
    if (!existsSync(indexPath)) return null;
    const html = readFileSync(indexPath, 'utf8');
    const cfg = { brand: brand.name, tagline: brand.tagline, base: baseUrl, demo: demoMode, categories: app.CATEGORIES };
    return html.replace('<!--SN_CONFIG-->', `<script>window.__SN__=${JSON.stringify(cfg)}</script>`);
  }

  async function handleMcp(req, res) {
    if (req.method !== 'POST') return mcpError(res, 405, 'Method not allowed.');
    let parsed;
    try { const raw = await readBody(req, BODY_LIMIT); parsed = raw ? JSON.parse(raw) : undefined; }
    catch (err) { return mcpError(res, err.status === 413 ? 413 : 400, err.status === 413 ? '请求体过大' : 'Parse error.'); }
    const mcp = createMcpServer(catalog, { baseUrl, version: PKG.version, brand });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); mcp.close(); });
    try { await mcp.connect(transport); await transport.handleRequest(req, res, parsed); }
    catch { if (!res.headersSent) mcpError(res, 500, 'Internal server error.'); }
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, baseUrl); } catch { return sendJson(res, 400, { error: 'bad_request', message: '无法解析 URL' }); }
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') { publicCors(res); res.writeHead(204); res.end(); return; }

    // Resolve the session once for the whole request.
    const token = parseCookies(req)[SESSION_COOKIE];
    const user = (token && db.resolveSession(token)) || null;
    let m;

    try {
      // ---- MCP ----
      if (path === '/mcp') { publicCors(res); return await handleMcp(req, res); }

      // ---- health / llms / static / app shell ----
      if (method === 'GET' && path === '/healthz') {
        publicCors(res);
        const c = catalog.counts();
        return sendJson(res, 200, { ok: true, skills: c.total, bySource: { skillnet: c.skillnet, github: c.github } });
      }
      if (method === 'GET' && path === '/llms.txt') {
        publicCors(res);
        return sendText(res, 200, renderLlmsTxt({ baseUrl, counts: catalog.counts(), brand }), 'text/markdown; charset=utf-8');
      }
      if (method === 'GET' && (path === '/app.js' || path === '/app.css')) return serveStatic(res, publicDir, path.slice(1));
      if (method === 'GET' && path.startsWith('/assets/')) return serveStatic(res, publicDir, path.slice(1));
      if (method === 'GET' && path === '/vendor/fflate.js') {
        const f = join(ROOT, 'node_modules', 'fflate', 'umd', 'index.js');
        if (!existsSync(f)) return sendJson(res, 404, { error: 'not_found', message: 'fflate 未安装' });
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        return res.end(readFileSync(f));
      }
      if (method === 'GET' && path === '/skill-finder/SKILL.md') return sendText(res, 200, renderFinder(), 'text/markdown; charset=utf-8');
      if (method === 'GET' && path === '/skill-finder.zip') {
        const entries = { 'skill-finder/SKILL.md': strToU8(renderFinder()) };
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="skill-finder.zip"' });
        return res.end(Buffer.from(zipSync(entries, { level: 6 })));
      }
      if (method === 'GET' && path === '/get-finder') return sendHtml(res, 200, renderGetFinder({ brand, baseUrl }));

      // ---- app shell (SPA) at / ----
      if (method === 'GET' && path === '/') {
        const shell = appShell();
        if (shell) return sendHtml(res, 200, shell);
        const q = queryParam(url, 'q') || ''; const cat = queryParam(url, 'cat') || '';
        const hits = catalog.search(q, { category: cat || null, limit: q || cat ? 20 : 12, user });
        return sendHtml(res, 200, renderIndex({ q, cat, categories: catalog.categories(), results: hits.map((h) => h.summary), brand }));
      }
      if (method === 'GET' && path === '/browse') {
        const q = queryParam(url, 'q') || ''; const cat = queryParam(url, 'cat') || '';
        const hits = catalog.search(q, { category: cat || null, limit: q || cat ? 20 : 12, user });
        return sendHtml(res, 200, renderIndex({ q, cat, categories: catalog.categories(), results: hits.map((h) => h.summary), brand }));
      }

      // ---- browse API ----
      if (method === 'GET' && path === '/api/categories') { publicCors(res); return sendJson(res, 200, catalog.categories()); }
      if (method === 'GET' && path === '/api/home') { publicCors(res); return sendJson(res, 200, app.home(user)); }
      if (method === 'GET' && path === '/api/rank') {
        publicCors(res);
        const type = queryParam(url, 'type') || 'hot';
        const cat = queryParam(url, 'cat') || null;
        let limit = parseInt(url.searchParams.get('limit') || '20', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 20;
        return sendJson(res, 200, app.rank({ type, cat, limit, viewer: user }));
      }

      if (method === 'GET' && path === '/api/skills/search') {
        publicCors(res);
        const q = queryParam(url, 'q') || '';
        if (q.includes('�') || /^[\s?]{2,}$/.test(q)) {
          return sendJson(res, 400, { error: 'garbled_query', message: '搜索词在传输中变成了乱码。请把中文按 UTF-8 做 URL 编码，例如：printf \'%s\' 关键词 | curl --get --data-urlencode "q@-" <地址>' });
        }
        const cat = queryParam(url, 'cat') || null;
        let limit = parseInt(url.searchParams.get('limit') || '5', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 5;
        if (limit > 20) limit = 20;
        const hits = catalog.search(q, { category: cat, limit, user });
        return sendJson(res, 200, { query: q, total: hits.length, results: hits.map((h) => h.summary) });
      }

      // ---- auth ----
      if (method === 'POST' && path === '/api/auth/signup') {
        const b = await readJsonBody(req);
        const handle = String(b.handle || '');
        if (!/^[a-z0-9_]{3,20}$/.test(handle)) return sendJson(res, 400, { error: 'bad_handle', message: '用户名只能用小写字母、数字和下划线，3-20 位' });
        if (!b.name || String(b.name).trim().length < 1) return sendJson(res, 400, { error: 'bad_name', message: '请填写昵称' });
        if (!b.password || String(b.password).length < 8) return sendJson(res, 400, { error: 'bad_password', message: '密码至少 8 位' });
        const role = b.role === 'creator' ? 'creator' : 'user';
        if (db.handleTaken(handle)) return sendJson(res, 409, { error: 'handle_taken', message: '这个用户名已经被占用了' });
        const u = db.createUser({ handle, name: String(b.name), role, platform: b.platform ? String(b.platform) : '', bio: b.bio ? String(b.bio) : '', password: String(b.password) });
        setSession(res, db.createSession(u.id));
        return sendJson(res, 201, me(u));
      }
      if (method === 'POST' && path === '/api/auth/login') {
        const b = await readJsonBody(req);
        const handle = String(b.handle || '');
        if (!loginLimiter.check(`${clientIp(req)}:${handle.toLowerCase()}`)) return sendJson(res, 429, { error: 'rate_limited', message: '尝试过于频繁，请稍后再试' });
        const u = db.getUserByHandle(handle);
        if (!u || !verifyPassword(String(b.password || ''), u.salt, u.hash)) return sendJson(res, 401, { error: 'bad_credentials', message: '用户名或密码不对' });
        setSession(res, db.createSession(u.id));
        return sendJson(res, 200, me(u));
      }
      if (method === 'POST' && path === '/api/auth/logout') {
        await readJsonBody(req);
        if (token) db.deleteSession(token);
        clearSession(res);
        return sendJson(res, 200, { ok: true });
      }
      if (method === 'GET' && path === '/api/me') return sendJson(res, 200, me(user));
      if (path === '/api/auth/demo') {
        if (!demoMode) return sendJson(res, 404, { error: 'demo_disabled', message: '演示登录未开启' });
        if (method === 'POST') {
          const b = await readJsonBody(req);
          const u = db.getUserByHandle(String(b.as || ''));
          if (!u || !u.seed) return sendJson(res, 400, { error: 'bad_demo_account', message: '不是可用的演示账号' });
          setSession(res, db.createSession(u.id));
          return sendJson(res, 200, me(u));
        }
        if (method === 'GET') {
          const u = db.getUserByHandle(queryParam(url, 'as') || '');
          if (!u || !u.seed) return sendJson(res, 400, { error: 'bad_demo_account', message: '不是可用的演示账号' });
          setSession(res, db.createSession(u.id));
          let next = queryParam(url, 'next') || '/';
          if (!/^\/(?!\/)/.test(next)) next = '/';
          res.writeHead(302, { Location: next });
          return res.end();
        }
      }

      // ---- skills: specific sub-paths (order before /api/skills/:id) ----
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/install$/)) && (method === 'GET' || method === 'POST')) {
        publicCors(res);
        if (method === 'POST') { try { await readBody(req, BODY_LIMIT); } catch { /* body optional */ } }
        const id = decodeURIComponent(m[1]);
        const client = queryParam(url, 'client') || 'other';
        const ref = queryParam(url, 'ref') || null;
        return sendJson(res, 200, catalog.install(id, { client, ref }));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/)) && method === 'GET') {
        publicCors(res);
        const out = catalog.fileContent(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
        if (out.redirect) { res.writeHead(302, { Location: out.redirect }); res.end(); return; }
        return sendText(res, 200, out.content, 'text/plain; charset=utf-8');
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/download\.zip$/)) && method === 'GET') {
        publicCors(res);
        const { slug, files } = catalog.zipFiles(decodeURIComponent(m[1]));
        const entries = {};
        for (const f of files) entries[`${slug}/${f.path}`] = strToU8(f.content);
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${slug}.zip"` });
        return res.end(Buffer.from(zipSync(entries, { level: 6 })));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/qr\.svg$/)) && method === 'GET') {
        publicCors(res);
        const r = catalog.get(decodeURIComponent(m[1]));
        if (!r) return sendJson(res, 404, { error: 'not_found', message: '技能不存在' });
        const ref = queryParam(url, 'ref');
        const target = `${baseUrl}/s/${r.id}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        return res.end(qrSvg(target));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/like$/)) && method === 'POST') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.toggleLike(user, decodeURIComponent(m[1])));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/reviews$/)) && method === 'POST') {
        const b = await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.addReview(user, decodeURIComponent(m[1]), b.rating, b.text));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/tips$/)) && method === 'POST') {
        const b = await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, await app.tip(user, decodeURIComponent(m[1]), b.amount));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/versions$/)) && method === 'POST') {
        const b = await readJsonBody(req, UPLOAD_LIMIT); requireUser(user);
        if (!uploadLimiter.check(user.id)) return sendJson(res, 429, { error: 'rate_limited', message: '上传过于频繁，请稍后再试' });
        return sendJson(res, 200, app.addVersion(user, decodeURIComponent(m[1]), b.files, b.note));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/claim\/verify$/)) && method === 'POST') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, await app.claimVerify(user, decodeURIComponent(m[1]), { fetchImpl: opts.fetchImpl || fetch }));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)\/claim$/)) && method === 'POST') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.claimGenerate(user, decodeURIComponent(m[1])));
      }
      if (path === '/api/skills' && method === 'POST') {
        const b = await readJsonBody(req, UPLOAD_LIMIT); requireUser(user);
        if (!uploadLimiter.check(user.id)) return sendJson(res, 429, { error: 'rate_limited', message: '上传过于频繁，请稍后再试' });
        return sendJson(res, 201, { skill: app.upload(user, b.meta, b.files) });
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)$/)) && method === 'PATCH') {
        const b = await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.patchSkill(user, decodeURIComponent(m[1]), b));
      }
      if ((m = path.match(/^\/api\/skills\/([^/]+)$/)) && method === 'GET') {
        publicCors(res);
        const r = catalog.get(decodeURIComponent(m[1]));
        if (!r) return sendJson(res, 404, { error: 'not_found', message: '技能不存在' });
        return sendJson(res, 200, catalog.detail(r, { user }));
      }

      // ---- creators ----
      if (method === 'GET' && path === '/api/creators') {
        publicCors(res);
        let limit = parseInt(url.searchParams.get('limit') || '12', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 12;
        return sendJson(res, 200, { items: app.creatorsList(limit) });
      }
      if ((m = path.match(/^\/api\/creators\/([^/]+)\/follow$/)) && method === 'POST') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.toggleFollow(user, decodeURIComponent(m[1])));
      }
      if ((m = path.match(/^\/api\/creators\/([^/]+)\/qr\.svg$/)) && method === 'GET') {
        publicCors(res);
        const handle = decodeURIComponent(m[1]);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        return res.end(qrSvg(`${baseUrl}/#/creator/${handle}`));
      }
      if ((m = path.match(/^\/api\/creators\/([^/]+)$/)) && method === 'GET') {
        publicCors(res);
        return sendJson(res, 200, app.creatorByHandle(decodeURIComponent(m[1]), user));
      }

      // ---- me / library / notifications ----
      if (method === 'GET' && path === '/api/me/skills') { requireUser(user); return sendJson(res, 200, app.mySkills(user)); }
      if (method === 'GET' && path === '/api/me/dashboard') { requireUser(user); return sendJson(res, 200, app.dashboard(user)); }
      if (method === 'GET' && path === '/api/me/library') { requireUser(user); return sendJson(res, 200, app.library(user)); }
      if ((m = path.match(/^\/api\/me\/library\/([^/]+)$/)) && method === 'POST') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.addLibrary(user, decodeURIComponent(m[1])));
      }
      if ((m = path.match(/^\/api\/me\/library\/([^/]+)$/)) && method === 'DELETE') {
        await readJsonBody(req); requireUser(user);
        return sendJson(res, 200, app.removeLibrary(user, decodeURIComponent(m[1])));
      }
      if (method === 'GET' && path === '/api/me/notifications') { requireUser(user); return sendJson(res, 200, app.notifications(user)); }
      if (method === 'POST' && path === '/api/me/notifications/read') {
        await readJsonBody(req); requireUser(user);
        db.markAllRead(user.id);
        return sendJson(res, 200, { ok: true });
      }

      // ---- SSR skill pages ----
      if ((m = path.match(/^\/s\/(.+)\.md$/)) && method === 'GET') {
        const r = catalog.get(decodeURIComponent(m[1]));
        if (!r) return sendText(res, 404, '# 404\n技能不存在\n', 'text/markdown; charset=utf-8');
        return sendText(res, 200, renderSkillMarkdown(catalog.detail(r, { user }), brand), 'text/markdown; charset=utf-8');
      }
      if ((m = path.match(/^\/s\/([^/]+)$/)) && method === 'GET') {
        const r = catalog.get(decodeURIComponent(m[1]));
        if (!r) return sendHtml(res, 404, '<!doctype html><meta charset=utf-8><h1>404</h1><p>技能不存在</p>');
        return sendHtml(res, 200, renderSkillPage(catalog.detail(r, { user }), brand));
      }

      return sendJson(res, 404, { error: 'not_found', message: '未找到该路径' });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message, ...(err.extra || {}) });
      console.error('[server] 未处理错误：', err);
      if (!res.headersSent) return sendJson(res, 500, { error: 'internal', message: '服务器内部错误' });
    }
  });

  server.app = app;
  server.catalog = catalog;
  server.baseUrl = baseUrl;
  return server;
}

// Start when run directly.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const server = createServer({ dbFile: process.env.DB_FILE || join(ROOT, 'data', 'db.json') });
  server.listen(port, () => {
    const c = server.catalog.counts();
    console.log(`skillnet-hub listening on ${server.baseUrl} (${c.total} skills: ${c.skillnet} skillnet, ${c.github} github)`);
  });
}
