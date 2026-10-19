'use strict';
/* کاربران/کارکنان، نقش‌ها، نمایندگان، حمل‌ونقل، روش‌های پرداخت */
const express = require('express');
const crypto = require('node:crypto');
const { db, tx, hashPassword } = require('../db');
const { bad, clean, faToEn, int, todayISO, need, audit, phoneOk, sendCsv, jnum } = require('./core');
const { PERMISSIONS, ALL } = require('./schema');
const { BOOKING_SQL, withFin } = require('./routes-fin');

const r = express.Router();
const pw8 = p => { if (String(p ?? '').length < 8) throw bad('رمز عبور باید حداقل ۸ نویسه باشد.'); return String(p); };
const userName = u => { u = clean(u, 30); if (!/^[A-Za-z0-9_.-]{3,30}$/.test(u)) throw bad('نام کاربری باید ۳ تا ۳۰ نویسهٔ انگلیسی، عدد، نقطه یا خط تیره باشد.'); return u; };

/* ───── نقش‌ها ───── */
const roleOut = x => ({ id: x.id, name: x.name, perms: JSON.parse(x.perms), builtin: !!x.builtin, note: x.note, users: x.users });
r.get('/roles', need('users'), async (req, res) => {
  res.json({ roles: (await db.all('SELECT r.*, (SELECT COUNT(*) FROM admins a WHERE a.role_id = r.id) AS users FROM roles r ORDER BY r.id')).map(roleOut), permissions: PERMISSIONS });
});
function rolePerms(b) {
  const p = (Array.isArray(b.perms) ? b.perms : []).filter(x => ALL.includes(x));
  return JSON.stringify([...new Set(p)]);
}
r.post('/roles', need('users'), async (req, res) => {
  const name = clean(req.body?.name, 40); if (name.length < 2) throw bad('نام نقش را وارد کنید.');
  if (await db.get('SELECT 1 FROM roles WHERE name = ?', [name])) throw bad('نقشی با این نام وجود دارد.', 409);
  const x = await db.run('INSERT INTO roles (name, perms, note) VALUES (?,?,?)', [name, rolePerms(req.body), clean(req.body?.note, 120)]);
  await audit(req, 'نقش جدید', name); res.json({ ok: true, id: x.id });
});
r.put('/roles/:id', need('users'), async (req, res) => {
  const cur = await db.get('SELECT * FROM roles WHERE id = ?', [req.params.id]); if (!cur) throw bad('نقش یافت نشد.', 404);
  if (cur.builtin) throw bad('نقش‌های سیستمی (مدیر کل و نماینده) قابل ویرایش نیستند.', 409);
  const name = clean(req.body?.name, 40); if (name.length < 2) throw bad('نام نقش را وارد کنید.');
  if (await db.get('SELECT 1 FROM roles WHERE name = ? AND id != ?', [name, cur.id])) throw bad('نقشی با این نام وجود دارد.', 409);
  await db.run('UPDATE roles SET name=?, perms=?, note=? WHERE id=?', [name, rolePerms(req.body), clean(req.body?.note, 120), cur.id]);
  /* تغییر دسترسی روی نشست‌های فعال بلافاصله اعمال می‌شود (دسترسی‌ها هر درخواست خوانده می‌شود) */
  await audit(req, 'ویرایش نقش', name); res.json({ ok: true });
});
r.delete('/roles/:id', need('users'), async (req, res) => {
  const cur = await db.get('SELECT * FROM roles WHERE id = ?', [req.params.id]); if (!cur) throw bad('نقش یافت نشد.', 404);
  if (cur.builtin) throw bad('نقش‌های سیستمی حذف نمی‌شوند.', 409);
  if ((await db.get('SELECT COUNT(*) c FROM admins WHERE role_id = ?', [cur.id])).c) throw bad('این نقش به کاربرانی داده شده؛ ابتدا نقش آن‌ها را تغییر دهید.', 409);
  await db.run('DELETE FROM roles WHERE id = ?', [cur.id]); await audit(req, 'حذف نقش', cur.name); res.json({ ok: true });
});

