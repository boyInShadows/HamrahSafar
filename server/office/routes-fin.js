'use strict';
/* رزرو (نمای عملیاتی)، پرداخت‌ها، اقساط، حسابداری، خسارت و تأخیر */
const express = require('express');
const { db } = require('../db');
const { bad, clean, faToEn, int, todayISO, addDays, need, audit, sendCsv, jnum, jdate, fa } = require('./core');
const F = require('./finance');
const sms = require('./sms');

const r = express.Router();
const PAID = F.PAID;
const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const range = req => { const from = clean(faToEn(req.query.from), 10), to = clean(faToEn(req.query.to), 10); return { from: dateOk(from) ? from : '1970-01-01', to: dateOk(to) ? to : '2999-12-31' }; };
const localDay = col => `date(${col}, '+210 minutes')`; /* وقت تهران */

/* ───── رزروها ───── */
const BOOKING_SQL = `SELECT b.id, b.ref, b.trip_id AS tripId, b.trip_title AS tripTitle, b.name, b.phone, b.count, b.notes, b.total, b.surcharge, b.status, b.created_at AS createdAt,
  b.source, b.agent_id AS agentId, b.customer_id AS customerId, b.commission, b.method_id AS methodId, t.date AS tripDate, a.name AS agentName,
  COALESCE((SELECT SUM(amount) FROM payments p WHERE p.booking_id = b.id AND p.status = '${PAID}' AND p.amount > 0),0) AS paid,
  COALESCE((SELECT -SUM(amount) FROM payments p WHERE p.booking_id = b.id AND p.status = '${PAID}' AND p.amount < 0),0) AS refunded,
  COALESCE((SELECT SUM(amount) FROM penalties x WHERE x.booking_id = b.id AND x.status = 'بدهکار'),0) AS penalties
  FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id LEFT JOIN agents a ON a.id = b.agent_id`;
const withFin = b => { const charge = b.status === 'لغو شده' ? 0 : b.total + b.surcharge, net = b.paid - b.refunded; return { ...b, charge, net, balance: Math.max(0, charge + b.penalties - net) }; };
const bookingScope = req => (req.admin.isAgent ? { sql: ' b.agent_id = ?', args: [req.admin.agent_id ?? -1] } : null);

