'use strict';
/* مشتریان (CRM) */
const express = require('express');
const { db } = require('../db');
const { bad, clean, faToEn, phoneOk, need, audit, sendCsv, jnum, todayISO } = require('./core');
const F = require('./finance');

const r = express.Router();
const CATS = ['عادی', 'VIP', 'وفادار', 'سازمانی', 'بالقوه'];
const KINDS = ['یادداشت', 'تماس', 'پیامک', 'حضوری', 'پیگیری'];

/* نماینده فقط مشتریان خودش را می‌بیند */
const scope = req => (req.admin.isAgent ? { sql: ' AND c.agent_id = ?', args: [req.admin.agent_id ?? -1] } : { sql: '', args: [] });
const allow = need('customers', 'agent');

function listSql(req) {
  const q = faToEn(clean(req.query.q, 60)).toLowerCase(), cat = clean(req.query.category, 20), s = scope(req);
  const args = [...s.args]; let where = '1=1' + s.sql;
  if (q) { where += ' AND (lower(c.name) LIKE ? OR c.phone LIKE ? OR c.national_id LIKE ? OR lower(c.tags) LIKE ? OR lower(c.city) LIKE ?)'; args.push(...Array(5).fill(`%${q}%`)); }
  if (cat) { where += ' AND c.category = ?'; args.push(cat); }
  const order = { spent: 'spent DESC', bookings: 'bookings DESC', recent: 'c.id DESC', name: 'c.name' }[req.query.sort] || 'c.id DESC';
  return { args, sql: `SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status != 'لغو شده') AS bookings,
    COALESCE((SELECT SUM(p.amount) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = c.id AND p.status = '${F.PAID}'),0) AS spent,
    (SELECT MAX(created_at) FROM bookings b WHERE b.customer_id = c.id) AS lastBooking
    FROM customers c WHERE ${where} ORDER BY ${order}` };
}
const out = c => ({ id: c.id, name: c.name, phone: c.phone, nationalId: c.national_id, email: c.email, city: c.city, category: c.category, tags: c.tags, notes: c.notes, createdAt: c.created_at, bookings: c.bookings, spent: c.spent, lastBooking: c.lastBooking });

r.get('/customers', allow, async (req, res) => {
  const { sql, args } = listSql(req);
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  res.json({ customers: (await db.all(sql + ' LIMIT ?', [...args, limit])).map(out), categories: CATS });
});
r.get('/customers.csv', need('customers'), async (req, res) => {
  const { sql, args } = listSql(req);
  sendCsv(res, 'customers', ['نام', 'موبایل', 'کد ملی', 'ایمیل', 'شهر', 'دسته', 'برچسب‌ها', 'تعداد رزرو', 'مجموع پرداخت (تومان)', 'آخرین رزرو (شمسی)'],
    (await db.all(sql, args)).map(c => [c.name, c.phone, c.national_id, c.email, c.city, c.category, c.tags, c.bookings, c.spent, jnum(c.lastBooking)]));
});
r.get('/customers/followups', need('customers'), async (req, res) => {
  res.json({ followups: await db.all(`SELECT n.id, n.kind, n.text, n.follow_up AS followUp, c.id AS customerId, c.name, c.phone FROM customer_notes n JOIN customers c ON c.id = n.customer_id
    WHERE n.done = 0 AND n.follow_up IS NOT NULL ORDER BY n.follow_up LIMIT 100`), today: todayISO() });
});

