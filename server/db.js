'use strict';
/* پایگاه داده libSQL (نسل جدید SQLite از Turso) — محلی با فایل، یا ابری با DATABASE_URL */
const { createClient } = require('@libsql/client');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const client = createClient({
  url: process.env.DATABASE_URL || 'file:' + path.join(DATA_DIR, 'hamrah.db').replace(/\\/g, '/'),
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined
});

const toObjs = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
/* اجرای کوئری روی کلاینت یا تراکنش */
const make = ex => ({
  all: async (sql, args = []) => toObjs(await ex.execute({ sql, args })),
  get: async (sql, args = []) => toObjs(await ex.execute({ sql, args }))[0],
  run: async (sql, args = []) => { const r = await ex.execute({ sql, args }); return { changes: r.rowsAffected, id: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null }; }
});
const db = make(client);

/* تراکنش: fn(t) با t.get/all/run؛ در خطا rollback می‌شود */
async function tx(fn) {
  const t = await client.transaction('write');
  try { const r = await fn(make(t)); await t.commit(); return r; }
  catch (e) { await t.rollback().catch(() => {}); throw e; }
  finally { t.close(); }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('nature','pilgrimage','recreation')),
    transport TEXT NOT NULL, destination TEXT NOT NULL, date TEXT,
    price INTEGER NOT NULL CHECK (price >= 0), capacity INTEGER NOT NULL CHECK (capacity >= 1),
    duration TEXT DEFAULT '', best_season TEXT DEFAULT '', tagline TEXT DEFAULT '', description TEXT DEFAULT '',
    image TEXT DEFAULT '', image_pos TEXT DEFAULT 'center', featured INTEGER NOT NULL DEFAULT 0,
    highlights TEXT NOT NULL DEFAULT '[]', itinerary TEXT NOT NULL DEFAULT '[]', includes TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE RESTRICT, trip_title TEXT NOT NULL,
    name TEXT NOT NULL, phone TEXT NOT NULL, count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 10),
    notes TEXT DEFAULT '', total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'در انتظار پرداخت',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_trip ON bookings(trip_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, message TEXT DEFAULT '',
    handled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`
];

/* رمزنگاری رمز عبور با scrypt */
const hashPassword = pw => { const salt = crypto.randomBytes(16); return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
function verifyPassword(pw, stored) {
  const [s, k] = String(stored).split(':'); if (!s || !k) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(k, 'hex'));
}

const SETTING_KEYS = ['phone', 'email', 'address', 'instagram', 'hours'];

async function seed() {
  if ((await db.get('SELECT COUNT(*) c FROM trips')).c) return;
  const seedTrips = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const addDays = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await client.batch(seedTrips.map(t => ({
    sql: `INSERT INTO trips (id,title,category,transport,destination,date,price,capacity,duration,best_season,tagline,description,image,image_pos,featured,highlights,itinerary,includes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [t.id, t.title, t.category, t.transport, t.destination, (t.inDays != null ? addDays(t.inDays) : t.date) || null, t.price, t.capacity,
      t.duration || '', t.bestSeason || '', t.tagline || '', t.description || '', t.image || '', t.imagePos || 'center', t.featured ? 1 : 0,
      JSON.stringify(t.highlights || []), JSON.stringify(t.itinerary || []), JSON.stringify(t.includes || [])]
  })), 'write');
}

async function ensureAdmin() {
  if ((await db.get('SELECT COUNT(*) c FROM admins')).c) return;
  const username = process.env.ADMIN_USER || 'admin';
  let pass = process.env.ADMIN_PASS, generated = false;
  if (!pass) { pass = crypto.randomBytes(9).toString('base64url'); generated = true; }
  await db.run('INSERT INTO admins (username, password_hash) VALUES (?,?)', [username, hashPassword(pass)]);
  console.log('\n──────── مدیر اولیه ساخته شد ────────');
  console.log(' نام کاربری :', username);
  console.log(generated ? ` رمز عبور   : ${pass}   (فقط همین یک بار نمایش داده می‌شود)` : ' رمز عبور   : مقدار ADMIN_PASS');
  console.log('─────────────────────────────────────\n');
}

async function init() {
  await client.execute('PRAGMA foreign_keys = ON').catch(() => {});
  await client.batch(SCHEMA, 'write');
  for (const k of SETTING_KEYS) await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, '']);
  await seed();
  await require('./office/schema').upgrade({ db, client });
  await ensureAdmin();
  await db.run('UPDATE admins SET role_id = 1 WHERE role_id IS NULL');
}

module.exports = { db, tx, init, close: () => client.close(), hashPassword, verifyPassword, DATA_DIR, SETTING_KEYS };
