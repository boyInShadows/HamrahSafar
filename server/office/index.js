'use strict';
/* نقطهٔ اتصال ماژول‌های عملیاتی به سرور اصلی */
const express = require('express');
const { db } = require('../db');
const { SITE_ORIGIN, bad, clean, faToEn, phoneOk, jdate, cfg } = require('./core');
const F = require('./finance');
const reminders = require('./reminders');

module.exports = function build({ rateLimit }) {
  /* ───── مسیرهای عمومی ───── */
  const pub = express.Router();
  const methodsPublic = async () => (await db.all('SELECT id, name, type, installments, down_percent AS downPercent, interval_days AS intervalDays, fee_percent AS feePercent, terms FROM payment_methods WHERE active = 1 AND public = 1 ORDER BY sort_order, id'))
    .filter(m => m.type !== 'online' || F.gatewayReady());
  pub.get('/pay/methods', async (req, res) => res.json({ methods: await methodsPublic() }));
  pub.get('/transports', async (req, res) => res.json({ transports: await db.all('SELECT name, icon FROM transport_types WHERE active = 1 ORDER BY sort_order, id') }));

  pub.post('/bookings', async (req, res) => {
    rateLimit('book:' + req.ip, 8, 600e3);
    const { tripId, name, phone, count, notes, methodId } = req.body || {};
    res.json(await F.createBooking({ tripId, name, phone, count, notes, methodId, source: 'site' }));
  });

  async function findBooking(ref, phone) {
    ref = clean(faToEn(ref), 20).toUpperCase(); phone = clean(faToEn(phone), 20);
    const b = await db.get('SELECT b.*, t.date FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id WHERE b.ref = ? AND b.phone = ?', [ref, phone]);
    if (!b) throw bad('رزروی با این کد و شماره موبایل پیدا نشد.', 404);
    return b;
  }
  async function trackOut(b) {
    const f = await F.finance(b.id);
    const payments = await db.all("SELECT id, seq, kind, amount, due_date AS dueDate, status, method_name AS methodName, receipt_no AS receiptNo, paid_at AS paidAt FROM payments WHERE booking_id = ? AND status != 'لغو شد' ORDER BY kind = 'refund', seq, id", [b.id]);
    return { ref: b.ref, tripTitle: b.trip_title, count: b.count, total: b.total, surcharge: b.surcharge, status: b.status, createdAt: b.created_at, date: b.date, paid: f.net, balance: f.balance, payments,
      methodChosen: !!b.method_id, methods: b.status === 'لغو شده' ? [] : await methodsPublic(), canChooseMethod: !payments.some(p => p.status === 'پرداخت شده' && p.kind === 'installment') && b.status !== 'لغو شده' };
  }
  pub.get('/bookings/track', async (req, res) => {
    rateLimit('track:' + req.ip, 15, 600e3);
    res.json({ booking: await trackOut(await findBooking(req.query.ref, req.query.phone)) });
  });
  pub.post('/bookings/method', async (req, res) => {
    rateLimit('method:' + req.ip, 10, 600e3);
    const b = await findBooking(req.body?.ref, req.body?.phone), { tx } = require('../db');
    await tx(t => F.buildPlan(t, b.id, Number(req.body?.methodId), { publicOnly: true }));
    res.json({ booking: await trackOut(b) });
  });
  pub.post('/pay/start', async (req, res) => {
    rateLimit('paystart:' + req.ip, 10, 600e3);
    const b = await findBooking(req.body?.ref, req.body?.phone);
    const p = await db.get('SELECT id FROM payments WHERE id = ? AND booking_id = ?', [Number(req.body?.paymentId), b.id]);
    if (!p) throw bad('پرداخت یافت نشد.', 404);
    res.json(await F.startGateway(p.id, SITE_ORIGIN || `${req.protocol}://${req.get('host')}`));
  });
  pub.get('/pay/session', async (req, res) => {
    const s = await db.get(`SELECT s.status, s.amount, b.ref, b.trip_title AS tripTitle FROM gateway_sessions s JOIN payments p ON p.id = s.payment_id JOIN bookings b ON b.id = p.booking_id WHERE s.token = ?`, [clean(req.query.t, 60)]);
    if (!s) throw bad('جلسهٔ پرداخت یافت نشد.', 404);
    res.json({ ...s, gateway: F.gatewayName() });
  });
  /* آزمایشی: دکمه‌های صفحهٔ pay.html */
  pub.post('/pay/callback', async (req, res) => {
    if (F.gatewayName() !== 'sandbox') throw bad('مسیر نامعتبر.', 404);
    rateLimit('paycb:' + req.ip, 20, 600e3);
    res.json(await F.finishGateway(clean(req.body?.t, 60), { ok: !!req.body?.ok }));
  });
  /* زرین‌پال: بازگشت کاربر از درگاه */
  pub.get('/pay/callback', async (req, res) => {
    const t = clean(req.query.t, 60);
    try { const r = await F.finishGateway(t, { ok: req.query.Status === 'OK', authority: clean(req.query.Authority, 60) }); res.redirect(`/pay.html?t=${t}&done=${r.success ? 'ok' : 'fail'}`); }
    catch { res.redirect(`/pay.html?t=${t}&done=fail`); }
  });
  pub.get('/receipt', async (req, res) => {
    rateLimit('receipt:' + req.ip, 20, 600e3);
    const b = await findBooking(req.query.ref, req.query.phone);
    const rows = await db.all("SELECT seq, kind, amount, status, method_name AS methodName, receipt_no AS receiptNo, paid_at AS paidAt FROM payments WHERE booking_id = ? AND status = 'پرداخت شده' ORDER BY paid_at, id", [b.id]);
    const f = await F.finance(b.id);
    res.json({ agency: await cfg('agencyName'), note: await cfg('receiptNote'), booking: { ref: b.ref, name: b.name, phone: b.phone, tripTitle: b.trip_title, date: b.date, count: b.count, total: b.total, surcharge: b.surcharge, status: b.status },
      payments: rows, paid: f.net, balance: f.balance });
  });

  /* ───── مسیرهای پنل (پس از ورود) ───── */
  const office = express.Router();
  for (const m of ['routes-crm', 'routes-fin', 'routes-team', 'routes-ops']) office.use(require('./' + m));
  return { pub, office, reminders };
};
