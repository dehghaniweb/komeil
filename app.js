(function () {
'use strict';
const D = window.DUA, T0 = window.DUA_TIMES, N = D.lines.length;
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const fa = n => Number(n).toLocaleString('fa-IR');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const store = {
  get(k, d) { try { const v = localStorage.getItem('komeil.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('komeil.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('komeil.' + k); } catch (e) {} }
};
const SOURCE_TEXT = 'منبع متن و ترجمه: سایت ahlolbait.com (مؤسسهٔ تحقیق و نشر معارف اهل‌بیت علیهم‌السلام) — با اجازهٔ آن سایت. ترجمه: ترجمهٔ مفاتیح‌الجنان. صوت: عربی و ترجمهٔ فارسی (audiolib.ir).';

/* ---------- زمان‌ها ---------- */
let W = { ar: T0.ar.starts.slice(), fa: T0.fa.starts.slice() };
const END = { ar: T0.ar.end, fa: T0.fa.end };
let hasOverride = false;
(function loadOverride() {
  const o = store.get('times', null);
  if (o && o.base === T0.v && o.ar && o.fa && o.ar.length === N && o.fa.length === N + 1) { W = { ar: o.ar.slice(), fa: o.fa.slice() }; hasOverride = true; }
})();
function saveOverride() { store.set('times', { base: T0.v, ar: W.ar, fa: W.fa }); hasOverride = true; }
const nItems = tr => tr === 'ar' ? N : N + 1;
const itemNext = (tr, k) => k + 1 < nItems(tr) ? W[tr][k + 1] : END[tr];
function itemEnd(tr, k, trim) {          // پایان جمله؛ با trim مکث بلند آخر جمله کوتاه می‌شود
  const nx = itemNext(tr, k); if (!trim) return nx;
  const st = W[tr][k]; let best = null;
  for (const [a, b] of T0.pauses[tr]) { if (a > nx + 0.05) break; if (b >= nx - 0.6 && a > st + 0.8) best = a; }
  return best != null ? Math.min(nx, best + 0.35) : nx;
}
function lineAt(arr, t) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };

/* ---------- تنظیمات ظاهر ---------- */
const S = Object.assign({ theme: 'green', mode: 'day', ar: 30, fa: 16, showFa: true, autoscroll: true }, store.get('settings', {}));
function applyLook() {
  const r = document.documentElement;
  r.dataset.theme = S.theme; r.dataset.mode = S.mode;
  r.style.setProperty('--ar-size', S.ar + 'px'); r.style.setProperty('--fa-size', S.fa + 'px');
  document.body.classList.toggle('hide-fa', !S.showFa);
  $('#btn-mode').textContent = S.mode === 'night' ? '☀' : '☾';
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = getComputedStyle(document.body).backgroundColor;
  store.set('settings', S);
}

/* ---------- ساخت صفحه ---------- */
const linesBox = $('#lines');
D.lines.forEach((l, i) => {
  const a = el('article', 'line'); a.id = 'l' + i; a.dataset.i = i;
  a.append(el('span', 'num', fa(i + 1)), el('div', 'ar', l.ar), el('div', 'fa', l.fa));
  a.addEventListener('click', () => { startAt(i, 'ar'); });
  linesBox.append(a);
});
$('#intro-body').textContent = D.intro;
$('#source-line').textContent = SOURCE_TEXT;
$('#intro-toggle').addEventListener('click', () => {
  const b = $('#intro-body'); b.hidden = !b.hidden; $('#intro-arrow').textContent = b.hidden ? '▾' : '▴';
});

/* ---------- صوت ---------- */
const AUDIO_PATH = { ar: 'audio/ar.mp3', fa: 'audio/fa.mp3' };
const CACHE_AUDIO = 'komeil-audio-v1';
const audio = { ar: new Audio(), fa: new Audio() };
const offline = { ar: false, fa: false };
for (const k in audio) { audio[k].preload = 'auto'; audio[k].src = AUDIO_PATH[k]; }
const absUrl = p => new URL(p, location.href).href;
async function loadCachedAudio() {
  if (!window.caches) return;
  try {
    const c = await caches.open(CACHE_AUDIO);
    for (const tr of ['ar', 'fa']) {
      const r = await c.match(absUrl(AUDIO_PATH[tr]));
      if (r) { const b = await r.blob(); audio[tr].src = URL.createObjectURL(b); offline[tr] = true; }
    }
  } catch (e) {}
  renderSheet();
}
async function downloadAudio(onProgress) {
  const c = await caches.open(CACHE_AUDIO);
  const trs = ['ar', 'fa'];
  const sizes = {}, got = { ar: 0, fa: 0 };
  for (const tr of trs) {
    const resp = await fetch(AUDIO_PATH[tr]);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = +resp.headers.get('content-length') || 0;
    const rd = resp.body.getReader(); const chunks = [];
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      chunks.push(value); got[tr] += value.length;
      onProgress && onProgress(tr, got[tr], total);
    }
    sizes[tr] = got[tr];
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    await c.put(absUrl(AUDIO_PATH[tr]), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size) } }));
    const a = audio[tr], t = a.currentTime, was = !a.paused;
    a.src = URL.createObjectURL(blob); a.currentTime = t; if (was) a.play().catch(() => {});
    offline[tr] = true;
  }
}
async function removeOfflineAudio() { try { await caches.delete(CACHE_AUDIO); } catch (e) {} offline.ar = offline.fa = false; for (const k in audio) { audio[k].src = AUDIO_PATH[k]; } }