function bookingQuery(req) {
  const w = [], args = [], s = bookingScope(req);
  if (s) { w.push(s.sql); args.push(...s.args); }
  const q = faToEn(clean(req.query.q, 60)).toLowerCase(), { from, to } = range(req);
  if (q) { w.push('(lower(b.name) LIKE ? OR b.phone LIKE ? OR lower(b.ref) LIKE ? OR lower(b.trip_title) LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  if (req.query.status) { w.push('b.status = ?'); args.push(clean(req.query.status, 20)); }
  if (req.query.tripId) { w.push('b.trip_id = ?'); args.push(clean(req.query.tripId, 40)); }
  if (req.query.agentId && !s) { w.push('b.agent_id = ?'); args.push(Number(req.query.agentId)); }
  w.push(`${localDay('b.created_at')} BETWEEN ? AND ?`); args.push(from, to);
  return { sql: BOOKING_SQL + ' WHERE ' + w.join(' AND ') + ' ORDER BY b.id DESC', args };
}
r.get('/bookings', need('bookings', 'agent', 'payments'), async (req, res) => {
  const { sql, args } = bookingQuery(req);
  let list = (await db.all(sql + ' LIMIT 1000', args)).map(withFin);
  if (req.query.unpaid === '1') list = list.filter(b => b.balance > 0 && b.status !== 'لغو شده');
  res.json({ bookings: list });
});
r.get('/bookings.csv', need('bookings', 'agent'), async (req, res) => {
  const { sql, args } = bookingQuery(req);
  sendCsv(res, 'bookings', ['کد رزرو', 'نام', 'موبایل', 'سفر', 'تاریخ حرکت', 'نفرات', 'مبلغ کل', 'پرداخت‌شده', 'مانده', 'وضعیت', 'نماینده', 'تاریخ ثبت'],
    (await db.all(sql, args)).map(withFin).map(b => [b.ref, b.name, b.phone, b.tripTitle, jnum(b.tripDate), b.count, b.charge, b.net, b.balance, b.status, b.agentName || '', jnum(b.createdAt)]));
});

async function bookingFor(req, id = req.params.id) {
  const s = bookingScope(req);
  const b = await db.get(BOOKING_SQL + ' WHERE b.id = ?' + (s ? ' AND' + s.sql : ''), [id, ...(s ? s.args : [])]);
  if (!b) throw bad('رزرو یافت نشد.', 404);
  return withFin(b);
}
r.get('/bookings/:id', need('bookings', 'agent', 'payments'), async (req, res) => {
  const b = await bookingFor(req);
  const payments = await db.all('SELECT id, seq, kind, amount, due_date AS dueDate, status, method_name AS methodName, receipt_no AS receiptNo, paid_at AS paidAt, note FROM payments WHERE booking_id = ? ORDER BY kind = \'refund\', seq, id', [b.id]);
  const penalties = await db.all('SELECT id, kind, amount, status, note, created_at AS createdAt FROM penalties WHERE booking_id = ? ORDER BY id', [b.id]);
  res.json({ booking: b, payments, penalties });
});

/* ثبت رزرو دستی توسط کارمند یا نماینده */
r.post('/bookings', need('bookings', 'agent'), async (req, res) => {
  const b = req.body || {};
  const agentId = req.admin.isAgent ? req.admin.agent_id : (b.agentId ? Number(b.agentId) : null);
  if (req.admin.isAgent && !agentId) throw bad('حساب شما به نمایندهٔ فعالی متصل نیست.', 403);
  const out = await F.createBooking({ ...b, agentId, createdBy: req.admin.id, source: req.admin.isAgent ? 'agent' : 'staff' });
  await audit(req, 'ثبت رزرو دستی', out.ref);
  res.json(out);
});
r.post('/bookings/:id/plan', need('bookings', 'payments', 'agent'), async (req, res) => {
  const b = await bookingFor(req);
  const { tx } = require('../db');
  res.json({ ok: true, plan: await tx(t => F.buildPlan(t, b.id, Number(req.body?.methodId))) });
});
r.patch('/bookings/:id/notes', need('bookings', 'agent'), async (req, res) => {
  const b = await bookingFor(req); await db.run('UPDATE bookings SET notes = ? WHERE id = ?', [clean(req.body?.notes, 500), b.id]); res.json({ ok: true });
});
r.get('/bookings/:id/cancel-preview', need('bookings', 'accounting', 'agent'), async (req, res) => { const b = await bookingFor(req); res.json(await F.cancelPreview(b.id)); });
r.post('/bookings/:id/cancel', need('bookings', 'accounting', 'agent'), async (req, res) => {
  const b = await bookingFor(req);
  if (req.admin.isAgent && (b.status === 'تأیید شده' || b.paid > 0)) throw bad('لغو رزرو تأییدشده یا دارای پرداخت از طریق دفتر انجام می‌شود.', 403);
  const x = await F.cancelBooking(b.id, { penalty: req.admin.isAgent ? 0 : req.body?.penalty, reason: req.body?.reason, adminId: req.admin.id, notify: req.body?.notify !== false });
  await audit(req, 'لغو رزرو', `${b.ref} — خسارت ${x.penalty}`);
  res.json({ ok: true, ...x });
});

/* ───── پرداخت‌ها ───── */
r.post('/payments/:id/pay', need('payments'), async (req, res) => {
  const out = await F.markPaid(Number(req.params.id), { methodName: req.body?.methodName, note: req.body?.note, adminId: req.admin.id });
  await audit(req, 'ثبت پرداخت', `رسید ${out.receipt}`); res.json({ ok: true, ...out });
});
r.post('/bookings/:id/payments', need('payments'), async (req, res) => {
  const b = await bookingFor(req), amount = int(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 1) throw bad('مبلغ را به‌صورت عدد وارد کنید.');
  if (b.status === 'لغو شده' && amount > b.balance) throw bad('مبلغ از بدهی باقی‌مانده بیشتر است.');
  if (amount > b.balance) throw bad(`مبلغ از مانده (${fa(b.balance)} تومان) بیشتر است.`);
  const seq = ((await db.get('SELECT COALESCE(MAX(seq),0) m FROM payments WHERE booking_id = ? AND seq < 99', [b.id])).m) + 1;
  const row = await db.run('INSERT INTO payments (booking_id, seq, kind, amount, due_date, method_name) VALUES (?,?,?,?,?,?)', [b.id, seq, 'installment', amount, todayISO(), clean(req.body?.methodName, 40) || 'نقدی']);
  const out = await F.markPaid(row.id, { methodName: req.body?.methodName, note: req.body?.note, adminId: req.admin.id });
  await audit(req, 'ثبت پرداخت دستی', `${b.ref} — ${amount}`); res.json({ ok: true, ...out });
});
r.get('/payments', need('payments', 'accounting'), async (req, res) => {
  const { from, to } = range(req), w = [`${localDay('COALESCE(p.paid_at, p.created_at)')} BETWEEN ? AND ?`], args = [from, to];
  if (req.query.status) { w.push('p.status = ?'); args.push(clean(req.query.status, 20)); }
  const q = faToEn(clean(req.query.q, 60)).toLowerCase(); if (q) { w.push('(lower(b.name) LIKE ? OR b.phone LIKE ? OR lower(b.ref) LIKE ?)'); args.push(...Array(3).fill(`%${q}%`)); }
  const rows = await db.all(`SELECT p.id, p.booking_id AS bookingId, p.seq, p.kind, p.amount, p.due_date AS dueDate, p.status, p.method_name AS methodName, p.receipt_no AS receiptNo, p.paid_at AS paidAt,
    b.ref, b.name, b.phone, b.trip_title AS tripTitle FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE ${w.join(' AND ')} ORDER BY p.id DESC LIMIT 1000`, args);
  res.json({ payments: rows, today: todayISO() });
});
r.get('/payments.csv', need('payments', 'accounting'), async (req, res) => {
  const { from, to } = range(req);
  const rows = await db.all(`SELECT p.*, b.ref, b.name, b.trip_title FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE ${localDay('COALESCE(p.paid_at,p.created_at)')} BETWEEN ? AND ? ORDER BY p.id DESC`, [from, to]);
  sendCsv(res, 'payments', ['رسید', 'کد رزرو', 'مشتری', 'سفر', 'قسط', 'مبلغ (تومان)', 'سررسید', 'وضعیت', 'روش', 'تاریخ پرداخت'], rows.map(p => [p.receipt_no || '', p.ref, p.name, p.trip_title, p.seq === 99 ? 'بازگشت' : p.seq, p.amount, jnum(p.due_date), p.status, p.method_name, jnum(p.paid_at)]));
});

/* ───── تأخیر پرداخت و جریمه ───── */
r.get('/accounting/overdue', need('accounting', 'payments'), async (req, res) => res.json({ overdue: await F.overdue() }));
r.post('/accounting/overdue/:paymentId/fee', need('accounting'), async (req, res) => {
  const o = (await F.overdue()).find(x => x.id === Number(req.params.paymentId));
  if (!o) throw bad('قسط معوق یافت نشد.', 404);
  const amount = req.body?.amount === undefined ? o.lateFee : int(req.body.amount);
  if (!Number.isInteger(amount) || amount < 1) throw bad('مبلغ جریمه باید بیشتر از صفر باشد.');
  if (o.delayCharged > 0 && !req.body?.force) throw bad('برای این رزرو قبلاً جریمهٔ تأخیر ثبت شده است.', 409);
  await db.run("INSERT INTO penalties (booking_id, kind, amount, note, created_by) VALUES (?,?,?,?,?)", [o.bookingId, 'delay', amount, `جریمهٔ ${o.days} روز تأخیر قسط ${o.seq}`, req.admin.id]);
  await audit(req, 'جریمهٔ تأخیر', `${o.ref} — ${amount}`); res.json({ ok: true, amount });
});
r.get('/accounting/penalties', need('accounting'), async (req, res) => {
  res.json({ penalties: await db.all(`SELECT x.id, x.kind, x.amount, x.status, x.note, x.created_at AS createdAt, b.ref, b.name, b.id AS bookingId, b.trip_title AS tripTitle FROM penalties x JOIN bookings b ON b.id = x.booking_id ORDER BY x.id DESC LIMIT 500`) });
});
r.post('/accounting/penalties', need('accounting'), async (req, res) => {
  const b = req.body || {}, amount = int(b.amount), kind = ['damage', 'delay', 'other', 'cancellation'].includes(b.kind) ? b.kind : 'damage';
  if (!Number.isInteger(amount) || amount < 1) throw bad('مبلغ را به‌صورت عدد وارد کنید.');
  const bk = await db.get('SELECT id, ref FROM bookings WHERE id = ?', [Number(b.bookingId)]); if (!bk) throw bad('رزرو یافت نشد.', 404);
  await db.run('INSERT INTO penalties (booking_id, kind, amount, note, created_by) VALUES (?,?,?,?,?)', [bk.id, kind, amount, clean(b.note, 200), req.admin.id]);
  await audit(req, 'ثبت خسارت', `${bk.ref} — ${amount}`); res.json({ ok: true });
});
r.patch('/accounting/penalties/:id', need('accounting'), async (req, res) => {
  const st = req.body?.status === 'بخشیده شد' ? 'بخشیده شد' : 'بدهکار';
  await db.run('UPDATE penalties SET status = ? WHERE id = ?', [st, req.params.id]); await audit(req, 'تغییر وضعیت خسارت', `${req.params.id} → ${st}`); res.json({ ok: true });
});
r.delete('/accounting/penalties/:id', need('accounting'), async (req, res) => { await db.run('DELETE FROM penalties WHERE id = ?', [req.params.id]); res.json({ ok: true }); });

/* تأخیر در حرکت سفر */
r.get('/accounting/delays', need('accounting', 'trips'), async (req, res) => {
  res.json({ delays: await db.all('SELECT d.id, d.minutes, d.reason, d.notified, d.created_at AS createdAt, t.title AS tripTitle, t.date FROM trip_delays d JOIN trips t ON t.id = d.trip_id ORDER BY d.id DESC LIMIT 200') });
});
r.post('/accounting/delays', need('accounting', 'trips'), async (req, res) => {
  const b = req.body || {}, minutes = int(b.minutes);
  const t = await db.get('SELECT id, title FROM trips WHERE id = ?', [String(b.tripId || '')]); if (!t) throw bad('سفر یافت نشد.', 404);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw bad('مدت تأخیر باید بین ۱ تا ۱۴۴۰ دقیقه باشد.');
  const reason = clean(b.reason, 200);
  const row = await db.run('INSERT INTO trip_delays (trip_id, minutes, reason, created_by) VALUES (?,?,?,?)', [t.id, minutes, reason, req.admin.id]);
  let sent = 0;
  if (b.notify) {
    for (const bk of await db.all("SELECT * FROM bookings WHERE trip_id = ? AND status = 'تأیید شده'", [t.id])) {
      await sms.sendTemplate('trip_delay', bk.phone, { ...(await sms.bookingVars(bk)), minutes: fa(minutes), extra: reason }, { kind: 'trip_delay', bookingId: bk.id, customerId: bk.customer_id }); sent++;
    }
    await db.run('UPDATE trip_delays SET notified = 1 WHERE id = ?', [row.id]);
  }
  await audit(req, 'ثبت تأخیر حرکت', `${t.title} — ${minutes} دقیقه`); res.json({ ok: true, notified: sent });
});
r.delete('/accounting/delays/:id', need('accounting', 'trips'), async (req, res) => { await db.run('DELETE FROM trip_delays WHERE id = ?', [req.params.id]); res.json({ ok: true }); });

/* ───── هزینه‌ها ───── */
r.get('/accounting/expenses', need('accounting'), async (req, res) => {
  const { from, to } = range(req);
  res.json({ expenses: await db.all('SELECT e.id, e.trip_id AS tripId, e.category, e.title, e.amount, e.spent_on AS spentOn, e.note, t.title AS tripTitle FROM expenses e LEFT JOIN trips t ON t.id = e.trip_id WHERE e.spent_on BETWEEN ? AND ? ORDER BY e.spent_on DESC, e.id DESC LIMIT 1000', [from, to]) });
});
function expense(b) {
  const e = { title: clean(b.title, 100), category: clean(b.category, 40) || 'سایر', amount: int(b.amount), spent_on: clean(faToEn(b.spentOn), 10) || todayISO(), note: clean(b.note, 200), trip_id: b.tripId ? clean(b.tripId, 40) : null };
  if (e.title.length < 2) throw bad('عنوان هزینه را وارد کنید.');
  if (!Number.isInteger(e.amount) || e.amount < 1) throw bad('مبلغ را به‌صورت عدد وارد کنید.');
  if (!dateOk(e.spent_on)) throw bad('تاریخ هزینه نامعتبر است.');
  return e;
}
r.post('/accounting/expenses', need('accounting'), async (req, res) => {
  const e = expense(req.body || {});
  if (e.trip_id && !(await db.get('SELECT 1 FROM trips WHERE id = ?', [e.trip_id]))) throw bad('سفر یافت نشد.', 404);
  await db.run('INSERT INTO expenses (trip_id, category, title, amount, spent_on, note, created_by) VALUES (?,?,?,?,?,?,?)', [e.trip_id, e.category, e.title, e.amount, e.spent_on, e.note, req.admin.id]);
  await audit(req, 'ثبت هزینه', `${e.title} — ${e.amount}`); res.json({ ok: true });
});
r.put('/accounting/expenses/:id', need('accounting'), async (req, res) => {
  const e = expense(req.body || {});
  await db.run('UPDATE expenses SET trip_id=?, category=?, title=?, amount=?, spent_on=?, note=? WHERE id=?', [e.trip_id, e.category, e.title, e.amount, e.spent_on, e.note, req.params.id]); res.json({ ok: true });
});
r.delete('/accounting/expenses/:id', need('accounting'), async (req, res) => { await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]); await audit(req, 'حذف هزینه', req.params.id); res.json({ ok: true }); });

