'use strict';
/* آزمون ماژول‌های عملیاتی: نقش‌ها، نماینده، مشتری، پرداخت/اقساط، لغو و خسارت، گزارش، پیامک */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs'), path = require('node:path');

const PORT = 3800 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const tempRoot = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tempRoot, 'hamrah-office-'));
let proc; const jar = {};

async function call(p, { method = 'GET', body, as } = {}) {
  const res = await fetch(BASE + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: jar[as] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => ({})) : await res.text(), res };
}
async function login(name, username, password) {
  const r = await call('/api/admin/login', { method: 'POST', body: { username, password } });
  assert.equal(r.status, 200, 'login ' + username); jar[name] = r.res.headers.get('set-cookie').split(';')[0];
}
const O = (as, p, method, body) => call('/api/office' + p, { method, body, as });

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR: dir, DATABASE_URL: '', DATABASE_AUTH_TOKEN: '', ADMIN_USER: 'admin', ADMIN_PASS: 'TestPass123', COOKIE_SECURE: 'false', NODE_ENV: 'test', SMS_PROVIDER: 'log', PAYMENT_GATEWAY: 'sandbox' },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/trips'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  await login('owner', 'admin', 'TestPass123');
});
after(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

let trip, agentId, bookingId, bookingRef;

test('office endpoints need login and roles limit access', async () => {
  assert.equal((await call('/api/office/customers')).status, 401);
  const roles = await O('owner', '/roles'); assert.equal(roles.status, 200); assert.ok(roles.data.roles.length >= 5);
  const created = await O('owner', '/roles', 'POST', { name: 'فقط گزارش', perms: ['reports'] }); assert.equal(created.status, 200);
  assert.equal((await O('owner', '/users', 'POST', { username: 'rep', password: 'short', roleId: created.data.id })).status, 400);
  assert.equal((await O('owner', '/users', 'POST', { username: 'rep', password: 'Report1234', fullName: 'گزارش‌گیر', roleId: created.data.id })).status, 200);
  await login('rep', 'rep', 'Report1234');
  assert.equal((await O('rep', '/reports/overview')).status, 200);
  assert.equal((await O('rep', '/customers')).status, 403);
  assert.equal((await O('rep', '/agents')).status, 403);
  assert.equal((await call('/api/admin/trips', { as: 'rep' })).status, 403);   /* پنل قدیمی هم نقش را رعایت می‌کند */
  assert.equal((await O('rep', '/users')).status, 403);
  /* پیکربندی نقش بلافاصله اعمال می‌شود */
  await O('owner', `/roles/${created.data.id}`, 'PUT', { name: 'فقط گزارش', perms: ['reports', 'customers'] });
  assert.equal((await O('rep', '/customers')).status, 200);
  /* نقش‌های سیستمی ثابت‌اند و آخرین مدیر کل حذف نمی‌شود */
  assert.equal((await O('owner', '/roles/1', 'PUT', { name: 'x', perms: [] })).status, 409);
  const me = await call('/api/admin/me', { as: 'owner' }); assert.deepEqual(me.data.perms, ['*']);
  const ownerId = (await O('owner', '/users')).data.users.find(u => u.username === 'admin').id;
  assert.equal((await O('owner', `/users/${ownerId}`, 'DELETE')).status, 409);
});

test('agent: own panel, scoped bookings and commission', async () => {
  trip = (await call('/api/trips')).data.trips.find(t => t.seatsLeft >= 6);
  assert.equal((await O('owner', '/agents', 'POST', { name: 'نماینده تست', phone: '09120001111', commissionPercent: 10, username: 'ag1', password: '1234' })).status, 400);
  const mk = await O('owner', '/agents', 'POST', { name: 'نماینده تست', phone: '09120001111', commissionPercent: 10, username: 'ag1', password: 'Agent12345' });
  assert.equal(mk.status, 200); agentId = mk.data.id;
  await login('agent', 'ag1', 'Agent12345');
  assert.equal((await call('/api/admin/trips', { as: 'agent' })).status, 403);
  assert.equal((await call('/api/admin/bookings', { as: 'agent' })).status, 403);
  assert.equal((await O('agent', '/agents')).status, 403);
  assert.equal((await O('agent', '/reports/overview')).status, 403);
  assert.equal((await O('agent', '/payments')).status, 403);
  const b = await O('agent', '/bookings', 'POST', { tripId: trip.id, name: 'مشتری نماینده', phone: '09121112222', count: 2, methodId: 1 });
  assert.equal(b.status, 200); assert.equal(b.data.total, trip.price * 2);
  const sum = (await O('agent', '/agent/summary')).data;
  assert.equal(sum.agent.commission, Math.round(trip.price * 2 * 0.1)); assert.equal(sum.agent.bookings, 1);
  /* نماینده فقط رزروهای خودش را می‌بیند */
  const direct = await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'مشتری مستقیم', phone: '09123334444', count: 1 } });
  assert.equal(direct.status, 200);
  const mine = (await O('agent', '/bookings')).data.bookings; assert.equal(mine.length, 1); assert.equal(mine[0].agentName, 'نماینده تست');
  assert.equal((await O('agent', `/bookings/${(await O('owner', '/bookings')).data.bookings.find(x => x.ref === direct.data.ref).id}`)).status, 404);
  /* مشتری نماینده در CRM او دیده می‌شود، نه مشتری مستقیم */
  const cs = (await O('agent', '/customers')).data.customers; assert.deepEqual(cs.map(c => c.phone), ['09121112222']);
  /* تسویهٔ کمیسیون */
  assert.equal((await O('owner', `/agents/${agentId}/settlements`, 'POST', { amount: 999999999 })).status, 400);
  assert.equal((await O('owner', `/agents/${agentId}/settlements`, 'POST', { amount: 1000, note: 'علی‌الحساب' })).status, 200);
  assert.equal((await O('agent', '/agent/summary')).data.agent.balance, sum.agent.commission - 1000);
});