/* ---------- موتور پخش ---------- */
let mode = store.get('mode', 'both'), cur = clamp(store.get('pos', 0), -1, N - 1), phase = 'ar', playing = false, timer = null, busyUntil = 0;
let rate = store.get('rate', 1);
const RATES = [0.8, 0.9, 1, 1.15, 1.3, 1.5];
function seekPlay(tr, t) {
  const a = audio[tr]; busyUntil = performance.now() + 150;
  const go = () => { a.currentTime = t; a.playbackRate = rate; a.preservesPitch = true; const p = a.play(); if (p && p.catch) p.catch(() => {}); };
  if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
}
function pauseAll() { audio.ar.pause(); audio.fa.pause(); }
function stopTimer() { clearInterval(timer); timer = null; }
function startTimer() { stopTimer(); timer = setInterval(tick, 30); }
function startAt(i, ph) {
  pauseAll(); stopFix();
  if (mode === 'ar' && i < 0) i = 0;
  cur = i;
  if (mode === 'ar') { phase = 'ar'; seekPlay('ar', W.ar[i]); }
  else if (mode === 'fa') { phase = 'fa'; seekPlay('fa', W.fa[i + 1]); }
  else { phase = i < 0 ? 'fa' : (ph || 'ar'); seekPlay(phase, phase === 'ar' ? W.ar[i] : W.fa[i + 1]); }
  playing = true; startTimer(); mark(); updateUI();
}
function finish() { pauseAll(); playing = false; stopTimer(); updateUI(); }
function tick() {
  if (!playing || performance.now() < busyUntil) return;
  if (mode === 'ar' || mode === 'fa') {
    const a = audio[mode], t = a.currentTime;
    if (a.ended || t >= END[mode] - 0.05) { finish(); return; }
    const idx = mode === 'ar' ? lineAt(W.ar, t) : lineAt(W.fa, t) - 1;
    if (idx !== cur && !(mode === 'ar' && idx < 0)) { cur = idx; mark(); }
    updateInfo();
    return;
  }
  const k = phase === 'ar' ? cur : cur + 1;
  const a = audio[phase];
  if (a.ended || a.currentTime >= itemEnd(phase, k, true) - 0.02) {
    a.pause();
    if (phase === 'ar') { phase = 'fa'; seekPlay('fa', W.fa[cur + 1]); }
    else { if (cur + 1 >= N) { finish(); return; } cur++; phase = 'ar'; seekPlay('ar', W.ar[cur]); mark(); }
    updateUI();
  }
  updateInfo();
}
function togglePlay() {
  if (playing) { pauseAll(); playing = false; stopTimer(); updateUI(); return; }
  const tr = mode === 'both' ? phase : mode;
  const k = tr === 'ar' ? cur : cur + 1;
  const a = audio[tr];
  if (cur >= 0 || tr === 'fa') {
    if (k >= 0 && a.currentTime >= W[tr][k] - 0.3 && a.currentTime < itemNext(tr, k) && !a.ended) { playing = true; a.playbackRate = rate; a.play().catch(() => {}); startTimer(); updateUI(); return; }
  }
  startAt(cur < 0 && mode === 'ar' ? 0 : cur, 'ar');
}
function go(i) {
  i = clamp(i, mode === 'ar' ? 0 : -1, N - 1);
  if (playing) startAt(i, 'ar'); else { cur = i; pauseAll(); mark(); updateUI(); }
}
function setMode(m) { mode = m; store.set('mode', m); if (playing) startAt(cur, 'ar'); else { if (m === 'ar' && cur < 0) cur = 0; mark(); } updateUI(); }
function setRate(r) { rate = r; store.set('rate', r); audio.ar.playbackRate = r; audio.fa.playbackRate = r; updateUI(); }

