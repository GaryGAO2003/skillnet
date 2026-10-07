/* SkillNet creator hub — vanilla SPA, no build step, no frameworks.
   Ported from the approved demo; wired to the real backend (see API contract).
   Structure: config → helpers → api() → pieces → views → modals → events → boot. */
(function () {
'use strict';

/* ---------- config ---------- */
// Injected by the backend into <head> as window.__SN__. Defaults keep the page
// alive if it is opened without injection (brand is a placeholder; never hard-code).
var DEF_CATS = ['视频剪辑', '短视频运营', '小红书', '插画美术', '音乐', '摄影修图', 'UI/UX', '文案口播'];
var CFG = Object.assign({
  brand: 'SkillNet',
  tagline: '创作者的 AI 技能，一句话就能装进你的 AI 助手',
  base: location.origin,
  demo: false,
  categories: DEF_CATS
}, window.__SN__ || {});
var BRAND = CFG.brand || 'SkillNet';
var CATS = (CFG.categories && CFG.categories.length) ? CFG.categories : DEF_CATS;
var BASEURL = String(CFG.base || location.origin).replace(/\/+$/, '');
document.title = BRAND + ' · 创作者 AI 技能市场';

/* ---------- small helpers ---------- */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function attr(s) { return esc(s); } // attribute-safe (esc already covers quotes)
var yuan = function (n) { n = Number(n) || 0; return '¥' + (n % 1 ? n.toFixed(2) : n); };
var fmt = function (n) { n = Number(n) || 0; return n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString('en-US'); };
var PAL = [['#FF4D8D', '#FFB86B'], ['#5B8CFF', '#B18CFF'], ['#2ED3A0', '#E6FF4F'], ['#FF7A45', '#FF4D8D'], ['#17141C', '#5B8CFF'], ['#B18CFF', '#FF9BD2'], ['#00B8D9', '#2ED3A0'], ['#FFB800', '#FF5A5A']];
var AVA = ['#FF4D8D', '#5B8CFF', '#2ED3A0', '#FF7A45', '#B18CFF', '#00B8D9'];
function palOf(p) { p = Number(p); return PAL[(p >= 0 && p < PAL.length) ? p : 0]; }
function coverBg(p) { var c = palOf(p); return 'background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')'; }
function hashCode(str) { var h = 7; str = String(str || ''); for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
function avaColor(seed) { return AVA[hashCode(seed) % AVA.length]; }
function ava(name, seed, cls) {
  return '<span class="ava ' + (cls || '') + '" style="background:' + avaColor(seed || name) + '">' + esc(String(name || '?').slice(0, 1)) + '</span>';
}
var I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  lib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  me: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  heart: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/></svg>'
};

/* ---------- toast ---------- */
function toast(t) {
  var d = document.createElement('div');
  d.className = 'toast';
  d.textContent = t;
  document.body.appendChild(d);
  setTimeout(function () { d.remove(); }, 2400);
}
function copy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast('复制失败，请长按文字手动复制'); });
  } else { toast('复制失败，请长按文字手动复制'); }
}

/* ---------- api ---------- */
// All calls are same-origin with the session cookie. Errors are {error,message};
// callers toast message. A 401 login_required bounces to #/login and returns here.
var pendingReturn = null;
function api(path, opts) {
  opts = opts || {};
  var o = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    o.headers['Content-Type'] = 'application/json';
    o.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  if (opts.headers) for (var k in opts.headers) o.headers[k] = opts.headers[k];
  return fetch(path, o).then(function (res) {
    var ct = res.headers.get('content-type') || '';
    var dataP = ct.indexOf('application/json') >= 0 ? res.json().catch(function () { return null; }) : Promise.resolve(null);
    return dataP.then(function (data) {
      if (res.ok) return data;
      var err = data && data.error ? data : { error: 'http_' + res.status, message: '出错了（' + res.status + '）' };
      if (res.status === 401 && err.error === 'login_required') {
        if (!(current && current.name === 'login')) pendingReturn = location.hash || '#/';
        err.handled = true;
        go('#/login');
      }
      throw err;
    });
  }, function () {
    throw { error: 'network', message: '网络连接失败，请检查网络后重试' };
  });
}

/* ---------- app state ---------- */
var state = { me: null, notifUnread: 0 };
var current = { name: 'home', arg: null, query: {} };
var homeState = { data: null, q: '', cat: '全部' };
var rankTab = 'hot';
var installTab = 'ai';
var curDetail = null; // cached skill detail for cheap install-tab re-render

function setApp(html) { $('#app').innerHTML = html; }
function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}
function skillHref(id) { return '#/skill/' + encodeURIComponent(id); }
function creatorHref(h) { return '#/creator/' + encodeURIComponent(h); }
function shareUrlFor(id) { return BASEURL + '/s/' + id; }

/* loading / error pieces */
function skelGrid(n) {
  n = n || 8; var out = '';
  for (var i = 0; i < n; i++) out += '<div class="skel"><div class="sk-cover"></div><div class="sk-body"><div class="sk-line"></div><div class="sk-line s"></div></div></div>';
  return '<div class="skelgrid">' + out + '</div>';
}
function loadRow(t) { return '<div class="loadrow"><span class="spin"></span>' + esc(t || '加载中…') + '</div>'; }
function errState(err, retryName) {
  var msg = (err && err.message) || '加载失败';
  return '<div class="empty"><span class="e">出错了</span>' + esc(msg) +
    '<button class="btn pink" data-act="retry">重试</button></div>';
}

/* ---------- cover / card pieces ---------- */
function cover(sm, cls, inner) {
  var c = palOf(sm.pal);
  return '<div class="' + (cls || 'cover') + '" style="' + coverBg(sm.pal) + '">' +
    '<span class="blob" style="width:60%;height:60%;right:-12%;top:-18%;background:' + c[1] + ';opacity:.55"></span>' +
    '<span class="blob" style="width:40%;height:40%;left:-8%;bottom:-14%;background:#fff;opacity:.18"></span>' +
    '<span class="glyph">' + esc(sm.glyph || (sm.name || '').slice(0, 2)) + '</span>' + (inner || '') + '</div>';
}
function creatorName(sm) {
  if (sm.source === 'github' && sm.creator && !sm.creator.claimed) return '来自 GitHub';
  return (sm.creator && sm.creator.name) || (sm.owner && sm.owner.name) || '匿名';
}
function card(sm, opt) {
  opt = opt || {};
  var liked = sm.liked === true;
  var cn = creatorName(sm);
  var badge = '<span class="tag" style="background:rgba(255,255,255,.9);color:#17141C">' + esc(sm.cat) + '</span>';
  if (opt.update) badge += '<span class="tag" style="background:var(--lemon);color:#17141C">有更新 v' + esc(sm.version || '') + '</span>';
  var likeBtn = (sm.liked === null || sm.liked === undefined && !state.me)
    ? '' // logged out: no like toggle on card
    : '<button class="like ' + (liked ? 'on' : '') + '" data-act="like" data-id="' + attr(sm.id) + '" aria-label="喜欢" aria-pressed="' + (liked ? 'true' : 'false') + '">' + I.heart + '<span class="num">' + fmt(sm.likes) + '</span></button>';
  var rating = (sm.rating != null) ? ('★ ' + esc(sm.rating)) : '新';
  return '<article class="card" data-href="' + skillHref(sm.id) + '" tabindex="0" role="link" aria-label="' + attr(sm.name) + '">' +
    cover(sm, 'cover', '<span class="badge">' + badge + '</span>' + likeBtn) +
    '<div class="body"><h3>' + (sm.pick ? '<span class="tag pk">精选</span>' : '') + esc(sm.name) + '</h3>' +
    '<div class="desc">' + esc(sm.desc) + '</div>' +
    '<div class="foot"><span class="who">' + ava(cn, (sm.creator && sm.creator.handle) || cn) + esc(cn) + '</span>' +
    '<span class="muted num">' + rating + ' · ' + fmt(sm.installs) + '</span></div></div></article>';
}
function grid(list, emptyMsg) {
  if (!list || !list.length) return '<div class="empty"><span class="e">还没有找到</span>' + esc(emptyMsg || '换个关键词或分类试试') + '</div>';
  return '<div class="grid">' + list.map(function (s) { return card(s); }).join('') + '</div>';
}

/* ---------- chrome (header + bottom tabs) ---------- */
function demoBar() {
  var el = $('#demobar');
  if (CFG.demo) { el.hidden = false; el.innerHTML = '演示模式 · 示例数据 · <b>支付为模拟，不会真的扣钱</b>'; }
  else { el.hidden = true; el.innerHTML = ''; }
}
function tabsFor(u) {
  var t = [['home', '发现', I.home], ['rank', '榜单', I.chart]];
  if (u) t.push(['dash', '后台', I.chart]);
  t.push(['upload', '发布', I.plus], ['library', '我的', I.lib]);
  return t;
}
function renderChrome(activeName) {
  var u = state.me, tabs = tabsFor(u), unread = u ? (state.notifUnread || 0) : 0;
  var isActive = function (k) { return activeName === k; };
  $('#hdr').innerHTML =
    '<button class="logo" data-href="#/"><i></i>' + esc(BRAND) + '</button>' +
    '<nav class="nav">' + tabs.map(function (t) {
      return '<button data-href="#/' + (t[0] === 'home' ? '' : t[0]) + '" class="' + (isActive(t[0]) ? 'on' : '') + '">' + esc(t[1]) + '</button>';
    }).join('') + '</nav>' +
    '<span class="spacer"></span>' +
    '<label class="hsearch">' + I.search + '<input id="hq" placeholder="搜 skill、作者" value="' + attr(homeState.q) + '" aria-label="搜索"></label>' +
    (u
      ? '<button class="iconbtn" data-act="notifs" aria-label="通知">' + I.bell + (unread ? '<span class="dot">' + unread + '</span>' : '') + '</button>' +
        '<button class="me-btn" data-act="mesheet" aria-label="账号">' + ava(u.name, u.handle) + '<span style="font-weight:600;font-size:14px">' + esc(u.name) + '</span></button>'
      : '<button class="btn dark sm" data-href="#/login">登录</button>');
  var bt = $('#btabs');
  bt.style.setProperty('--n', tabs.length);
  bt.innerHTML = tabs.map(function (t) {
    return '<button data-href="#/' + (t[0] === 'home' ? '' : t[0]) + '" class="' + (isActive(t[0]) ? 'on' : '') + ' ' + (t[0] === 'upload' ? 'up' : '') + '"><span class="ic">' + t[2] + '</span>' + esc(t[1]) + '</button>';
  }).join('');
  var hq = $('#hq');
  if (hq) hq.onkeydown = function (e) {
    if (e.key === 'Enter') { homeState.q = hq.value.trim(); homeState.cat = '全部'; if (current.name === 'home') { renderFeed(); scrollFeed(); } else go('#/'); }
  };
}
function scrollFeed() { setTimeout(function () { var f = $('#feed'); if (f) f.scrollIntoView({ behavior: 'smooth' }); }, 60); }

