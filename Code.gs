/**
 * پل آمار «دعای کمیل» (گوگل‌اسکریپت)
 *
 * برنامه ← این پل (doPost: سریع، فقط در «صف» می‌نویسد) ← هر ۵ دقیقه در جدول‌های یک Google Sheet خصوصی جمع می‌شود.
 * صفحهٔ آمار فقط با لینک مخصوص خودتان باز می‌شود (آدرس /exec + ?k=کلید). بدون کلید، فقط «ok» دیده می‌شود.
 * هیچ کلید یا رمزی داخل برنامه یا گیت‌هاب نیست.
 *
 * ۱) تابع setup را یک بار اجرا کنید.   ۲) Deploy ← New deployment ← Web app (Execute as: Me، Who has access: Anyone).
 * ۳) تابع showLinks را اجرا کنید؛ کلید شما در Log نوشته می‌شود.   (بعد از تست‌ها: resetStats همهٔ آمار تستی را پاک می‌کند.)
 */
const TZ = 'Asia/Tehran';      // روزِ آمار به وقت ایران
const N_LINES = 131;           // تعداد جمله‌های دعا (با برنامه یکی است)
const SPAN = 45;               // تعداد روزِ نمودارها
const QUEUE_BATCH = 2000;      // تعداد ردیفِ صف در هر نوبت پردازش
const RATE_DEVICE = 40;        // حداکثر درخواست هر دستگاه در ۱۰ دقیقه
const RATE_GLOBAL = 1500;      // حداکثر کل درخواست‌ها در یک دقیقه
const TAB = {
  queue: ['ts', 'device', 'json'],
  daily: ['day', 'opens', 'active', 'new', 'plays_ar', 'plays_both', 'plays_fa', 'sec_ar', 'sec_both', 'sec_fa', 'finished', 'installs', 'offline', 'batches'],
  devices: ['id', 'first_day', 'last_day', 'days', 'platform', 'installed_use', 'version'],
  lines: ['line', 'sessions']
};
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const ss_ = () => SpreadsheetApp.openById(prop_('SHEET_ID'));
const dayOf_ = ms => +Utilities.formatDate(new Date(ms), TZ, 'yyyyMMdd');
const newKey_ = () => Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
function safeEq_(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function addDays_(d, k) {
  const t = new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100 + k, 12));
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

/* ---------------- دریافت از برنامه ---------------- */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (raw && raw.length <= 4000) {
      const c = clean_(JSON.parse(raw));
      if (c && allow_(c.d)) ss_().getSheetByName('queue').appendRow([Date.now(), c.d, JSON.stringify(c)]);
    }
  } catch (err) {}
  return ContentService.createTextOutput('ok');
}
function clean_(o) {                      // فقط عدد و حرف‌های مجاز می‌ماند؛ هر چیز دیگر دور ریخته می‌شود
  if (!o || typeof o !== 'object' || o.v !== 1) return null;
  const d = String(o.d || '');
  if (!/^[a-z][0-9a-f]{15,31}$/.test(d)) return null;
  const num = (x, max) => { x = Math.floor(+x); return x > 0 ? Math.min(x, max) : 0; };
  const pl = o.pl || {}, ls = o.ls || {};
  const c = {
    v: 1, d: d, p: /^[aiwmlo]$/.test(o.p) ? o.p : 'o', sa: o.sa ? 1 : 0, av: num(o.av, 999),
    o: num(o.o, 5), fin: num(o.fin, 5), ins: num(o.ins, 1), off: num(o.off, 1),
    pl: { ar: num(pl.ar, 200), both: num(pl.both, 200), fa: num(pl.fa, 200) },
    ls: { ar: num(ls.ar, 7200), both: num(ls.both, 7200), fa: num(ls.fa, 7200) },
    h: []
  };
  if (Array.isArray(o.h)) {
    const seen = {};
    o.h.slice(0, N_LINES).forEach(x => { const i = Math.floor(+x); if (i >= 0 && i < N_LINES && !seen[i]) { seen[i] = 1; c.h.push(i); } });
  }
  const any = c.o || c.fin || c.ins || c.off || c.pl.ar || c.pl.both || c.pl.fa || c.ls.ar || c.ls.both || c.ls.fa || c.h.length;
  return any ? c : null;
}
function allow_(d) {                      // سقف درخواست؛ جلوی شلوغ‌کردنِ جدول را می‌گیرد
  const cache = CacheService.getScriptCache(), now = Date.now();
  const gk = 'g' + Math.floor(now / 60000), dk = 'r' + d + ':' + Math.floor(now / 600000);
  const got = cache.getAll([gk, dk]), g = +got[gk] || 0, r = +got[dk] || 0;
  if (g >= RATE_GLOBAL || r >= RATE_DEVICE) return false;
  const put = {}; put[gk] = String(g + 1); put[dk] = String(r + 1);
  cache.putAll(put, 700);
  return true;
}

