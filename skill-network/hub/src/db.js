// db.js — JSON-file persistence for everything the catalog does not own:
// users, sessions, uploaded-skill metadata, tips, reviews, likes, follows,
// library and notifications. Atomic writes (tmp then rename), debounced, flushed
// on exit. Seeded on first run from data/skills.json creators.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, newToken, sessionExpiry } from './auth.js';

function emptyData() {
  return {
    version: 1,
    users: {},        // id -> { id, handle, name, role, platform, fans, bio, salt, hash, createdAt }
    sessions: {},     // token -> { userId, createdAt, expiresAt }
    skills: {},       // id -> uploaded skill meta
    tips: [],         // [{ id, skillId, fromUserId, fromName, amount, fee, net, method, demo, ts }]
    reviews: {},      // skillId -> [{ id, userId|null, name, rating, text, ts }]
    likes: {},        // skillId -> [userId]
    follows: {},      // creatorUserId -> [userId]
    library: {},      // userId -> { skillId: { seenVersion, ts } }
    notifications: {}, // userId -> [{ id, text, ts, read, link }]
    claims: {},       // `${skillId}:${userId}` -> code ; `claimed:${skillId}` -> { userId, githubLogin }
  };
}

const uid = (p) => `${p}-${randomBytes(4).toString('hex')}`;

