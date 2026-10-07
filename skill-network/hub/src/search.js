// search.js — query understanding + relevance scoring for the SkillNet hub.
// Pure module: no I/O, no internal deps. Records carry an effective `installs`
// field set by the catalog before scoring.

export const CATEGORIES = [
  '视频剪辑', '短视频运营', '小红书', '插画美术',
  '音乐', '摄影修图', 'UI/UX', '文案口播',
];

// Bidirectional synonym groups. The matched surface form keeps weight 1, every
// other term in its group is a synonym (weight 0.6). `cat` ties a concept to one
// of the 8 categories for the category boost.
export const SYNONYM_GROUPS = [
  { terms: ['小红书', 'xhs', '红书', '种草', '笔记'], cat: '小红书' },
  { terms: ['封面', '首图', '头图', '缩略图', 'cover', 'thumbnail'] },
  { terms: ['标题', '起标题', 'title'] },
  { terms: ['剪辑', '剪视频', '剪片', '视频剪辑', '剪映', 'edit', 'editing'], cat: '视频剪辑' },
  { terms: ['字幕', '花字', 'subtitle', 'caption', 'srt'], cat: '视频剪辑' },
  { terms: ['口播', '口播稿', '台词', '讲稿', '配音', 'voiceover'], cat: '文案口播' },
  { terms: ['文案', '写文案', 'copywriting', '软文'], cat: '文案口播' },
  // Must be vocab, or the "ai" stopword strips it down to 去/味.
  { terms: ['去ai味', 'ai味', '去机器味', '降ai率', '人味', 'humanizer'], cat: '文案口播' },
  { terms: ['选题', '话题', '热点', 'topic'], cat: '短视频运营' },
  { terms: ['抖音', 'douyin', 'tiktok', '短视频'], cat: '短视频运营' },
  { terms: ['b站', 'bilibili', '哔哩哔哩'] },
  { terms: ['vlog', '视频日记'] },
  { terms: ['分镜', '脚本', 'storyboard', 'script'] },
  { terms: ['插画', '画画', '绘画', '插图', 'illustration', '美术'], cat: '插画美术' },
  { terms: ['配色', '色卡', '调色板', 'palette', 'color'], cat: '插画美术' },
  { terms: ['提示词', '咒语', 'prompt', 'midjourney', 'mj', '即梦', '出图', '生图'] },
  { terms: ['修图', 'p图', '调色', '后期', 'retouch', 'lightroom', '醒图'], cat: '摄影修图' },
  { terms: ['摄影', '拍照', 'photo'], cat: '摄影修图' },
  { terms: ['音乐', '写歌', '作曲', 'music'], cat: '音乐' },
  { terms: ['歌词', '作词', 'lyrics'], cat: '音乐' },
  { terms: ['编曲', '混音', 'mix', 'mixing'], cat: '音乐' },
  { terms: ['ui', 'ux', '界面', '设计稿', '交互', 'figma', '用户体验'], cat: 'UI/UX' },
  { terms: ['人像', 'portrait'] },
];

// Starter stopword / filler list. Extend sensibly.
export const STOPWORDS = [
  '帮我', '请', '找个', '找一个', '找', '一个', '有没有', '推荐', '想要', '我想',
  '能不能', '可以', '能', '的话', '的', '地', '得', '做', '用', '给我', '一下',
  '怎么', '什么', '哪个', '好用', '吗', '呢', '技能', '插件', '工具',
  'skills', 'skill', 'ai', 'agent',
];

const FIELD_WEIGHTS = {
  name: 3, tags: 2.5, cat: 2, desc: 1.5, examples: 0.8, descOriginal: 1,
};

export function normalize(s) {
  if (s == null) return '';
  return String(s).normalize('NFKC').toLowerCase().trim();
}

const CAT_SET = new Set(CATEGORIES.map(normalize));

// Build lookup: normalized term -> group index, and the stopword set.
const TERM_TO_GROUP = new Map();
SYNONYM_GROUPS.forEach((g, idx) => {
  g._norm = g.terms.map(normalize);
  for (const t of g._norm) if (!TERM_TO_GROUP.has(t)) TERM_TO_GROUP.set(t, idx);
});
const STOP_SET = new Set(STOPWORDS.map(normalize));
const MAX_KEY_LEN = Math.max(
  ...[...TERM_TO_GROUP.keys(), ...STOP_SET].map((k) => k.length),
);

const isAlnum = (ch) => ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9';
const isCjk = (ch) => /[㐀-鿿豈-﫿]/.test(ch);

// Longest match of a vocab/stopword key at position i. ASCII-only keys must sit
// on a word boundary so "edit" does not match inside "editor".
function longestMatch(s, i) {
  const maxLen = Math.min(MAX_KEY_LEN, s.length - i);
  for (let len = maxLen; len >= 1; len--) {
    const slice = s.slice(i, i + len);
    const pureAscii = /^[a-z0-9]+$/.test(slice);
    if (pureAscii) {
      const leftOk = i === 0 || !isAlnum(s[i - 1]);
      const rightOk = i + len >= s.length || !isAlnum(s[i + len]);
      if (!leftOk || !rightOk) continue;
    }
    if (TERM_TO_GROUP.has(slice)) return { len, type: 'vocab', group: TERM_TO_GROUP.get(slice), surface: slice };
    if (STOP_SET.has(slice)) return { len, type: 'stop' };
  }
  return null;
}