/* ---------------- جمع‌بندی صف (هر ۵ دقیقه و هر بار باز شدن صفحهٔ آمار) ---------------- */
function flush() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return -1;
  try {
    let total = 0; const t0 = Date.now();
    for (;;) {
      const n = flushOnce_(); total += n;
      if (n < QUEUE_BATCH || Date.now() - t0 > 240000) break;
    }
    PropertiesService.getScriptProperties().setProperty('LAST_FLUSH', String(Date.now()));
    return total;
  } finally { lock.releaseLock(); }
}
function flushOnce_() {
  const ss = ss_(), q = ss.getSheetByName('queue'), last = q.getLastRow();
  if (last < 2) return 0;
  const n = Math.min(last - 1, QUEUE_BATCH);
  const rows = q.getRange(2, 1, n, 3).getValues();
  const dsh = ss.getSheetByName('devices'), vl = dsh.getLastRow();
  const dev = vl >= 2 ? dsh.getRange(2, 1, vl - 1, 7).getValues() : [];
  const old = dev.length, ix = new Map(), days = new Map(), seen = new Array(N_LINES).fill(0);
  dev.forEach((r, i) => ix.set(String(r[0]), i));
  let lo = Infinity, hi = -1;
  rows.forEach(r => {
    let c; try { c = clean_(JSON.parse(String(r[2]))); } catch (e) { c = null; }
    if (!c || !(+r[0] > 0)) return;
    const day = dayOf_(+r[0]);
    let a = days.get(day);
    if (!a) { a = { opens: 0, active: 0, nw: 0, par: 0, pboth: 0, pfa: 0, sar: 0, sboth: 0, sfa: 0, fin: 0, ins: 0, off: 0, b: 0 }; days.set(day, a); }
    a.b++; a.opens += c.o; a.fin += c.fin; a.ins += c.ins; a.off += c.off;
    a.par += c.pl.ar; a.pboth += c.pl.both; a.pfa += c.pl.fa; a.sar += c.ls.ar; a.sboth += c.ls.both; a.sfa += c.ls.fa;
    c.h.forEach(i => { seen[i]++; });
    const k = ix.get(c.d);
    if (k === undefined) { ix.set(c.d, dev.length); dev.push([c.d, day, day, 1, c.p, c.sa, c.av]); a.nw++; a.active++; return; }
    const x = dev[k]; let ch = false;
    if (+x[2] !== day) { x[2] = day; x[3] = (+x[3] || 0) + 1; a.active++; ch = true; }
    if (c.sa && +x[5] !== 1) { x[5] = 1; ch = true; }
    if (c.av && +x[6] !== c.av) { x[6] = c.av; ch = true; }
    if (ch && k < old) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
  });
  if (hi >= 0) dsh.getRange(lo + 2, 3, hi - lo + 1, 5).setValues(dev.slice(lo, hi + 1).map(r => r.slice(2, 7)));
  if (dev.length > old) dsh.getRange(old + 2, 1, dev.length - old, 7).setValues(dev.slice(old));
  if (days.size) {
    const ds = ss.getSheetByName('daily'), dl = ds.getLastRow();
    const dr = dl >= 2 ? ds.getRange(2, 1, dl - 1, 14).getValues() : [], di = new Map();
    dr.forEach((r, i) => di.set(+r[0], i));
    days.forEach((a, day) => {
      const add = [a.opens, a.active, a.nw, a.par, a.pboth, a.pfa, a.sar, a.sboth, a.sfa, a.fin, a.ins, a.off, a.b];
      const k = di.get(day);
      if (k === undefined) { di.set(day, dr.length); dr.push([day].concat(add)); }
      else dr[k] = [day].concat(dr[k].slice(1).map((v, j) => (+v || 0) + add[j]));
    });
    ds.getRange(2, 1, dr.length, 14).setValues(dr);
  }
  if (seen.some(v => v)) {
    const lr = ss.getSheetByName('lines').getRange(2, 2, N_LINES, 1);
    lr.setValues(lr.getValues().map((r, i) => [(+r[0] || 0) + seen[i]]));
  }
  q.deleteRows(2, n);       // آخر کار: اگر وسط کار خطایی شد، ردیف‌ها می‌مانند و دفعهٔ بعد دوباره پردازش می‌شوند
  return n;
}