/* ---------- notifications badge ---------- */
function refreshNotifBadge() {
  if (!state.me) { state.notifUnread = 0; return Promise.resolve(); }
  return api('/api/me/notifications').then(function (d) {
    state.notifUnread = d.unread || 0; renderChrome(current.name);
  }).catch(function () {});
}

/* ---------- trust badges ---------- */
function trustPills(d) {
  var p = [];
  var level = d.safetyLevel || d.safety;
  if (level === 'review') p.push('<span class="pill warn">⚠ 需要留意</span>');
  else if (level === 'block') p.push('<span class="pill warn">已拦截</span>');
  else p.push('<span class="pill ok">🛡 安全检测通过</span>');
  if (d.verified) p.push('<span class="pill ok">✓ 实测可用</span>');
  if (d.source === 'github' && d.creator && !d.creator.claimed) p.push('<span class="pill gh">来自 GitHub · 作者未入驻</span>');
  if (d.requires) p.push('<span class="pill warn">需要：' + esc(d.requires) + '</span>');
  if (d.version) p.push('<span class="pill">' + (d.source === 'github' ? '提交 ' : 'v') + esc(d.version) + '</span>');
  return '<div class="pills">' + p.join('') + '</div>';
}

/* ================= VIEWS ================= */

/* ---------- login ---------- */
var authRole = 'creator';
function viewLogin() {
  renderChrome('login');
  var demoBtns = CFG.demo
    ? '<div class="demoquick">' +
        '<button class="btn pink" data-act="demo" data-as="momo">以创作者 Momo画画中 体验</button>' +
        '<button class="btn lemon" data-act="demo" data-as="zhou">以用户 小周 体验</button>' +
      '</div>' : '';
  var catOpts = CATS.map(function (c) { return '<option value="' + attr(c) + '">' + esc(c) + '</option>'; }).join('');
  var html =
    '<div style="text-align:center;max-width:640px;margin:16px auto 0">' +
      '<h1 style="font-size:clamp(2rem,5vw,3.2rem);font-weight:800">你是来<span style="color:var(--pink)">分享</span>的，还是来<span style="background:var(--lemon);color:#17141C;border-radius:10px;padding:0 .15em">挖宝</span>的？</h1>' +
      '<p class="muted">创作者和用户都能发布 skill，随时可以切换。</p>' + demoBtns +
      '<div class="seg" role="tablist"><button data-authmode="signup" class="on">注册</button><button data-authmode="login">登录</button></div>' +
    '</div>' +
    '<div id="signupBox">' +
      '<div class="auth" style="margin-top:20px">' +
        '<button type="button" class="role c" data-role="creator" style="text-align:left;border:0;cursor:pointer;color:#fff" aria-pressed="true"><h2>我是创作者</h2><p>发布 skill，生成二维码放进视频，看谁在用、收粉丝打赏。</p></button>' +
        '<button type="button" class="role u" data-role="user" style="text-align:left;border:0;cursor:pointer;color:#17141C" aria-pressed="false"><h2>我是用户</h2><p>扫码装 skill，关注喜欢的博主，作者更新会通知你。</p></button>' +
      '</div>' +
      '<form id="signupForm" class="form" style="max-width:520px;margin:20px auto 0">' +
        '<div class="g2">' +
          '<div class="field"><label for="suName">昵称</label><input id="suName" class="input" required maxlength="40" placeholder="你的昵称"></div>' +
          '<div class="field"><label for="suHandle">用户名 (handle)</label><input id="suHandle" class="input" required pattern="[a-z0-9_]{3,20}" placeholder="3-20 位小写字母/数字/下划线"><span class="hint">用在你的主页链接里</span></div>' +
        '</div>' +
        '<div class="g2">' +
          '<div class="field"><label for="suPass">密码</label><input id="suPass" class="input" type="password" required minlength="8" placeholder="至少 8 位"></div>' +
          '<div class="field" id="platformField"><label for="suPlatform">主阵地（选填）</label><input id="suPlatform" class="input" placeholder="比如：B站 / 抖音 / 小红书"></div>' +
        '</div>' +
        '<div class="field"><label for="suBio">简介（选填）</label><input id="suBio" class="input" maxlength="80" placeholder="一句话介绍自己"></div>' +
        '<input type="hidden" id="suCat" value="">' +
        '<button class="btn pink block" style="height:50px">注册并开始</button>' +
      '</form>' +
    '</div>' +
    '<div id="loginBox" hidden>' +
      '<form id="loginForm" class="form" style="max-width:420px;margin:24px auto 0">' +
        '<div class="field"><label for="liHandle">用户名 (handle)</label><input id="liHandle" class="input" required placeholder="你的 handle"></div>' +
        '<div class="field"><label for="liPass">密码</label><input id="liPass" class="input" type="password" required placeholder="密码"></div>' +
        '<button class="btn dark block" style="height:50px">登录</button>' +
      '</form>' +
    '</div>' + (catOpts ? '' : '');
  setApp(html);
  bindLogin();
}
function bindLogin() {
  authRole = 'creator';
  $$('[data-authmode]').forEach(function (b) {
    b.onclick = function () {
      $$('[data-authmode]').forEach(function (x) { x.classList.toggle('on', x === b); });
      var mode = b.getAttribute('data-authmode');
      $('#signupBox').hidden = mode !== 'signup';
      $('#loginBox').hidden = mode !== 'login';
    };
  });
  $$('#signupBox [data-role]').forEach(function (b) {
    b.onclick = function () {
      authRole = b.getAttribute('data-role');
      $$('#signupBox [data-role]').forEach(function (x) {
        var on = x === b; x.style.outline = on ? '3px solid var(--ink)' : 'none'; x.style.outlineOffset = '2px';
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      $('#platformField').style.display = authRole === 'creator' ? '' : 'none';
    };
  });
  // default highlight
  var first = $('#signupBox [data-role="creator"]'); if (first) { first.style.outline = '3px solid var(--ink)'; first.style.outlineOffset = '2px'; }
  var sf = $('#signupForm');
  if (sf) sf.onsubmit = function (e) {
    e.preventDefault();
    var body = {
      name: $('#suName').value.trim(),
      handle: $('#suHandle').value.trim(),
      password: $('#suPass').value,
      role: authRole,
      platform: authRole === 'creator' ? $('#suPlatform').value.trim() : '',
      bio: $('#suBio').value.trim()
    };
    if (!/^[a-z0-9_]{3,20}$/.test(body.handle)) { toast('用户名需为 3-20 位小写字母、数字或下划线'); return; }
    if (body.password.length < 8) { toast('密码至少 8 位'); return; }
    submitBtn(sf, true);
    api('/api/auth/signup', { method: 'POST', body: body }).then(function (d) {
      afterAuth(d.me);
    }).catch(function (err) { submitBtn(sf, false); if (!err.handled) toast(err.message || '注册失败'); });
  };
  var lf = $('#loginForm');
  if (lf) lf.onsubmit = function (e) {
    e.preventDefault();
    var body = { handle: $('#liHandle').value.trim(), password: $('#liPass').value };
    submitBtn(lf, true);
    api('/api/auth/login', { method: 'POST', body: body }).then(function (d) {
      afterAuth(d.me);
    }).catch(function (err) { submitBtn(lf, false); if (!err.handled) toast(err.message || '登录失败'); });
  };
}
function submitBtn(form, busy) {
  var b = form.querySelector('button[type=submit],button:not([type])');
  if (!b) return;
  if (busy) { b.dataset._t = b.textContent; b.disabled = true; b.textContent = '请稍候…'; }
  else { b.disabled = false; if (b.dataset._t) b.textContent = b.dataset._t; }
}
function afterAuth(me) {
  state.me = me; toast('嗨，' + (me ? me.name : ''));
  refreshNotifBadge();
  var ret = pendingReturn; pendingReturn = null;
  if (ret && ret !== '#/login') go(ret);
  else go('#/');
}

/* ---------- home ---------- */
function viewHome() {
  renderChrome('home');
  setApp(
    '<section class="hero"><h1>把博主的 <mark>独门手艺</mark>，装进你的 AI</h1>' +
    '<p>剪辑、写歌、画画、做设计……刷到喜欢的 skill，扫个码就能用。不会代码也没关系。</p>' +
    '<form class="bigsearch" id="bigs"><input id="bq" placeholder="想做点什么？比如：vlog 脚本" value="' + attr(homeState.q) + '" aria-label="搜索 skill"><button class="btn pink">搜索</button></form>' +
    '<div class="hot">大家在搜 ' + ['配色', '字幕', '歌名', '小红书封面'].map(function (t) { return '<button data-act="hot" data-q="' + attr(t) + '">' + esc(t) + '</button>'; }).join('') + '</div></section>' +
    '<section style="margin-top:24px"><a class="finder" href="/get-finder"><b>让你的 AI 自己来这里找 skill</b><span class="muted" style="color:#17141C;opacity:.75">装一个 meta-skill，agent 就能搜索整个目录</span><span class="spacer"></span><span class="btn dark sm">去设置 →</span></a></section>' +
    '<div id="homebody">' + loadRow('正在加载首页…') + '</div>'
  );
  bindHeroSearch();
  api('/api/home').then(function (d) {
    homeState.data = d;
    renderHomeBody(d);
  }).catch(function (err) {
    if (err.handled) return;
    $('#homebody').innerHTML = errState(err);
  });
}
function renderHomeBody(d) {
  var collections = (d.collections || []).map(function (c, i) {
    return '<div class="coll" style="' + coverBg(i % PAL.length) + '"><b>' + esc(c.title) + '</b><span>' + esc(c.desc || '') + '</span>' +
      '<div class="stack">' + (c.skills || []).map(function (s) { return '<button data-href="' + skillHref(s.id) + '">' + esc(s.name) + '</button>'; }).join('') + '</div></div>';
  }).join('');
  var hot = (d.hot || []).slice(0, 6).map(function (s, i) {
    return '<div class="rk" data-href="' + skillHref(s.id) + '"><span class="n">' + (i + 1) + '</span>' + cover(s, 'mini') +
      '<div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.name) + '</b>' +
      '<span class="muted" style="font-size:13px">' + esc(creatorName(s)) + ' · ' + fmt(s.installs) + '</span></div></div>';
  }).join('');
  var cats = (d.categories && d.categories.length) ? d.categories : CATS.map(function (c) { return { cat: c, count: null }; });
  var chips = '<button class="chip ' + (homeState.cat === '全部' ? 'on' : '') + '" data-cat="全部">全部</button>' +
    cats.map(function (c) {
      return '<button class="chip ' + (homeState.cat === c.cat ? 'on' : '') + '" data-cat="' + attr(c.cat) + '">' + esc(c.cat) + (c.count != null ? ' ' + c.count : '') + '</button>';
    }).join('');
  var creators = (d.creators || []).map(function (a) {
    return '<div class="cr" data-href="' + creatorHref(a.handle) + '">' + ava(a.name, a.handle) +
      '<div><b>' + esc(a.name) + '</b><div class="muted" style="font-size:13px">' + esc(a.platform || ('@' + a.handle)) + (a.fans ? ' · ' + esc(a.fans) + ' 粉丝' : '') + '</div></div>' +
      '<p>' + esc(a.bio || '') + '</p><span class="tag">' + (a.skillCount || 0) + ' 个 skill</span></div>';
  }).join('');
  $('#homebody').innerHTML =
    (collections ? '<section><div class="sec-h"><h2>编辑精选专题</h2></div><div class="rail" style="grid-auto-columns:minmax(280px,1fr)">' + collections + '</div></section>' : '') +
    (hot ? '<section><div class="sec-h"><h2>本周热门</h2><button class="btn sm" data-href="#/rank">完整榜单 →</button></div><div class="rail">' + hot + '</div></section>' : '') +
    '<section id="feed"><div class="sec-h" style="flex-wrap:wrap"><h2 id="feedTitle">逛逛</h2></div>' +
    '<div class="chips" id="homeChips" style="margin-bottom:18px">' + chips + '</div>' +
    '<div id="feedGrid">' + grid(d.fresh && d.fresh.length ? d.fresh : d.hot) + '</div></section>' +
    (creators ? '<section><div class="sec-h"><h2>值得关注的博主</h2></div><div class="creators">' + creators + '</div></section>' : '');
  renderFeed();
}
var searchTimer = null;
function bindHeroSearch() {
  var bs = $('#bigs');
  if (bs) bs.onsubmit = function (e) { e.preventDefault(); homeState.q = $('#bq').value.trim(); homeState.cat = '全部'; renderFeed(); scrollFeed(); };
  var bq = $('#bq');
  if (bq) bq.oninput = function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { homeState.q = bq.value.trim(); homeState.cat = '全部'; renderFeed(); }, 300);
  };
}
function renderFeed() {
  var fg = $('#feedGrid'); if (!fg) return;
  var ft = $('#feedTitle');
  // sync chip highlight
  $$('#homeChips [data-cat]').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-cat') === homeState.cat); });
  var q = homeState.q, cat = homeState.cat;
  if (!q && cat === '全部') {
    if (ft) ft.textContent = '逛逛';
    var d = homeState.data || {};
    fg.innerHTML = grid(d.fresh && d.fresh.length ? d.fresh : d.hot);
    return;
  }
  if (ft) ft.innerHTML = q ? '「' + esc(q) + '」的结果' : esc(cat);
  fg.innerHTML = loadRow('搜索中…');
  var qs = '/api/skills/search?q=' + encodeURIComponent(q) + (cat && cat !== '全部' ? '&cat=' + encodeURIComponent(cat) : '') + '&limit=20';
  api(qs).then(function (r) {
    if (homeState.q !== q || homeState.cat !== cat) return; // stale
    fg.innerHTML = (r.results && r.results.length)
      ? grid(r.results)
      : '<div class="empty"><span class="e">没有找到匹配的 skill</span>换更宽的关键词（2-4 个字），或点别的分类看看' + (q || cat !== '全部' ? '<button class="btn" data-act="clearq">清除筛选 ×</button>' : '') + '</div>';
  }).catch(function (err) { if (!err.handled) fg.innerHTML = errState(err); });
}

