'use strict';
/* پیامک، یادآوری، تنظیمات عملیاتی، گزارش‌ها و اطلاعات سیستم */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, DATA_DIR } = require('../db');
const { bad, clean, faToEn, int, todayISO, need, audit, sendCsv, jnum, getConfig } = require('./core');
const F = require('./finance');
const sms = require('./sms');
const reminders = require('./reminders');
const { BOOKING_SQL, withFin } = require('./routes-fin');

const r = express.Router();
const CATEGORY_NAMES = { nature: 'طبیعت‌گردی', pilgrimage: 'زیارتی', recreation: 'تفریحی و فرهنگی' };
const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const range = req => { const from = clean(faToEn(req.query.from), 10), to = clean(faToEn(req.query.to), 10); return { from: dateOk(from) ? from : '1970-01-01', to: dateOk(to) ? to : '2999-12-31' }; };
const day = c => `date(${c}, '+210 minutes')`;

/* ───── پیامک ───── */
r.get('/sms/status', need('sms'), async (req, res) => res.json({ provider: sms.provider(), enabled: (await getConfig()).smsEnabled === '1', live: sms.provider() !== 'log' }));
r.get('/sms/templates', need('sms'), async (req, res) => res.json({ templates: (await db.all('SELECT key, title, body, enabled FROM sms_templates ORDER BY rowid')).map(t => ({ ...t, enabled: !!t.enabled })),
  vars: ['name', 'ref', 'trip', 'date', 'total', 'balance', 'amount', 'receipt', 'seq', 'when', 'minutes', 'agency', 'extra'] }));
r.put('/sms/templates/:key', need('sms'), async (req, res) => {
  const body = clean(req.body?.body, 400); if (body.length < 5) throw bad('متن پیامک را بنویسید.');
  const x = await db.run('UPDATE sms_templates SET body = ?, enabled = ? WHERE key = ?', [body, req.body?.enabled === false ? 0 : 1, req.params.key]);
  if (!x.changes) throw bad('قالب یافت نشد.', 404); await audit(req, 'ویرایش قالب پیامک', req.params.key); res.json({ ok: true });
});
r.get('/sms/log', need('sms'), async (req, res) => res.json({ log: await db.all('SELECT id, phone, text, kind, status, provider, error, created_at AS createdAt FROM sms_log ORDER BY id DESC LIMIT ?', [Math.min(Number(req.query.limit) || 100, 500)]) }));
r.post('/sms/send', need('sms'), async (req, res) => {
  const phone = faToEn(clean(req.body?.phone, 20)), text = clean(req.body?.text, 400);
  if (!/^09\d{9}$/.test(phone)) throw bad('شمارهٔ موبایل معتبر نیست.'); if (text.length < 3) throw bad('متن پیام را بنویسید.');
  const id = await sms.send(phone, text, { kind: 'manual' }); if (!id) throw bad('ارسال پیامک غیرفعال است (در تنظیمات فعال کنید).', 409);
  await audit(req, 'ارسال پیامک دستی', phone); res.json({ ok: true });
});
r.post('/sms/broadcast', need('sms'), async (req, res) => {
  const text = clean(req.body?.text, 300); if (text.length < 3) throw bad('متن پیام را بنویسید.');
  const w = ["b.status = 'تأیید شده'"], args = [];
  if (req.body?.tripId) { w.push('b.trip_id = ?'); args.push(String(req.body.tripId)); } else throw bad('سفر مقصد پیام را انتخاب کنید.');
  const rows = await db.all(`SELECT DISTINCT b.phone, b.customer_id FROM bookings b WHERE ${w.join(' AND ')} LIMIT 500`, args);
  let n = 0; for (const x of rows) if (await sms.sendTemplate('broadcast', x.phone, { extra: text }, { kind: 'broadcast', customerId: x.customer_id })) n++;
  await audit(req, 'پیام گروهی', `${n} گیرنده`); res.json({ ok: true, sent: n });
});
r.get('/reminders/preview', need('sms'), async (req, res) => res.json(await reminders.preview()));
r.post('/reminders/run', need('sms'), async (req, res) => { const out = await reminders.run(); await audit(req, 'اجرای یادآوری‌ها', JSON.stringify(out)); res.json({ ok: true, ...out }); });