export function loadDb({ dbFile = null, dataDir = null, env = process.env } = {}) {
  let data = emptyData();
  let loaded = false;

  if (dbFile && existsSync(dbFile)) {
    try {
      const parsed = JSON.parse(readFileSync(dbFile, 'utf8'));
      data = { ...emptyData(), ...parsed };
      // Ensure nested maps exist even if an older/partial file is loaded.
      for (const k of ['users', 'sessions', 'skills', 'reviews', 'likes', 'follows', 'library', 'notifications', 'claims']) {
        if (!data[k] || typeof data[k] !== 'object') data[k] = {};
      }
      if (!Array.isArray(data.tips)) data.tips = [];
      loaded = true;
    } catch (err) {
      console.warn(`[db] 无法解析 ${dbFile}，从空状态开始：${err.message}`);
      data = emptyData();
    }
  }

  // --- debounced atomic persistence ---
  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dbFile) return;
    try {
      const dir = dirname(dbFile);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${dbFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tmp, dbFile);
    } catch (err) {
      console.warn(`[db] 写入 ${dbFile} 失败：${err.message}`);
    }
  }
  function persist() {
    if (!dbFile) return;
    if (timer) return;
    timer = setTimeout(flush, 120);
    if (timer.unref) timer.unref();
  }
  if (dbFile) {
    process.once('exit', flush);
    process.once('SIGINT', () => { flush(); process.exit(0); });
    process.once('SIGTERM', () => { flush(); process.exit(0); });
  }

  // --- seeding (only when the db has no users yet) ---
  function seed() {
    const password = env.DEMO_PASSWORD || 'demo1234';
    const mkUser = (u) => {
      const { salt, hash } = hashPassword(password);
      data.users[u.id] = {
        id: u.id, handle: u.handle, name: u.name, role: u.role,
        platform: u.platform || '', fans: u.fans || null, bio: u.bio || '',
        salt, hash, createdAt: new Date().toISOString(), seed: true,
      };
    };

    let creators = [];
    if (dataDir) {
      try {
        const sp = join(dataDir, 'skills.json');
        if (existsSync(sp)) creators = JSON.parse(readFileSync(sp, 'utf8')).creators || [];
      } catch { /* ignore */ }
    }
    for (const c of creators) {
      mkUser({ id: c.id, handle: c.handle, name: c.name, role: 'creator', platform: c.platform, fans: c.fans, bio: c.bio });
    }
    mkUser({ id: 'u1', handle: 'zhou', name: '小周', role: 'user', platform: '', fans: null, bio: '刚开始做小红书，什么都想学一点。' });

    // social graph
    data.follows.c2 = ['u1'];
    data.likes.s3 = ['u1'];
    data.likes.s5 = ['u1'];
    data.library.u1 = { s3: { seenVersion: '1.3', ts: '2026-09-29T00:00:00.000Z' } };

    const seedReview = (skillId, name, rating, text, ts) => {
      if (!data.reviews[skillId]) data.reviews[skillId] = [];
      data.reviews[skillId].push({ id: uid('rv'), userId: null, name, rating, text, ts });
    };
    seedReview('s1', '小鹿拍拍', 5, '第一次做 vlog 就靠它了，分镜很专业', '2026-09-15T00:00:00.000Z');
    seedReview('s1', '阿May', 4, '希望多点旅行类模板', '2026-09-18T00:00:00.000Z');
    seedReview('s3', '小周', 5, '配色直接能用，还会告诉我哪个颜色放哪', '2026-09-20T00:00:00.000Z');
    seedReview('s5', '弹唱少女', 5, '歌名太有感觉了', '2026-09-22T00:00:00.000Z');

    flush();
  }
  if (!loaded || Object.keys(data.users).length === 0) seed();

  // --- helpers ---
  const nowIso = () => new Date().toISOString();
  const arr = (map, key) => { if (!Array.isArray(map[key])) map[key] = []; return map[key]; };

  const api = {
    flush,
    raw() { return data; },

    // ---- users ----
    getUser(id) { return (id && data.users[id]) || null; },
    getUserByHandle(handle) {
      const h = String(handle || '').toLowerCase();
      return Object.values(data.users).find((u) => u.handle.toLowerCase() === h) || null;
    },
    handleTaken(handle) { return !!api.getUserByHandle(handle); },
    createUser({ handle, name, role, platform = '', bio = '', password }) {
      const id = uid('usr');
      const { salt, hash } = hashPassword(password);
      const user = { id, handle, name, role, platform, fans: null, bio, salt, hash, createdAt: nowIso() };
      data.users[id] = user;
      persist();
      return user;
    },
    publicUser(u) {
      if (!u) return null;
      return { id: u.id, handle: u.handle, name: u.name, role: u.role, platform: u.platform || '', bio: u.bio || '', fans: u.fans || null };
    },

    // ---- sessions ----
    createSession(userId) {
      const token = newToken();
      data.sessions[token] = { userId, createdAt: nowIso(), expiresAt: sessionExpiry() };
      persist();
      return token;
    },
    resolveSession(token) {
      const s = token && data.sessions[token];
      if (!s) return null;
      if (s.expiresAt && Date.parse(s.expiresAt) < Date.now()) { delete data.sessions[token]; persist(); return null; }
      return api.getUser(s.userId);
    },
    deleteSession(token) { if (token && data.sessions[token]) { delete data.sessions[token]; persist(); } },

    // ---- uploaded skills ----
    addSkill(meta) { data.skills[meta.id] = meta; persist(); return meta; },
    getSkill(id) { return (id && data.skills[id]) || null; },
    updateSkill(id, patch) {
      if (!data.skills[id]) return null;
      data.skills[id] = { ...data.skills[id], ...patch, updatedAt: nowIso() };
      persist();
      return data.skills[id];
    },
    listUploadedSkills() { return Object.values(data.skills); },
    slugTakenByOwner(ownerUserId, slug) {
      return Object.values(data.skills).some((s) => s.ownerUserId === ownerUserId && s.slug === slug);
    },

    // ---- tips ----
    addTip({ skillId, fromUserId, fromName, amount, fee, net, method, demo = false, ts }) {
      const tip = { id: uid('tip'), skillId, fromUserId: fromUserId || null, fromName: fromName || null, amount, fee, net, method, demo: !!demo, ts: ts || nowIso() };
      data.tips.push(tip);
      persist();
      return tip;
    },
    allTips() { return data.tips; },
    tipsForSkill(skillId) { return data.tips.filter((t) => t.skillId === skillId); },
    clearDemoTips() { data.tips = data.tips.filter((t) => !t.demo); persist(); },

    // ---- reviews ----
    reviewsForSkill(skillId) { return data.reviews[skillId] || []; },
    upsertReview(skillId, userId, name, rating, text) {
      const list = arr(data.reviews, skillId);
      const existing = list.find((r) => r.userId && r.userId === userId);
      if (existing) {
        existing.rating = rating; existing.text = text; existing.name = name; existing.ts = nowIso();
        persist();
        return existing;
      }
      const review = { id: uid('rv'), userId, name, rating, text, ts: nowIso() };
      list.push(review);
      persist();
      return review;
    },

    // ---- likes ----
    likeCount(skillId) { return (data.likes[skillId] || []).length; },
    hasLiked(skillId, userId) { return !!userId && (data.likes[skillId] || []).includes(userId); },
    toggleLike(skillId, userId) {
      const list = arr(data.likes, skillId);
      const i = list.indexOf(userId);
      let liked;
      if (i === -1) { list.push(userId); liked = true; } else { list.splice(i, 1); liked = false; }
      persist();
      return { liked, count: list.length };
    },
    likedSkillIds(userId) {
      return Object.entries(data.likes).filter(([, u]) => u.includes(userId)).map(([id]) => id);
    },

    // ---- follows (keyed by creator userId) ----
    followerCount(creatorUserId) { return (data.follows[creatorUserId] || []).length; },
    isFollowing(creatorUserId, userId) { return !!userId && (data.follows[creatorUserId] || []).includes(userId); },
    toggleFollow(creatorUserId, userId) {
      const list = arr(data.follows, creatorUserId);
      const i = list.indexOf(userId);
      let following;
      if (i === -1) { list.push(userId); following = true; } else { list.splice(i, 1); following = false; }
      persist();
      return { following, followers: list.length };
    },
    followersOf(creatorUserId) { return data.follows[creatorUserId] || []; },

    // ---- library (per user) ----
    inLibrary(userId, skillId) { return !!(data.library[userId] && data.library[userId][skillId]); },
    librarySeen(userId, skillId) {
      const e = data.library[userId] && data.library[userId][skillId];
      return e ? e.seenVersion : null;
    },
    addToLibrary(userId, skillId, seenVersion) {
      if (!data.library[userId]) data.library[userId] = {};
      data.library[userId][skillId] = { seenVersion: seenVersion || null, ts: nowIso() };
      persist();
      return data.library[userId][skillId];
    },
    removeFromLibrary(userId, skillId) {
      if (data.library[userId]) { delete data.library[userId][skillId]; persist(); }
    },
    getLibrary(userId) {
      const m = data.library[userId] || {};
      return Object.entries(m).map(([skillId, e]) => ({ skillId, seenVersion: e.seenVersion, ts: e.ts }));
    },
    libraryHolders(skillId) {
      return Object.entries(data.library).filter(([, m]) => m[skillId]).map(([userId]) => userId);
    },

    // ---- notifications ----
    addNotification(userId, text, link) {
      const list = arr(data.notifications, userId);
      const n = { id: uid('ntf'), text, link: link || null, ts: nowIso(), read: false };
      list.push(n);
      persist();
      return n;
    },
    notifications(userId) {
      return (data.notifications[userId] || []).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    },
    unreadCount(userId) { return (data.notifications[userId] || []).filter((n) => !n.read).length; },
    markAllRead(userId) {
      for (const n of data.notifications[userId] || []) n.read = true;
      persist();
    },

    // ---- claims ----
    claimCode(userId, skillId) {
      const key = `${skillId}:${userId}`;
      if (!data.claims[key]) { data.claims[key] = `skillnet-claim-${randomBytes(5).toString('hex')}`; persist(); }
      return data.claims[key];
    },
    getClaim(skillId) { return data.claims[`claimed:${skillId}`] || null; },
    setClaimed(skillId, userId, githubLogin) {
      data.claims[`claimed:${skillId}`] = { userId, githubLogin: githubLogin || null, ts: nowIso() };
      persist();
      return data.claims[`claimed:${skillId}`];
    },
  };

  return api;
}