function validate(b) {
  const c = { name: clean(b.name, 80), phone: faToEn(clean(b.phone, 20)), national_id: faToEn(clean(b.nationalId, 10)), email: clean(b.email, 100), city: clean(b.city, 40),
    category: CATS.includes(b.category) ? b.category : 'عادی', tags: clean(b.tags, 120), notes: clean(b.notes, 1000) };
  if (c.name.length < 3) throw bad('نام مشتری را کامل وارد کنید.');
  if (!phoneOk(c.phone)) throw bad('شماره موبایل معتبر نیست.');
  if (c.national_id && !/^\d{10}$/.test(c.national_id)) throw bad('کد ملی باید ۱۰ رقم باشد.');
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw bad('ایمیل نامعتبر است.');
  return c;
}
r.post('/customers', allow, async (req, res) => {
  const c = validate(req.body || {});
  if (await db.get('SELECT 1 FROM customers WHERE phone = ?', [c.phone])) throw bad('مشتری با این شماره موبایل قبلاً ثبت شده است.', 409);
  const x = await db.run('INSERT INTO customers (name, phone, national_id, email, city, category, tags, notes, agent_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [c.name, c.phone, c.national_id, c.email, c.city, c.category, c.tags, c.notes, req.admin.isAgent ? req.admin.agent_id : null]);
  await audit(req, 'مشتری جدید', c.name);
  res.json({ ok: true, id: x.id });
});
async function mineById(req, id) {
  const s = scope(req);
  const c = await db.get(`SELECT c.* FROM customers c WHERE c.id = ?${s.sql}`, [id, ...s.args]);
  if (!c) throw bad('مشتری یافت نشد.', 404);
  return c;
}
r.put('/customers/:id', allow, async (req, res) => {
  const cur = await mineById(req, req.params.id), c = validate(req.body || {});
  if (c.phone !== cur.phone && await db.get('SELECT 1 FROM customers WHERE phone = ? AND id != ?', [c.phone, cur.id])) throw bad('این شماره برای مشتری دیگری ثبت شده است.', 409);
  await db.run('UPDATE customers SET name=?, phone=?, national_id=?, email=?, city=?, category=?, tags=?, notes=? WHERE id=?', [c.name, c.phone, c.national_id, c.email, c.city, c.category, c.tags, c.notes, cur.id]);
  res.json({ ok: true });
});
r.delete('/customers/:id', need('customers'), async (req, res) => {
  const c = await mineById(req, req.params.id);
  if ((await db.get('SELECT COUNT(*) n FROM bookings WHERE customer_id = ?', [c.id])).n) throw bad('این مشتری رزرو دارد و حذف نمی‌شود.', 409);
  await db.run('DELETE FROM customers WHERE id = ?', [c.id]); await audit(req, 'حذف مشتری', c.name);
  res.json({ ok: true });
});
r.get('/customers/:id', allow, async (req, res) => {
  const c = await mineById(req, req.params.id);
  const bookings = await db.all(`SELECT id, ref, trip_title AS tripTitle, count, total, status, created_at AS createdAt FROM bookings WHERE customer_id = ? ORDER BY id DESC`, [c.id]);
  for (const b of bookings) b.finance = await F.finance(b.id);
  const notes = await db.all('SELECT id, kind, text, follow_up AS followUp, done, admin_name AS adminName, created_at AS createdAt FROM customer_notes WHERE customer_id = ? ORDER BY id DESC', [c.id]);
  const sms = req.admin.isAgent ? [] : await db.all('SELECT id, text, kind, status, created_at AS createdAt FROM sms_log WHERE phone = ? ORDER BY id DESC LIMIT 30', [c.phone]);
  res.json({ customer: out({ ...c, bookings: bookings.filter(b => b.status !== 'لغو شده').length, spent: bookings.reduce((s, b) => s + b.finance.net, 0) }), bookings, notes, sms, kinds: KINDS, categories: CATS });
});
r.post('/customers/:id/notes', allow, async (req, res) => {
  const c = await mineById(req, req.params.id), b = req.body || {}, text = clean(b.text, 1000);
  if (text.length < 2) throw bad('متن یادداشت را بنویسید.');
  const fu = b.followUp ? clean(faToEn(b.followUp), 10) : null;
  if (fu && !/^\d{4}-\d{2}-\d{2}$/.test(fu)) throw bad('تاریخ پیگیری نامعتبر است.');
  await db.run('INSERT INTO customer_notes (customer_id, kind, text, follow_up, admin_name) VALUES (?,?,?,?,?)', [c.id, KINDS.includes(b.kind) ? b.kind : 'یادداشت', text, fu, req.admin.full_name || req.admin.username]);
  res.json({ ok: true });
});
async function ownNote(req) {
  const n = await db.get('SELECT id, customer_id FROM customer_notes WHERE id = ?', [req.params.id]);
  if (!n) throw bad('یادداشت یافت نشد.', 404);
  await mineById(req, n.customer_id); return n;
}
r.patch('/notes/:id', allow, async (req, res) => { const n = await ownNote(req); await db.run('UPDATE customer_notes SET done = ? WHERE id = ?', [req.body?.done ? 1 : 0, n.id]); res.json({ ok: true }); });
r.delete('/notes/:id', allow, async (req, res) => { const n = await ownNote(req); await db.run('DELETE FROM customer_notes WHERE id = ?', [n.id]); res.json({ ok: true }); });

module.exports = r;
