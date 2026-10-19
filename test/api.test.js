'use strict';
/* آزمون یکپارچه API — اجرا: npm test (Node 22.5+) */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs'), path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90), BASE = `http://127.0.0.1:${PORT}`;
const tempRoot = path.join(__dirname, '..', 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tempRoot, 'hamrah-'));
let proc, cookie = '';

const call = async (p, { method = 'GET', body, auth } = {}) => {
  const res = await fetch(BASE + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})), res };
};

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR: dir, DATABASE_URL: '', DATABASE_AUTH_TOKEN: '', ADMIN_USER: 'admin', ADMIN_PASS: 'TestPass123', SITE_URL: 'https://hamrah.example', COOKIE_SECURE: 'false', NODE_ENV: 'test', SMS_PROVIDER: 'log', PAYMENT_GATEWAY: 'sandbox' },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/trips'); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
after(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('trips are public and seeded with future dates', async () => {
  const { status, data } = await call('/api/trips');
  assert.equal(status, 200); assert.ok(data.trips.length >= 3);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(data.trips.every(t => !t.date || t.date >= today));
});

test('admin endpoints require login', async () => {
  for (const p of ['/api/admin/trips', '/api/admin/bookings', '/api/admin/stats', '/api/admin/messages']) assert.equal((await call(p)).status, 401);
  assert.equal((await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  const r = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'TestPass123' } });
  assert.equal(r.status, 200); cookie = r.res.headers.get('set-cookie').split(';')[0];
  assert.match(r.res.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await call('/api/admin/me', { auth: true })).status, 200);
});

test('booking validates input, computes price on the server and tracks by ref+phone', async () => {
  const trip = (await call('/api/trips')).data.trips[0];
  assert.equal((await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'ab', phone: '09123456789', count: 1 } })).status, 400);
  assert.equal((await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'علی رضایی', phone: '123', count: 1 } })).status, 400);
  const ok = await call('/api/bookings', { method: 'POST', body: { tripId: trip.id, name: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', count: 2, total: 1 } });
  assert.equal(ok.status, 200); assert.equal(ok.data.total, trip.price * 2); assert.match(ok.data.ref, /^HS-[0-9A-F]{8}$/);
  assert.equal((await call(`/api/bookings/track?ref=${ok.data.ref}&phone=09123456789`)).data.booking.status, 'در انتظار پرداخت');
  assert.equal((await call(`/api/bookings/track?ref=${ok.data.ref}&phone=09120000000`)).status, 404);
});

test('capacity cannot be oversold and cancelling frees seats', async () => {
  const { data: { id } } = await call('/api/admin/trips', { method: 'POST', auth: true, body: { title: 'تور آزمایشی', category: 'nature', transport: 'اتوبوس', destination: 'کیش', price: 1000, capacity: 3 } });
  const book = n => call('/api/bookings', { method: 'POST', body: { tripId: id, name: 'مسافر آزمون', phone: '09121112233', count: n } });
  const a = await book(3); assert.equal(a.status, 200);
  assert.equal((await book(1)).status, 409);
  const list = (await call('/api/admin/bookings', { auth: true })).data.bookings;
  const bid = list.find(b => b.ref === a.data.ref).id;
  assert.equal((await call(`/api/admin/bookings/${bid}`, { method: 'PATCH', auth: true, body: { status: 'لغو شده' } })).status, 200);
  assert.equal((await book(2)).status, 200);
  assert.equal((await call(`/api/admin/bookings/${bid}`, { method: 'PATCH', auth: true, body: { status: 'تأیید شده' } })).status, 409);
  assert.equal((await call(`/api/admin/trips/${id}`, { method: 'DELETE', auth: true })).status, 409);
});

test('trip validation, featured limit, settings and messages', async () => {
  const bad = await call('/api/admin/trips', { method: 'POST', auth: true, body: { title: 'x', category: 'nature', transport: 'اتوبوس', destination: 'y', price: 1, capacity: 1 } });
  assert.equal(bad.status, 400);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', auth: true, body: { phone: '021-123' } })).status, 200);
  assert.equal((await call('/api/settings')).data.settings.phone, '021-123');
  assert.equal((await call('/api/messages', { method: 'POST', body: { name: 'سارا احمدی', phone: '09351112233', message: 'سلام' } })).status, 200);
  assert.equal((await call('/api/admin/messages', { auth: true })).data.messages.length, 1);
});

test('static files are served and path traversal is blocked', async () => {
  assert.equal((await fetch(BASE + '/')).status, 200);
  assert.equal((await fetch(BASE + '/css/style.css')).status, 200);
  assert.notEqual((await fetch(BASE + '/..%2fserver%2fserver.js')).status, 200);
  assert.equal((await fetch(BASE + '/server/server.js')).status, 404);
  assert.equal((await fetch(BASE + '/.env')).status, 404);
});

test('login accepts the configured frontend origin and rejects other origins', async () => {
  const options = origin => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'admin', password: 'TestPass123' }) });
  assert.equal((await fetch(BASE + '/api/admin/login', options('https://attacker.example'))).status, 403);
  assert.equal((await fetch(BASE + '/api/admin/login', options('https://hamrah.example.attacker.example'))).status, 403);
  const login = await fetch(BASE + '/api/admin/login', options('https://hamrah.example'));
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], Origin: 'https://hamrah.example' };
  assert.equal((await fetch(BASE + '/api/admin/me', { headers })).status, 200);
  assert.equal((await fetch(BASE + '/api/admin/logout', { method: 'POST', headers })).status, 200);
});