/* ---------- نمایش ---------- */
let prevEl = null;
function mark() {
  if (prevEl) prevEl.classList.remove('active', 'phase-ar', 'phase-fa');
  const e = cur < 0 ? $('#intro') : document.getElementById('l' + cur);
  prevEl = e;
  if (e) {
    e.classList.add('active');
    if (mode === 'both') e.classList.add(phase === 'ar' ? 'phase-ar' : 'phase-fa');
    if (S.autoscroll && !fixActive) e.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (cur >= 0) store.set('pos', cur);
  const sk = $('#seek'); if (sk && +sk.value !== Math.max(cur, 0)) sk.value = Math.max(cur, 0);
  updateInfo();
}
function updateInfo() {
  const tr = mode === 'both' ? phase : mode;
  const t = audio[tr] ? audio[tr].currentTime : 0;
  $('#info').textContent = (cur < 0 ? 'مقدمه' : 'جملهٔ ' + fa(cur + 1) + ' از ' + fa(N)) + (playing ? ' · ' + fmt(t) : '');
  if (prevEl && mode === 'both') { prevEl.classList.toggle('phase-ar', phase === 'ar'); prevEl.classList.toggle('phase-fa', phase === 'fa'); }
}
function updateUI() {
  $('#c-play').textContent = playing ? '⏸' : '▶';
  $('#c-rate').textContent = fa(rate) + '×';
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  updateInfo();
}
$('#c-play').onclick = togglePlay;
$('#c-next').onclick = $('#a-next').onclick = () => go(cur + 1);
$('#c-prev').onclick = $('#a-prev').onclick = () => go(cur - 1);
$('#c-rate').onclick = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length] || 1);
$('#modes').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };
$('#seek').addEventListener('input', e => { $('#info').textContent = 'جملهٔ ' + fa(+e.target.value + 1) + ' از ' + fa(N); });
$('#seek').addEventListener('change', e => go(+e.target.value));
$('#btn-mode').onclick = () => { S.mode = S.mode === 'night' ? 'day' : 'night'; applyLook(); };
$('#btn-set').onclick = () => { renderSheet(); document.body.classList.add('sheet-open'); };
$('#sheet-bg').onclick = () => document.body.classList.remove('sheet-open');
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'دعای کمیل', artist: 'دعای کمیل' });
    navigator.mediaSession.setActionHandler('play', togglePlay); navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('nexttrack', () => go(cur + 1)); navigator.mediaSession.setActionHandler('previoustrack', () => go(cur - 1));
  } catch (e) {}
}