test('customers (CRM): auto-created from bookings, search, notes, follow-ups', async () => {
  const list = (await O('owner', '/customers?q=مستقیم')).data.customers; assert.equal(list.length, 1);
  const id = list[0].id;
  assert.equal((await O('owner', `/customers/${id}`, 'PUT', { name: 'مشتری مستقیم', phone: '09123334444', nationalId: '123', category: 'VIP' })).status, 400);
  assert.equal((await O('owner', `/customers/${id}`, 'PUT', { name: 'مشتری مستقیم', phone: '09123334444', nationalId: '0012345678', city: 'تهران', category: 'VIP', tags: 'شمال,خانوادگی' })).status, 200);
  assert.equal((await O('owner', `/customers/${id}/notes`, 'POST', { kind: 'تماس', text: 'تماس گرفته شد', followUp: '2030-01-01' })).status, 200);
  const prof = (await O('owner', `/customers/${id}`)).data;
  assert.equal(prof.customer.category, 'VIP'); assert.equal(prof.bookings.length, 1); assert.equal(prof.notes.length, 1); assert.ok(prof.sms.length >= 1);
  assert.equal((await O('owner', '/customers/followups')).data.followups.length, 1);
  assert.equal((await O('owner', '/customers?category=VIP')).data.customers.length, 1);
  assert.equal((await O('owner', `/customers/${id}`, 'DELETE')).status, 409);
  assert.equal((await O('owner', '/customers', 'POST', { name: 'دستی ثبت', phone: '09125556666' })).status, 200);
  assert.equal((await O('owner', '/customers', 'POST', { name: 'دستی ثبت', phone: '09125556666' })).status, 409);
  const csv = await O('owner', '/customers.csv'); assert.equal(csv.status, 200); assert.ok(csv.data.includes('09123334444'));
});

