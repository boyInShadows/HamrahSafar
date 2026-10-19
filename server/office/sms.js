'use strict';
/* سامانهٔ پیامک: قالب‌ها، صف/لاگ، و آداپتور ارائه‌دهنده.
   SMS_PROVIDER = log (پیش‌فرض؛ فقط ثبت در لاگ) | kavenegar (نیازمند SMS_API_KEY و SMS_SENDER) */
const { db } = require('../db');
const { clean, cfg, fa, jdate } = require('./core');

const provider = () => (process.env.SMS_PROVIDER || 'log').toLowerCase();

async function deliver(phone, text) {
  if (provider() === 'kavenegar') {
    if (!process.env.SMS_API_KEY) throw new Error('SMS_API_KEY تنظیم نشده است.');
    const u = new URL(`https://api.kavenegar.com/v1/${encodeURIComponent(process.env.SMS_API_KEY)}/sms/send.json`);
    u.searchParams.set('receptor', phone); u.searchParams.set('message', text);
    if (process.env.SMS_SENDER) u.searchParams.set('sender', process.env.SMS_SENDER);
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.return?.status !== 200) throw new Error(j?.return?.message || 'خطای ارائه‌دهندهٔ پیامک');
    return 'kavenegar';
  }
  return 'log';
}

/* جایگزینی {متغیر}ها در قالب */
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')).replace(/\s{2,}/g, ' ').trim();

async function send(phone, text, meta = {}) {
  phone = String(phone || ''); text = clean(text, 700);
  if (!/^09\d{9}$/.test(phone) || !text) return null;
  if ((await cfg('smsEnabled')) !== '1') return null;
  const row = await db.run('INSERT INTO sms_log (phone, text, kind, booking_id, customer_id, provider) VALUES (?,?,?,?,?,?)', [phone, text, meta.kind || '', meta.bookingId ?? null, meta.customerId ?? null, provider()]);
  try {
    const p = await deliver(phone, text);
    await db.run("UPDATE sms_log SET status = ?, provider = ? WHERE id = ?", [p === 'log' ? 'ثبت شد (آزمایشی)' : 'ارسال شد', p, row.id]);
  } catch (e) { await db.run("UPDATE sms_log SET status = 'ناموفق', error = ? WHERE id = ?", [clean(e.message, 200), row.id]); }
  return row.id;
}

/* ارسال با قالب؛ اگر قالب غیرفعال باشد چیزی نمی‌رود. هیچ‌وقت خطا پرتاب نمی‌کند. */
async function sendTemplate(key, phone, vars = {}, meta = {}) {
  try {
    const t = await db.get('SELECT body, enabled FROM sms_templates WHERE key = ?', [key]);
    if (!t || !t.enabled) return null;
    return await send(phone, fill(t.body, { agency: await cfg('agencyName'), extra: '', ...vars }), { kind: key, ...meta });
  } catch (e) { console.error('sms', e.message); return null; }
}

/* متغیرهای رایج رزرو برای قالب‌ها */
async function bookingVars(b) {
  const trip = await db.get('SELECT title, date FROM trips WHERE id = ?', [b.trip_id]);
  const paid = (await db.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE booking_id = ? AND status = 'پرداخت شده'", [b.id])).s;
  return { name: b.name, ref: b.ref, trip: b.trip_title, date: jdate(trip?.date), total: fa(b.total + (b.surcharge || 0)), balance: fa(Math.max(0, b.total + (b.surcharge || 0) - paid)) };
}

module.exports = { send, sendTemplate, fill, bookingVars, provider };