/* ---------- rank ---------- */
function viewRank() {
  renderChrome('rank');
  var T = { hot: ['热门榜', '按使用人数'], new: ['新星榜', '最近上架、增长最快'], fav: ['收藏榜', '被收藏最多'], rating: ['好评榜', '评分最高'] };
  var tabs = Object.keys(T).map(function (k) { return '<button class="chip ' + (rankTab === k ? 'on' : '') + '" data-rank="' + k + '">' + T[k][0] + '</button>'; }).join('');
  setApp(
    '<h1 style="font-size:clamp(2rem,5vw,3.2rem);font-weight:800">榜单</h1>' +
    '<p class="muted" style="margin:4px 0 20px">覆盖剪辑、运营、画画、音乐和设计——每一类里最好用的 skill。</p>' +
    '<div class="chips" style="margin-bottom:12px">' + tabs + '</div>' +
    '<p class="muted" id="rankSub" style="margin:0 0 12px;font-size:13px">' + T[rankTab][1] + '</p>' +
    '<div id="rankList">' + loadRow() + '</div>'
  );
  api('/api/rank?type=' + encodeURIComponent(rankTab) + '&limit=50').then(function (r) {
    var items = r.items || [];
    $('#rankList').innerHTML = items.length ? '<div class="rlist">' + items.map(function (s, i) {
      return '<div class="rrow" data-href="' + skillHref(s.id) + '" tabindex="0" role="link"><span class="n ' + (i < 3 ? 'top' : '') + '">' + (i + 1) + '</span>' +
        cover(s, 'mini') + '<div style="min-width:0"><b>' + esc(s.name) + '</b>' + (s.pick ? ' <span class="tag pk">精选</span>' : '') +
        '<div class="muted rdesc">' + esc(s.desc) + '</div><div class="hint">' + esc(creatorName(s)) + ' · ' + esc(s.cat) + ' · ★ ' + (s.rating != null ? esc(s.rating) : '新') + '</div></div>' +
        '<div class="rnum"><b class="num">' + fmt(s.installs) + '</b><span class="hint">人在用 · ♥ ' + fmt(s.likes) + '</span></div></div>';
    }).join('') + '</div>' : '<div class="empty"><span class="e">暂无数据</span></div>';
  }).catch(function (err) { if (!err.handled) $('#rankList').innerHTML = errState(err); });
}