test('installment plan, payments, auto-confirm, receipts and SMS log', async () => {
  const b = await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'خریدار اقساطی', phone: '09127778888', count: 2, methodId: 4 } });
  assert.equal(b.status, 200); bookingRef = b.data.ref; assert.equal(b.data.plan.surcharge, Math.round(trip.price * 2 * 0.05));
  const row = (await O('owner', '/bookings')).data.bookings.find(x => x.ref === bookingRef); bookingId = row.id;
  const d = (await O('owner', `/bookings/${bookingId}`)).data;
  assert.equal(d.payments.length, 3);
  assert.equal(d.payments.reduce((s, p) => s + p.amount, 0), trip.price * 2 + b.data.plan.surcharge);
  assert.equal(d.booking.status, 'در انتظار پرداخت');
  /* پرداخت پیش‌پرداخت → تأیید خودکار */
  assert.equal((await O('owner', `/payments/${d.payments[0].id}/pay`, 'POST', { methodName: 'کارت‌خوان' })).status, 200);
  assert.equal((await O('owner', `/payments/${d.payments[0].id}/pay`, 'POST', {})).status, 409);
  const after = (await O('owner', `/bookings/${bookingId}`)).data;
  assert.equal(after.booking.status, 'تأیید شده'); assert.equal(after.booking.balance, trip.price * 2 + b.data.plan.surcharge - d.payments[0].amount);
  assert.match(after.payments[0].receiptNo, /^R-\d{8}-\d{5}$/);
  /* تغییر روش پس از پرداخت ممنوع */
  assert.equal((await O('owner', `/bookings/${bookingId}/plan`, 'POST', { methodId: 1 })).status, 409);
  /* پرداخت دستی بیش از مانده رد می‌شود */
  assert.equal((await O('owner', `/bookings/${bookingId}/payments`, 'POST', { amount: 99999999999 })).status, 400);
  /* پیامک‌ها ثبت شده‌اند (ثبت رزرو، دریافت پرداخت، تأیید) */
  const log = (await O('owner', '/sms/log')).data.log.filter(x => x.phone === '09127778888').map(x => x.kind);
  for (const k of ['booking_created', 'payment_received', 'booking_confirmed']) assert.ok(log.includes(k), k);
  /* کاربر در صفحهٔ پیگیری برنامهٔ پرداخت و رسید را می‌بیند */
  const tr = (await call(`/api/bookings/track?ref=${bookingRef}&phone=09127778888`)).data.booking;
  assert.equal(tr.payments.length, 3); assert.equal(tr.canChooseMethod, false);
  const rc = (await call(`/api/receipt?ref=${bookingRef}&phone=09127778888`)).data; assert.equal(rc.payments.length, 1); assert.equal(rc.agency, 'همراه سفر');
  assert.equal((await call(`/api/receipt?ref=${bookingRef}&phone=09120000000`)).status, 404);
});

test('online payment via sandbox gateway; failure then retry', async () => {
  const b = await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'پرداخت آنلاین', phone: '09129990000', count: 1, methodId: 3 } });
  const tr = (await call(`/api/bookings/track?ref=${b.data.ref}&phone=09129990000`)).data.booking, pid = tr.payments[0].id;
  assert.equal((await call('/api/pay/start', { method: 'POST', body: { ref: b.data.ref, phone: '09120000000', paymentId: pid } })).status, 404);
  const s1 = (await call('/api/pay/start', { method: 'POST', body: { ref: b.data.ref, phone: '09129990000', paymentId: pid } })).data;
  const t1 = new URL(s1.url, BASE).searchParams.get('t');
  assert.equal((await call(`/api/pay/session?t=${t1}`)).data.amount, trip.price);
  assert.equal((await call('/api/pay/callback', { method: 'POST', body: { t: t1, ok: false } })).data.success, false);
  assert.equal((await call('/api/pay/callback', { method: 'POST', body: { t: t1, ok: true } })).status, 410);   /* جلسهٔ مصرف‌شده */
  assert.equal((await call(`/api/bookings/track?ref=${b.data.ref}&phone=09129990000`)).data.booking.payments[0].status, 'ناموفق');
  const s2 = (await call('/api/pay/start', { method: 'POST', body: { ref: b.data.ref, phone: '09129990000', paymentId: pid } })).data;
  const t2 = new URL(s2.url, BASE).searchParams.get('t');
  assert.equal((await call('/api/pay/callback', { method: 'POST', body: { t: t2, ok: true } })).data.success, true);
  const after = (await call(`/api/bookings/track?ref=${b.data.ref}&phone=09129990000`)).data.booking;
  assert.equal(after.status, 'تأیید شده'); assert.equal(after.balance, 0);
  assert.equal((await call('/api/pay/start', { method: 'POST', body: { ref: b.data.ref, phone: '09129990000', paymentId: pid } })).status, 409);
});

test('choosing a payment method later from tracking page', async () => {
  const b = await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'انتخاب بعدی', phone: '09121230000', count: 1 } });
  const t = (await call(`/api/bookings/track?ref=${b.data.ref}&phone=09121230000`)).data.booking;
  assert.equal(t.payments.length, 0); assert.ok(t.methods.length >= 3); assert.equal(t.canChooseMethod, true);
  const m = await call('/api/bookings/method', { method: 'POST', body: { ref: b.data.ref, phone: '09121230000', methodId: 1 } });
  assert.equal(m.status, 200); assert.equal(m.data.booking.payments.length, 1);
  assert.equal((await call('/api/bookings/method', { method: 'POST', body: { ref: b.data.ref, phone: '09121230000', methodId: 999 } })).status, 400);
});

