'use strict';
/* سرور همراه سفر — Express 5 + libSQL */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

/* بارگذاری ساده .env */
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch { /* فایل .env اختیاری است */ }

const { db, tx, init, close, hashPassword, verifyPassword, DATA_DIR, SETTING_KEYS } = require('./db');
const { SITE_ORIGIN, loadAdmin, can, HttpError, bad } = require('./office/core');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const SESSION_MS = 12 * 3600 * 1000;
const STATUSES = ['در انتظار پرداخت', 'تأیید شده', 'لغو شده'];
const CATEGORIES = ['nature', 'pilgrimage', 'recreation'];

/* ───────── ابزارها ───────── */
const faToEn = s => String(s ?? '').replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const todayISO = () => new Date().toISOString().slice(0, 10);


/* محدودکننده نرخ ساده (در حافظه) */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); throw bad('تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.', 429); }
  arr.push(now); hits.set(key, arr);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of hits) if (!a.some(t => now - t < 3600e3)) hits.delete(k);
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now]).catch(() => {});
}, 600e3).unref();

/* ───────── نگاشت سفر ───────── */
const TRIP_SQL = `SELECT t.*, COALESCE((SELECT SUM(count) FROM bookings b WHERE b.trip_id = t.id AND b.status != 'لغو شده'), 0) AS booked FROM trips t`;
const j = s => { try { return JSON.parse(s); } catch { return []; } };
const tripOut = r => ({
  id: r.id, title: r.title, category: r.category, transport: r.transport, destination: r.destination, date: r.date, price: r.price,
  capacity: r.capacity, booked: r.booked, seatsLeft: Math.max(0, r.capacity - r.booked), duration: r.duration, bestSeason: r.best_season,
  tagline: r.tagline, description: r.description, image: r.image, imagePos: r.image_pos, featured: !!r.featured, active: !!r.active,
  highlights: j(r.highlights), itinerary: j(r.itinerary), includes: j(r.includes)
});