function conceptFromGroup(groupIdx, surface) {
  const g = SYNONYM_GROUPS[groupIdx];
  const variants = g._norm.map((t) => ({ text: t, weight: t === surface ? 1 : 0.6 }));
  return { term: surface, variants, category: g.cat || null };
}

function leftoverConcept(text) {
  return { term: text, variants: [{ text, weight: 1 }], category: CAT_SET.has(text) ? text : null };
}

// Turn a query into weighted concepts.
export function extractConcepts(query) {
  const s = normalize(query);
  const concepts = [];
  let cjkBuf = '';
  let asciiBuf = '';

  const flushCjk = () => {
    if (!cjkBuf) return;
    if (cjkBuf.length === 1) concepts.push(leftoverConcept(cjkBuf));
    else for (let k = 0; k + 1 < cjkBuf.length; k++) concepts.push(leftoverConcept(cjkBuf.slice(k, k + 2)));
    cjkBuf = '';
  };
  const flushAscii = () => {
    if (!asciiBuf) return;
    for (const w of asciiBuf.split(/[^a-z0-9]+/)) if (w) concepts.push(leftoverConcept(w));
    asciiBuf = '';
  };
  const flushAll = () => { flushCjk(); flushAscii(); };

  let i = 0;
  while (i < s.length) {
    const m = longestMatch(s, i);
    if (m) {
      flushAll();
      if (m.type === 'vocab') concepts.push(conceptFromGroup(m.group, m.surface));
      i += m.len;
      continue;
    }
    const ch = s[i];
    if (isAlnum(ch)) { flushCjk(); asciiBuf += ch; }
    else if (isCjk(ch)) { flushAscii(); cjkBuf += ch; }
    else { flushAll(); }
    i++;
  }
  flushAll();

  // Dedupe by surface term, keep first occurrence.
  const seen = new Set();
  return concepts.filter((c) => (seen.has(c.term) ? false : (seen.add(c.term), true)));
}

// ASCII terms must hit whole words (plural -s/-es allowed) so 'ui' does not match
// "guide" and 'script' does not match "description" in English GitHub
// descriptions; CJK terms have no word boundaries and match as substrings.
function makeMatcher(term) {
  if (!/^[a-z0-9]+$/.test(term)) return (text) => text.includes(term);
  const re = new RegExp(`(?:^|[^a-z0-9])${term}(?:e?s)?(?![a-z0-9])`);
  return (text) => re.test(text);
}

function examplesText(record) {
  if (!Array.isArray(record.examples)) return '';
  return record.examples.map((e) => `${e.you || ''} ${e.ai || ''}`).join('\n');
}

function scoreDoc(record, concepts) {
  const fields = [
    ['name', record.name, FIELD_WEIGHTS.name],
    ['tags', Array.isArray(record.tags) ? record.tags.join('\n') : '', FIELD_WEIGHTS.tags],
    ['cat', record.cat, FIELD_WEIGHTS.cat],
    ['desc', record.desc, FIELD_WEIGHTS.desc],
    ['examples', examplesText(record), FIELD_WEIGHTS.examples],
    ['descOriginal', record.descOriginal, FIELD_WEIGHTS.descOriginal],
  ].map(([n, t, w]) => [n, normalize(t), w]).filter(([, t]) => t);

  let sum = 0;
  let matchedCount = 0;
  const matched = [];
  for (const c of concepts) {
    let best = 0;
    for (const v of c.variants) {
      if (!v.text) continue;
      for (const [, ft, fw] of fields) {
        if (v.match(ft)) {
          const sc = fw * v.weight;
          if (sc > best) best = sc;
        }
      }
    }
    if (best > 0) { matchedCount++; matched.push(c.term); }
    sum += best;
  }

  const n = concepts.length;
  let text = sum / (n * FIELD_WEIGHTS.name);
  const coverage = matchedCount / n;
  // Category boost: a query concept naming this doc's category.
  if (record.cat && concepts.some((c) => c.category && c.category === record.cat)) text *= 1.2;

  const installs = Number(record.installs) || 0;
  const rating = Number(record.rating) || 0;
  const stars = Number(record.stars) || 0;
  const mult = 1
    + 0.12 * Math.log10(1 + installs)
    + 0.15 * Math.max(0, rating - 4)
    + 0.15 * (record.verified ? 1 : 0)
    + 0.05 * (record.creator && record.creator.claimed ? 1 : 0)
    + 0.03 * Math.log10(1 + stars);
  const safetyFactor = record.safety && record.safety.level === 'review' ? 0.7 : 1;
  const final = text * mult * safetyFactor;

  return { record, text, coverage, score: final, matched };
}

// Main entry. `records` must each carry an effective `installs` number.
export function search(records, query, { category = null, limit = 5 } = {}) {
  const concepts = extractConcepts(query);
  for (const c of concepts) for (const v of c.variants) v.match = makeMatcher(v.text);
  let pool = records.filter((r) => !(r.safety && r.safety.level === 'block'));
  if (category) pool = pool.filter((r) => r.cat === category);

  if (concepts.length === 0) {
    return pool
      .map((r) => ({ record: r, score: 0, matched: [], text: 0, coverage: 0 }))
      .sort((a, b) => (Number(b.record.installs) || 0) - (Number(a.record.installs) || 0))
      .slice(0, limit);
  }

  const scored = [];
  for (const r of pool) {
    const s = scoreDoc(r, concepts);
    if (s.coverage >= 0.5 && s.text > 0) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score
    || (Number(b.record.installs) || 0) - (Number(a.record.installs) || 0));
  return scored.slice(0, limit);
}