/* ---------- skill detail ---------- */
function installInner(d) {
  if (d.safetyLevel === 'block') return '';
  var tabs = '<div class="tabs2"><button data-itab="ai" class="' + (installTab === 'ai' ? 'on' : '') + '">发给 AI</button>' +
    '<button data-itab="zip" class="' + (installTab === 'zip' ? 'on' : '') + '">下载压缩包</button>' +
    '<button data-itab="cli" class="' + (installTab === 'cli' ? 'on' : '') + '">命令行</button></div>';
  var body;
  if (installTab === 'ai') {
    var sentence = '请帮我安装这个 skill：' + shareUrlFor(d.id);
    body = '<p style="margin:0;font-size:14px">最简单：把这句话发给你正在用的 AI（Claude、OpenClaw 等），它会自己装好。</p>' +
      '<div class="say"><code>' + esc(sentence) + '</code></div>' +
      '<button class="btn dark block" data-act="copytext" data-text="' + attr(sentence) + '">复制这句话</button>';
  } else if (installTab === 'zip') {
    if (d.zipUrl) {
      body = '<p style="margin:0;font-size:14px">下载后解压到 skills 目录，或在 Claude 设置 → Skills 里上传。</p>' +
        '<a class="btn pink block" href="' + attr(d.zipUrl) + '">下载 ' + esc(d.slug) + '.zip</a>';
    } else if (d.source === 'github') {
      body = '<p style="margin:0;font-size:14px">作者还没入驻，文件从 GitHub 下载。</p>' +
        (d.truncated && d.archiveUrl
          ? '<a class="btn pink block" href="' + attr(d.archiveUrl) + '">下载整包（' + (d.fileCount || '') + ' 个文件）</a>'
          : '') +
        '<a class="btn block" href="' + attr(d.sourceUrl || '') + '" target="_blank" rel="noopener">在 GitHub 查看</a>';
    } else {
      body = '<p class="muted" style="margin:0">这个 skill 暂时没有压缩包，用命令行方式安装。</p>';
    }
  } else {
    var dir = '~/.claude/skills/' + d.slug;
    var lines = [];
    if (d.truncated && d.archiveUrl) {
      lines.push('mkdir -p ' + dir, 'curl -fL -o skill.zip "' + d.archiveUrl + '"', 'unzip -q skill.zip', 'cp -r "' + (d.archiveRoot || d.slug) + '/." ' + dir + '/');
    } else {
      (d.fileUrls || []).forEach(function (f) { lines.push('curl -fL -o ' + dir + '/' + f.path + ' "' + f.url + '"'); });
    }
    var cmd = lines.join('\n');
    body = '<p style="margin:0;font-size:14px">适合 Claude Code / Codex / Cursor 用户（其他客户端改一下目录即可）。</p>' +
      '<div class="cmd"><code>' + esc(cmd) + '</code></div>' +
      '<button class="btn dark block" data-act="copytext" data-text="' + attr(cmd) + '">复制命令</button>';
  }
  return '<b style="font-family:var(--f-display);font-size:18px">安装 · 三种方式</b>' + tabs + '<div style="display:grid;gap:12px">' + body + '</div>';
}
function sideTipBox(d) {
  if (d.canTip) {
    return '<div class="sheet"><b>好用的话，请作者喝一杯 ☕</b>' +
      '<div class="tipgrid">' + [[6, '奶茶'], [18, '咖啡'], [50, '饭钱']].map(function (a) {
        return '<button data-act="tip" data-id="' + attr(d.id) + '" data-amt="' + a[0] + '">' + yuan(a[0]) + '<small>' + a[1] + '</small></button>';
      }).join('') + '</div>' +
      '<button class="btn block" data-act="tip" data-id="' + attr(d.id) + '" data-amt="0">自定义金额</button></div>';
  }
  if (d.source === 'github' && d.creator && !d.creator.claimed) {
    return '<div class="sheet"><b>作者还没入驻，暂时不能打赏</b>' +
      (state.me ? '<p class="hint" style="margin:0">如果你是作者，可以认领它，认领后就能收到粉丝打赏。</p>' +
        '<button class="btn pink block" data-act="claim" data-id="' + attr(d.id) + '">我是作者，认领</button>'
        : '<p class="hint" style="margin:0">你是作者？<a href="#/login" style="font-weight:700">登录</a>后即可认领。</p>') + '</div>';
  }
  return '';
}
function viewSkill(r) {
  renderChrome('skill');
  setApp('<p style="margin:0 0 16px"><button class="btn sm" data-act="back">← 返回</button></p>' + loadRow('加载 skill…'));
  api('/api/skills/' + encodeURIComponent(r.arg)).then(function (d) {
    curDetail = d;
    renderSkill(d, r.query);
  }).catch(function (err) {
    if (err.handled) return;
    setApp('<p style="margin:0 0 16px"><button class="btn sm" data-href="#/">← 返回首页</button></p>' + errState(err));
  });
}
function renderSkill(d, query) {
  var me = state.me;
  var isOwner = me && d.creator && me.handle === d.creator.handle;
  var examples = (d.examples || []).map(function (e) {
    return '<div class="ba"><div class="b4"><span class="lbl">你说</span><div style="white-space:pre-wrap">' + esc(e.you) + '</div></div>' +
      '<div class="af"><span class="lbl">它回</span><div style="white-space:pre-wrap">' + esc(e.ai) + '</div></div></div>';
  }).join('');
  var findings = (d.safetyFindings || []).map(function (f) {
    var sev = { block: '拦截', review: '留意' }[f.severity] || f.severity;
    return '<li><span class="sev">[' + esc(sev) + ']</span>' + esc(f.label) + (f.file ? ' <span class="muted">（' + esc(f.file) + (f.line ? ':' + esc(f.line) : '') + '）</span>' : '') + '</li>';
  }).join('');
  var reviews = (d.reviews || []).map(function (rv) {
    return '<div class="rv"><b>' + esc(rv.name) + '</b><span class="stars">' + '★'.repeat(rv.rating) + '☆'.repeat(5 - rv.rating) + '</span><div>' + esc(rv.text) + '</div></div>';
  }).join('') || '<span class="muted">还没有评价，用过之后来说两句吧</span>';
  var reviewForm = (me && !isOwner)
    ? '<form id="rvForm" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><select id="rvStar" class="input" style="width:auto" aria-label="评分"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select><input id="rvText" class="input" style="flex:1;min-width:160px" placeholder="用起来怎么样？" required aria-label="评价"><button class="btn dark">发布</button></form>'
    : '';
  var versions = (d.versions || []).map(function (v) {
    return '<div><b>v' + esc(v.v) + '</b><span class="muted">' + esc(v.date) + '</span><span>' + esc(v.note || '') + '</span></div>';
  }).join('') || '<div class="muted">暂无更新记录</div>';
  var following = d.creatorFull && d.creatorFull.following;
  var cn = (d.creator && d.creator.name) || '匿名';
  var ch = d.creator && d.creator.handle;
  var liked = d.liked === true;
  var inLib = d.inLibrary === true;

  var installSheet = (d.safetyLevel === 'block')
    ? '<div class="sheet"><b style="font-family:var(--f-display);font-size:18px">无法安装</b>' +
      '<p style="margin:0;font-size:14px">这个 skill 没有通过安全检测，已被拦截，不提供任何安装方式。</p>' +
      (findings ? '<ul class="findings">' + findings + '</ul>' : '') +
      '<p class="hint" style="margin:0">如果你是作者：去掉相关内容后重新提交即可重新检测。</p></div>'
    : '<div class="sheet" id="installbox">' + installInner(d) + '</div>';

  var left =
    cover(d, 'cover bigcover') +
    '<div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span class="tag">' + esc(d.cat) + '</span><span class="tag free">免费使用</span></div>' +
    '<h1 style="font-size:clamp(2rem,4.5vw,3rem);font-weight:800">' + esc(d.name) + '</h1>' +
    '<p style="font-size:17px;margin:8px 0 0">' + esc(d.desc) + '</p>' + trustPills(d) +
    (d.video ? '<div class="muted" style="margin-top:8px">🎬 ' + esc(d.video.platform || '') + (d.video.title ? '《' + esc(d.video.title) + '》' : '') + '</div>' : '') + '</div>' +
    '<div class="sheet" style="grid-template-columns:auto 1fr auto;align-items:center">' + ava(cn, ch) +
    '<div style="min-width:0"><b>' + esc(cn) + '</b><div class="muted" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    (d.creatorFull && d.creatorFull.bio ? esc(d.creatorFull.bio) : '@' + esc(ch || '')) + '</div></div>' +
    '<div style="display:flex;gap:8px">' + (me && !isOwner && ch ? '<button class="btn sm ' + (following ? '' : 'pink') + '" data-act="follow" data-handle="' + attr(ch) + '">' + (following ? '已关注' : '+ 关注') + '</button>' : '') +
    (ch ? '<button class="btn sm" data-href="' + creatorHref(ch) + '">主页</button>' : '') + '</div></div>' +
    (examples ? '<div><h2 style="font-size:22px;margin-bottom:12px">效果展示</h2><div class="exlist">' + examples + '</div></div>' : '') +
    ((d.safetyLevel === 'review' && findings) ? '<div><h2 style="font-size:22px;margin-bottom:12px">安全检测 · 需要留意</h2><ul class="findings">' + findings + '</ul></div>' : '') +
    '<div><h2 style="font-size:22px;margin-bottom:12px">大家怎么说 <span class="muted" style="font-size:16px">★ ' + (d.rating != null ? esc(d.rating) : '新') + (d.ratingCount ? '（' + esc(d.ratingCount) + '）' : '') + '</span></h2>' +
    '<div class="sheet" style="gap:4px">' + reviews + reviewForm + '</div></div>' +
    '<div><h2 style="font-size:22px;margin-bottom:12px">更新记录</h2><div class="sheet vlist">' + versions + '</div></div>';

  var aside =
    installSheet +
    '<div class="sheet"><div class="kv">' +
    '<div><b class="num">' + fmt(d.installs) + '</b><span>人在用</span></div>' +
    '<div><b class="num">' + fmt(d.likes) + '</b><span>收藏</span></div>' +
    '<div><b>' + (d.version ? (d.source === 'github' ? '' : 'v') + esc(d.version) : '—') + '</b><span>最新</span></div></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    '<button class="btn ' + (liked ? 'pink' : '') + '" data-act="like" data-id="' + attr(d.id) + '" aria-pressed="' + (liked ? 'true' : 'false') + '">' + I.heart + ' <span class="lk-label">' + (liked ? '已喜欢' : '喜欢') + '</span></button>' +
    '<button class="btn" data-act="share" data-id="' + attr(d.id) + '">分享二维码</button></div>' +
    '<button class="btn block ' + (inLib ? 'dark' : '') + '" data-act="lib" data-id="' + attr(d.id) + '"><span class="lib-label">' + (inLib ? '已收藏到「我的」' : '收藏到「我的」') + '</span></button></div>' +
    sideTipBox(d);

  setApp('<p style="margin:0 0 16px"><button class="btn sm" data-act="back">← 返回</button></p>' +
    '<div class="detail"><div style="min-width:0;display:grid;gap:24px">' + left + '</div><aside class="sticky">' + aside + '</aside></div>');

  bindSkill(d);
  if (query && query.tip && d.canTip) openTip(d);
}
function bindSkill(d) {
  var rv = $('#rvForm');
  if (rv) rv.onsubmit = function (e) {
    e.preventDefault();
    var text = $('#rvText').value.trim(); if (!text) return;
    var rating = Number($('#rvStar').value);
    submitBtn(rv, true);
    api('/api/skills/' + encodeURIComponent(d.id) + '/reviews', { method: 'POST', body: { rating: rating, text: text } })
      .then(function () { toast('评价已发布'); reload(); })
      .catch(function (err) { submitBtn(rv, false); if (!err.handled) toast(err.message || '发布失败'); });
  };
}

/* ---------- creator profile ---------- */
function viewCreator(r) {
  renderChrome('creator');
  setApp('<p style="margin:0 0 16px"><button class="btn sm" data-act="back">← 返回</button></p>' + loadRow());
  api('/api/creators/' + encodeURIComponent(r.arg)).then(function (res) {
    var a = res.creator, list = res.skills || [];
    var p = hashCode(a.handle) % PAL.length;
    var me = state.me, isSelf = me && me.handle === a.handle;
    var installs = list.reduce(function (n, s) { return n + (s.installs || 0); }, 0);
    var html =
      '<p style="margin:0 0 16px"><button class="btn sm" data-act="back">← 返回</button></p>' +
      '<div class="banner" style="' + coverBg(p) + '"><span class="blob" style="position:absolute;border-radius:50%;width:300px;height:300px;right:-60px;top:-120px;background:#fff;opacity:.18"></span></div>' +
      '<div class="prof">' + ava(a.name, a.handle, 'xl') +
      '<div style="flex:1;min-width:200px"><h1 style="font-weight:800">' + esc(a.name) + '</h1>' +
      '<div class="muted">@' + esc(a.handle) + (a.platform ? ' · ' + esc(a.platform) + (a.fans ? ' ' + esc(a.fans) + ' 粉丝' : '') : '') + '</div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (me && !isSelf ? '<button class="btn ' + (a.following ? '' : 'pink') + '" data-act="follow" data-handle="' + attr(a.handle) + '">' + (a.following ? '已关注' : '+ 关注') + '</button>' : '') +
      '<button class="btn dark" data-act="sharecreator" data-handle="' + attr(a.handle) + '">主页二维码</button></div></div>' +
      '<div style="padding-inline:24px;margin-top:14px"><p style="margin:0;max-width:60ch">' + esc(a.bio || '') + '</p>' +
      '<div class="stats"><span><b class="num">' + (a.skillCount != null ? a.skillCount : list.length) + '</b><span class="muted">skill</span></span>' +
      '<span><b class="num">' + fmt(installs) + '</b><span class="muted">人在用</span></span>' +
      '<span><b class="num">' + fmt(a.followers || 0) + '</b><span class="muted">站内粉丝</span></span></div></div>' +
      '<section style="margin-top:32px">' + (list.length ? grid(list) : '<div class="empty"><span class="e">还没有发布 skill</span>' + (isSelf ? '<button class="btn pink" data-href="#/upload">发布第一个</button>' : '') + '</div>') + '</section>';
    setApp(html);
  }).catch(function (err) {
    if (err.handled) return;
    setApp('<p style="margin:0 0 16px"><button class="btn sm" data-href="#/">← 返回首页</button></p>' + errState(err));
  });
}

