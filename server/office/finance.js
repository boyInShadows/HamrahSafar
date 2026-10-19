'use strict';
/* منطق مالی: رزرو، برنامهٔ پرداخت/اقساط، دریافت پرداخت، لغو و جریمه، درگاه */
const crypto = require('node:crypto');
const { db, tx } = require('../db');
const { bad, clean, faToEn, todayISO, addDays, daysBetween, phoneOk, cfg, jdate, fa } = require('./core');
const sms = require('./sms');

const TRIP_SQL = `SELECT t.*, COALESCE((SELECT SUM(count) FROM bookings b WHERE b.trip_id = t.id AND b.status != 'لغو شده'), 0) AS booked FROM trips t`;
const PAID = 'پرداخت شده';

/* ───── مشتری ───── */
async function upsertCustomer(t, { name, phone, agentId }) {
  await t.run('INSERT OR IGNORE INTO customers (name, phone, agent_id) VALUES (?,?,?)', [name, phone, agentId ?? null]);
  return (await t.get('SELECT id FROM customers WHERE phone = ?', [phone])).id;
}

/* ───── وضعیت مالی یک رزرو ───── */
async function finance(bookingId, q = db) {
  const b = await q.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!b) return null;
  const sum = async (sql, a = []) => (await q.get(sql, [bookingId, ...a])).s;
  const paid = await sum(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id = ? AND status = '${PAID}' AND amount > 0`);
  const refunded = -(await sum(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id = ? AND status = '${PAID}' AND amount < 0`));
  const penalties = await sum("SELECT COALESCE(SUM(amount),0) s FROM penalties WHERE booking_id = ? AND status = 'بدهکار'");
  const charge = b.status === 'لغو شده' ? 0 : b.total + b.surcharge;
  const net = paid - refunded;
  return { total: b.total, surcharge: b.surcharge, charge, penalties, paid, refunded, net, balance: Math.max(0, charge + penalties - net), credit: Math.max(0, net - charge - penalties) };
}

/* ───── ساخت رزرو (مشترک بین سایت، نماینده و کارکنان) ───── */
async function createBooking({ tripId, name, phone, count, notes, methodId, agentId, createdBy, source = 'site', maxCount = 10 }) {
  name = clean(name, 80); phone = faToEn(clean(phone, 20)); notes = clean(notes, 500); count = Number(count);
  if (name.length < 3) throw bad('نام و نام خانوادگی را کامل وارد کنید.');
  if (!phoneOk(phone)) throw bad('شماره موبایل معتبر نیست (مثال: 09123456789).');
  if (!Number.isInteger(count) || count < 1 || count > maxCount) throw bad(`تعداد مسافران باید بین ۱ تا ${maxCount} باشد.`);
  const out = await tx(async t => {
    const trip = await t.get(TRIP_SQL + ' WHERE t.id = ? AND t.active = 1', [String(tripId || '')]);
    if (!trip) throw bad('این سفر یافت نشد.', 404);
    if (trip.date && trip.date < todayISO()) throw bad('زمان حرکت این سفر گذشته است.', 409);
    const left = trip.capacity - trip.booked;
    if (left < count) throw bad(`ظرفیت کافی نیست؛ ${Math.max(0, left)} صندلی باقی مانده است.`, 409);
    let agent = null;
    if (agentId) { agent = await t.get('SELECT * FROM agents WHERE id = ? AND active = 1', [agentId]); if (!agent) throw bad('نمایندهٔ فعال یافت نشد.', 403); }
    const ref = 'HS-' + crypto.randomBytes(4).toString('hex').toUpperCase(), total = count * trip.price;
    const customerId = await upsertCustomer(t, { name, phone, agentId: agent?.id });
    const commission = agent ? Math.round(total * agent.commission_percent / 100) : 0;
    const r = await t.run('INSERT INTO bookings (ref, trip_id, trip_title, name, phone, count, notes, total, customer_id, agent_id, created_by, commission, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [ref, trip.id, trip.title, name, phone, count, notes, total, customerId, agent?.id ?? null, createdBy ?? null, commission, source]);
    let plan = null;
    if (methodId) plan = await buildPlan(t, r.id, Number(methodId), { publicOnly: source === 'site' });
    return { ok: true, id: r.id, ref, total, seatsLeft: left - count, plan };
  });
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [out.id]);
  sms.sendTemplate('booking_created', phone, await sms.bookingVars(b), { bookingId: b.id, customerId: b.customer_id });
  return out;
}