/* ---------- تنظیمات ---------- */
function renderSheet() {
  const sh = $('#sheet'); sh.innerHTML = '';
  const add = (title, ...kids) => { const s = el('div', 'set'); if (title) s.append(el('h3', '', title)); s.append(...kids); sh.append(s); return s; };
  sh.append(el('h2', '', 'تنظیمات'));
  const sw = el('div', 'chips');
  [['green', 'سبز'], ['indigo', 'لاجورد'], ['emerald', 'زمرد']].forEach(([t, n]) => { const b = el('button', 'sw' + (S.theme === t ? ' on' : '')); b.dataset.t = t; b.title = n; b.setAttribute('aria-label', n); b.onclick = () => { S.theme = t; applyLook(); renderSheet(); }; sw.append(b); });
  const md = el('div', 'chips');
  [['day', 'روز'], ['night', 'شب']].forEach(([m, n]) => { const b = el('button', 'chip' + (S.mode === m ? ' on' : ''), n); b.onclick = () => { S.mode = m; applyLook(); renderSheet(); }; md.append(b); });
  add('رنگ‌بندی', sw, el('div', '', ''), md);
  const sizeRow = (label, key, step, lo, hi) => {
    const r = el('div', 'row2'); r.append(el('span', '', label), el('span', 'spacer'));
    const m = el('button', 'btn sm', 'A−'), p = el('button', 'btn sm', 'A+'), v = el('span', '', fa(S[key]));
    m.onclick = () => { S[key] = clamp(S[key] - step, lo, hi); applyLook(); v.textContent = fa(S[key]); };
    p.onclick = () => { S[key] = clamp(S[key] + step, lo, hi); applyLook(); v.textContent = fa(S[key]); };
    r.append(m, v, p); return r;
  };
  add('اندازهٔ نوشته', sizeRow('عربی', 'ar', 2, 20, 56), sizeRow('ترجمه', 'fa', 1, 12, 30));
  const tg = (label, key) => { const b = el('button', 'chip' + (S[key] ? ' on' : ''), label + (S[key] ? ': روشن' : ': خاموش')); b.onclick = () => { S[key] = !S[key]; applyLook(); renderSheet(); }; return b; };
  add('نمایش', el('div', 'chips', ''), tg('نمایش ترجمه', 'showFa'), document.createTextNode(' '), tg('حرکت خودکار متن', 'autoscroll'));
  // آفلاین
  const off = el('div'); const ok = offline.ar && offline.fa;
  off.append(el('p', '', ok ? '✔ متن و صوت روی این دستگاه ذخیره شده و بدون اینترنت کار می‌کند.' : 'برای شنیدن بدون اینترنت، فایل‌های صوتی (حدود ۱۲ مگابایت) را روی دستگاه ذخیره کن. متن به‌طور خودکار آفلاین می‌شود.'));
  const bar = el('div', 'bar'); const bi = el('i'); bar.append(bi); const msg = el('p', '', '');
  const btn = el('button', 'btn pri', ok ? 'ذخیرهٔ دوباره' : 'ذخیره برای آفلاین');
  btn.onclick = async () => {
    btn.disabled = true; msg.textContent = 'در حال دریافت…';
    try { await downloadAudio((tr, g, tot) => { const part = tr === 'ar' ? 0 : 0.5; bi.style.width = Math.min(100, (part + (tot ? g / tot : 0.5) * 0.5) * 100) + '%'; msg.textContent = (tr === 'ar' ? 'صوت عربی' : 'صوت ترجمه') + ': ' + fa(Math.round(g / 1048576 * 10) / 10) + ' مگابایت'; }); renderSheet(); }
    catch (e) { msg.textContent = 'ذخیره نشد: ' + e.message; btn.disabled = false; }
  };
  const row = el('div', 'row2'); row.append(btn);
  if (ok) { const d = el('button', 'btn', 'حذف صدا از دستگاه'); d.onclick = async () => { await removeOfflineAudio(); renderSheet(); }; row.append(d); }
  off.append(row, bar, msg); add('ذخیرهٔ آفلاین', off);
  // زمان‌ها
  const tm = el('div'); tm.append(el('p', '', hasOverride ? 'زمان‌بندی اصلاح‌شدهٔ این دستگاه در حال استفاده است.' : 'زمان‌بندی پیش‌فرض برنامه در حال استفاده است.'));
  const tr = el('div', 'row2'); const fx = el('a', 'btn', 'ابزار اصلاح زمان'); fx.href = '#fix'; fx.onclick = () => document.body.classList.remove('sheet-open'); tr.append(fx);
  if (hasOverride) { const r = el('button', 'btn', 'حذف اصلاحات'); r.onclick = () => { store.del('times'); location.reload(); }; tr.append(r); }
  tm.append(tr); add('زمان‌بندی جمله‌ها', tm);
  add('منبع', el('p', '', SOURCE_TEXT));
  const cl = el('button', 'btn pri', 'بستن'); cl.onclick = () => document.body.classList.remove('sheet-open'); sh.append(cl);
}