/* ---------- dashboard ---------- */
function viewDash() {
  renderChrome('dash');
  setApp(loadRow('加载后台…'));
  api('/api/me/dashboard').then(function (d) {
    var skills = d.skills || [], totals = d.totals || {};
    if (!skills.length) {
      setApp('<div class="empty" style="margin-top:40px"><span class="e">你还没有发布 skill</span>把你的创作流程做成一个 skill，粉丝扫码就能用。<button class="btn pink" data-href="#/upload">去发布</button></div>');
      return;
    }
    var tips = totals.tips || {};
    var demoBadge = totals.demoData ? ' <span class="badge-demo">含演示数据</span>' : '';
    var tiles =
      '<div class="tile"><span class="muted">总安装</span><b>' + fmt(totals.installs) + '</b><small>累计</small></div>' +
      '<div class="tile"><span class="muted">近 7 天安装</span><b>' + fmt(totals.installs7d) + '</b><small>本周新增</small></div>' +
      '<div class="tile"><span class="muted">打赏收入（已扣服务费）</span><b>' + yuan(tips.net || 0) + '</b><small>累计净收入</small></div>' +
      '<div class="tile"><span class="muted">打赏人数</span><b>' + fmt(tips.tippers || 0) + '</b><small>' + (tips.count || 0) + ' 次打赏</small></div>';
    // 30-day chart from daily
    var daily = d.daily || [], w = 600, h = 120;
    var vals = daily.map(function (x) { return x.installs || 0; });
    var pm = Math.max.apply(null, [1].concat(vals));
    var pts = vals.map(function (v, i) { return [(i / Math.max(1, vals.length - 1) * w), (h - 8 - v / pm * (h - 24))]; });
    var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var chartSvg = vals.length
      ? '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="近30天安装趋势"><defs><linearGradient id="gf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF4D8D" stop-opacity=".28"/><stop offset="1" stop-color="#FF4D8D" stop-opacity="0"/></linearGradient></defs>' +
        '<polygon points="0,' + (h - 8) + ' ' + line + ' ' + w + ',' + (h - 8) + '" fill="url(#gf)"/>' +
        '<polyline points="' + line + '" fill="none" stroke="#FF4D8D" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>'
      : '<p class="muted">暂无数据</p>';
    // bars
    var refs = (d.byRef || []).map(function (x) { return { l: x.ref, v: x.n }; });
    var refMax = Math.max.apply(null, [1].concat(refs.map(function (x) { return x.v; })));
    var refBars = refs.length ? refs.map(function (x, i) {
      return '<div class="bar"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.l) + '</span><div class="track"><div class="fill ' + (i === 0 ? 'hot' : '') + '" style="width:' + (x.v / refMax * 100) + '%"></div></div><span class="num" style="text-align:right">' + fmt(x.v) + '</span></div>';
    }).join('') : '<span class="muted">发布 skill 后这里会显示来源</span>';
    var clients = (d.byClient || []).map(function (x) { return '<span class="tag">' + esc(x.client) + ' · ' + fmt(x.n) + '</span>'; }).join('') || '<span class="muted">暂无数据</span>';
    // my skills with push form
    var skillOpts = skills.map(function (s) { return '<option value="' + attr(s.id) + '">' + esc(s.name) + ' · v' + esc(s.version || '1.0') + '</option>'; }).join('');
    var recentTips = (d.recentTips || []).map(function (t) {
      return '<div class="tiprow">' + ava(t.from, t.from) + '<div style="min-width:0"><b>' + esc(t.from) + '</b>' + (t.demo ? ' <span class="badge-demo">演示</span>' : '') + '<div class="hint">' + esc(t.skillName) + ' · ' + esc(t.ts || '') + '</div></div><span class="amt">' + yuan(t.net) + '</span></div>';
    }).join('') || '<span class="muted">还没有收到打赏</span>';

    setApp(
      '<div class="sec-h" style="margin-bottom:20px"><div><h1 style="font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800">嗨，' + esc(state.me.name) + ' 👋' + demoBadge + '</h1>' +
      '<p class="muted" style="margin:4px 0 0">近 7 天又有 ' + fmt(totals.installs7d) + ' 次安装</p></div><button class="btn pink" data-href="#/upload">发布新 skill</button></div>' +
      '<section class="tiles">' + tiles + '</section>' +
      '<section class="two" style="margin-top:20px"><div class="chart"><b>近 30 天新增安装</b>' + chartSvg +
      '<b style="display:block;margin:18px 0 12px">来自哪个视频</b><div class="bars">' + refBars + '</div>' +
      '<b style="display:block;margin:18px 0 10px">粉丝用什么 AI</b><div class="pills">' + clients + '</div></div>' +
      '<div class="sheet" style="align-self:start"><b style="font-family:var(--f-display);font-size:20px">推送更新</b>' +
      '<p class="hint" style="margin:0">上传新版本文件 + 说明，关注你的人和把它收藏进「我的」的人都会收到通知。</p>' +
      '<form id="pushForm" class="form" style="gap:12px"><div class="field"><label for="pushSkill">哪个 skill</label><select id="pushSkill" class="input">' + skillOpts + '</select></div>' +
      '<div class="field"><label for="pushNote">这次更新了什么</label><input id="pushNote" class="input" placeholder="比如：新增抖音竖屏模板" required></div>' +
      '<div class="drop" id="pushDrop" style="padding:20px"><div style="font-weight:700">把新版本文件夹 / .zip 拖进来</div><p class="hint" style="margin:6px 0 10px">或点下面选择</p>' +
      '<input type="file" id="pushFiles" multiple webkitdirectory hidden><input type="file" id="pushZip" accept=".zip" hidden>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn sm dark" id="pushPickDir">选择文件夹</button><button type="button" class="btn sm" id="pushPickZip">选择 .zip</button></div>' +
      '<p class="hint" id="pushFileInfo" style="margin:10px 0 0"></p></div>' +
      '<button class="btn pink block">发布并通知</button></form></div></section>' +
      '<section><div class="sec-h"><h2>我的 skill</h2></div>' + grid(skills) + '</section>' +
      '<section><div class="sec-h"><h2>最近打赏</h2></div><div class="tiplist">' + recentTips + '</div></section>'
    );
    bindDash();
  }).catch(function (err) {
    if (err.handled) return;
    setApp(errState(err));
  });
}
function bindDash() {
  var pushFiles = [];
  var info = $('#pushFileInfo');
  var drop = $('#pushDrop');
  function setInfo() { if (info) info.textContent = pushFiles.length ? ('已读取 ' + pushFiles.length + ' 个文件') : ''; }
  function take(fileList, items) {
    collectInput(fileList, items).then(function (files) {
      pushFiles = files; setInfo();
      if (!files.length) toast('没有读到文件');
    }).catch(function (e) { toast(e.message || '读取失败'); });
  }
  $('#pushPickDir').onclick = function () { $('#pushFiles').click(); };
  $('#pushPickZip').onclick = function () { $('#pushZip').click(); };
  $('#pushFiles').onchange = function (e) { take(e.target.files, null); };
  $('#pushZip').onchange = function (e) { take(e.target.files, null); };
  if (drop) {
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = function () { drop.classList.remove('over'); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files, e.dataTransfer.items); };
  }
  var pf = $('#pushForm');
  pf.onsubmit = function (e) {
    e.preventDefault();
    var id = $('#pushSkill').value, note = $('#pushNote').value.trim();
    if (!note) { toast('写一句更新说明吧'); return; }
    if (!pushFiles.length) { toast('请选择新版本的文件'); return; }
    submitBtn(pf, true);
    api('/api/skills/' + encodeURIComponent(id) + '/versions', { method: 'POST', body: { files: pushFiles, note: note } })
      .then(function () { toast('新版本已发布，已通知关注者'); go('#/dash'); })
      .catch(function (err) { submitBtn(pf, false); if (!err.handled) toast(err.message || '发布失败'); });
  };
}