/* ───── بدهی‌ها (مشتریان بدهکار) ───── */
r.get('/accounting/debts', need('accounting', 'payments'), async (req, res) => {
  const list = (await db.all(BOOKING_SQL + " WHERE b.status != 'لغو شده' OR b.id IN (SELECT booking_id FROM penalties WHERE status = 'بدهکار')")).map(withFin).filter(b => b.balance > 0);
  const today = todayISO();
  const next = Object.fromEntries((await db.all("SELECT booking_id, MIN(due_date) d FROM payments WHERE status = 'در انتظار' AND kind = 'installment' GROUP BY booking_id")).map(x => [x.booking_id, x.d]));
  res.json({ debts: list.map(b => ({ id: b.id, ref: b.ref, name: b.name, phone: b.phone, tripTitle: b.tripTitle, charge: b.charge, penalties: b.penalties, net: b.net, balance: b.balance, nextDue: next[b.id] || null, late: !!(next[b.id] && next[b.id] < today) })).sort((a, b) => b.balance - a.balance), total: list.reduce((s, b) => s + b.balance, 0) });
});

/* ───── خلاصهٔ مالی ───── */
r.get('/accounting/summary', need('accounting', 'reports'), async (req, res) => {
  const { from, to } = range(req), pd = localDay('p.paid_at');
  const one = async (sql, a) => (await db.get(sql, a)).s;
  const income = await one(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p WHERE p.status='${PAID}' AND p.amount > 0 AND ${pd} BETWEEN ? AND ?`, [from, to]);
  const refunds = -(await one(`SELECT COALESCE(SUM(p.amount),0) s FROM payments p WHERE p.status='${PAID}' AND p.amount < 0 AND ${pd} BETWEEN ? AND ?`, [from, to]));
  const expenses = await one('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE spent_on BETWEEN ? AND ?', [from, to]);
  const commissions = await one(`SELECT COALESCE(SUM(commission),0) s FROM bookings WHERE status != 'لغو شده' AND ${localDay('created_at')} BETWEEN ? AND ?`, [from, to]);
  const penalties = await one(`SELECT COALESCE(SUM(amount),0) s FROM penalties WHERE status = 'بدهکار' AND ${localDay('created_at')} BETWEEN ? AND ?`, [from, to]);
  const receivable = (await db.all(BOOKING_SQL)).map(withFin).reduce((s, b) => s + b.balance, 0);
  const byMethod = await db.all(`SELECT p.method_name AS name, SUM(p.amount) AS amount, COUNT(*) AS n FROM payments p WHERE p.status='${PAID}' AND ${pd} BETWEEN ? AND ? GROUP BY p.method_name ORDER BY amount DESC`, [from, to]);
  const trips = await db.all(`SELECT t.id, t.title, t.date,
    COALESCE((SELECT SUM(p.amount) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.trip_id = t.id AND p.status='${PAID}'),0) AS revenue,
    COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.trip_id = t.id),0) AS expenses,
    COALESCE((SELECT SUM(b.commission) FROM bookings b WHERE b.trip_id = t.id AND b.status != 'لغو شده'),0) AS commissions
    FROM trips t WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id) OR EXISTS (SELECT 1 FROM expenses e WHERE e.trip_id = t.id) ORDER BY t.date DESC`);
  res.json({ from, to, income, refunds, expenses, commissions, penalties, receivable, net: income - refunds - expenses - commissions, byMethod,
    trips: trips.map(t => ({ ...t, profit: t.revenue - t.expenses - t.commissions })) });
});

module.exports = r;
module.exports.BOOKING_SQL = BOOKING_SQL; module.exports.withFin = withFin;
