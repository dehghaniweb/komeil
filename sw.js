// سرویس‌ورکر دعای کمیل: پوستهٔ برنامه آفلاین می‌شود؛ فایل‌های صوتی را خود برنامه (دکمهٔ «ذخیره برای آفلاین») نگه می‌دارد.
const SHELL = 'komeil-shell-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'times.js', 'manifest.webmanifest', 'icon.svg',
  'fonts/AmiriQuran.ttf', 'fonts/Vazirmatn-Regular.woff2', 'fonts/Vazirmatn-Medium.woff2', 'fonts/Vazirmatn-Bold.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('komeil-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/audio/') || req.headers.has('range')) return;   // صوت دست‌نخورده
  const isFont = url.pathname.includes('/fonts/');
  if (isFont) {   // فونت: اول حافظه
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => { const cp = n.clone(); caches.open(SHELL).then(c => c.put(req, cp)); return n; })));
    return;
  }
  // بقیه: اول شبکه (تا اصلاح زمان‌ها و متن زود برسد)، اگر نبود حافظه
  e.respondWith(fetch(req).then(n => { const cp = n.clone(); caches.open(SHELL).then(c => c.put(req, cp)); return n; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