/* ---------- library ---------- */
function viewLibrary() {
  renderChrome('library');
  setApp('<h1 style="font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800;margin-bottom:20px">我的</h1>' + loadRow());
  Promise.all([
    api('/api/me/library').catch(function (e) { if (e.handled) throw e; return { items: [] }; }),
    api('/api/me/skills').catch(function () { return { items: [] }; })
  ]).then(function (res) {
    var saved = res[0].items || [], mine = res[1].items || [];
    var upd = saved.filter(function (s) { return s.hasUpdate; });
    var updBanner = upd.length
      ? '<div class="banner-up"><b style="font-size:17px">🎉 ' + upd.length + ' 个 skill 有新版本</b>' +
        upd.map(function (s) { return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px"><b>' + esc(s.name) + '</b><span>当前 v' + esc(s.version || '') + '</span><span class="spacer"></span><button class="btn sm dark" data-href="' + skillHref(s.id) + '">去看看</button></div>'; }).join('') + '</div>'
      : '';
    setApp(
      '<h1 style="font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800;margin-bottom:20px">我的</h1>' + updBanner +
      '<section style="margin-top:' + (updBanner ? '28px' : '0') + '"><div class="sec-h"><h2>收藏的 · ' + saved.length + '</h2></div>' +
      (saved.length ? '<div class="grid">' + saved.map(function (s) { return card(s, { update: s.hasUpdate }); }).join('') + '</div>'
        : '<div class="empty"><span class="e">还没有收藏 skill</span>去发现页逛逛，或扫博主视频里的二维码<button class="btn pink" data-href="#/">去逛逛</button></div>') + '</section>' +
      '<section><div class="sec-h"><h2>我发布的 · ' + mine.length + '</h2><button class="btn sm" data-href="#/upload">+ 发布</button></div>' +
      (mine.length ? grid(mine) : '<div class="empty"><span class="e">你也可以分享自己的 skill</span>不管是创作者还是用户，都能发布<button class="btn dark" data-href="#/upload">发布 skill</button></div>') + '</section>'
    );
  }).catch(function (err) { if (err.handled) return; setApp('<h1 style="font-weight:800;margin-bottom:20px">我的</h1>' + errState(err)); });
}

/* ---------- upload ---------- */
var TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|rb|go|rs|java|c|h|cpp|css|html?|xml|csv|toml|ini|env|gitignore)$/i;
var IMG_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;
var MAX_FILES = 60, MAX_TOTAL = 2 * 1024 * 1024, MAX_ONE = 500 * 1024;

var draft = { name: '', slug: '', desc: '', cat: '', tags: '', vPlatform: '', vTitle: '', vUrl: '', exYou: '', exAi: '', md: '', files: [] };
function viewUpload() {
  renderChrome('upload');
  if (!draft.cat) draft.cat = CATS[0];
  renderUpload(null);
}
function renderUpload(findings) {
  var p = Math.max(0, CATS.indexOf(draft.cat)) % PAL.length;
  var prev = { id: 's0', pal: p, glyph: (draft.name || '新').slice(0, 2), name: draft.name || '你的 skill 名字', desc: draft.desc || '一句话介绍会显示在这里', installs: 0, likes: 0, rating: null, cat: draft.cat, creator: { name: state.me ? state.me.name : '你', handle: state.me ? state.me.handle : 'me', claimed: true }, source: 'skillnet', liked: null, version: '1.0', pick: false };
  var findHtml = findings && findings.length
    ? '<div class="sheet" style="border:2px solid var(--pink)"><b style="color:var(--pink)">没有通过安全检测，请修改后重试</b><ul class="findings">' +
      findings.map(function (f) {
        var sev = { block: '拦截', review: '留意' }[f.severity] || f.severity;
        return '<li><span class="sev">[' + esc(sev) + ']</span>' + esc(f.label) + (f.file ? ' <span class="muted">（' + esc(f.file) + (f.line ? ':' + esc(f.line) : '') + '）</span>' : '') + '</li>';
      }).join('') + '</ul></div>'
    : '';
  setApp(
    '<h1 style="font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800">发布 skill</h1>' +
    '<p class="muted" style="margin:6px 0 24px">拖进来，填几项，拿走二维码。一个 skill 就是一个带 SKILL.md 的文件夹。</p>' + findHtml +
    '<div class="upwrap"><form id="upForm" class="form">' +
    '<div class="drop" id="drop"><div class="big">把 skill 文件夹拖到这里</div><p class="muted" style="margin:6px 0 14px">支持文件夹、单个 SKILL.md 或 .zip；我们会自动读取名字和介绍</p>' +
    '<input type="file" id="fileIn" multiple webkitdirectory hidden><input type="file" id="mdIn" accept=".md,text/markdown" hidden><input type="file" id="zipIn" accept=".zip" hidden>' +
    '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="btn dark sm" id="pickDir">选择文件夹</button><button type="button" class="btn sm" id="pickMd">只传 SKILL.md</button><button type="button" class="btn sm" id="pickZip">上传 .zip</button></div>' +
    '<p class="hint" id="fileInfo" style="margin:12px 0 0">' + (draft.files.length ? ('已读取 ' + draft.files.length + ' 个文件') : '') + '</p></div>' +
    '<div class="field"><label>分类</label><div class="cats">' + CATS.map(function (c) { return '<button type="button" class="chip ' + (draft.cat === c ? 'on' : '') + '" data-pcat="' + attr(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
    '<div class="g2"><div class="field"><label for="fName">名字</label><input id="fName" class="input" required value="' + attr(draft.name) + '" placeholder="比如：小红书爆款封面"></div>' +
    '<div class="field"><label for="fSlug">英文短名 (slug)</label><input id="fSlug" class="input" required pattern="[a-z0-9-]{1,64}" value="' + attr(draft.slug) + '" placeholder="xhs-cover"><span class="hint">写进 SKILL.md，小写字母、数字、横线</span></div></div>' +
    '<div class="field"><label for="fDesc">一句话介绍</label><input id="fDesc" class="input" required value="' + attr(draft.desc) + '" placeholder="它能帮粉丝做什么"></div>' +
    '<div class="field"><label for="fTags">标签（逗号分隔，选填）</label><input id="fTags" class="input" value="' + attr(draft.tags) + '" placeholder="封面, 小红书, 排版"></div>' +
    '<div class="field"><label>来自哪个视频（选填）</label><div class="g3">' +
    '<input id="fvPlatform" class="input" value="' + attr(draft.vPlatform) + '" placeholder="平台 B站/抖音">' +
    '<input id="fvTitle" class="input" value="' + attr(draft.vTitle) + '" placeholder="视频标题">' +
    '<input id="fvUrl" class="input" value="' + attr(draft.vUrl) + '" placeholder="链接（选填）"></div><span class="hint">用来统计粉丝从哪个视频来</span></div>' +
    '<div class="field"><label>示例（选填）</label><div class="g2">' +
    '<input id="fexYou" class="input" value="' + attr(draft.exYou) + '" placeholder="你说：周末想拍 vlog">' +
    '<input id="fexAi" class="input" value="' + attr(draft.exAi) + '" placeholder="它回：给你一份分镜脚本…"></div></div>' +
    '<div class="field"><label>收入</label><div class="say" style="font-size:13px">所有 skill 都免费使用。粉丝觉得好用，可以在 skill 页面给你打赏（¥6 / ¥18 / ¥50 或自定义），平台收 10% 服务费。</div></div>' +
    '<details' + (draft.md ? ' open' : '') + '><summary style="cursor:pointer;font-weight:600">查看 / 编辑 SKILL.md' + (draft.files.length ? '' : '（没有上传文件时，用这里的内容生成）') + '</summary><div class="field" style="margin-top:10px"><textarea id="fMd" class="input" placeholder="---&#10;name: xhs-cover&#10;description: 一句话介绍&#10;---&#10;&#10;# 使用说明">' + esc(draft.md) + '</textarea></div></details>' +
    '<button class="btn pink" style="height:52px;font-size:16px">发布并生成二维码</button>' +
    '</form>' +
    '<aside class="sticky"><p class="hint" style="margin:0 0 8px;font-weight:600">预览</p><div style="pointer-events:none">' + card(prev) + '</div></aside></div>'
  );
  bindUpload();
}
function keepDraft() {
  draft.name = valOf('fName'); draft.slug = valOf('fSlug'); draft.desc = valOf('fDesc');
  draft.tags = valOf('fTags'); draft.vPlatform = valOf('fvPlatform'); draft.vTitle = valOf('fvTitle'); draft.vUrl = valOf('fvUrl');
  draft.exYou = valOf('fexYou'); draft.exAi = valOf('fexAi'); draft.md = valOf('fMd');
}
function valOf(id) { var el = $('#' + id); return el ? el.value : ''; }
function bindUpload() {
  ['fName', 'fDesc'].forEach(function (id) { var el = $('#' + id); if (el) el.addEventListener('change', function () { keepDraft(); renderUpload(null); }); });
  ['fSlug', 'fTags', 'fvPlatform', 'fvTitle', 'fvUrl', 'fexYou', 'fexAi', 'fMd'].forEach(function (id) { var el = $('#' + id); if (el) el.addEventListener('input', keepDraft); });
  $$('[data-pcat]').forEach(function (b) { b.onclick = function () { keepDraft(); draft.cat = b.getAttribute('data-pcat'); renderUpload(null); }; });
  $('#pickDir').onclick = function () { $('#fileIn').click(); };
  $('#pickMd').onclick = function () { $('#mdIn').click(); };
  $('#pickZip').onclick = function () { $('#zipIn').click(); };
  function take(fileList, items) {
    keepDraft();
    collectInput(fileList, items).then(function (files) {
      if (!files.length) { toast('没有读到文件'); return; }
      draft.files = files;
      var md = files.filter(function (f) { return /(^|\/)SKILL\.md$/i.test(f.path); })[0] || files.filter(function (f) { return /\.md$/i.test(f.path); })[0];
      if (md && md.encoding === 'utf8') { draft.md = md.content; parseFrontmatter(md.content); toast('读取成功 ✓'); }
      else { toast('已读取文件（没找到 SKILL.md，可在下方填写）'); }
      renderUpload(null);
    }).catch(function (e) { toast(e.message || '读取失败'); });
  }
  $('#fileIn').onchange = function (e) { take(e.target.files, null); };
  $('#mdIn').onchange = function (e) { take(e.target.files, null); };
  $('#zipIn').onchange = function (e) { take(e.target.files, null); };
  var d = $('#drop');
  d.ondragover = function (e) { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = function () { d.classList.remove('over'); };
  d.ondrop = function (e) { e.preventDefault(); d.classList.remove('over'); take(e.dataTransfer.files, e.dataTransfer.items); };
  var form = $('#upForm');
  form.onsubmit = function (e) {
    e.preventDefault();
    keepDraft();
    if (!draft.name) { toast('给 skill 起个名字'); return; }
    if (!/^[a-z0-9-]{1,64}$/.test(draft.slug)) { toast('英文短名需为小写字母、数字和横线'); return; }
    if (!draft.desc) { toast('写一句介绍'); return; }
    var files = draft.files.slice();
    var hasMd = files.some(function (f) { return /(^|\/)SKILL\.md$/i.test(f.path); });
    if (!hasMd) {
      var md = draft.md && /^---/.test(draft.md.trim()) ? draft.md
        : '---\nname: ' + draft.slug + '\ndescription: ' + draft.desc.replace(/\n/g, ' ') + '\n---\n\n# ' + draft.name + '\n\n' + (draft.md || draft.desc) + '\n';
      files.unshift({ path: 'SKILL.md', content: md, encoding: 'utf8' });
    }
    if (files.length > MAX_FILES) { toast('文件太多（最多 ' + MAX_FILES + ' 个）'); return; }
    var meta = { name: draft.name, cat: draft.cat, desc: draft.desc, glyph: draft.name.slice(0, 2) };
    var tags = draft.tags.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (tags.length) meta.tags = tags;
    if (draft.vTitle || draft.vUrl) meta.video = { platform: draft.vPlatform, title: draft.vTitle, url: draft.vUrl };
    if (draft.exYou && draft.exAi) meta.examples = [{ you: draft.exYou, ai: draft.exAi }];
    submitBtn(form, true);
    api('/api/skills', { method: 'POST', body: { meta: meta, files: files } }).then(function (res) {
      var sk = res.skill;
      draft = { name: '', slug: '', desc: '', cat: CATS[0], tags: '', vPlatform: '', vTitle: '', vUrl: '', exYou: '', exAi: '', md: '', files: [] };
      openShareSkill(sk);
      go(skillHref(sk.id));
    }).catch(function (err) {
      submitBtn(form, false);
      if (err.handled) return;
      if (err.error === 'safety_block') { renderUpload(err.findings || []); toast('没有通过安全检测，请看上方提示'); window.scrollTo(0, 0); return; }
      toast(err.message || '发布失败');
    });
  };
}
function parseFrontmatter(text) {
  var fm = String(text).match(/^---\s*([\s\S]*?)\s*---/);
  if (!fm) return;
  var name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1];
  var desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1];
  if (name) { draft.slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64); if (!draft.name) draft.name = name.trim(); }
  if (desc && !draft.desc) draft.desc = desc.trim().replace(/^["']|["']$/g, '');
}

/* ---------- file collection (folder / zip / single) -> [{path,content,encoding}] ---------- */
function collectInput(fileList, items) {
  // Drag-drop with directory entries
  if (items && items.length && items[0].webkitGetAsEntry) {
    var entries = [];
    for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) entries.push(en); }
    if (entries.length) return walkEntries(entries).then(readAll);
  }
  var arr = fileList ? Array.prototype.slice.call(fileList) : [];
  // single .zip
  if (arr.length === 1 && /\.zip$/i.test(arr[0].name)) return readZip(arr[0]);
  return readAll(arr.map(function (f) { return { path: f.webkitRelativePath || f.name, file: f }; }));
}
function walkEntries(entries) {
  var out = [];
  function walk(entry, prefix) {
    return new Promise(function (resolve) {
      if (entry.isFile) {
        entry.file(function (f) { out.push({ path: (prefix ? prefix + '/' : '') + entry.name, file: f }); resolve(); }, function () { resolve(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader(); var all = [];
        (function more() {
          reader.readEntries(function (ents) {
            if (!ents.length) {
              Promise.all(all.map(function (e) { return walk(e, (prefix ? prefix + '/' : '') + entry.name); })).then(resolve);
            } else { all = all.concat(Array.prototype.slice.call(ents)); more(); }
          }, function () { resolve(); });
        })();
      } else resolve();
    });
  }
  return Promise.all(entries.map(function (e) { return walk(e, ''); })).then(function () { return out; });
}
function readAll(list) {
  list = stripCommonRoot(list);
  return Promise.all(list.map(function (item) {
    return new Promise(function (resolve, reject) {
      var f = item.file, path = item.path;
      if (f.size > MAX_ONE) return reject({ message: '文件过大：' + path + '（单个不超过 500KB）' });
      var reader = new FileReader();
      if (IMG_EXT.test(path)) {
        reader.onload = function () { var s = String(reader.result); var b = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s; resolve({ path: path, content: b, encoding: 'base64' }); };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(f);
      } else if (TEXT_EXT.test(path) || f.size < 64 * 1024) {
        reader.onload = function () { resolve({ path: path, content: String(reader.result), encoding: 'utf8' }); };
        reader.onerror = function () { resolve(null); };
        reader.readAsText(f);
      } else { resolve(null); } // skip unknown large binaries
    });
  })).then(function (files) { return files.filter(Boolean); });
}
function readZip(file) {
  return new Promise(function (resolve, reject) {
    if (!window.fflate) return reject({ message: '解压组件未加载，请改用文件夹上传' });
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = new Uint8Array(reader.result);
        var unzipped = window.fflate.unzipSync(data);
        var list = [];
        Object.keys(unzipped).forEach(function (name) {
          if (/\/$/.test(name)) return; // dir
          var bytes = unzipped[name];
          if (bytes.length > MAX_ONE) throw { message: '文件过大：' + name };
          if (IMG_EXT.test(name)) list.push({ path: name, content: bytesToBase64(bytes), encoding: 'base64' });
          else list.push({ path: name, content: strFromU8(bytes), encoding: 'utf8' });
        });
        resolve(stripRootPaths(list));
      } catch (e) { reject(e.message ? e : { message: '解压失败' }); }
    };
    reader.onerror = function () { reject({ message: '读取 zip 失败' }); };
    reader.readAsArrayBuffer(file);
  });
}
function strFromU8(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); }
  catch (e) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }
}
function bytesToBase64(bytes) {
  var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin);
}
function commonRoot(paths) {
  if (!paths.length) return '';
  var first = paths[0].split('/');
  if (first.length < 2) return '';
  var root = first[0];
  return paths.every(function (p) { return p.split('/')[0] === root && p.indexOf('/') >= 0; }) ? root : '';
}
function stripCommonRoot(list) {
  var root = commonRoot(list.map(function (x) { return x.path; }));
  if (!root) return list;
  return list.map(function (x) { return { path: x.path.slice(root.length + 1), file: x.file }; });
}
function stripRootPaths(list) {
  var root = commonRoot(list.map(function (x) { return x.path; }));
  if (!root) return list;
  return list.map(function (x) { return { path: x.path.slice(root.length + 1), content: x.content, encoding: x.encoding }; });
}