/* ───── کاربران و کارکنان (حساب‌های ورود به پنل؛ نماینده‌ها در بخش خودشان) ───── */
r.get('/users', need('users'), async (req, res) => {
  res.json({ users: (await db.all(`SELECT a.id, a.username, a.full_name AS fullName, a.phone, a.kind, a.active, a.role_id AS roleId, r.name AS roleName, a.agent_id AS agentId,
    (SELECT COUNT(*) FROM bookings b WHERE b.created_by = a.id) AS bookings FROM admins a LEFT JOIN roles r ON r.id = a.role_id ORDER BY a.id`)).map(u => ({ ...u, active: !!u.active })) });
});
async function checkRole(roleId) {
  const role = await db.get('SELECT * FROM roles WHERE id = ?', [Number(roleId)]); if (!role) throw bad('نقش نامعتبر است.');
  return role;
}
async function lastOwnerGuard(id, willLoseOwner) {
  if (!willLoseOwner) return;
  const left = (await db.get("SELECT COUNT(*) c FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.active = 1 AND a.id != ? AND r.perms LIKE '%\"*\"%'", [id])).c;
  if (!left) throw bad('حداقل یک مدیر کل فعال باید باقی بماند.', 409);
}
r.post('/users', need('users'), async (req, res) => {
  const b = req.body || {}, username = userName(b.username), role = await checkRole(b.roleId);
  if (role.id === 5) throw bad('حساب نماینده از بخش «نمایندگان» ساخته می‌شود.');
  if (await db.get('SELECT 1 FROM admins WHERE username = ?', [username])) throw bad('این نام کاربری قبلاً ثبت شده است.', 409);
  const phone = faToEn(clean(b.phone, 20)); if (phone && !phoneOk(phone)) throw bad('شمارهٔ موبایل معتبر نیست.');
  const x = await db.run('INSERT INTO admins (username, password_hash, full_name, phone, role_id, kind) VALUES (?,?,?,?,?,?)', [username, hashPassword(pw8(b.password)), clean(b.fullName, 80), phone, role.id, 'staff']);
  await audit(req, 'کاربر جدید', `${username} (${role.name})`); res.json({ ok: true, id: x.id });
});
r.put('/users/:id', need('users'), async (req, res) => {
  const u = await db.get('SELECT a.*, r.perms FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = ?', [req.params.id]); if (!u) throw bad('کاربر یافت نشد.', 404);
  const b = req.body || {}, phone = faToEn(clean(b.phone, 20)); if (phone && !phoneOk(phone)) throw bad('شمارهٔ موبایل معتبر نیست.');
  let roleId = u.role_id;
  if (u.kind === 'agent') { /* نقش نماینده ثابت است */ } else { const role = await checkRole(b.roleId ?? u.role_id); if (role.id === 5) throw bad('نقش نماینده فقط برای حساب‌های بخش «نمایندگان» است.'); roleId = role.id; }
  const active = b.active === false ? 0 : 1;
  if (u.id === req.admin.id && !active) throw bad('نمی‌توانید حساب خودتان را غیرفعال کنید.', 409);
  const newPerms = JSON.parse((await db.get('SELECT perms FROM roles WHERE id = ?', [roleId])).perms);
  await lastOwnerGuard(u.id, (JSON.parse(u.perms || '[]').includes('*')) && (!active || !newPerms.includes('*')));
  await db.run('UPDATE admins SET full_name=?, phone=?, role_id=?, active=? WHERE id=?', [clean(b.fullName, 80), phone, roleId, active, u.id]);
  if (!active) await db.run('DELETE FROM sessions WHERE admin_id = ?', [u.id]);
  await audit(req, 'ویرایش کاربر', u.username); res.json({ ok: true });
});
r.post('/users/:id/password', need('users'), async (req, res) => {
  const pw = pw8(req.body?.password);
  if (!(await db.get('SELECT 1 FROM admins WHERE id = ?', [req.params.id]))) throw bad('کاربر یافت نشد.', 404);
  await tx(async t => { await t.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(pw), req.params.id]); await t.run('DELETE FROM sessions WHERE admin_id = ?', [req.params.id]); });
  await audit(req, 'تغییر رمز کاربر', req.params.id); res.json({ ok: true });
});
r.delete('/users/:id', need('users'), async (req, res) => {
  const u = await db.get('SELECT a.*, r.perms FROM admins a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = ?', [req.params.id]); if (!u) throw bad('کاربر یافت نشد.', 404);
  if (u.id === req.admin.id) throw bad('نمی‌توانید حساب خودتان را حذف کنید.', 409);
  if (u.kind === 'agent') throw bad('حساب نماینده را از بخش «نمایندگان» غیرفعال یا حذف کنید.', 409);
  await lastOwnerGuard(u.id, JSON.parse(u.perms || '[]').includes('*'));
  await db.run('DELETE FROM admins WHERE id = ?', [u.id]); await audit(req, 'حذف کاربر', u.username); res.json({ ok: true });
});