async function validateTrip(b, existingId) {
  const t = {
    title: clean(b.title, 120), category: b.category, transport: clean(b.transport, 40), destination: clean(b.destination, 120),
    date: b.date ? clean(faToEn(b.date), 10) : null, price: Number(b.price), capacity: Number(b.capacity),
    duration: clean(b.duration, 40), best_season: clean(b.bestSeason, 80), tagline: clean(b.tagline, 120), description: clean(b.description, 1500),
    image: clean(b.image, 300), image_pos: clean(b.imagePos || 'center', 30), featured: b.featured ? 1 : 0, active: b.active === false ? 0 : 1
  };
  if (t.title.length < 3) throw bad('عنوان سفر باید حداقل ۳ حرف باشد.');
  if (!CATEGORIES.includes(t.category)) throw bad('دسته سفر نامعتبر است.');
  if (!t.transport) throw bad('وسیله نقلیه را مشخص کنید.');
  if (!t.destination) throw bad('مقصد را وارد کنید.');
  if (t.date && (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || isNaN(Date.parse(t.date)))) throw bad('تاریخ نامعتبر است.');
  if (!Number.isInteger(t.price) || t.price < 0 || t.price > 1e9) throw bad('قیمت نامعتبر است.');
  if (!Number.isInteger(t.capacity) || t.capacity < 1 || t.capacity > 1000) throw bad('ظرفیت باید بین ۱ تا ۱۰۰۰ باشد.');
  if (t.image && !/^(assets\/img\/|\/uploads\/|https:\/\/)[^\s'"()\\]+$/.test(t.image)) throw bad('آدرس تصویر نامعتبر است.');
  if (!/^[\w\s%.,-]+$/.test(t.image_pos)) t.image_pos = 'center';
  const strs = (a, n, m) => (Array.isArray(a) ? a : []).map(x => clean(x, m)).filter(Boolean).slice(0, n);
  t.highlights = JSON.stringify(strs(b.highlights, 12, 140));
  t.includes = JSON.stringify(strs(b.includes, 12, 140));
  t.itinerary = JSON.stringify((Array.isArray(b.itinerary) ? b.itinerary : []).slice(0, 14)
    .map(x => Array.isArray(x) ? [clean(x[0], 40), clean(x[1], 300)] : null).filter(x => x && x[0] && x[1]));
  if (t.featured && (await db.get('SELECT COUNT(*) c FROM trips WHERE featured = 1 AND id != ?', [existingId || ''])).c >= 3)
    throw bad('حداکثر ۳ تور ویژه مجاز است؛ ابتدا یکی را از حالت ویژه خارج کنید.', 409);
  return t;
}

/* ───────── احراز هویت ───────── */
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* نامعتبر */ } } });
  return o;
}
async function currentAdmin(req) {
  const tok = parseCookies(req).sid; if (!tok) return null;
  const row = await db.get(`SELECT a.id, a.username, a.full_name, a.kind, a.agent_id, a.active, s.expires_at, r.perms FROM sessions s JOIN admins a ON a.id = s.admin_id LEFT JOIN roles r ON r.id = a.role_id WHERE s.token_hash = ?`, [sha(tok)]);
  return row && row.expires_at >= Date.now() && row.active ? loadAdmin(row) : null;
}
const sidCookie = (val, maxAge) => `sid=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;

/* میان‌افزارها */
const requireAdmin = async (req, res, next) => {
  const a = await currentAdmin(req);
  if (!a) throw bad('برای ادامه وارد شوید.', 401);
  req.admin = a; next();
};
const sameOrigin = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const o = req.headers.origin;
  if (o) { let ok = false; try { ok = new URL(o).host === req.headers.host || o === SITE_ORIGIN; } catch { /* نامعتبر */ } if (!ok) throw bad('درخواست از مبدأ نامعتبر.', 403); }
  next();
};

/* ───────── برنامه ───────── */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
});

const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(sameOrigin);
api.use(express.json({ limit: '200kb' }));

/* عمومی */
api.get('/trips', async (req, res) => {
  res.json({ trips: (await db.all(TRIP_SQL + ' WHERE t.active = 1 ORDER BY (t.date IS NULL), t.date')).map(tripOut) });
});

api.get('/settings', async (req, res) => {
  res.json({ settings: Object.fromEntries((await db.all('SELECT key, value FROM settings')).map(r => [r.key, r.value])) });
});

api.post('/messages', async (req, res) => {
  rateLimit('msg:' + req.ip, 5, 600e3);
  const b = req.body || {};
  const name = clean(b.name, 80), phone = faToEn(clean(b.phone, 20)), message = clean(b.message, 1000);
  if (name.length < 3) throw bad('نام را کامل وارد کنید.');
  if (!/^09\d{9}$/.test(phone)) throw bad('شماره موبایل معتبر نیست.');
  await db.run('INSERT INTO messages (name, phone, message) VALUES (?,?,?)', [name, phone, message]);
  res.json({ ok: true });
});

const office = require('./office')({ rateLimit });
api.use(office.pub);

/* ورود و خروج مدیر */
api.post('/admin/login', async (req, res) => {
  rateLimit('login:' + req.ip, 8, 15 * 60e3);
  const b = req.body || {};
  const row = await db.get('SELECT * FROM admins WHERE username = ? AND active = 1', [clean(b.username, 60)]);
  const ok = row ? verifyPassword(String(b.password ?? ''), row.password_hash) : (verifyPassword('x', hashPassword('y')), false);
  if (!ok) throw bad('نام کاربری یا رمز عبور درست نیست.', 401);
  const tok = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?,?,?)', [sha(tok), row.id, Date.now() + SESSION_MS]);
  res.set('Set-Cookie', sidCookie(tok, SESSION_MS / 1000)).json({ ok: true, username: row.username });
});
api.post('/admin/logout', async (req, res) => {
  const tok = parseCookies(req).sid;
  if (tok) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(tok)]);
  res.set('Set-Cookie', sidCookie('', 0)).json({ ok: true });
});

/* از اینجا به بعد فقط مدیر */
const admin = express.Router();
admin.use(requireAdmin);

/* دسترسی بخش‌های قدیمی پنل بر اساس نقش (نماینده‌ها به این بخش‌ها راه ندارند) */
const LEGACY_PERM = { trips: 'trips', bookings: 'bookings', 'bookings.csv': 'bookings', messages: 'messages', settings: 'settings', upload: 'trips' };
admin.use((req, res, next) => {
  const seg = req.path.split('/')[1];
  if (seg === 'me' || seg === 'password') return next();
  if (seg === 'stats') { if (req.admin.isAgent) throw bad('شما به این بخش دسترسی ندارید.', 403); return next(); }
  const perm = LEGACY_PERM[seg];
  if (!perm || !(can(req.admin, perm) || (req.method === 'GET' && seg === 'trips' && can(req.admin, 'bookings')) || (req.method === 'GET' && seg === 'trips' && can(req.admin, 'accounting')))) throw bad('شما به این بخش دسترسی ندارید.', 403);
  next();
});
admin.get('/me', (req, res) => res.json({ username: req.admin.username, fullName: req.admin.full_name, kind: req.admin.kind, isAgent: req.admin.isAgent, perms: req.admin.perms }));
admin.post('/password', async (req, res) => {
  const b = req.body || {};
  const row = await db.get('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
  if (!verifyPassword(String(b.current ?? ''), row.password_hash)) throw bad('رمز فعلی درست نیست.', 403);
  const np = String(b.next ?? '');
  if (np.length < 8) throw bad('رمز جدید باید حداقل ۸ نویسه باشد.');
  const cur = sha(parseCookies(req).sid);
  await tx(async t => {
    await t.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(np), req.admin.id]);
    await t.run('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?', [req.admin.id, cur]);
  });
  res.json({ ok: true });
});

/* سفرها */
admin.get('/trips', async (req, res) => res.json({ trips: (await db.all(TRIP_SQL + ' ORDER BY (t.date IS NULL), t.date')).map(tripOut) }));
admin.post('/trips', async (req, res) => {
  const t = await validateTrip(req.body || {}, '');
  const id = 'trip-' + crypto.randomBytes(5).toString('hex');
  await db.run(`INSERT INTO trips (id,title,category,transport,destination,date,price,capacity,duration,best_season,tagline,description,image,image_pos,featured,highlights,itinerary,includes,active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, t.title, t.category, t.transport, t.destination, t.date, t.price, t.capacity, t.duration, t.best_season, t.tagline, t.description, t.image, t.image_pos, t.featured, t.highlights, t.itinerary, t.includes, t.active]);
  res.json({ ok: true, id });
});
admin.put('/trips/:id', async (req, res) => {
  const cur = await db.get(TRIP_SQL + ' WHERE t.id = ?', [req.params.id]);
  if (!cur) throw bad('سفر یافت نشد.', 404);
  const t = await validateTrip(req.body || {}, req.params.id);
  if (t.capacity < cur.booked) throw bad(`ظرفیت نمی‌تواند کمتر از تعداد صندلی‌های رزروشده (${cur.booked}) باشد.`, 409);
  await db.run(`UPDATE trips SET title=?,category=?,transport=?,destination=?,date=?,price=?,capacity=?,duration=?,best_season=?,tagline=?,description=?,image=?,image_pos=?,featured=?,highlights=?,itinerary=?,includes=?,active=? WHERE id=?`,
    [t.title, t.category, t.transport, t.destination, t.date, t.price, t.capacity, t.duration, t.best_season, t.tagline, t.description, t.image, t.image_pos, t.featured, t.highlights, t.itinerary, t.includes, t.active, req.params.id]);
  res.json({ ok: true });
});
admin.delete('/trips/:id', async (req, res) => {
  if ((await db.get('SELECT COUNT(*) c FROM bookings WHERE trip_id = ?', [req.params.id])).c) throw bad('این سفر رزرو دارد و حذف نمی‌شود؛ به‌جای آن غیرفعالش کنید.', 409);
  await db.run('DELETE FROM trips WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* رزروها */
admin.get('/bookings', async (req, res) => res.json({ bookings: await db.all('SELECT id, ref, trip_id AS tripId, trip_title AS tripTitle, name, phone, count, notes, total, status, created_at AS createdAt FROM bookings ORDER BY id DESC') }));
admin.get('/bookings.csv', async (req, res) => {
  const rows = await db.all('SELECT ref, name, phone, trip_title, count, total, status, created_at FROM bookings ORDER BY id DESC');
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`;
  const csv = '\uFEFF' + [['کد رزرو', 'نام', 'موبایل', 'سفر', 'تعداد', 'مبلغ', 'وضعیت', 'تاریخ ثبت (UTC)'], ...rows.map(r => [r.ref, r.name, r.phone, r.trip_title, r.count, r.total, r.status, r.created_at])].map(r => r.map(esc).join(',')).join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookings.csv"' }).send(csv);
});
admin.patch('/bookings/:id', async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) throw bad('وضعیت نامعتبر است.');
  await tx(async t => {
    const b = await t.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!b) throw bad('رزرو یافت نشد.', 404);
    if (b.status === 'لغو شده' && status !== 'لغو شده') {
      const trip = await t.get(TRIP_SQL + ' WHERE t.id = ?', [b.trip_id]);
      if (trip.capacity - trip.booked < b.count) throw bad('ظرفیت کافی برای فعال‌سازی دوباره این رزرو نیست.', 409);
    }
    await t.run('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);
  });
  if (status === 'تأیید شده') { const sms = require('./office/sms'), bk = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]); sms.sendTemplate('booking_confirmed', bk.phone, await sms.bookingVars(bk), { bookingId: bk.id, customerId: bk.customer_id }); }
  res.json({ ok: true });
});

/* پیام‌ها */
admin.get('/messages', async (req, res) => res.json({ messages: await db.all('SELECT id, name, phone, message, handled, created_at AS createdAt FROM messages ORDER BY id DESC') }));
admin.patch('/messages/:id', async (req, res) => { await db.run('UPDATE messages SET handled = ? WHERE id = ?', [req.body?.handled ? 1 : 0, req.params.id]); res.json({ ok: true }); });
admin.delete('/messages/:id', async (req, res) => { await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]); res.json({ ok: true }); });

/* تنظیمات سایت */
admin.put('/settings', async (req, res) => {
  const b = req.body || {};
  await tx(async t => { for (const k of SETTING_KEYS) if (k in b) await t.run('UPDATE settings SET value = ? WHERE key = ?', [clean(b[k], k === 'address' || k === 'hours' ? 200 : 100), k]); });
  res.json({ ok: true });
});

/* آمار */
admin.get('/stats', async (req, res) => {
  const one = async sql => (await db.get(sql)).c;
  const [trips, capacity, bookings, pending, seatsBooked, revenue, newMessages] = await Promise.all([
    one('SELECT COUNT(*) c FROM trips WHERE active = 1'),
    one('SELECT COALESCE(SUM(capacity),0) c FROM trips WHERE active = 1'),
    one("SELECT COUNT(*) c FROM bookings WHERE status != 'لغو شده'"),
    one("SELECT COUNT(*) c FROM bookings WHERE status = 'در انتظار پرداخت'"),
    one("SELECT COALESCE(SUM(count),0) c FROM bookings WHERE status != 'لغو شده'"),
    one("SELECT COALESCE(SUM(total),0) c FROM bookings WHERE status = 'تأیید شده'"),
    one('SELECT COUNT(*) c FROM messages WHERE handled = 0')
  ]);
  res.json({ trips, capacity, bookings, pending, seatsBooked, revenue, newMessages });
});

/* آپلود تصویر (بدنه خام؛ نوع فایل از روی امضای بایتی بررسی می‌شود) */
admin.post('/upload', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  let ext = null;
  if (buf.length > 12) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = '.jpg';
    else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = '.png';
    else if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') ext = '.webp';
  }
  if (!ext) throw bad('فقط تصویر JPG، PNG یا WebP تا ۵ مگابایت مجاز است.', 415);
  const name = crypto.randomBytes(10).toString('hex') + ext;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf);
  res.json({ url: '/uploads/' + name });
});

api.use('/admin', admin);
api.use('/office', requireAdmin, office.office);
api.use((req, res) => { throw bad('مسیر یافت نشد.', 404); });
app.use('/api', api);

/* ───────── فایل‌های استاتیک ───────── */
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true, index: false, dotfiles: 'ignore' }));
app.use(express.static(PUBLIC_DIR, {
  maxAge: '1h', index: 'index.html', dotfiles: 'ignore',
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('صفحه پیدا نشد.'));

/* مدیریت خطا */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'قالب درخواست نامعتبر است.' });
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور.' });
});

/* ───────── اجرا ───────── */
let server;
init().then(() => {
  server = app.listen(PORT, () => console.log(`همراه سفر در حال اجراست: http://localhost:${PORT}`));
  office.reminders.start();
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `پورت ${PORT} در حال استفاده است. PORT دیگری در .env بگذارید.` : e); process.exit(1); });
}).catch(e => { console.error('خطا در راه‌اندازی پایگاه داده:', e); process.exit(1); });
const stop = () => { server?.close(); close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
