'use strict';
/* یادآوری حرکت و اقساط (زمان‌بندی خودکار + اجرای دستی) */
const { db } = require('./../db');
const { todayISO, addDays, cfg, fa, jdate } = require('./core');
const sms = require('./sms');

const days = s => String(s || '').split(',').map(x => Number(x.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 30);

async function departures(todayStr = todayISO()) {
  const ds = days(await cfg('remindDays')), out = [];
  for (const d of ds) {
    const rows = await db.all(`SELECT b.*, t.date FROM bookings b JOIN trips t ON t.id = b.trip_id
      WHERE t.date = ? AND b.status = 'تأیید شده' AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.kind = ? AND r.booking_id = b.id AND r.payment_id = 0)`, [addDays(todayStr, d), 'depart-' + d]);
    for (const b of rows) out.push({ kind: 'depart-' + d, d, b });
  }
  return out;
}
async function installments(todayStr = todayISO()) {
  const n = Number((await cfg('installmentRemindDays')) || 0);
  const rows = await db.all(`SELECT p.*, b.name, b.phone, b.ref, b.trip_title, b.id AS bid, b.customer_id FROM payments p JOIN bookings b ON b.id = p.booking_id
    WHERE p.status = 'در انتظار' AND p.kind = 'installment' AND p.amount > 0 AND b.status != 'لغو شده' AND p.due_date <= ? AND p.seq > 1`, [addDays(todayStr, n)]);
  const out = [];
  for (const p of rows) {
    const kind = p.due_date < todayStr ? 'overdue' : 'due';
    if (!(await db.get('SELECT 1 FROM reminders_sent WHERE kind = ? AND booking_id = ? AND payment_id = ?', [kind, p.bid, p.id]))) out.push({ kind, p });
  }
  return out;
}

async function preview() {
  const dep = await departures(), ins = await installments();
  return {
    departures: dep.map(x => ({ kind: x.kind, ref: x.b.ref, name: x.b.name, phone: x.b.phone, trip: x.b.trip_title, date: x.b.date })),
    installments: ins.map(x => ({ kind: x.kind, ref: x.p.ref, name: x.p.name, phone: x.p.phone, amount: x.p.amount, dueDate: x.p.due_date, seq: x.p.seq }))
  };
}

async function run() {
  if ((await cfg('smsEnabled')) !== '1') return { departures: 0, installments: 0, skipped: true };
  let nd = 0, ni = 0;
  for (const { kind, d, b } of await departures()) {
    const claim = await db.run('INSERT OR IGNORE INTO reminders_sent (kind, booking_id, payment_id) VALUES (?,?,0)', [kind, b.id]);
    if (!claim.changes) continue;
    await sms.sendTemplate('depart_reminder', b.phone, { ...(await sms.bookingVars(b)), when: d === 0 ? 'امروز' : d === 1 ? 'فردا' : `${fa(d)} روز دیگر`, extra: 'لطفاً نیم ساعت زودتر در محل حاضر باشید.' }, { bookingId: b.id, customerId: b.customer_id });
    nd++;
  }
  for (const { kind, p } of await installments()) {
    const claim = await db.run('INSERT OR IGNORE INTO reminders_sent (kind, booking_id, payment_id) VALUES (?,?,?)', [kind, p.bid, p.id]);
    if (!claim.changes) continue;
    await sms.sendTemplate('installment_due', p.phone, { name: p.name, ref: p.ref, seq: fa(p.seq), amount: fa(p.amount), date: jdate(p.due_date) }, { bookingId: p.bid, customerId: p.customer_id });
    ni++;
  }
  return { departures: nd, installments: ni };
}

let timer;
function start() {
  const tick = () => run().then(r => { if (r.departures || r.installments) console.log('یادآوری‌ها:', r); }).catch(e => console.error('reminders', e.message));
  setTimeout(tick, 15e3).unref(); timer = setInterval(tick, 30 * 60e3); timer.unref();
}
module.exports = { preview, run, start };