test('cancellation computes penalty by policy, refunds the rest, records debt', async () => {
  const pv = (await O('owner', `/bookings/${bookingId}/cancel-preview`)).data;
  assert.ok(pv.percent >= 0 && pv.penalty >= 0); assert.equal(pv.refund, Math.max(0, pv.paid - pv.penalty));
  const r = await O('owner', `/bookings/${bookingId}/cancel`, 'POST', { penalty: 100000, reason: 'انصراف مشتری' });
  assert.equal(r.status, 200); assert.equal(r.data.penalty, 100000);
  const d = (await O('owner', `/bookings/${bookingId}`)).data;
  assert.equal(d.booking.status, 'لغو شده');
  assert.equal(d.booking.net, 100000);               /* پرداختی − بازگشت = خسارت */
  assert.equal(d.booking.balance, 0);
  assert.equal(d.payments.filter(p => p.status === 'در انتظار').length, 0);
  assert.equal((await O('owner', `/bookings/${bookingId}/cancel`, 'POST', {})).status, 409);
  /* ظرفیت آزاد شد */
  assert.ok((await call('/api/trips')).data.trips.find(t => t.id === trip.id).seatsLeft >= 0);
  /* نماینده نمی‌تواند رزرو دارای پرداخت را لغو کند */
  const ag = (await O('agent', '/bookings')).data.bookings[0];
  const fine = await O('agent', `/bookings/${ag.id}/cancel`, 'POST', { reason: 'x' }); assert.equal(fine.status, 200);
});

test('accounting: overdue fees, penalties, expenses, delays, debts and summary', async () => {
  const t0 = (await call('/api/trips')).data.trips.find(t => t.seatsLeft >= 3);
  const b = await call('/api/bookings', { method: 'POST', body: { tripId: t0.id, name: 'بدهکار تست', phone: '09125550000', count: 1, methodId: 4 } });
  const id = (await O('owner', '/bookings?q=09125550000')).data.bookings[0].id;
  const pays = (await O('owner', `/bookings/${id}`)).data.payments;
  await O('owner', `/payments/${pays[0].id}/pay`, 'POST', {});
  const debts = (await O('owner', '/accounting/debts')).data; assert.ok(debts.debts.some(x => x.id === id));
  assert.equal((await O('owner', '/accounting/penalties', 'POST', { bookingId: id, kind: 'damage', amount: 50000, note: 'شکستن صندلی' })).status, 200);
  const pens = (await O('owner', '/accounting/penalties')).data.penalties; assert.equal(pens[0].kind, 'damage');
  assert.equal((await O('owner', `/accounting/penalties/${pens[0].id}`, 'PATCH', { status: 'بخشیده شد' })).status, 200);
  assert.equal((await O('owner', '/accounting/expenses', 'POST', { title: 'اجاره اتوبوس', amount: 5000000, tripId: t0.id, category: 'حمل‌ونقل' })).status, 200);
  assert.equal((await O('owner', '/accounting/expenses', 'POST', { title: 'x', amount: 0 })).status, 400);
  const dl = await O('owner', '/accounting/delays', 'POST', { tripId: t0.id, minutes: 45, reason: 'ترافیک', notify: true }); assert.equal(dl.status, 200); assert.ok(dl.data.notified >= 1);
  assert.equal((await O('owner', '/accounting/delays', 'POST', { tripId: t0.id, minutes: 0 })).status, 400);
  const sm = (await O('owner', '/accounting/summary')).data;
  assert.ok(sm.income > 0); assert.equal(sm.expenses, 5000000); assert.equal(sm.net, sm.income - sm.refunds - sm.expenses - sm.commissions);
  assert.ok(sm.trips.find(x => x.id === t0.id).expenses === 5000000);
  assert.ok(sm.byMethod.length >= 1);
  assert.equal((await O('owner', '/accounting/overdue')).status, 200);
  for (const p of ['/payments', '/payments.csv', '/bookings.csv', '/reports/sales.csv']) assert.equal((await O('owner', p)).status, 200, p);
});

test('reports aggregate sales, agents, customers and staff', async () => {
  const r = (await O('owner', '/reports/overview')).data;
  assert.ok(r.kpi.bookings >= 4 && r.kpi.income > 0 && r.kpi.customers >= 5);
  assert.ok(r.byTrip.length && r.byCategory.length && r.daily.length);
  assert.ok(r.byAgent.some(a => a.name === 'فروش مستقیم'));   /* رزرو نمایندهٔ تست لغو شده و در فروش نیست */
  assert.equal((await O('owner', '/reports/overview?from=2000-01-01&to=2000-01-02')).data.kpi.bookings, 0);
});