/* ───── برنامهٔ پرداخت: نقدی/کارت/آنلاین ← یک ردیف؛ اقساطی ← پیش‌پرداخت + اقساط ───── */
async function buildPlan(t, bookingId, methodId, { publicOnly = false } = {}) {
  const m = await t.get('SELECT * FROM payment_methods WHERE id = ? AND active = 1' + (publicOnly ? ' AND public = 1' : ''), [methodId]);
  if (!m) throw bad('روش پرداخت نامعتبر است.');
  const b = await t.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (b.status === 'لغو شده') throw bad('رزرو لغوشده برنامهٔ پرداخت ندارد.', 409);
  if ((await t.get("SELECT COUNT(*) c FROM payments WHERE booking_id = ? AND status = ? AND kind = 'installment'", [bookingId, PAID])).c)
    throw bad('برای این رزرو پرداخت ثبت شده و روش پرداخت دیگر قابل تغییر نیست.', 409);
  await t.run("DELETE FROM payments WHERE booking_id = ? AND status IN ('در انتظار','ناموفق') AND kind = 'installment'", [bookingId]);
  const surcharge = m.type === 'installment' ? Math.round(b.total * m.fee_percent / 100) : 0;
  const grand = b.total + surcharge, today = todayISO();
  const rows = [];
  if (m.type === 'installment' && m.installments > 1) {
    const first = Math.min(grand, Math.round(grand * m.down_percent / 100));
    const rest = grand - first, n = m.installments - 1;
    rows.push(first);
    for (let i = 0; i < n; i++) rows.push(i === n - 1 ? rest - Math.floor(rest / n) * (n - 1) : Math.floor(rest / n));
  } else rows.push(grand);
  for (const [i, amount] of rows.entries()) {
    if (amount <= 0 && rows.length > 1) continue;
    await t.run('INSERT INTO payments (booking_id, seq, amount, due_date, method_name) VALUES (?,?,?,?,?)', [bookingId, i + 1, amount, addDays(today, i * m.interval_days), m.name]);
  }
  await t.run('UPDATE bookings SET method_id = ?, surcharge = ? WHERE id = ?', [m.id, surcharge, bookingId]);
  return { method: m.name, type: m.type, surcharge, count: rows.length };
}

/* ───── دریافت پرداخت ───── */
async function markPaid(paymentId, { methodName, note, adminId, gatewayRef } = {}) {
  const res = await tx(async t => {
    const p = await t.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!p) throw bad('پرداخت یافت نشد.', 404);
    if (p.status === PAID) throw bad('این پرداخت قبلاً ثبت شده است.', 409);
    if (p.status === 'لغو شد') throw bad('این پرداخت لغو شده است.', 409);
    const receipt = `R-${todayISO().replace(/-/g, '')}-${String(p.id).padStart(5, '0')}`;
    await t.run('UPDATE payments SET status = ?, paid_at = ?, receipt_no = ?, method_name = COALESCE(NULLIF(?,\'\'), method_name), note = COALESCE(NULLIF(?,\'\'), note), created_by = COALESCE(?, created_by), gateway_ref = COALESCE(?, gateway_ref) WHERE id = ?',
      [PAID, new Date().toISOString(), receipt, clean(methodName, 40), clean(note, 200), adminId ?? null, gatewayRef ?? null, p.id]);
    const confirmed = await autoConfirm(t, p.booking_id);
    return { receipt, bookingId: p.booking_id, amount: p.amount, confirmed };
  });
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [res.bookingId]);
  const vars = { ...(await sms.bookingVars(b)), amount: fa(res.amount), receipt: res.receipt };
  const meta = { bookingId: b.id, customerId: b.customer_id };
  sms.sendTemplate('payment_received', b.phone, vars, meta);
  if (res.confirmed) sms.sendTemplate('booking_confirmed', b.phone, vars, meta);
  return res;
}

/* وقتی همهٔ ردیف‌های پیش‌پرداخت (seq=1) پرداخت شد، رزرو در انتظار خودکار تأیید می‌شود */
async function autoConfirm(t, bookingId) {
  if ((await t.get("SELECT value FROM config WHERE key = 'autoConfirm'"))?.value !== '1') return false;
  const b = await t.get('SELECT status FROM bookings WHERE id = ?', [bookingId]);
  if (b.status !== 'در انتظار پرداخت') return false;
  const open = (await t.get("SELECT COUNT(*) c FROM payments WHERE booking_id = ? AND seq = 1 AND kind = 'installment' AND status != ?", [bookingId, PAID])).c;
  const any = (await t.get("SELECT COUNT(*) c FROM payments WHERE booking_id = ? AND seq = 1 AND kind = 'installment'", [bookingId])).c;
  if (open || !any) return false;
  await t.run("UPDATE bookings SET status = 'تأیید شده' WHERE id = ?", [bookingId]);
  return true;
}