/* ---------------- صفحهٔ خصوصی آمار ---------------- */
function doGet(e) {
  const p = (e && e.parameter) || {}, key = prop_('ADMIN_KEY');
  if (!key || typeof p.k !== 'string' || !safeEq_(p.k, key)) return ContentService.createTextOutput('ok');
  try { flush(); } catch (err) {}
  try {
    const data = report_();
    if (p.json === '1') return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
    return HtmlService.createHtmlOutput(page_(data)).setTitle('آمار دعای کمیل')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1').addMetaTag('robots', 'noindex,nofollow')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) { return ContentService.createTextOutput('خطا: ' + err); }
}
function report_() {
  const ss = ss_(), now = Date.now(), today = dayOf_(now);
  const dsh = ss.getSheetByName('daily'), dn = dsh.getLastRow();
  const dr = dn >= 2 ? dsh.getRange(2, 1, dn - 1, 14).getValues() : [], by = {};
  dr.forEach(r => { by[+r[0]] = r.map(x => +x || 0); });
  const zero = d => [d, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const daily = []; for (let k = SPAN - 1; k >= 0; k--) { const d = addDays_(today, -k); daily.push(by[d] || zero(d)); }
  const win = from => { const s = zero(from); dr.forEach(r => { if (+r[0] >= from) for (let j = 1; j < 14; j++) s[j] += +r[j] || 0; }); return s; };
  const vsh = ss.getSheetByName('devices'), vn = vsh.getLastRow();
  const dev = vn >= 2 ? vsh.getRange(2, 1, vn - 1, 7).getValues() : [];
  const w7 = addDays_(today, -6), w30 = addDays_(today, -29);
  const V = { total: dev.length, a1: 0, a7: 0, a30: 0, n1: 0, n7: 0, n30: 0, ret: 0, sa: 0, plat: {}, ver: {} };
  dev.forEach(r => {
    const f = +r[1], l = +r[2];
    if (l >= today) V.a1++; if (l >= w7) V.a7++; if (l >= w30) V.a30++;
    if (f >= today) V.n1++; if (f >= w7) V.n7++; if (f >= w30) V.n30++;
    if (+r[3] >= 2) V.ret++; if (+r[5] === 1) V.sa++;
    V.plat[r[4]] = (V.plat[r[4]] || 0) + 1; V.ver[r[6]] = (V.ver[r[6]] || 0) + 1;
  });
  const lines = ss.getSheetByName('lines').getRange(2, 2, N_LINES, 1).getValues().map(r => +r[0] || 0);
  let link = ''; try { const u = ScriptApp.getService().getUrl(); if (u) link = u + '?k=' + prop_('ADMIN_KEY'); } catch (e) {}
  return {
    now: now, today: today, tz: TZ, daily: daily, win: { d1: win(today), d7: win(w7), d30: win(w30), all: win(0) }, dev: V, lines: lines,
    meta: { queue: Math.max(0, ss.getSheetByName('queue').getLastRow() - 1), lastFlush: +prop_('LAST_FLUSH') || 0, sheet: ss.getUrl(), link: link }
  };
}
function page_(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('\\u2028').split(String.fromCharCode(8233)).join('\\u2029');
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>' + CSS_ + '</style></head><body><div class="wrap" id="app"></div><script>(' + clientMain_.toString() + ')(' + json + ');</script></body></html>';
}
const CSS_ = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--ring:rgba(11,11,11,.10);--accent:#2a78d6;--soft:#86b6ef;--wash:rgba(42,120,214,.10)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--ring:rgba(255,255,255,.10);--accent:#3987e5;--soft:#1c5cab;--wash:rgba(57,135,229,.14)}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--page);color:var(--ink);font:15px/1.7 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:14px 16px 40px}
header{display:flex;align-items:center;gap:10px;margin:6px 0 2px}
h1{font-size:20px;margin:0;font-weight:700;flex:1}
h2{font-size:15px;margin:26px 0 6px;font-weight:700}
.sub{color:var(--ink2);font-size:13px}
.btn{color:var(--ink);text-decoration:none;border:1px solid var(--ring);background:var(--surface);border-radius:999px;padding:4px 14px;font-size:13px}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:16px;padding:14px 16px;margin:10px 0}
.hero .v{font-size:56px;font-weight:700;line-height:1.2}
.hero .l{font-size:15px;color:var(--ink2)}.hero .s{font-size:13px;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.kpis .card{margin:0;padding:12px}
.kpis .l{font-size:12.5px;color:var(--ink2)}.kpis .v{font-size:26px;font-weight:600;line-height:1.4}.kpis .s{font-size:12px;color:var(--muted)}
.chips{display:flex;gap:8px;margin:6px 0 2px}
.chip{border:1px solid var(--ring);background:var(--surface);color:var(--ink);border-radius:999px;padding:3px 14px;font:inherit;font-size:13px;cursor:pointer}
.chip[aria-pressed=true]{background:var(--accent);color:#fff;border-color:transparent}
.cap{font-size:13.5px;font-weight:600;margin-bottom:4px}
.plot{position:relative}svg{display:block;max-width:100%;direction:ltr}svg rect:focus{outline:2px solid var(--accent)}
.tip{position:absolute;z-index:3;pointer-events:none;background:var(--surface);border:1px solid var(--ring);box-shadow:0 4px 18px rgba(0,0,0,.18);border-radius:10px;padding:5px 10px;font-size:12.5px;white-space:nowrap;line-height:1.7}
.tip b{font-weight:700}.tip .tt{color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{padding:6px;text-align:start;border-bottom:1px solid var(--grid);white-space:nowrap}
thead th{color:var(--ink2);font-weight:600;font-size:12.5px}tbody th{font-weight:500}td{font-variant-numeric:tabular-nums}
.tw{overflow-x:auto}details summary{cursor:pointer;font-weight:600}
.sumc{padding:10px 10px}.sumc table{font-size:12.5px}.sumc th,.sumc td{white-space:normal;padding:6px 4px;line-height:1.5}.sumc tbody th{width:34%}
.rk{display:grid;grid-template-columns:104px 1fr auto;align-items:center;gap:10px;margin:7px 0;font-size:13.5px}
.rk i{display:block;height:12px;min-width:2px;background:var(--accent);border-radius:0 4px 4px 0}
[dir=rtl] .rk i{border-radius:4px 0 0 4px}
.rk .v{color:var(--ink2);font-size:13px}
.note{color:var(--muted);font-size:12.5px;margin:6px 0 0}.sh{font-size:13px;font-weight:600;margin:12px 0 2px;color:var(--ink2)}
footer{margin-top:22px;color:var(--muted);font-size:12.5px;text-align:center}footer a{color:var(--ink2)}
`;
/* این تابع در مرورگر اجرا می‌شود (داخل صفحهٔ آمار)، نه در گوگل */
function clientMain_(D) {
  var NS = 'http://www.w3.org/2000/svg', app = document.getElementById('app');
  var el = function (t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  var sv = function (t, a, p) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  var fa = function (n) { return (Math.round(n * 10) / 10).toLocaleString('fa-IR'); };
  var pc = function (a, b) { return b > 0 ? fa(Math.round(a * 100 / b)) + '٪' : '—'; };
  var jd = function (day, o) {
    var y = Math.floor(day / 10000), m = Math.floor(day / 100) % 100, d = day % 100;
    try { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', Object.assign({ timeZone: 'UTC' }, o)).format(new Date(Date.UTC(y, m - 1, d, 12))); } catch (e) { return String(day); }
  };
  var dur = function (s) {
    s = Math.round(s); if (s < 60) return fa(s) + ' ثانیه';
    var m = Math.round(s / 60); if (m < 60) return fa(m) + ' دقیقه';
    var h = Math.floor(m / 60); m = m % 60; if (h >= 10) return fa(h + (m >= 30 ? 1 : 0)) + ' ساعت'; return fa(h) + ' ساعت' + (m ? ' و ' + fa(m) + ' دقیقه' : '');
  };
  var niceMax = function (v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  var sum3 = function (r, a) { return r[a] + r[a + 1] + r[a + 2]; };          // پخش: ستون‌های ۴ تا ۶ ، ثانیه: ۷ تا ۹
  var sec = function (t) { app.appendChild(el('h2', '', t)); };
  var card = function (c) { var d = el('div', 'card' + (c ? ' ' + c : '')); app.appendChild(d); return d; };
  var tipOf = function (host) {
    var t = el('div', 'tip'); t.hidden = true; host.appendChild(t);
    return {
      show: function (x, y, title, rows) {
        t.textContent = ''; t.appendChild(el('div', 'tt', title));
        rows.forEach(function (r) { var d = el('div'); d.appendChild(el('b', '', r[0])); d.appendChild(document.createTextNode(' ' + r[1])); t.appendChild(d); });
        t.hidden = false;
        var w = t.offsetWidth, h = t.offsetHeight, W = host.clientWidth;
        t.style.left = Math.max(2, Math.min(W - w - 2, x - w / 2)) + 'px'; t.style.top = Math.max(0, y - h - 10) + 'px';
      },
      hide: function () { t.hidden = true; }
    };
  };
  var axisY = function (svg, ticks, Y, x1, x2, tx) {
    ticks.forEach(function (t) {
      sv('line', { x1: x1, x2: x2, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
      sv('text', { x: tx, y: Y(t) + 4, fill: 'var(--muted)', 'font-size': 11, 'text-anchor': 'start' }, svg).textContent = fa(t);
    });
  };
  var tickList = function (top) { var t = [0]; if (top % 2 === 0) t.push(top / 2); t.push(top); return t; };

  /* ستون‌ها: هر روز یک ستون؛ قدیمی‌ترین روز سمت راست، امروز سمت چپ */
  function barChart(host, items, label, fmt) {
    host.textContent = '';
    var W = Math.max(260, host.clientWidth || 320), H = 176, pl = 6, pr = 38, pt = 22, pb = 24, pw = W - pl - pr, ph = H - pt - pb, n = items.length, step = pw / n;
    var bw = Math.max(2, Math.min(24, step - 2)), mx = 0, mi = 0;
    items.forEach(function (it, i) { if (it.v > mx) { mx = it.v; mi = i; } });
    var top = niceMax(mx), Y = function (v) { return pt + ph - (top ? v / top * ph : 0); };
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label });
    axisY(svg, tickList(top), Y, pl, W - pr, W - pr + 6);
    var tip = tipOf(host), marks = [], k = Math.max(1, Math.ceil(72 / step));
    var X = function (i) { return pl + pw - i * step - step / 2; };
    items.forEach(function (it, i) {
      var cx = X(i), h = it.v / top * ph, last = i === n - 1;
      if (h > 0.4) {
        var r = Math.min(4, bw / 2, h), x = cx - bw / 2, y = Y(it.v);
        marks[i] = sv('path', { d: 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + (y + h) + 'Z', fill: last ? 'var(--accent)' : 'var(--soft)' }, svg);
      }
      if ((n - 1 - i) % k === 0) sv('text', { x: Math.max(cx, 27), y: H - 7, fill: 'var(--muted)', 'font-size': 11, 'text-anchor': 'middle', direction: 'rtl' }, svg).textContent = jd(it.day, { day: 'numeric', month: 'short' });
    });
    [n - 1, mi].forEach(function (i, j) {                       // برچسبِ انتخابی: امروز و بیشترین
      if (j === 1 && (i === n - 1 || Math.abs(X(i) - X(n - 1)) < 34 || !items[i].v)) return;
      if (!items[i].v) return;
      sv('text', { x: X(i), y: Y(items[i].v) - 5, fill: 'var(--ink2)', 'font-size': 11, 'font-weight': 600, 'text-anchor': 'middle' }, svg).textContent = fmt ? fmt(items[i].v) : fa(items[i].v);
    });
    var cur = -1;
    var show = function (i) {
      if (cur >= 0 && marks[cur]) marks[cur].setAttribute('fill', cur === n - 1 ? 'var(--accent)' : 'var(--soft)');
      cur = i; if (marks[i]) marks[i].setAttribute('fill', 'var(--accent)');
      tip.show(X(i), Math.min(Y(items[i].v), pt + ph - 4), jd(items[i].day, { weekday: 'long', day: 'numeric', month: 'long' }), items[i].rows);
    };
    var hide = function () { if (cur >= 0 && marks[cur]) marks[cur].setAttribute('fill', cur === n - 1 ? 'var(--accent)' : 'var(--soft)'); cur = -1; tip.hide(); };
    items.forEach(function (it, i) {
      var hit = sv('rect', { x: X(i) - step / 2, y: pt, width: step, height: ph, fill: 'transparent', tabindex: 0, 'aria-label': jd(it.day, { day: 'numeric', month: 'long' }) + ': ' + it.rows.map(function (r) { return r[0] + ' ' + r[1]; }).join('، ') }, svg);
      hit.addEventListener('pointerenter', function () { show(i); });
      hit.addEventListener('pointerdown', function () { show(i); });
      hit.addEventListener('focus', function () { show(i); });
      hit.addEventListener('blur', hide);
      hit.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hide(); });
    });
    host.insertBefore(svg, host.firstChild);
  }

  /* نمودار سطحی برای ۱۳۱ جمله: جملهٔ ۱ سمت راست */
  function areaChart(host, ys, label) {
    host.textContent = '';
    var W = Math.max(260, host.clientWidth || 320), H = 150, pl = 6, pr = 38, pt = 18, pb = 24, pw = W - pl - pr, ph = H - pt - pb, n = ys.length;
    var mx = Math.max.apply(null, ys), mi = ys.indexOf(mx), top = niceMax(mx);
    var X = function (i) { return pl + pw - (n > 1 ? i / (n - 1) : 0) * pw; }, Y = function (v) { return pt + ph - (top ? v / top * ph : 0); };
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label });
    axisY(svg, tickList(top), Y, pl, W - pr, W - pr + 6);
    var d = ys.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join('');
    sv('path', { d: d + 'L' + X(n - 1).toFixed(1) + ',' + (pt + ph) + 'L' + X(0).toFixed(1) + ',' + (pt + ph) + 'Z', fill: 'var(--wash)' }, svg);
    sv('path', { d: d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    for (var i = 0; i < n; i++) if (i === 0 || (i + 1) % 20 === 0) sv('text', { x: X(i), y: H - 7, fill: 'var(--muted)', 'font-size': 11, 'text-anchor': 'middle' }, svg).textContent = fa(i + 1);
    sv('text', { x: X(mi), y: Y(mx) - 6, fill: 'var(--ink2)', 'font-size': 11, 'font-weight': 600, 'text-anchor': 'middle' }, svg).textContent = fa(mx);
    var tip = tipOf(host), cl = sv('line', { y1: pt, y2: pt + ph, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dot = sv('circle', { r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg);
    var hit = sv('rect', { x: pl, y: pt, width: pw, height: ph, fill: 'transparent', tabindex: 0, 'aria-label': label }, svg), cur = 0;
    var show = function (i) {
      cur = Math.max(0, Math.min(n - 1, i)); var x = X(cur), y = Y(ys[cur]);
      cl.setAttribute('x1', x); cl.setAttribute('x2', x); cl.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      tip.show(x, y, 'جملهٔ ' + fa(cur + 1), [[fa(ys[cur]), 'بار شنیده شد']]);
    };
    var hide = function () { cl.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); };
    var at = function (ev) { var rc = svg.getBoundingClientRect(); return Math.round((pl + pw - (ev.clientX - rc.left)) / pw * (n - 1)); };
    hit.addEventListener('pointermove', function (ev) { show(at(ev)); });
    hit.addEventListener('pointerdown', function (ev) { show(at(ev)); });
    hit.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hide(); });
    hit.addEventListener('focus', function () { show(cur); });
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowLeft') { show(cur + 1); ev.preventDefault(); } else if (ev.key === 'ArrowRight') { show(cur - 1); ev.preventDefault(); } });
    host.insertBefore(svg, host.firstChild);
  }

  /* میله‌های رتبه‌ای: بزرگ‌ترین بالا، عدد و درصد کنار میله */
  function rank(parent, items) {
    var tot = 0, mx = 0; items.forEach(function (it) { tot += it.v; if (it.v > mx) mx = it.v; });
    items.sort(function (a, b) { return b.v - a.v; }).forEach(function (it) {
      var r = el('div', 'rk'); r.appendChild(el('span', '', it.name));
      var b = el('i'); b.style.width = (mx ? Math.max(1, it.v / mx * 100) : 0) + '%'; var w = el('span'); w.appendChild(b); r.appendChild(w);
      r.appendChild(el('span', 'v', fa(it.v) + ' (' + pc(it.v, tot) + ')')); parent.appendChild(r);
    });
  }
  var table = function (head, rows) {
    var t = el('table'), th = el('thead'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', '', h)); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody'); rows.forEach(function (r) { var x = el('tr'); r.forEach(function (c, i) { x.appendChild(el(i ? 'td' : 'th', '', c)); }); tb.appendChild(x); }); t.appendChild(tb);
    return t;
  };

  /* ---- ساخت صفحه ---- */
  var V = D.dev, Wn = D.win, hd = el('header'); hd.appendChild(el('h1', '', 'آمار دعای کمیل'));
  var rf = el('a', 'btn', 'بازخوانی ↻');
  if (D.meta.link) { rf.href = D.meta.link; rf.target = '_top'; } else { rf.href = '#'; rf.onclick = function (e) { e.preventDefault(); location.reload(); }; }
  hd.appendChild(rf); app.appendChild(hd);
  var hm; try { hm = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: D.tz }).format(new Date(D.now)); } catch (e) { hm = ''; }
  app.appendChild(el('div', 'sub', 'به‌روزرسانی: ' + jd(D.today, { weekday: 'long' }) + ' ' + jd(D.today, { day: 'numeric', month: 'long' }) + ' ' + jd(D.today, { year: 'numeric' }) + ' — ساعت ' + hm));
  var hero = card('hero'); hero.appendChild(el('div', 'v', fa(V.a1))); hero.appendChild(el('div', 'l', 'دستگاه فعال امروز')); hero.appendChild(el('div', 's', fa(V.n1) + ' دستگاه جدید امروز'));
  var kp = el('div', 'kpis'); app.appendChild(kp);
  [['هفت روز اخیر', V.a7, fa(V.n7) + ' جدید'], ['سی روز اخیر', V.a30, fa(V.n30) + ' جدید'], ['کل دستگاه‌ها', V.total, pc(V.ret, V.total) + ' بازگشتی']].forEach(function (k) {
    var c = el('div', 'card'); c.appendChild(el('div', 'l', k[0])); c.appendChild(el('div', 'v', fa(k[1]))); c.appendChild(el('div', 's', k[2])); kp.appendChild(c);
  });
  var anything = V.total > 0;
  if (!anything) {
    var em = card(); em.appendChild(el('div', 'cap', 'هنوز آماری ثبت نشده است'));
    em.appendChild(el('div', 'note', 'وقتی برنامه (با آدرس این پل) باز شود و کسی آن را اجرا کند، تا حدود پنج دقیقه بعد اینجا دیده می‌شود. همین صفحه را دوباره باز کنید.'));
  } else {
    var range = 30, C1, C2, DT;
    sec('روند روزانه');
    var chips = el('div', 'chips'), btns = [];
    [7, 30, 45].forEach(function (r) { var b = el('button', 'chip', fa(r) + ' روز اخیر'); b.type = 'button'; b.onclick = function () { range = r; draw(); }; btns.push([r, b]); chips.appendChild(b); });
    app.appendChild(chips);
    var c1 = card(); c1.appendChild(el('div', 'cap', 'دستگاه‌های فعال در هر روز')); C1 = el('div', 'plot'); c1.appendChild(C1);
    var c2 = card(); c2.appendChild(el('div', 'cap', 'دقیقه‌های شنیدن در هر روز')); C2 = el('div', 'plot'); c2.appendChild(C2);
    var dt = el('details', 'card'); dt.appendChild(el('summary', '', 'جدول روزانه (همهٔ اعداد)')); DT = el('div', 'tw'); dt.appendChild(DT); app.appendChild(dt);
    var draw = function () {
      btns.forEach(function (x) { x[1].setAttribute('aria-pressed', x[0] === range ? 'true' : 'false'); });
      var rs = D.daily.slice(D.daily.length - range);
      barChart(C1, rs.map(function (r) { return { v: r[2], day: r[0], rows: [[fa(r[2]), 'دستگاه فعال'], [fa(r[3]), 'دستگاه جدید'], [fa(r[1]), 'باز شدن برنامه']] }; }), 'دستگاه‌های فعال در هر روز');
      barChart(C2, rs.map(function (r) { return { v: sum3(r, 7) / 60, day: r[0], rows: [[dur(sum3(r, 7)), 'شنیدن'], [fa(sum3(r, 4)), 'پخش']] }; }), 'دقیقه‌های شنیدن در هر روز', function (v) { return fa(Math.round(v)); });
      DT.textContent = '';
      DT.appendChild(table(['روز', 'فعال', 'جدید', 'بازدید', 'پخش', 'شنیدن', 'تا آخر', 'نصب', 'آفلاین'], rs.slice().reverse().map(function (r) {
        return [jd(r[0], { weekday: 'short', day: 'numeric', month: 'short' }), fa(r[2]), fa(r[3]), fa(r[1]), fa(sum3(r, 4)), dur(sum3(r, 7)), fa(r[10]), fa(r[11]), fa(r[12])];
      })));
    };
    draw();
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(draw, 150); });

    sec('خلاصه');
    var sc = card('sumc'), sw = el('div', 'tw'); sc.appendChild(sw);
    var w4 = [Wn.d1, Wn.d7, Wn.d30, Wn.all], act = [V.a1, V.a7, V.a30, V.total];
    sw.appendChild(table(['', 'امروز', 'هفت روز', 'سی روز', 'کل'], [
      ['دستگاه فعال'].concat([V.a1, V.a7, V.a30, V.total].map(fa)),
      ['دستگاه جدید'].concat([V.n1, V.n7, V.n30, V.total].map(fa)),
      ['باز شدن برنامه'].concat(w4.map(function (w) { return fa(w[1]); })),
      ['تعداد پخش'].concat(w4.map(function (w) { return fa(sum3(w, 4)); })),
      ['مدت شنیدن'].concat(w4.map(function (w) { return dur(sum3(w, 7)); })),
      ['میانگین شنیدن هر دستگاه'].concat(w4.map(function (w, i) { return act[i] ? dur(sum3(w, 7) / act[i]) : '—'; })),
      ['شنیدن تا آخر دعا'].concat(w4.map(function (w) { return fa(w[10]); })),
      ['نصب برنامه'].concat(w4.map(function (w) { return fa(w[11]); })),
      ['ذخیرهٔ آفلاین'].concat(w4.map(function (w) { return fa(w[12]); }))
    ]));

    sec('حالت پخش');
    var mc = card(), A = Wn.all;
    rank(mc, [{ name: 'فقط عربی', v: A[4] }, { name: 'عربی و ترجمه', v: A[5] }, { name: 'فقط ترجمه', v: A[6] }]);
    mc.appendChild(el('div', 'note', 'تعداد پخش در هر حالت. مدت شنیدن: فقط عربی ' + dur(A[7]) + '، عربی و ترجمه ' + dur(A[8]) + '، فقط ترجمه ' + dur(A[9])));

    sec('کدام جمله‌ها شنیده می‌شود');
    var lc = card(), lm = Math.max.apply(null, D.lines);
    if (lm > 0) {
      lc.appendChild(el('div', 'note', 'هر نقطه = چند بازدید آن جمله را (حداقل ۲ ثانیه) شنیده‌اند. جملهٔ ۱ سمت راست است.'));
      var LP = el('div', 'plot'); lc.appendChild(LP);
      var dl = function () { areaChart(LP, D.lines, 'تعداد شنیده‌شدن هر جمله'); }; dl();
      window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { draw(); dl(); }, 150); });
    } else lc.appendChild(el('div', 'note', 'هنوز داده‌ای برای شنیده‌شدنِ جمله‌ها نیست.'));

    sec('دستگاه‌ها');
    var dc = card(), PN = { a: 'اندروید', i: 'آیفون / آیپد', w: 'ویندوز', m: 'مک', l: 'لینوکس', o: 'نامشخص' };
    dc.appendChild(el('div', 'sh', 'سیستم‌عامل'));
    rank(dc, Object.keys(V.plat).map(function (k) { return { name: PN[k] || k, v: V.plat[k] }; }));
    dc.appendChild(el('div', 'sh', 'نوع استفاده'));
    rank(dc, [{ name: 'برنامهٔ نصب‌شده', v: V.sa }, { name: 'داخل مرورگر', v: V.total - V.sa }]);
    dc.appendChild(el('div', 'sh', 'نسخهٔ برنامه'));
    rank(dc, Object.keys(V.ver).map(function (k) { return { name: 'نسخهٔ ' + fa(k), v: V.ver[k] }; }));
    dc.appendChild(el('div', 'note', 'بازگشتی = دستگاهی که در بیش از یک روز برنامه را باز کرده: ' + fa(V.ret) + ' از ' + fa(V.total) + ' (' + pc(V.ret, V.total) + ')'));
  }
  var ft = el('footer'), lf = D.meta.lastFlush ? new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: D.tz }).format(new Date(D.meta.lastFlush)) : '—';
  ft.appendChild(el('div', '', 'آخرین جمع‌بندی: ' + lf)); ft.appendChild(el('div', '', 'در صف پردازش: ' + fa(D.meta.queue)));
  ft.appendChild(el('div', '', 'آمار ناشناس و تقریبی است؛ هیچ اطلاعات شخصی ذخیره نمی‌شود.'));
  if (D.meta.sheet) { var sa = el('a', '', 'باز کردن جدول خام (Google Sheet)'); sa.href = D.meta.sheet; sa.target = '_blank'; sa.rel = 'noopener noreferrer'; ft.appendChild(sa); }
  app.appendChild(ft);
}

/* ---------------- نصب و نگهداری (فقط از داخل ویرایشگر اجرا می‌شوند) ---------------- */
function setup() {
  const P = PropertiesService.getScriptProperties();
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss && P.getProperty('SHEET_ID')) { try { ss = SpreadsheetApp.openById(P.getProperty('SHEET_ID')); } catch (e) {} }
  if (!ss) ss = SpreadsheetApp.create('آمار دعای کمیل (خصوصی)');
  P.setProperty('SHEET_ID', ss.getId());
  if (!P.getProperty('ADMIN_KEY')) P.setProperty('ADMIN_KEY', newKey_());
  Object.keys(TAB).forEach(name => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, TAB[name].length).setValues([TAB[name]]).setFontWeight('bold');
  });
  const ls = ss.getSheetByName('lines');
  if (ls.getLastRow() < 2) { const v = []; for (let i = 1; i <= N_LINES; i++) v.push([i, 0]); ls.getRange(2, 1, N_LINES, 2).setValues(v); }
  ss.getSheetByName('devices').getRange('A:A').setNumberFormat('@');
  ss.getSheets().forEach(sh => { if (!TAB[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh); });
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'flush') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('flush').timeBased().everyMinutes(5).create();
  Logger.log('✅ آماده شد. جدول آمار (خصوصی): ' + ss.getUrl());
  Logger.log('قدم بعد: Deploy ← New deployment ← Web app');
}
function showLinks() {
  const k = prop_('ADMIN_KEY');
  if (!k) { Logger.log('ابتدا تابع setup را اجرا کنید.'); return; }
  Logger.log('کلید آمار (فقط برای خودتان، به هیچ‌کس ندهید):');
  Logger.log(k);
  Logger.log('لینک آمار = آدرس برنامهٔ وب (آنکه به /exec ختم می‌شود) + ?k=' + k);
  let base = ''; try { base = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  if (/\/exec$/.test(base)) Logger.log('لینک کامل: ' + base + '?k=' + k);
}
function resetKey() { PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', newKey_()); showLinks(); }
function resetStats() {      // همهٔ آمار (و صف) پاک می‌شود؛ بعد از تست‌ها
  const ss = ss_();
  ['queue', 'daily', 'devices'].forEach(n => { const s = ss.getSheetByName(n), l = s.getLastRow(); if (l > 1) s.deleteRows(2, l - 1); });
  const lr = ss.getSheetByName('lines').getRange(2, 2, N_LINES, 1);
  lr.setValues(lr.getValues().map(() => [0]));
  Logger.log('آمار پاک شد.');
}