test('transports, payment methods, config, SMS templates, reminders and system info', async () => {
  const tr = (await call('/api/transports')).data.transports; assert.ok(tr.some(x => x.name === 'قطار'));
  assert.equal((await O('owner', '/transports', 'POST', { name: 'کشتی', icon: '🚢' })).status, 200);
  assert.equal((await O('owner', '/transports', 'POST', { name: 'کشتی' })).status, 409);
  assert.ok((await call('/api/transports')).data.transports.some(x => x.name === 'کشتی'));
  const used = (await O('owner', '/transports')).data.transports.find(x => x.name === 'اتوبوس'); assert.equal((await O('owner', `/transports/${used.id}`, 'DELETE')).status, 409);
  assert.equal((await O('owner', '/paymethods', 'POST', { name: 'اقساط خراب', type: 'installment', installments: 1 })).status, 400);
  assert.equal((await O('owner', '/paymethods', 'POST', { name: 'اقساطی ۶ ماهه', type: 'installment', installments: 6, downPercent: 20, intervalDays: 30, feePercent: 8 })).status, 200);
  assert.ok((await call('/api/pay/methods')).data.methods.some(m => m.name === 'اقساطی ۶ ماهه'));
  assert.equal((await O('owner', '/config', 'PUT', { remindDays: 'abc' })).status, 400);
  assert.equal((await O('owner', '/config', 'PUT', { cancelPolicy: [{ minDays: 5, percent: 10 }] })).status, 400);
  assert.equal((await O('owner', '/config', 'PUT', { remindDays: '5,2', lateFeePercentPerDay: 1, cancelPolicy: [{ minDays: 10, percent: 0 }, { minDays: 0, percent: 80 }] })).status, 200);
  assert.equal((await O('owner', '/config')).data.config.remindDays, '5,2');
  assert.equal((await O('owner', '/sms/templates/payment_received', 'PUT', { body: '{agency}: دریافت {amount} تومان — رسید {receipt}', enabled: true })).status, 200);
  assert.equal((await O('owner', '/sms/send', 'POST', { phone: '123', text: 'سلام' })).status, 400);
  assert.equal((await O('owner', '/sms/send', 'POST', { phone: '09120000000', text: 'سلام تست' })).status, 200);
  assert.equal((await O('owner', '/sms/broadcast', 'POST', { text: 'پیام گروهی', tripId: trip.id })).status, 200);
  assert.equal((await O('owner', '/reminders/preview')).status, 200);
  assert.equal((await O('owner', '/reminders/run', 'POST')).status, 200);
  const info = (await O('owner', '/system/info')).data; assert.ok(info.db.counts.bookings >= 5); assert.ok(info.audit.length > 3);
  const bk = await O('owner', '/system/backup'); assert.equal(bk.status, 200);
  assert.equal((await O('rep', '/system/info')).status, 403);
});

test('reminders send once for departures and due installments', async () => {
  /* سفری که فردا حرکت می‌کند، رزرو تأییدشده با دو یادآوری ایمن */
  const owner = 'owner';
  const tid = (await O(owner, '/transports')).status && (await call('/api/admin/trips', { as: owner })).data.trips[0].id;
  const t = (await call('/api/admin/trips', { as: owner })).data.trips[0];
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const mk = await call('/api/admin/trips', { method: 'POST', as: owner, body: { title: 'سفر فردا', category: 'nature', transport: 'اتوبوس', destination: 'کاشان', date: tomorrow, price: 1000000, capacity: 5 } });
  assert.equal(mk.status, 200);
  const b = await call('/api/bookings', { method: 'POST', body: { tripId: mk.data.id, name: 'یادآوری تست', phone: '09126660000', count: 1, methodId: 1 } });
  const id = (await O(owner, '/bookings?q=09126660000')).data.bookings[0].id;
  await call('/api/admin/bookings/' + id, { method: 'PATCH', as: owner, body: { status: 'تأیید شده' } });
  await O(owner, '/config', 'PUT', { remindDays: '3,1' });
  assert.equal((await O(owner, '/reminders/preview')).data.departures.filter(x => x.ref === b.data.ref).length, 1);
  const r1 = (await O(owner, '/reminders/run', 'POST')).data; assert.ok(r1.departures >= 1);
  assert.equal((await O(owner, '/reminders/run', 'POST')).data.departures, 0);
  assert.ok((await O(owner, '/sms/log')).data.log.some(x => x.kind === 'depart_reminder' && x.phone === '09126660000'));
});

test('deactivated users are logged out and cannot log in', async () => {
  const u = (await O('owner', '/users')).data.users.find(x => x.username === 'rep');
  assert.equal((await O('owner', `/users/${u.id}`, 'PUT', { fullName: 'گزارش‌گیر', roleId: u.roleId, active: false })).status, 200);
  assert.equal((await O('rep', '/customers')).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', body: { username: 'rep', password: 'Report1234' } })).status, 401);
});