/* ───── لغو با محاسبهٔ خسارت ───── */
async function cancelPolicy() { try { return JSON.parse(await cfg('cancelPolicy')).sort((a, b) => b.minDays - a.minDays); } catch { return [{ minDays: 0, percent: 100 }]; } }
async function cancelPreview(bookingId) {
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!b) throw bad('رزرو یافت نشد.', 404);
  if (b.status === 'لغو شده') throw bad('این رزرو قبلاً لغو شده است.', 409);
  const trip = await db.get('SELECT date FROM trips WHERE id = ?', [b.trip_id]);
  const f = await finance(bookingId);
  const days = trip?.date ? daysBetween(todayISO(), trip.date) : null;
  const rule = days === null ? { minDays: 0, percent: 0 } : ((await cancelPolicy()).find(r => days >= r.minDays) || { percent: 100 });
  const full = Math.round(b.total * rule.percent / 100);
  const penalty = b.status === 'تأیید شده' ? full : Math.min(full, f.net);
  return { days, percent: rule.percent, penalty, paid: f.net, refund: Math.max(0, f.net - penalty), debt: Math.max(0, penalty - f.net) };
}
async function cancelBooking(bookingId, { penalty, reason, adminId, notify = true }) {
  const pre = await cancelPreview(bookingId);
  penalty = penalty === undefined || penalty === null || penalty === '' ? pre.penalty : Math.round(Number(penalty));
  if (!Number.isInteger(penalty) || penalty < 0) throw bad('مبلغ خسارت نامعتبر است.');
  const net = pre.paid, refund = Math.max(0, net - penalty);
  await tx(async t => {
    await t.run("UPDATE bookings SET status = 'لغو شده', cancelled_at = ?, cancel_reason = ? WHERE id = ?", [new Date().toISOString(), clean(reason, 200), bookingId]);
    await t.run("UPDATE payments SET status = 'لغو شد' WHERE booking_id = ? AND status IN ('در انتظار','ناموفق')", [bookingId]);
    if (penalty > 0) await t.run("INSERT INTO penalties (booking_id, kind, amount, note, created_by) VALUES (?,?,?,?,?)", [bookingId, 'cancellation', penalty, clean(reason, 200) || 'خسارت لغو رزرو', adminId ?? null]);
    if (refund > 0) await t.run("INSERT INTO payments (booking_id, seq, kind, amount, status, method_name, paid_at, receipt_no, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [bookingId, 99, 'refund', -refund, PAID, 'بازگشت وجه', new Date().toISOString(), 'B-' + Date.now().toString(36).toUpperCase(), 'بازگشت وجه پس از لغو', adminId ?? null]);
  });
  if (notify) {
    const b = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    sms.sendTemplate('booking_cancelled', b.phone, { ...(await sms.bookingVars(b)), extra: refund ? `مبلغ ${fa(refund)} تومان به شما بازگردانده می‌شود.` : (penalty > net ? `مبلغ ${fa(penalty - net)} تومان بابت خسارت لغو باقی است.` : '') }, { bookingId, customerId: b.customer_id });
  }
  return { penalty, refund, debt: Math.max(0, penalty - net) };
}

/* ───── جریمهٔ تأخیر قسط (محاسبه) ───── */
async function overdue() {
  const pct = Number(await cfg('lateFeePercentPerDay')) || 0, today = todayISO();
  const rows = await db.all(`SELECT p.id, p.booking_id AS bookingId, p.seq, p.amount, p.due_date AS dueDate, b.ref, b.name, b.phone, b.trip_title AS tripTitle,
    (SELECT COALESCE(SUM(amount),0) FROM penalties x WHERE x.booking_id = b.id AND x.kind = 'delay') AS delayCharged
    FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.status = 'در انتظار' AND p.kind = 'installment' AND p.amount > 0 AND p.due_date < ? AND b.status != 'لغو شده' ORDER BY p.due_date`, [today]);
  return rows.map(r => { const days = daysBetween(r.dueDate, today); return { ...r, days, lateFee: Math.round(r.amount * pct * days / 100) }; });
}

/* ───── درگاه پرداخت (آزمایشی داخلی یا زرین‌پال) ───── */
const gatewayName = () => (process.env.PAYMENT_GATEWAY || 'sandbox').toLowerCase();
/* درگاه آزمایشی در حالت production (مگر با ALLOW_SANDBOX_PAY=true) غیرفعال است تا پرداخت ساختگی ثبت نشود */
const gatewayReady = () => gatewayName() === 'zarinpal' ? !!process.env.ZARINPAL_MERCHANT : (process.env.NODE_ENV !== 'production' || process.env.ALLOW_SANDBOX_PAY === 'true');
async function startGateway(paymentId, origin) {
  const p = await db.get("SELECT p.*, b.status AS bstatus FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ?", [paymentId]);
  if (!p || p.status === PAID || p.amount <= 0 || p.bstatus === 'لغو شده') throw bad('این پرداخت قابل انجام نیست.', 409);
  if (!gatewayReady()) throw bad('پرداخت آنلاین فعلاً فعال نیست؛ با روش‌های دیگر پرداخت کنید.', 503);
  const token = crypto.randomBytes(18).toString('hex');
  let authority = '', url = '/pay.html?t=' + token;
  if (gatewayName() === 'zarinpal') {
    const merchant = process.env.ZARINPAL_MERCHANT; if (!merchant) throw bad('درگاه پرداخت پیکربندی نشده است.', 503);
    const r = await fetch('https://api.zarinpal.com/pg/v4/payment/request.json', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ merchant_id: merchant, amount: p.amount * 10, currency: 'IRR', description: 'رزرو سفر', callback_url: `${origin}/api/pay/callback?t=${token}` }), signal: AbortSignal.timeout(10000) }).then(x => x.json()).catch(() => ({}));
    if (!r?.data?.authority) throw bad('اتصال به درگاه برقرار نشد؛ کمی بعد دوباره تلاش کنید.', 502);
    authority = r.data.authority; url = 'https://www.zarinpal.com/pg/StartPay/' + authority;
  }
  await db.run('INSERT INTO gateway_sessions (token, payment_id, amount, authority, created_at) VALUES (?,?,?,?,?)', [token, paymentId, p.amount, authority, Date.now()]);
  return { url, gateway: gatewayName() };
}
/* تأیید نهایی همیشه سمت سرور انجام می‌شود */
async function finishGateway(token, { ok, authority }) {
  const s = await db.get('SELECT * FROM gateway_sessions WHERE token = ?', [token]);
  if (!s || s.status !== 'open' || Date.now() - s.created_at > 30 * 60e3) throw bad('جلسهٔ پرداخت نامعتبر یا منقضی است.', 410);
  let success = !!ok, ref = 'SBX-' + s.token.slice(0, 8).toUpperCase();
  if (gatewayName() === 'zarinpal') {
    success = false;
    if (ok && authority === s.authority) {
      const r = await fetch('https://api.zarinpal.com/pg/v4/payment/verify.json', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ merchant_id: process.env.ZARINPAL_MERCHANT, amount: s.amount * 10, authority }), signal: AbortSignal.timeout(10000) }).then(x => x.json()).catch(() => ({}));
      if (r?.data?.code === 100 || r?.data?.code === 101) { success = true; ref = String(r.data.ref_id || authority); }
    }
  }
  const claim = await db.run("UPDATE gateway_sessions SET status = ? WHERE token = ? AND status = 'open'", [success ? 'paid' : 'failed', token]);
  if (!claim.changes) throw bad('این پرداخت قبلاً بررسی شده است.', 409);
  const p = await db.get('SELECT booking_id FROM payments WHERE id = ?', [s.payment_id]);
  const b = await db.get('SELECT * FROM bookings WHERE id = ?', [p.booking_id]);
  if (success) { await markPaid(s.payment_id, { methodName: 'پرداخت آنلاین', gatewayRef: ref }); return { success, ref: b.ref }; }
  await db.run("UPDATE payments SET status = 'ناموفق' WHERE id = ? AND status = 'در انتظار'", [s.payment_id]);
  sms.sendTemplate('payment_failed', b.phone, await sms.bookingVars(b), { bookingId: b.id, customerId: b.customer_id });
  return { success, ref: b.ref };
}

module.exports = { TRIP_SQL, PAID, finance, createBooking, buildPlan, markPaid, cancelPreview, cancelBooking, overdue, startGateway, finishGateway, gatewayName, gatewayReady, upsertCustomer };