/* ───── تنظیمات عملیاتی ───── */
const CFG_KEYS = ['agencyName', 'smsEnabled', 'remindDays', 'installmentRemindDays', 'lateFeePercentPerDay', 'autoConfirm', 'cancelPolicy', 'receiptNote'];
r.get('/config', need('settings', 'sms', 'accounting'), async (req, res) => {
  const c = await getConfig(); const out = {}; for (const k of CFG_KEYS) out[k] = c[k];
  res.json({ config: { ...out, cancelPolicy: JSON.parse(c.cancelPolicy || '[]') }, gateway: { name: F.gatewayName(), ready: F.gatewayReady() }, smsProvider: sms.provider() });
});
r.put('/config', need('settings', 'sms', 'accounting'), async (req, res) => {
  const b = req.body || {}, set = async (k, v) => db.run('INSERT INTO config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, String(v)]);
  if ('agencyName' in b) { const v = clean(b.agencyName, 40); if (v.length < 2) throw bad('نام آژانس را وارد کنید.'); await set('agencyName', v); }
  for (const k of ['smsEnabled', 'autoConfirm']) if (k in b) await set(k, b[k] ? '1' : '0');
  if ('remindDays' in b) { const v = faToEn(clean(b.remindDays, 30)); if (v && !/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(v)) throw bad('روزهای یادآوری را با ویرگول و عدد وارد کنید (مثلاً 3,1).'); await set('remindDays', v.replace(/\s/g, '')); }
  if ('installmentRemindDays' in b) { const v = int(b.installmentRemindDays); if (!(v >= 0 && v <= 30)) throw bad('مقدار یادآوری قسط باید بین ۰ تا ۳۰ باشد.'); await set('installmentRemindDays', v); }
  if ('lateFeePercentPerDay' in b) { const v = Number(faToEn(b.lateFeePercentPerDay)); if (!(v >= 0 && v <= 10)) throw bad('درصد جریمهٔ روزانه باید بین ۰ تا ۱۰ باشد.'); await set('lateFeePercentPerDay', v); }
  if ('receiptNote' in b) await set('receiptNote', clean(b.receiptNote, 200));
  if ('cancelPolicy' in b) {
    const rules = (Array.isArray(b.cancelPolicy) ? b.cancelPolicy : []).map(x => ({ minDays: int(x.minDays), percent: Number(faToEn(x.percent)) }));
    if (!rules.length || rules.some(x => !(x.minDays >= 0 && x.minDays <= 365) || !(x.percent >= 0 && x.percent <= 100))) throw bad('قوانین لغو نامعتبر است (روز ۰ تا ۳۶۵، درصد ۰ تا ۱۰۰).');
    if (!rules.some(x => x.minDays === 0)) throw bad('یک قانون با «۰ روز» برای لغو در روز حرکت لازم است.');
    await set('cancelPolicy', JSON.stringify(rules));
  }
  await audit(req, 'تغییر تنظیمات عملیاتی'); res.json({ ok: true });
});

/* ───── گزارش‌ها ───── */
r.get('/reports/overview', need('reports'), async (req, res) => {
  const { from, to } = range(req), bd = day('b.created_at'), W = `${bd} BETWEEN ? AND ?`;
  const live = `b.status != 'لغو شده'`;
  const k = await db.get(`SELECT COUNT(*) AS bookings, COALESCE(SUM(b.count),0) AS seats, COALESCE(SUM(b.total),0) AS value FROM bookings b WHERE ${live} AND ${W}`, [from, to]);
  const cancelled = (await db.get(`SELECT COUNT(*) c FROM bookings b WHERE b.status = 'لغو شده' AND ${W}`, [from, to])).c;
  const customers = (await db.get(`SELECT COUNT(*) c FROM customers WHERE ${day('created_at')} BETWEEN ? AND ?`, [from, to])).c;
  const income = (await db.get(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status = '${F.PAID}' AND ${day('paid_at')} BETWEEN ? AND ?`, [from, to])).s;
  const daily = await db.all(`SELECT ${bd} AS day, COUNT(*) AS bookings, COALESCE(SUM(b.total),0) AS value FROM bookings b WHERE ${live} AND ${W} GROUP BY day ORDER BY day`, [from, to]);
  const byTrip = await db.all(`SELECT b.trip_id AS id, b.trip_title AS title, COUNT(*) AS bookings, SUM(b.count) AS seats, SUM(b.total) AS value,
    COALESCE((SELECT SUM(p.amount) FROM payments p JOIN bookings b2 ON b2.id = p.booking_id WHERE b2.trip_id = b.trip_id AND p.status = '${F.PAID}'),0) AS paid
    FROM bookings b WHERE ${live} AND ${W} GROUP BY b.trip_id ORDER BY value DESC`, [from, to]);
  const byCategory = (await db.all(`SELECT t.category AS key, COUNT(*) AS bookings, SUM(b.total) AS value FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE ${live} AND ${W} GROUP BY t.category ORDER BY value DESC`, [from, to])).map(x => ({ ...x, name: CATEGORY_NAMES[x.key] || x.key }));
  const byAgent = await db.all(`SELECT COALESCE(a.name, 'فروش مستقیم') AS name, COUNT(*) AS bookings, SUM(b.total) AS value, SUM(b.commission) AS commission FROM bookings b LEFT JOIN agents a ON a.id = b.agent_id WHERE ${live} AND ${W} GROUP BY b.agent_id ORDER BY value DESC`, [from, to]);
  const bySource = await db.all(`SELECT b.source AS key, COUNT(*) AS bookings, SUM(b.total) AS value FROM bookings b WHERE ${live} AND ${W} GROUP BY b.source`, [from, to]);
  const statuses = await db.all(`SELECT b.status AS name, COUNT(*) AS n FROM bookings b WHERE ${W} GROUP BY b.status`, [from, to]);
  const topCustomers = await db.all(`SELECT c.id, c.name, c.phone, COUNT(*) AS bookings, SUM(b.total) AS value FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE ${live} AND ${W} GROUP BY c.id ORDER BY value DESC LIMIT 10`, [from, to]);
  const staff = await db.all(`SELECT COALESCE(a.full_name, '') AS fullName, a.username, r.name AS roleName,
    (SELECT COUNT(*) FROM bookings x WHERE x.created_by = a.id AND ${day('x.created_at')} BETWEEN ? AND ?) AS bookings,
    (SELECT COUNT(*) FROM payments p WHERE p.created_by = a.id AND p.status = '${F.PAID}' AND ${day('p.paid_at')} BETWEEN ? AND ?) AS payments
    FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE a.kind = 'staff' ORDER BY bookings DESC`, [from, to, from, to]);
  res.json({ from, to, kpi: { ...k, cancelled, customers, income }, daily, byTrip, byCategory, byAgent, bySource, statuses, topCustomers, staff });
});
r.get('/reports/sales.csv', need('reports'), async (req, res) => {
  const { from, to } = range(req);
  const rows = (await db.all(BOOKING_SQL + ` WHERE ${day('b.created_at')} BETWEEN ? AND ? ORDER BY b.id DESC`, [from, to])).map(withFin);
  sendCsv(res, 'sales-report', ['کد رزرو', 'تاریخ ثبت', 'سفر', 'مشتری', 'موبایل', 'نفرات', 'مبلغ کل', 'پرداخت‌شده', 'مانده', 'وضعیت', 'نماینده', 'کمیسیون', 'منبع'],
    rows.map(b => [b.ref, jnum(b.createdAt), b.tripTitle, b.name, b.phone, b.count, b.charge, b.net, b.balance, b.status, b.agentName || 'مستقیم', b.commission, { site: 'سایت', agent: 'نماینده', staff: 'کارمند' }[b.source] || b.source]));
});

/* ───── اطلاعات سیستم و پشتیبان ───── */
r.get('/system/info', need('system'), async (req, res) => {
  const n = async t => (await db.get(`SELECT COUNT(*) c FROM ${t}`)).c;
  let dbSize = null; try { dbSize = fs.statSync(path.join(DATA_DIR, 'hamrah.db')).size; } catch { /* دیتابیس ابری */ }
  res.json({
    app: { version: require('../../package.json').version, node: process.version, uptime: Math.round(process.uptime()), env: process.env.NODE_ENV || 'development', time: new Date().toISOString() },
    db: { size: dbSize, remote: !!process.env.DATABASE_URL, counts: { trips: await n('trips'), bookings: await n('bookings'), customers: await n('customers'), payments: await n('payments'), agents: await n('agents'), users: await n('admins'), sms: await n('sms_log') } },
    services: { smsProvider: sms.provider(), gateway: F.gatewayName(), gatewayReady: F.gatewayReady() },
    audit: await db.all('SELECT id, username, action, detail, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT 100')
  });
});
r.get('/system/backup', need('system'), async (req, res) => {
  if (process.env.DATABASE_URL) throw bad('دیتابیس ابری است؛ پشتیبان‌گیری از پنل ارائه‌دهندهٔ دیتابیس انجام می‌شود.', 409);
  const snap = path.join(DATA_DIR, 'snapshot-' + crypto.randomBytes(6).toString('hex') + '.db');
  await db.run(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  await audit(req, 'دانلود پشتیبان');
  res.download(snap, `hamrah-backup-${todayISO()}.db`, err => { fs.rm(snap, { force: true }, () => {}); if (err && !res.headersSent) res.status(500).json({ error: 'ساخت پشتیبان ناموفق بود.' }); });
});

module.exports = r;