/* ================= MODALS ================= */
function modal(title, body, after) {
  $('#modalRoot').innerHTML = '<div class="scrim" data-act="close"><div class="modal" role="dialog" aria-modal="true" aria-label="' + attr(title) + '"><div class="mh"><b>' + esc(title) + '</b><button class="x" data-act="close" aria-label="关闭">×</button></div><div class="mb">' + body + '</div></div></div>';
  if (after) after();
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

function shareCard(p, qrHtml, big, sub, link) {
  return '<div class="qrcard" style="' + coverBg(p) + '"><span class="s" style="font-weight:700;letter-spacing:.1em">' + esc(BRAND.toUpperCase()) + '</span>' +
    '<div class="qr">' + qrHtml + '</div><div class="t">' + esc(big) + '</div><div class="s">' + esc(sub) + '</div></div>' +
    '<div class="cmd wrapped"><code>' + esc(link) + '</code><button class="btn sm dark" data-act="copytext" data-text="' + attr(link) + '">复制链接</button></div>' +
    '<p class="hint" style="margin:0">长按保存这张卡片，放进视频画面、简介、群聊或朋友圈。粉丝扫码就能打开。</p>';
}
function openShareSkill(sm) {
  var link = shareUrlFor(sm.id);
  var qr = '<img src="/api/skills/' + encodeURIComponent(sm.id) + '/qr.svg" alt="二维码" width="180" height="180" loading="lazy">';
  modal('分享 skill', shareCard(sm.pal || 0, qr, sm.name, 'by ' + creatorName(sm) + ' · 扫码获取', link));
}
function openShareCreator(handle, name) {
  var link = BASEURL + '/#/creator/' + handle; // canonical creator page handled by server; QR below is authoritative
  var qr = '<img src="/api/creators/' + encodeURIComponent(handle) + '/qr.svg" alt="二维码" width="180" height="180" loading="lazy">';
  modal('我的主页', shareCard(hashCode(handle) % PAL.length, qr, name || ('@' + handle), '扫码关注 · 获取全部 skill', BASEURL + '/#/creator/' + handle));
}
function openTip(d) {
  var amt = 18;
  function fee(a) { return Math.round(a * 0.1 * 100) / 100; }
  function render() {
    var f = fee(amt), net = Math.round((amt - f) * 100) / 100;
    modal('打赏作者',
      '<div style="display:flex;gap:12px;align-items:center"><span style="width:56px;height:56px;border-radius:14px;display:grid;place-items:center;flex:none;color:#fff;font-family:var(--f-display);font-weight:800;font-size:18px;' + coverBg(d.pal) + '">' + esc(d.glyph || d.name.slice(0, 2)) + '</span><div><b>' + esc(d.name) + '</b><div class="muted" style="font-size:13px">' + esc((d.creator && d.creator.name) || '') + '</div></div></div>' +
      '<div class="tipgrid">' + [6, 18, 50].map(function (a) { return '<button type="button" data-tipamt="' + a + '" class="' + (amt === a ? 'on' : '') + '">' + yuan(a) + '</button>'; }).join('') + '</div>' +
      '<div class="tipcustom"><input id="tipCustom" class="input" type="number" min="1" max="500" step="1" placeholder="自定义金额 ¥1-500" value="' + ([6, 18, 50].indexOf(amt) < 0 ? amt : '') + '"></div>' +
      '<div class="rcpt"><div><span>打赏</span><span id="tR1">' + yuan(amt) + '</span></div><div class="muted"><span>平台服务费 10%</span><span id="tR2">-' + yuan(f) + '</span></div><div class="tot"><span>作者收到</span><span id="tR3">' + yuan(net) + '</span></div></div>' +
      '<div class="notice">演示支付：不会真的扣钱，正式版会接入微信/支付宝</div>' +
      '<button class="btn pink block" style="height:50px" id="tipConfirm">确认打赏 <span id="tBtnAmt">' + yuan(amt) + '</span></button>',
      bind);
  }
  function syncReceipt() {
    var f = fee(amt), net = Math.round((amt - f) * 100) / 100;
    if ($('#tR1')) $('#tR1').textContent = yuan(amt);
    if ($('#tR2')) $('#tR2').textContent = '-' + yuan(f);
    if ($('#tR3')) $('#tR3').textContent = yuan(net);
    if ($('#tBtnAmt')) $('#tBtnAmt').textContent = yuan(amt);
    $$('[data-tipamt]').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-tipamt')) === amt); });
  }
  function bind() {
    $$('[data-tipamt]').forEach(function (b) { b.onclick = function () { amt = Number(b.getAttribute('data-tipamt')); var ci = $('#tipCustom'); if (ci) ci.value = ''; syncReceipt(); }; });
    var ci = $('#tipCustom');
    if (ci) ci.oninput = function () { var v = Math.floor(Number(ci.value)); if (!v || v < 1) v = 1; if (v > 500) { v = 500; ci.value = 500; } amt = v; syncReceipt(); };
    $('#tipConfirm').onclick = function () {
      if (!(amt >= 1 && amt <= 500)) { toast('金额需在 ¥1-500 之间'); return; }
      var btn = $('#tipConfirm'); btn.disabled = true; btn.textContent = '处理中…';
      api('/api/skills/' + encodeURIComponent(d.id) + '/tips', { method: 'POST', body: { amount: amt } })
        .then(function () { closeModal(); toast('打赏成功，作者会收到你的心意 💗'); reload(); })
        .catch(function (err) { btn.disabled = false; btn.textContent = '确认打赏 ' + yuan(amt); if (!err.handled) toast(err.message || '打赏失败'); });
    };
  }
  render();
}
function openNotifs() {
  modal('通知', loadRow());
  api('/api/me/notifications').then(function (res) {
    var list = res.items || [];
    var body = list.length
      ? list.map(function (n) {
          var link = n.link || '';
          return '<div class="notif ' + (n.read ? '' : 'new') + (link ? ' link' : '') + '"' + (link ? ' data-act="notiflink" data-link="' + attr(link) + '"' : '') + '>' +
            (n.read ? '' : '<span style="width:8px;height:8px;border-radius:50%;background:var(--pink);flex:none;margin-top:7px"></span>') +
            '<div><div>' + esc(n.text) + '</div><span class="hint">' + esc(n.ts || '') + '</span></div></div>';
        }).join('')
      : '<div class="empty" style="box-shadow:none"><span class="e">暂无通知</span>关注的博主更新时会告诉你</div>';
    modal('通知', body);
    if (res.unread) api('/api/me/notifications/read', { method: 'POST' }).then(function () { state.notifUnread = 0; renderChrome(current.name); }).catch(function () {});
    else { state.notifUnread = 0; renderChrome(current.name); }
  }).catch(function (err) { if (!err.handled) modal('通知', errState(err)); });
}
function openMe() {
  var u = state.me;
  modal('账号',
    '<div style="display:flex;gap:12px;align-items:center">' + ava(u.name, u.handle) + '<div><b>' + esc(u.name) + '</b><div class="hint">' + (u.role === 'creator' ? '创作者' : '用户') + ' · @' + esc(u.handle) + '</div></div></div>' +
    '<button class="btn block" data-act="mypage">我的主页</button>' +
    '<button class="btn block" data-act="logout">退出登录</button>');
}

/* ---------- optimistic in-place updates ---------- */
function syncLike(id, liked, likes) {
  $$('[data-act="like"][data-id="' + cssEsc(id) + '"]').forEach(function (b) {
    b.classList.toggle('on', !!liked);
    b.setAttribute('aria-pressed', liked ? 'true' : 'false');
    var num = b.querySelector('.num'); if (num && likes != null) num.textContent = fmt(likes);
    var lbl = b.querySelector('.lk-label'); if (lbl) lbl.textContent = liked ? '已喜欢' : '喜欢';
    if (b.classList.contains('btn')) b.classList.toggle('pink', !!liked);
  });
  if (curDetail && curDetail.id === id && likes != null) curDetail.likes = likes;
}
function syncFollow(handle, following) {
  $$('[data-act="follow"][data-handle="' + cssEsc(handle) + '"]').forEach(function (b) {
    b.textContent = following ? '已关注' : '+ 关注';
    b.classList.toggle('pink', !following);
  });
}
function syncLib(id, inLib) {
  $$('[data-act="lib"][data-id="' + cssEsc(id) + '"]').forEach(function (b) {
    b.classList.toggle('dark', !!inLib);
    var lbl = b.querySelector('.lib-label'); if (lbl) lbl.textContent = inLib ? '已收藏到「我的」' : '收藏到「我的」';
  });
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* ================= EVENTS ================= */
function reload() { var fn = VIEWS[current.name] || viewHome; fn(current); }

document.addEventListener('click', function (e) {
  var t = e.target.closest ? e.target.closest('[data-act]') : null;
  if (t) {
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    e.stopPropagation();
    if (act === 'close') { if (e.target === t || e.target.classList.contains('scrim')) closeModal(); return; }
    if (act === 'retry') { reload(); return; }
    if (act === 'back') { if (history.length > 1) history.back(); else go('#/'); return; }
    if (act === 'mesheet') { openMe(); return; }
    if (act === 'mypage') { closeModal(); go(creatorHref(state.me.handle)); return; }
    if (act === 'notifs') { openNotifs(); return; }
    if (act === 'notiflink') { var lk = t.getAttribute('data-link'); closeModal(); handleNotifLink(lk); return; }
    if (act === 'logout') { closeModal(); api('/api/auth/logout', { method: 'POST' }).then(function () { state.me = null; state.notifUnread = 0; toast('已退出'); go('#/login'); }).catch(function () { state.me = null; go('#/login'); }); return; }
    if (act === 'demo') { doDemo(t.getAttribute('data-as')); return; }
    if (act === 'copytext') { copy(t.getAttribute('data-text')); return; }
    if (act === 'hot') { homeState.q = t.getAttribute('data-q'); homeState.cat = '全部'; var bq = $('#bq'); if (bq) bq.value = homeState.q; renderFeed(); scrollFeed(); return; }
    if (act === 'clearq') { homeState.q = ''; homeState.cat = '全部'; var bq2 = $('#bq'); if (bq2) bq2.value = ''; renderFeed(); return; }
    if (act === 'share') { if (curDetail && curDetail.id === id) openShareSkill(curDetail); return; }
    if (act === 'sharecreator') { openShareCreator(t.getAttribute('data-handle'), null); return; }
    if (act === 'itab') { installTab = t.getAttribute('data-itab'); if (curDetail) { var box = $('#installbox'); if (box) box.innerHTML = installInner(curDetail); } return; }
    // actions needing auth
    if (['like', 'follow', 'lib', 'tip', 'claim'].indexOf(act) >= 0 && !state.me) { pendingReturn = location.hash; toast('先登录一下'); go('#/login'); return; }
    if (act === 'like') {
      api('/api/skills/' + encodeURIComponent(id) + '/like', { method: 'POST' })
        .then(function (r) { syncLike(id, r.liked, r.likes); })
        .catch(function (err) { if (!err.handled) toast(err.message || '操作失败'); });
      return;
    }
    if (act === 'follow') {
      var handle = t.getAttribute('data-handle');
      api('/api/creators/' + encodeURIComponent(handle) + '/follow', { method: 'POST' })
        .then(function (r) { syncFollow(handle, r.following); toast(r.following ? '关注成功' : '已取消关注'); })
        .catch(function (err) { if (!err.handled) toast(err.message || '操作失败'); });
      return;
    }
    if (act === 'lib') {
      var isIn = t.classList.contains('dark');
      api('/api/me/library/' + encodeURIComponent(id), { method: isIn ? 'DELETE' : 'POST' })
        .then(function (r) { syncLib(id, r.inLibrary); toast(r.inLibrary ? '已收藏到「我的」' : '已移出收藏'); })
        .catch(function (err) { if (!err.handled) toast(err.message || '操作失败'); });
      return;
    }
    if (act === 'tip') {
      if (curDetail && curDetail.id === id) openTip(curDetail);
      else api('/api/skills/' + encodeURIComponent(id)).then(function (d) { curDetail = d; openTip(d); }).catch(function (err) { if (!err.handled) toast(err.message || '出错了'); });
      return;
    }
    if (act === 'claim') { openClaim(id); return; }
    return;
  }
  // rank tab
  var rk = e.target.closest ? e.target.closest('[data-rank]') : null;
  if (rk) { rankTab = rk.getAttribute('data-rank'); viewRank(); return; }
  // home category chip
  var c = e.target.closest ? e.target.closest('[data-cat]') : null;
  if (c) { homeState.cat = c.getAttribute('data-cat'); homeState.q = ''; var bq3 = $('#bq'); if (bq3) bq3.value = ''; renderFeed(); return; }
  // navigation
  var g = e.target.closest ? e.target.closest('[data-href]') : null;
  if (g) { e.preventDefault(); go(g.getAttribute('data-href')); }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.card[data-href],.rk,.cr,.rrow')) e.target.click();
});

function handleNotifLink(link) {
  if (!link) return;
  if (link.charAt(0) === '#') go(link);
  else if (/^\/s\//.test(link)) {
    // canonical share page -> map to app detail
    var id = link.split('/s/')[1];
    if (id) go(skillHref(id)); else window.open(link, '_blank');
  } else if (/^https?:/.test(link)) window.open(link, '_blank');
  else if (link.charAt(0) === '/') window.open(link, '_blank');
}
function doDemo(as) {
  api('/api/auth/demo', { method: 'POST', body: { as: as } }).then(function (d) { afterAuth(d.me); })
    .catch(function (err) { if (!err.handled) toast(err.message || '演示登录失败'); });
}
function openClaim(id) {
  modal('认领 skill', loadRow('生成认领码…'));
  api('/api/skills/' + encodeURIComponent(id) + '/claim', { method: 'POST' }).then(function (r) {
    modal('认领 skill',
      '<p style="margin:0;font-size:14px">按下面的说明操作，完成后点「我已提交，验证」。</p>' +
      '<div class="say" style="white-space:pre-wrap">' + esc(r.instructions || '') + '</div>' +
      (r.code ? '<div class="cmd wrapped"><code>' + esc(r.code) + '</code><button class="btn sm dark" data-act="copytext" data-text="' + attr(r.code) + '">复制认领码</button></div>' : '') +
      '<button class="btn pink block" id="claimVerify">我已提交，验证</button>',
      function () {
        $('#claimVerify').onclick = function () {
          var b = $('#claimVerify'); b.disabled = true; b.textContent = '验证中…';
          api('/api/skills/' + encodeURIComponent(id) + '/claim/verify', { method: 'POST' })
            .then(function () { closeModal(); toast('认领成功！'); reload(); })
            .catch(function (err) { b.disabled = false; b.textContent = '我已提交，验证'; if (!err.handled) toast(err.message || '验证失败，请确认已按说明提交'); });
        };
      });
  }).catch(function (err) { if (!err.handled) modal('认领 skill', errState(err)); });
}

/* ================= ROUTER ================= */
var VIEWS = { home: viewHome, rank: viewRank, skill: viewSkill, creator: viewCreator, dash: viewDash, library: viewLibrary, upload: viewUpload, login: viewLogin };
function parseHash() {
  var h = location.hash.replace(/^#/, '');
  if (!h || h === '/') return { name: 'home', arg: null, query: {} };
  var parts = h.split('?'); var pathPart = parts[0]; var queryPart = parts[1] || '';
  var query = {};
  if (queryPart) queryPart.split('&').forEach(function (kv) { var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); var v = i < 0 ? '' : kv.slice(i + 1); query[decodeURIComponent(k)] = decodeURIComponent(v); });
  var seg = pathPart.replace(/^\//, '').split('/');
  var name = seg[0] || 'home';
  var arg = seg[1] ? decodeURIComponent(seg[1]) : null;
  if (!VIEWS[name]) name = 'home';
  return { name: name, arg: arg, query: query };
}
function route() {
  closeModal();
  var r = parseHash();
  current = r;
  if (['dash', 'upload', 'library'].indexOf(r.name) >= 0 && !state.me) { pendingReturn = location.hash; go('#/login'); return; }
  installTab = 'ai';
  window.scrollTo(0, 0);
  (VIEWS[r.name] || viewHome)(r);
}

/* ================= BOOT ================= */
function boot() {
  demoBar();
  renderChrome(parseHash().name);
  api('/api/me').then(function (d) { state.me = d && d.me ? d.me : null; }).catch(function () { state.me = null; })
    .then(function () {
      if (state.me) refreshNotifBadge();
      window.addEventListener('hashchange', route);
      if (!location.hash) {
        // first landing: creators go to dash, others home
        location.replace('#/' + (state.me && state.me.role === 'creator' ? 'dash' : ''));
      }
      route();
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