/* ---------- ابزار اصلاح زمان (#fix) ---------- */
let fixActive = false, fx = null, fxTimer = null;
function stopFix() { if (fxTimer) { clearInterval(fxTimer); fxTimer = null; } if (fx) fx.stopAt = null; }
function toast(t) { const d = el('div', 'toast', t); document.body.append(d); setTimeout(() => d.remove(), 1800); }
function fxLabel(tr, k) { return tr === 'ar' ? 'جملهٔ ' + fa(k + 1) : (k === 0 ? 'مقدمه' : 'جملهٔ ' + fa(k)); }
function fxText(tr, k) { if (tr === 'ar') return D.lines[k] ? D.lines[k].ar : ''; return k === 0 ? D.intro : (D.lines[k - 1] ? D.lines[k - 1].fa : ''); }
function fxPlay(t0, stopAt) {
  pauseAll(); playing = false; stopTimer(); stopFix();
  fx.stopAt = stopAt;
  seekPlay(fx.tr, Math.max(0, t0));
  fxTimer = setInterval(() => {
    const a = audio[fx.tr]; const live = $('#fx-live'); if (live) live.textContent = 'زمان فعلی: ' + fmt(a.currentTime);
    if (fx.stopAt != null && performance.now() > busyUntil && a.currentTime >= fx.stopAt) { a.pause(); stopFix(); }
  }, 50);
}
const fxStart = () => W[fx.tr][fx.k];
function fxSetStart(t) {
  const arr = W[fx.tr], k = fx.k;
  const lo = k > 0 ? arr[k - 1] + 0.3 : 0, hi = k + 1 < arr.length ? arr[k + 1] - 0.3 : END[fx.tr] - 0.3;
  arr[k] = Math.round(clamp(t, lo, hi) * 100) / 100; saveOverride(); renderFix();
  if (fx.auto) fxPlay(arr[k] - 1.5, arr[k] + 3);
}
function fxOnsets() { return T0.pauses[fx.tr].map(([a, b]) => Math.round((b - 0.12) * 100) / 100); }
function fxGo(k) { fx.k = clamp(k, 0, nItems(fx.tr) - 1); stopFix(); pauseAll(); renderFix(); fxPlay(fxStart() - 1.5, fxStart() + 4); window.scrollTo(0, 0); }
function fxNextSuspect() {
  const list = T0.suspects[fx.tr].filter(k => !fx.chk[fx.tr].includes(k)); if (!list.length) return fx.k + 1;
  const after = list.find(k => k > fx.k); return after != null ? after : list[0];
}
function fxJSON() {
  return JSON.stringify({ v: T0.v, ar: W.ar, fa: W.fa, checked_ar: fx.chk.ar.slice().sort((a, b) => a - b), checked_fa: fx.chk.fa.slice().sort((a, b) => a - b) });
}
function renderFix() {
  const box = $('#view-fix'); box.innerHTML = '';
  const tr = fx.tr, k = fx.k, nI = nItems(tr);
  const card = (...kids) => { const c = el('div', 'fx-card'); c.append(...kids); box.append(c); return c; };
  const btn = (txt, fn, cls) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), txt); b.onclick = fn; return b; };
  // سربرگ و مسیر
  const head = el('div', 'row2'); head.append(el('strong', '', 'اصلاح زمان‌بندی'), el('span', 'spacer'));
  const back = el('a', 'btn sm', '← برنامه'); back.href = '#'; head.append(back);
  card(head);
  const tabs = el('div', 'chips');
  [['ar', 'صوت عربی'], ['fa', 'صوت ترجمه']].forEach(([t, n]) => { const c = el('button', 'chip' + (tr === t ? ' on' : ''), n); c.onclick = () => { fx.tr = t; fx.k = 0; stopFix(); pauseAll(); renderFix(); }; tabs.append(c); });
  const auto = el('button', 'chip' + (fx.auto ? ' on' : ''), 'پخش خودکار بعد از تغییر'); auto.onclick = () => { fx.auto = !fx.auto; renderFix(); };
  card(tabs, el('div'), auto);
  // مشکوک‌ها
  const sus = el('div', 'sus');
  T0.suspects[tr].filter(x => x < nI).forEach(x => {
    const done = fx.chk[tr].includes(x);
    const c = el('button', 'chip ' + (x === k ? 'here' : done ? 'done' : 'warn'), (done ? '✓ ' : '') + (tr === 'ar' ? fa(x + 1) : fa(x)));
    c.onclick = () => fxGo(x); sus.append(c);
  });
  card(el('div', 'fx-ctx', 'جمله‌های مشکوک (اول اینها را کنترل کن):'), sus);
  // زمینه و جملهٔ فعلی
  const c1 = card();
  if (k > 0) c1.append(el('div', 'fx-ctx' + (tr === 'ar' ? ' ar' : ''), '↑ ' + fxLabel(tr, k - 1) + ': ' + fxText(tr, k - 1)));
  c1.append(el('div', 'fx-ctx', '▶ ' + fxLabel(tr, k) + ' — از ' + fa(nI) + ' (جمله‌ای که باید از اینجا شروع شود)'));
  c1.append(el('div', 'fx-cur' + (tr === 'ar' ? ' ar' : ''), fxText(tr, k)));
  if (k + 1 < nI) c1.append(el('div', 'fx-ctx' + (tr === 'ar' ? ' ar' : ''), '↓ ' + fxLabel(tr, k + 1) + ': ' + fxText(tr, k + 1)));
  // زمان
  card(el('div', 'fx-ctx', 'زمان شروع این جمله در صوت:'), el('div', 'fx-time', fmt(fxStart())), (() => { const l = el('div', 'fx-live', 'زمان فعلی: —'); l.id = 'fx-live'; return l; })());
  // پخش
  const g1 = el('div', 'grid2');
  g1.append(btn('▶ پخش مرز (۱٫۵ث قبل تا ۴ث بعد)', () => fxPlay(fxStart() - 1.5, fxStart() + 4), 'pri'), btn('▶ پخش آزاد از ۳ث قبل', () => fxPlay(fxStart() - 3, null)),
    btn('▶ پخش همین جمله', () => fxPlay(fxStart(), itemNext(tr, k))), btn('⏹ توقف', () => { audio[tr].pause(); stopFix(); }));
  card(g1);
  // تغییر زمان
  const g2 = el('div', 'grid4');
  [['−۱', -1], ['−۰٫۲', -0.2], ['+۰٫۲', 0.2], ['+۱', 1]].forEach(([n, d]) => g2.append(btn(n + 'ث', () => fxSetStart(fxStart() + d))));
  const g3 = el('div', 'grid2');
  g3.append(btn('⇠ مکث قبلی', () => { const c = fxOnsets().filter(t => t < fxStart() - 0.05).pop(); if (c != null) fxSetStart(c); else toast('مکث قبلی نیست'); }),
    btn('مکث بعدی ⇢', () => { const c = fxOnsets().find(t => t > fxStart() + 0.05); if (c != null) fxSetStart(c); else toast('مکث بعدی نیست'); }));
  card(el('div', 'fx-ctx', 'جابه‌جایی شروع جمله:'), g2, el('div'), g3);
  card(el('div', 'fx-ctx', 'در «پخش آزاد»، وقتی جملهٔ درست شروع شد همین دکمه را بزن:'),
    btn('✂ شروع را همین‌جا بگذار', () => { const t = audio[tr].currentTime; fxSetStart(t - 0.1); }, 'pri'));
  // تأیید و ناوبری
  const g4 = el('div', 'grid2');
  const isChk = fx.chk[tr].includes(k);
  g4.append(btn(isChk ? '✓ تأیید شده (برای برداشتن بزن)' : '✓ درست است، بعدی', () => {
    if (isChk) fx.chk[tr] = fx.chk[tr].filter(x => x !== k); else { fx.chk[tr].push(k); store.set('chk', fx.chk); fxGo(fxNextSuspect()); return; }
    store.set('chk', fx.chk); renderFix();
  }, 'pri'), btn('بعدی مشکوک ⇢', () => fxGo(fxNextSuspect())));
  const nav = el('div', 'row2'); const num = el('input'); num.type = 'number'; num.min = 1; num.max = nI; num.value = tr === 'ar' ? k + 1 : k; num.style.cssText = 'width:80px;padding:6px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)';
  num.onchange = () => fxGo(tr === 'ar' ? +num.value - 1 : +num.value);
  nav.append(btn('← قبلی', () => fxGo(k - 1)), btn('بعدی →', () => fxGo(k + 1)), el('span', 'spacer'), el('span', '', 'برو به شمارهٔ'), num);
  card(g4, el('div'), nav);
  // JSON
  const ta = el('textarea'); ta.id = 'fx-json'; ta.readOnly = true; ta.value = fxJSON();
  const g5 = el('div', 'grid2');
  g5.append(btn('📋 کپی JSON زمان‌ها', async () => { ta.value = fxJSON(); try { await navigator.clipboard.writeText(ta.value); toast('کپی شد'); } catch (e) { ta.select(); try { document.execCommand('copy'); toast('کپی شد'); } catch (e2) { toast('متن را دستی انتخاب و کپی کن'); } } }, 'pri'),
    btn('▶ آزمایش در برنامه', () => { location.hash = ''; }));
  const rs = btn('بازنشانی همهٔ اصلاحات این دستگاه', () => { if (confirm('همهٔ اصلاحات پاک شود؟')) { store.del('times'); store.del('chk'); location.reload(); } }, 'sm');
  card(el('div', 'fx-ctx', 'بعد از اصلاح، این متن را کپی کن و برای من بفرست:'), ta, el('div'), g5, el('div'), rs);
}
function route() {
  document.body.classList.remove('sheet-open');
  const isFix = location.hash === '#fix';
  if (isFix === fixActive && !(isFix && !fx)) return;
  fixActive = isFix;
  $('#view-main').hidden = isFix; $('#view-fix').hidden = !isFix;
  $('#player').hidden = isFix; $('#arrows').hidden = isFix;
  document.body.classList.toggle('fixmode', isFix);
  if (isFix) {
    pauseAll(); playing = false; stopTimer();
    fx = fx || { tr: 'ar', k: T0.suspects.ar[0] || 0, auto: true, chk: Object.assign({ ar: [], fa: [] }, store.get('chk', {})) };
    renderFix(); window.scrollTo(0, 0);
  } else { stopFix(); pauseAll(); mark(); }
}
window.addEventListener('hashchange', route);

/* ---------- شروع ---------- */
applyLook(); updateUI(); mark();
{ const sk = $('#seek'); sk.max = N - 1; sk.value = Math.max(cur, 0); }
setTimeout(() => { if (cur > 0 && S.autoscroll) { const e = document.getElementById('l' + cur); if (e) e.scrollIntoView({ block: 'center' }); } }, 100);
loadCachedAudio();
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__komeil = { W, audio, go, startAt, setMode, get state() { return { mode, cur, phase, playing }; } };
})();
