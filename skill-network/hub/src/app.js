// app.js — wires db + catalog + payments + brand and exposes the composite
// operations the HTTP layer calls (home, rank, creators, dashboard, tip, upload,
// versions, patch, claim). Keeps server.js focused on routing/transport.

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadCatalog, HttpError, CATEGORIES } from './catalog.js';
import { loadDb } from './db.js';
import { createPaymentProvider } from './payments.js';
import { getBrand } from './brand.js';
import { validateUpload, saveFiles } from './uploads.js';
import { scanFiles } from './safety.js';

const round2 = (x) => Math.round(x * 100) / 100;
const uid = (p) => `${p}-${randomBytes(4).toString('hex')}`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export function createApp(opts = {}) {
  const env = opts.env || process.env;
  const brand = opts.brand || getBrand(env);
  const dataDir = opts.dataDir;
  const baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');

  const db = loadDb({ dbFile: opts.dbFile || null, dataDir, env });
  const payments = createPaymentProvider(env);
  const catalog = loadCatalog({ dataDir, stateFile: opts.stateFile || null, baseUrl, db });

  let collections = [];
  try {
    const cp = join(dataDir, 'collections.json');
    if (existsSync(cp)) collections = JSON.parse(readFileSync(cp, 'utf8'));
  } catch (err) { console.warn(`[app] 无法解析 collections.json：${err.message}`); }

  const store = catalog.store;
  const nonBlocked = () => catalog.all().filter((r) => r.safety.level !== 'block');
  const ownedBy = (userId) => catalog.all().filter((r) => catalog.ownerUserIdOf(r) === userId);

  // ---- creators ----
  function creatorSummary(user) {
    if (!user) return null;
    const owned = ownedBy(user.id).filter((r) => r.safety.level !== 'block');
    return {
      id: user.id, handle: user.handle, name: user.name, role: user.role,
      platform: user.platform || '', fans: user.fans || null, bio: user.bio || '',
      followers: db.followerCount(user.id), skillCount: owned.length, claimed: true,
    };
  }

  function creatorsList(limit = 12) {
    const users = Object.values(db.raw().users)
      .map((u) => ({ u, owned: ownedBy(u.id).filter((r) => r.safety.level !== 'block') }))
      .filter((x) => x.owned.length > 0 || x.u.role === 'creator');
    users.sort((a, b) => b.owned.reduce((s, r) => s + catalog.effInstalls(r), 0) - a.owned.reduce((s, r) => s + catalog.effInstalls(r), 0));
    return users.slice(0, limit).map((x) => creatorSummary(x.u));
  }

  function creatorByHandle(handle, viewer) {
    const user = db.getUserByHandle(handle);
    if (!user) throw new HttpError(404, 'not_found', '创作者不存在');
    const skills = ownedBy(user.id)
      .filter((r) => r.safety.level !== 'block')
      .map((r) => catalog.summary(r, { user: viewer }));
    return {
      creator: { ...creatorSummary(user), following: viewer ? db.isFollowing(user.id, viewer.id) : false },
      skills,
    };
  }

  // ---- browse ----
  function home(viewer) {
    const sm = (r) => catalog.summary(r, { user: viewer });
    const cols = collections.map((c) => ({
      title: c.title, desc: c.desc,
      skills: (c.ids || []).map((id) => catalog.get(id)).filter((r) => r && r.safety.level !== 'block').map(sm),
    }));
    const pool = nonBlocked();
    const hot = pool.slice().sort((a, b) => catalog.effInstalls(b) - catalog.effInstalls(a)).slice(0, 8).map(sm);
    const fresh = pool.slice().filter((r) => r.updated).sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, 8).map(sm);
    return {
      collections: cols,
      hot,
      fresh,
      creators: creatorsList(6),
      categories: catalog.categories(),
    };
  }

  function rank({ type = 'hot', cat = null, limit = 20, viewer = null } = {}) {
    let pool = nonBlocked();
    if (cat) pool = pool.filter((r) => r.cat === cat);
    const withSm = pool.map((r) => ({ r, agg: catalog.ratingAgg(r), sm: catalog.summary(r, { user: viewer }) }));
    let items;
    if (type === 'new') items = withSm.sort((a, b) => ((a.r.updated || '') < (b.r.updated || '') ? 1 : -1));
    else if (type === 'fav') items = withSm.sort((a, b) => b.sm.likes - a.sm.likes);
    else if (type === 'rating') items = withSm.filter((x) => x.agg.count >= 3 && x.agg.rating != null).sort((a, b) => b.agg.rating - a.agg.rating);
    else { type = 'hot'; items = withSm.sort((a, b) => b.sm.installs - a.sm.installs); }
    return { type, items: items.slice(0, Math.max(1, Math.min(limit, 50))).map((x) => x.sm) };
  }

  // ---- interactions ----
  function toggleLike(user, skillId) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    const { liked, count } = db.toggleLike(skillId, user.id);
    return { liked, likes: (Number(r.likes) || 0) + count };
  }

  function toggleFollow(viewer, handle) {
    const creator = db.getUserByHandle(handle);
    if (!creator) throw new HttpError(404, 'not_found', '创作者不存在');
    if (creator.id === viewer.id) throw new HttpError(400, 'cannot_follow_self', '不能关注自己');
    const { following, followers } = db.toggleFollow(creator.id, viewer.id);
    return { following, followers };
  }

  function addReview(user, skillId, rating, text) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    const rt = Math.round(Number(rating));
    if (!Number.isFinite(rt) || rt < 1 || rt > 5) throw new HttpError(400, 'bad_rating', '评分必须是 1 到 5');
    const body = String(text == null ? '' : text);
    if (body.length > 500) throw new HttpError(400, 'review_too_long', '评价不能超过 500 字');
    const review = db.upsertReview(skillId, user.id, user.name, rt, body);
    const agg = catalog.ratingAgg(r);
    return { review: { name: review.name, handle: user.handle, rating: review.rating, text: review.text, ts: review.ts }, rating: agg.rating, ratingCount: agg.count };
  }

  function tip(user, skillId, amountRaw) {
    const amount = Number(amountRaw);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new HttpError(400, 'bad_amount', '打赏金额必须是 1 到 500 之间的整数（元）');
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    if (!catalog.tippable(r)) throw new HttpError(400, 'not_tippable', '这个技能暂时不能打赏（作者还没入驻，或已被安全拦截）');
    const ownerId = catalog.ownerUserIdOf(r);
    if (ownerId === user.id) throw new HttpError(400, 'cannot_tip_self', '不能给自己的技能打赏');
    const fee = round2(amount * 0.1);
    const net = round2(amount - fee);
    // Payment is a demo provider; it never moves real money.
    return payments.charge({ amount, skillId, fromUserId: user.id }).then((pay) => {
      const t = db.addTip({ skillId, fromUserId: user.id, fromName: user.name, amount, fee, net, method: pay.method, demo: false });
      const owner = db.getUser(ownerId);
      db.addNotification(ownerId, `${user.name} 打赏了你的「${r.name}」¥${amount}`, `/#/skill/${skillId}`);
      return {
        tip: { id: t.id, skillId, amount, fee, net, method: t.method, ts: t.ts },
        creator: { name: owner ? owner.name : r.creator.name, handle: owner ? owner.handle : r.creator.handle },
      };
    });
  }

  // ---- library + notifications ----
  function addLibrary(user, skillId) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    db.addToLibrary(user.id, skillId, r.version);
    return { inLibrary: true };
  }
  function removeLibrary(user, skillId) {
    db.removeFromLibrary(user.id, skillId);
    return { inLibrary: false };
  }
  function library(user) {
    const items = db.getLibrary(user.id).map((e) => {
      const r = catalog.get(e.skillId);
      if (!r) return null;
      const sm = catalog.summary(r, { user });
      const hasUpdate = !!(r.version && e.seenVersion && String(r.version) !== String(e.seenVersion));
      return { ...sm, seenVersion: e.seenVersion, hasUpdate };
    }).filter(Boolean);
    return { items };
  }
  function notifications(user) {
    const items = db.notifications(user.id);
    return { items, unread: items.filter((n) => !n.read).length };
  }

  // ---- creator tools ----
  function mySkills(user) {
    return { items: ownedBy(user.id).map((r) => catalog.summary(r, { user })) };
  }

  function requireUploadMeta(meta) {
    if (!meta || typeof meta !== 'object') throw new HttpError(400, 'bad_meta', '缺少技能信息 meta');
    if (!meta.name || typeof meta.name !== 'string') throw new HttpError(400, 'bad_meta', '请填写技能名称');
    if (!CATEGORIES.includes(meta.cat)) throw new HttpError(400, 'bad_cat', `分类必须是以下之一：${CATEGORIES.join('、')}`);
    if (!meta.desc || typeof meta.desc !== 'string') throw new HttpError(400, 'bad_meta', '请填写一句话说明');
  }

  function upload(user, meta, files) {
    requireUploadMeta(meta);
    const { files: norm, slug } = validateUpload(files);
    if (db.slugTakenByOwner(user.id, slug)) throw new HttpError(409, 'duplicate_slug', `你已经有一个标识为「${slug}」的技能了，换一个 SKILL.md frontmatter name`);
    const safety = scanFiles(norm.map((f) => ({ path: f.path, content: f.content, binary: f.binary })));
    if (safety.level === 'block') throw new HttpError(422, 'safety_block', '这个技能没有通过安全检测，无法上架', { findings: safety.findings });

    const id = uid('u');
    const version = '1.0';
    saveFiles(dataDir, id, version, norm);
    const meta2 = {
      id, slug, ownerUserId: user.id, ownerName: user.name, ownerHandle: user.handle,
      name: meta.name, cat: meta.cat, desc: meta.desc,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      examples: Array.isArray(meta.examples) ? meta.examples : [],
      video: meta.video || null, glyph: meta.glyph || null,
      version, versions: [{ v: version, date: today(), note: '首次发布' }], updated: today(),
      verified: false, source: 'skillnet', safety, createdAt: new Date().toISOString(),
    };
    db.addSkill(meta2);
    const r = catalog.addUploaded(meta2);
    return catalog.detail(r, { user });
  }

  function bumpMinor(v) {
    const m = /^(\d+)\.(\d+)$/.exec(String(v || '1.0'));
    if (!m) return '1.1';
    return `${m[1]}.${Number(m[2]) + 1}`;
  }

  function addVersion(user, skillId, files, note) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    const meta = db.getSkill(skillId);
    if (!meta || !r.uploaded) throw new HttpError(403, 'not_owner', '只能给自己上传的技能发布新版本');
    if (meta.ownerUserId !== user.id) throw new HttpError(403, 'not_owner', '只有作者本人可以发布新版本');
    const { files: norm } = validateUpload(files);
    const safety = scanFiles(norm.map((f) => ({ path: f.path, content: f.content, binary: f.binary })));
    if (safety.level === 'block') throw new HttpError(422, 'safety_block', '新版本没有通过安全检测，未保存', { findings: safety.findings });

    const version = bumpMinor(meta.version);
    saveFiles(dataDir, skillId, version, norm);
    const noteText = String(note || '').slice(0, 200);
    const meta2 = db.updateSkill(skillId, {
      version,
      versions: [{ v: version, date: today(), note: noteText }, ...(meta.versions || [])],
      updated: today(), safety,
    });
    const rec = catalog.addUploaded(meta2);

    // Notify library holders and followers (minus the author).
    const recipients = new Set([...db.libraryHolders(skillId), ...db.followersOf(user.id)]);
    recipients.delete(user.id);
    for (const uidTo of recipients) {
      db.addNotification(uidTo, `${user.name} 更新了「${rec.name}」v${version}：${noteText}`, `/#/skill/${skillId}`);
    }
    return { skill: catalog.detail(rec, { user }) };
  }

  function patchSkill(user, skillId, patch) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    const meta = db.getSkill(skillId);
    if (!meta || !r.uploaded) throw new HttpError(403, 'not_owner', '只能编辑自己上传的技能');
    if (meta.ownerUserId !== user.id) throw new HttpError(403, 'not_owner', '只有作者本人可以编辑');
    const next = {};
    if (patch.name != null) next.name = String(patch.name);
    if (patch.cat != null) { if (!CATEGORIES.includes(patch.cat)) throw new HttpError(400, 'bad_cat', '分类不合法'); next.cat = patch.cat; }
    if (patch.desc != null) next.desc = String(patch.desc);
    if (patch.tags != null) next.tags = Array.isArray(patch.tags) ? patch.tags : [];
    if (patch.video !== undefined) next.video = patch.video || null;
    if (patch.examples != null) next.examples = Array.isArray(patch.examples) ? patch.examples : [];
    if (patch.glyph != null) next.glyph = String(patch.glyph);
    const meta2 = db.updateSkill(skillId, next);
    const rec = catalog.addUploaded(meta2);
    return { skill: catalog.detail(rec, { user }) };
  }

  // ---- dashboard ----
  function dashboard(user) {
    const owned = ownedBy(user.id);
    const ids = new Set(owned.map((r) => r.id));
    const d7 = daysAgo(7);
    const d30 = daysAgo(30);

    let installs = 0; let installs7d = 0; let installs30d = 0;
    let demoData = false;
    for (const r of owned) {
      installs += catalog.effInstalls(r);
      installs7d += store.installsSince(r.id, d7);
      installs30d += store.installsSince(r.id, d30);
      if (store.hasDemo(r.id)) demoData = true;
    }

    const myTips = db.allTips().filter((t) => ids.has(t.skillId));
    if (myTips.some((t) => t.demo)) demoData = true;
    const tipTotals = {
      gross: round2(myTips.reduce((s, t) => s + t.amount, 0)),
      fee: round2(myTips.reduce((s, t) => s + t.fee, 0)),
      net: round2(myTips.reduce((s, t) => s + t.net, 0)),
      count: myTips.length,
      tippers: new Set(myTips.map((t) => t.fromUserId || t.fromName)).size,
    };

    const likes = owned.reduce((s, r) => s + (Number(r.likes) || 0) + db.likeCount(r.id), 0);

    // 30-day series (oldest first)
    const dates = [];
    for (let i = 29; i >= 0; i--) dates.push(daysAgo(i));
    const tipsByDate = {};
    for (const t of myTips) { const d = (t.ts || '').slice(0, 10); tipsByDate[d] = round2((tipsByDate[d] || 0) + t.net); }
    const daily = dates.map((date) => {
      let dayInstalls = 0;
      for (const r of owned) dayInstalls += Number(store.dailySeries(r.id)[date] || 0);
      return { date, installs: dayInstalls, tipsNet: round2(tipsByDate[date] || 0) };
    });

    const clientAgg = {};
    const refAgg = {};
    for (const r of owned) {
      for (const [c, n] of Object.entries(store.clientBreakdown(r.id))) clientAgg[c] = (clientAgg[c] || 0) + n;
      for (const [rf, n] of Object.entries(store.refBreakdown(r.id))) refAgg[rf] = (refAgg[rf] || 0) + n;
    }
    const byClient = Object.entries(clientAgg).map(([client, n]) => ({ client, n })).sort((a, b) => b.n - a.n);
    const byRef = Object.entries(refAgg).map(([ref, n]) => ({ ref, n })).sort((a, b) => b.n - a.n).slice(0, 8);

    const skills = owned.map((r) => {
      const sm = catalog.summary(r, { user });
      const tips = myTips.filter((t) => t.skillId === r.id);
      return { ...sm, installs30d: store.installsSince(r.id, d30), tipsNet: round2(tips.reduce((s, t) => s + t.net, 0)), tipCount: tips.length };
    });

    const recentTips = myTips.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 20).map((t) => {
      const r = catalog.get(t.skillId);
      return { from: t.fromName || '匿名', skillName: r ? r.name : t.skillId, amount: t.amount, net: t.net, ts: t.ts, demo: !!t.demo };
    });

    return {
      totals: { installs, installs7d, installs30d, tips: tipTotals, followers: db.followerCount(user.id), likes, demoData },
      daily,
      byClient,
      byRef,
      skills,
      recentTips,
    };
  }

  // ---- claim (GitHub cold-start) ----
  function claimGenerate(user, skillId) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    if (r.source !== 'github') throw new HttpError(400, 'not_claimable', '只有来自 GitHub 的技能需要认领');
    const code = db.claimCode(user.id, skillId);
    return { code, instructions: `在仓库的 SKILL.md 任意位置加入这行，提交后回来点验证：${code}` };
  }

  async function claimVerify(user, skillId, { fetchImpl = fetch } = {}) {
    const r = catalog.get(skillId);
    if (!r) throw new HttpError(404, 'not_found', '技能不存在');
    if (r.source !== 'github') throw new HttpError(400, 'not_claimable', '只有来自 GitHub 的技能需要认领');
    const code = db.claimCode(user.id, skillId);
    const token = env.GITHUB_TOKEN || '';
    const headers = { 'User-Agent': 'skillnet-hub', Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    let branch = null;
    try {
      const api = await fetchImpl(`https://api.github.com/repos/${r.repo}`, { headers });
      if (api && api.ok) { const j = await api.json(); branch = j && j.default_branch; }
    } catch { /* fall back below */ }
    branch = branch || r.branch || 'main';

    const path = `${r.repoPath ? r.repoPath + '/' : ''}SKILL.md`;
    const rawUrl = `https://raw.githubusercontent.com/${r.repo}/${branch}/${path}`;
    let content = '';
    try {
      const resp = await fetchImpl(rawUrl, { headers: { 'User-Agent': 'skillnet-hub' } });
      if (resp && resp.ok) content = await resp.text();
    } catch { content = ''; }

    if (!content.includes(code)) throw new HttpError(400, 'claim_not_found', `还没在 SKILL.md 里找到认领码 ${code}，提交后再试`);
    db.setClaimed(skillId, user.id, r.creator.handle);
    return { claimed: true, skill: catalog.detail(catalog.get(skillId), { user }) };
  }

  return {
    brand, baseUrl, dataDir, env,
    db, catalog, payments, collections, CATEGORIES,
    // browse
    home, rank, creatorsList, creatorByHandle, creatorSummary,
    // interactions
    toggleLike, toggleFollow, addReview, tip,
    addLibrary, removeLibrary, library, notifications,
    // creator tools
    mySkills, upload, addVersion, patchSkill, dashboard,
    // claim
    claimGenerate, claimVerify,
  };
}

export { HttpError };