/* ───── نمایندگان ───── */
const AGENT_SQL = `SELECT a.*, ad.username,
  (SELECT COUNT(*) FROM bookings b WHERE b.agent_id = a.id AND b.status != 'لغو شده') AS bookings,
  COALESCE((SELECT SUM(b.total) FROM bookings b WHERE b.agent_id = a.id AND b.status != 'لغو شده'),0) AS sales,
  COALESCE((SELECT SUM(b.commission) FROM bookings b WHERE b.agent_id = a.id AND b.status != 'لغو شده'),0) AS commission,
  COALESCE((SELECT SUM(s.amount) FROM agent_settlements s WHERE s.agent_id = a.id),0) AS settled
  FROM agents a LEFT JOIN admins ad ON ad.id = a.admin_id`;
const agentOut = a => ({ id: a.id, name: a.name, phone: a.phone, city: a.city, code: a.code, commissionPercent: a.commission_percent, active: !!a.active, notes: a.notes, username: a.username, bookings: a.bookings, sales: a.sales, commission: a.commission, settled: a.settled, balance: a.commission - a.settled });
r.get('/agents', need('agents'), async (req, res) => res.json({ agents: (await db.all(AGENT_SQL + ' ORDER BY a.id DESC')).map(agentOut) }));
function agentBody(b) {
  const a = { name: clean(b.name, 80), phone: faToEn(clean(b.phone, 20)), city: clean(b.city, 40), notes: clean(b.notes, 300), pct: Number(faToEn(b.commissionPercent)) };
  if (a.name.length < 3) throw bad('نام نماینده را کامل وارد کنید.');
  if (a.phone && !phoneOk(a.phone)) throw bad('شمارهٔ موبایل معتبر نیست.');
  if (!(a.pct >= 0 && a.pct <= 60)) throw bad('درصد کمیسیون باید بین ۰ تا ۶۰ باشد.');
  return a;
}
r.post('/agents', need('agents'), async (req, res) => {
  const b = req.body || {}, a = agentBody(b), username = userName(b.username), pw = pw8(b.password);
  if (await db.get('SELECT 1 FROM admins WHERE username = ?', [username])) throw bad('این نام کاربری قبلاً ثبت شده است.', 409);
  const id = await tx(async t => {
    const code = 'AG' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const ag = await t.run('INSERT INTO agents (name, phone, city, code, commission_percent, notes) VALUES (?,?,?,?,?,?)', [a.name, a.phone, a.city, code, a.pct, a.notes]);
    const ad = await t.run('INSERT INTO admins (username, password_hash, full_name, phone, role_id, kind, agent_id) VALUES (?,?,?,?,5,?,?)', [username, hashPassword(pw), a.name, a.phone, 'agent', ag.id]);
    await t.run('UPDATE agents SET admin_id = ? WHERE id = ?', [ad.id, ag.id]);
    return ag.id;
  });
  await audit(req, 'نمایندهٔ جدید', a.name); res.json({ ok: true, id });
});
r.put('/agents/:id', need('agents'), async (req, res) => {
  const cur = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]); if (!cur) throw bad('نماینده یافت نشد.', 404);
  const a = agentBody(req.body || {}), active = req.body?.active === false ? 0 : 1;
  await tx(async t => {
    await t.run('UPDATE agents SET name=?, phone=?, city=?, commission_percent=?, notes=?, active=? WHERE id=?', [a.name, a.phone, a.city, a.pct, a.notes, active, cur.id]);
    await t.run('UPDATE admins SET full_name=?, phone=?, active=? WHERE id=?', [a.name, a.phone, active, cur.admin_id]);
    if (!active) await t.run('DELETE FROM sessions WHERE admin_id = ?', [cur.admin_id]);
  });
  await audit(req, 'ویرایش نماینده', a.name); res.json({ ok: true });
});
r.post('/agents/:id/password', need('agents'), async (req, res) => {
  const cur = await db.get('SELECT admin_id FROM agents WHERE id = ?', [req.params.id]); if (!cur) throw bad('نماینده یافت نشد.', 404);
  await tx(async t => { await t.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(pw8(req.body?.password)), cur.admin_id]); await t.run('DELETE FROM sessions WHERE admin_id = ?', [cur.admin_id]); });
  res.json({ ok: true });
});
r.delete('/agents/:id', need('agents'), async (req, res) => {
  const cur = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]); if (!cur) throw bad('نماینده یافت نشد.', 404);
  if ((await db.get('SELECT COUNT(*) c FROM bookings WHERE agent_id = ?', [cur.id])).c) throw bad('این نماینده رزرو دارد و حذف نمی‌شود؛ غیرفعالش کنید.', 409);
  await tx(async t => { await t.run('DELETE FROM admins WHERE id = ?', [cur.admin_id]); await t.run('DELETE FROM agents WHERE id = ?', [cur.id]); });
  await audit(req, 'حذف نماینده', cur.name); res.json({ ok: true });
});
/* تسویهٔ کمیسیون */
r.get('/agents/:id/settlements', need('agents'), async (req, res) => res.json({ settlements: await db.all('SELECT id, amount, note, paid_on AS paidOn, created_at AS createdAt FROM agent_settlements WHERE agent_id = ? ORDER BY id DESC', [req.params.id]) }));
r.post('/agents/:id/settlements', need('agents'), async (req, res) => {
  const a = await db.get(AGENT_SQL + ' WHERE a.id = ?', [req.params.id]); if (!a) throw bad('نماینده یافت نشد.', 404);
  const amount = int(req.body?.amount), paidOn = clean(faToEn(req.body?.paidOn), 10) || todayISO();
  if (!Number.isInteger(amount) || amount < 1) throw bad('مبلغ را به‌صورت عدد وارد کنید.');
  if (amount > a.commission - a.settled) throw bad('مبلغ از کمیسیون تسویه‌نشده بیشتر است.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw bad('تاریخ نامعتبر است.');
  await db.run('INSERT INTO agent_settlements (agent_id, amount, note, paid_on, created_by) VALUES (?,?,?,?,?)', [a.id, amount, clean(req.body?.note, 200), paidOn, req.admin.id]);
  await audit(req, 'تسویهٔ نماینده', `${a.name} — ${amount}`); res.json({ ok: true });
});
r.delete('/agents/:id/settlements/:sid', need('agents'), async (req, res) => { await db.run('DELETE FROM agent_settlements WHERE id = ? AND agent_id = ?', [req.params.sid, req.params.id]); res.json({ ok: true }); });

/* پنل اختصاصی نماینده (فقط دادهٔ خودش) */
r.get('/agent/summary', need('agent'), async (req, res) => {
  const id = req.admin.agent_id; if (!id) throw bad('حساب شما به نماینده متصل نیست.', 403);
  const a = await db.get(AGENT_SQL + ' WHERE a.id = ?', [id]);
  const list = (await db.all(BOOKING_SQL + ' WHERE b.agent_id = ?', [id])).map(withFin);
  const unpaid = list.filter(b => b.status !== 'لغو شده').reduce((s, b) => s + b.balance, 0);
  res.json({ agent: { ...agentOut(a), code: a.code }, unpaid, collected: list.reduce((s, b) => s + b.net, 0), pending: list.filter(b => b.status === 'در انتظار پرداخت').length,
    settlements: await db.all('SELECT id, amount, note, paid_on AS paidOn FROM agent_settlements WHERE agent_id = ? ORDER BY id DESC LIMIT 50', [id]) });
});
r.get('/agent/trips', need('agent'), async (req, res) => {
  const trips = await db.all("SELECT t.id, t.title, t.destination, t.date, t.price, t.transport, t.capacity - COALESCE((SELECT SUM(count) FROM bookings b WHERE b.trip_id = t.id AND b.status != 'لغو شده'),0) AS seatsLeft FROM trips t WHERE t.active = 1 AND (t.date IS NULL OR t.date >= ?) ORDER BY (t.date IS NULL), t.date", [todayISO()]);
  res.json({ trips });
});

/* ───── حمل‌ونقل ───── */
r.get('/transports', async (req, res) => res.json({ transports: (await db.all('SELECT t.*, (SELECT COUNT(*) FROM trips x WHERE x.transport = t.name) AS trips FROM transport_types t ORDER BY t.sort_order, t.id')).map(t => ({ id: t.id, name: t.name, icon: t.icon, description: t.description, active: !!t.active, sortOrder: t.sort_order, trips: t.trips })) }));
function transport(b) {
  const t = { name: clean(b.name, 40), icon: clean(b.icon, 8), description: clean(b.description, 120), active: b.active === false ? 0 : 1 };
  if (t.name.length < 2) throw bad('نام وسیلهٔ نقلیه را وارد کنید.'); return t;
}
r.post('/transports', need('transports'), async (req, res) => {
  const t = transport(req.body || {}); if (await db.get('SELECT 1 FROM transport_types WHERE name = ?', [t.name])) throw bad('این وسیله قبلاً ثبت شده است.', 409);
  const next = (await db.get('SELECT COALESCE(MAX(sort_order),0)+1 n FROM transport_types')).n;
  await db.run('INSERT INTO transport_types (name, icon, description, active, sort_order) VALUES (?,?,?,?,?)', [t.name, t.icon, t.description, t.active, next]); res.json({ ok: true });
});
r.put('/transports/:id', need('transports'), async (req, res) => {
  const cur = await db.get('SELECT * FROM transport_types WHERE id = ?', [req.params.id]); if (!cur) throw bad('یافت نشد.', 404);
  const t = transport(req.body || {});
  if (await db.get('SELECT 1 FROM transport_types WHERE name = ? AND id != ?', [t.name, cur.id])) throw bad('این نام قبلاً ثبت شده است.', 409);
  await tx(async x => { await x.run('UPDATE transport_types SET name=?, icon=?, description=?, active=? WHERE id=?', [t.name, t.icon, t.description, t.active, cur.id]); if (t.name !== cur.name) await x.run('UPDATE trips SET transport = ? WHERE transport = ?', [t.name, cur.name]); });
  res.json({ ok: true });
});
r.delete('/transports/:id', need('transports'), async (req, res) => {
  const cur = await db.get('SELECT * FROM transport_types WHERE id = ?', [req.params.id]); if (!cur) throw bad('یافت نشد.', 404);
  if ((await db.get('SELECT COUNT(*) c FROM trips WHERE transport = ?', [cur.name])).c) throw bad('این وسیله در سفرها استفاده شده؛ به‌جای حذف غیرفعالش کنید.', 409);
  await db.run('DELETE FROM transport_types WHERE id = ?', [cur.id]); res.json({ ok: true });
});
r.post('/transports/order', need('transports'), async (req, res) => {
  const ids = req.body?.ids; if (!Array.isArray(ids)) throw bad('ترتیب نامعتبر است.');
  await tx(async t => { for (const [i, id] of ids.entries()) await t.run('UPDATE transport_types SET sort_order = ? WHERE id = ?', [i, Number(id)]); }); res.json({ ok: true });
});

/* ───── روش‌های پرداخت ───── */
const TYPES = { cash: 'نقدی', card: 'کارت‌به‌کارت', online: 'آنلاین (درگاه)', installment: 'اقساطی' };
const methodOut = m => ({ id: m.id, name: m.name, type: m.type, typeName: TYPES[m.type], installments: m.installments, downPercent: m.down_percent, intervalDays: m.interval_days, feePercent: m.fee_percent, terms: m.terms, public: !!m.public, active: !!m.active });
r.get('/paymethods', need('paymethods', 'payments', 'bookings', 'agent'), async (req, res) => {
  const all = req.query.all === '1' && (req.admin.perms.includes('*') || req.admin.perms.includes('paymethods'));
  res.json({ methods: (await db.all('SELECT * FROM payment_methods' + (all ? '' : ' WHERE active = 1') + ' ORDER BY sort_order, id')).map(methodOut), types: TYPES });
});
function method(b) {
  const m = { name: clean(b.name, 60), type: TYPES[b.type] ? b.type : 'cash', installments: int(b.installments, 1), down: Number(faToEn(b.downPercent ?? 100)), interval: int(b.intervalDays, 30), fee: Number(faToEn(b.feePercent ?? 0)), terms: clean(b.terms, 300), pub: b.public === false ? 0 : 1, active: b.active === false ? 0 : 1 };
  if (m.name.length < 2) throw bad('نام روش پرداخت را وارد کنید.');
  if (m.type === 'installment') {
    if (!(m.installments >= 2 && m.installments <= 12)) throw bad('تعداد اقساط (با احتساب پیش‌پرداخت) باید بین ۲ تا ۱۲ باشد.');
    if (!(m.down >= 0 && m.down <= 90)) throw bad('درصد پیش‌پرداخت باید بین ۰ تا ۹۰ باشد.');
    if (!(m.interval >= 1 && m.interval <= 90)) throw bad('فاصلهٔ اقساط باید بین ۱ تا ۹۰ روز باشد.');
    if (!(m.fee >= 0 && m.fee <= 50)) throw bad('درصد کارمزد باید بین ۰ تا ۵۰ باشد.');
  } else { m.installments = 1; m.down = 100; m.fee = 0; m.interval = 30; }
  return m;
}
r.post('/paymethods', need('paymethods'), async (req, res) => {
  const m = method(req.body || {}); if (await db.get('SELECT 1 FROM payment_methods WHERE name = ?', [m.name])) throw bad('روشی با این نام وجود دارد.', 409);
  const next = (await db.get('SELECT COALESCE(MAX(sort_order),0)+1 n FROM payment_methods')).n;
  await db.run('INSERT INTO payment_methods (name,type,installments,down_percent,interval_days,fee_percent,terms,public,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)', [m.name, m.type, m.installments, m.down, m.interval, m.fee, m.terms, m.pub, m.active, next]);
  await audit(req, 'روش پرداخت جدید', m.name); res.json({ ok: true });
});
r.put('/paymethods/:id', need('paymethods'), async (req, res) => {
  const cur = await db.get('SELECT * FROM payment_methods WHERE id = ?', [req.params.id]); if (!cur) throw bad('یافت نشد.', 404);
  const m = method(req.body || {}); if (await db.get('SELECT 1 FROM payment_methods WHERE name = ? AND id != ?', [m.name, cur.id])) throw bad('روشی با این نام وجود دارد.', 409);
  await db.run('UPDATE payment_methods SET name=?,type=?,installments=?,down_percent=?,interval_days=?,fee_percent=?,terms=?,public=?,active=? WHERE id=?', [m.name, m.type, m.installments, m.down, m.interval, m.fee, m.terms, m.pub, m.active, cur.id]);
  res.json({ ok: true });
});
r.delete('/paymethods/:id', need('paymethods'), async (req, res) => {
  if ((await db.get('SELECT COUNT(*) c FROM bookings WHERE method_id = ?', [req.params.id])).c) throw bad('این روش در رزروها استفاده شده؛ غیرفعالش کنید.', 409);
  await db.run('DELETE FROM payment_methods WHERE id = ?', [req.params.id]); res.json({ ok: true });
});

module.exports = r;
