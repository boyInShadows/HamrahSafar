'use strict';
/* اسکیمای ماژول‌های عملیاتی: نقش‌ها، نمایندگان، مشتریان، پرداخت، پیامک و حسابداری
   همهٔ دستورها idempotent هستند؛ روی پایگاه داده نسخه‌های قبلی هم بدون از دست رفتن داده اجرا می‌شود. */

/* همهٔ مجوزهای سیستم (کلید → عنوان فارسی) */
const PERMISSIONS = {
  trips: 'سفرها و پکیج‌ها', bookings: 'رزروها', messages: 'پیام‌های مشاوره', settings: 'تنظیمات تماس سایت',
  reports: 'گزارش‌گیری', customers: 'مشتریان (CRM)', payments: 'پرداخت‌ها و اقساط', accounting: 'حسابداری، خسارت و تأخیر',
  agents: 'نمایندگان', users: 'کاربران، کارکنان و نقش‌ها', transports: 'شیوه‌های حمل‌ونقل', paymethods: 'روش‌های پرداخت',
  sms: 'پیامک و یادآوری', system: 'اطلاعات سیستم و پشتیبان‌گیری'
};
const ALL = Object.keys(PERMISSIONS);

const BUILTIN_ROLES = [
  { id: 1, name: 'مدیر کل', perms: ['*'], builtin: 1, note: 'دسترسی کامل به همهٔ بخش‌ها' },
  { id: 2, name: 'مدیر عملیات', perms: ['trips', 'bookings', 'messages', 'reports', 'customers', 'payments', 'transports', 'sms', 'settings'], builtin: 0, note: 'مدیریت سفرها، رزروها و مشتریان' },
  { id: 3, name: 'حسابدار', perms: ['reports', 'payments', 'accounting', 'paymethods', 'customers'], builtin: 0, note: 'پرداخت‌ها، حسابداری و گزارش مالی' },
  { id: 4, name: 'کارمند فروش', perms: ['bookings', 'customers', 'messages', 'payments'], builtin: 0, note: 'ثبت و پیگیری رزرو و تماس با مشتری' },
  { id: 5, name: 'نماینده', perms: ['agent'], builtin: 1, note: 'فقط پنل اختصاصی نماینده (رزرو و گزارش خودش)' }
];

const DDL = [
  `CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, perms TEXT NOT NULL DEFAULT '[]', builtin INTEGER NOT NULL DEFAULT 0, note TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, username TEXT DEFAULT '', action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', city TEXT DEFAULT '', code TEXT UNIQUE,
    commission_percent REAL NOT NULL DEFAULT 5, admin_id INTEGER, active INTEGER NOT NULL DEFAULT 1, notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS agent_settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE, amount INTEGER NOT NULL, note TEXT DEFAULT '', paid_on TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, national_id TEXT DEFAULT '', email TEXT DEFAULT '',
    city TEXT DEFAULT '', category TEXT NOT NULL DEFAULT 'عادی', tags TEXT DEFAULT '', notes TEXT DEFAULT '', agent_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS customer_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, kind TEXT NOT NULL DEFAULT 'یادداشت',
    text TEXT NOT NULL, follow_up TEXT, done INTEGER NOT NULL DEFAULT 0, admin_name TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS transport_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, icon TEXT DEFAULT '', description TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`,
  /* type: cash نقدی | card کارت‌به‌کارت | online درگاه | installment اقساطی */
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, installments INTEGER NOT NULL DEFAULT 1, down_percent REAL NOT NULL DEFAULT 100,
    interval_days INTEGER NOT NULL DEFAULT 30, fee_percent REAL NOT NULL DEFAULT 0, terms TEXT DEFAULT '', public INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`,
  /* kind: installment قسط/تسویه | refund بازگشت وجه | extra سایر.  amount برای refund منفی است */
  `CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, seq INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL DEFAULT 'installment', amount INTEGER NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'در انتظار',
    method_name TEXT DEFAULT '', receipt_no TEXT, gateway_ref TEXT DEFAULT '', paid_at TEXT, note TEXT DEFAULT '', created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_due ON payments(status, due_date)`,
  `CREATE TABLE IF NOT EXISTS gateway_sessions (token TEXT PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE, amount INTEGER NOT NULL, authority TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL, category TEXT NOT NULL DEFAULT 'سایر', title TEXT NOT NULL,
    amount INTEGER NOT NULL, spent_on TEXT NOT NULL, note TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  /* kind: cancellation لغو | delay تأخیر پرداخت | damage خسارت | other.  status: بدهکار | بخشیده شد */
  `CREATE TABLE IF NOT EXISTS penalties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, kind TEXT NOT NULL, amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'بدهکار', note TEXT DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS trip_delays (
    id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, minutes INTEGER NOT NULL, reason TEXT DEFAULT '',
    notified INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS sms_templates (key TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS sms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, text TEXT NOT NULL, kind TEXT DEFAULT '', booking_id INTEGER, customer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'در صف', provider TEXT DEFAULT '', error TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS reminders_sent (kind TEXT NOT NULL, booking_id INTEGER NOT NULL, payment_id INTEGER NOT NULL DEFAULT 0, sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (kind, booking_id, payment_id))`
];

/* ستون‌های جدید جدول‌های قدیمی */
const ADD_COLS = {
  admins: [['full_name', "TEXT NOT NULL DEFAULT ''"], ['phone', "TEXT NOT NULL DEFAULT ''"], ['role_id', 'INTEGER'], ['kind', "TEXT NOT NULL DEFAULT 'staff'"], ['active', 'INTEGER NOT NULL DEFAULT 1'], ['agent_id', 'INTEGER']],
  bookings: [['customer_id', 'INTEGER'], ['agent_id', 'INTEGER'], ['created_by', 'INTEGER'], ['commission', 'INTEGER NOT NULL DEFAULT 0'], ['surcharge', 'INTEGER NOT NULL DEFAULT 0'],
    ['method_id', 'INTEGER'], ['source', "TEXT NOT NULL DEFAULT 'site'"], ['cancelled_at', 'TEXT'], ['cancel_reason', "TEXT DEFAULT ''"]]
};

const DEFAULT_TRANSPORTS = [['اتوبوس', '🚌', 'سفر گروهی با اتوبوس VIP'], ['قطار', '🚆', 'سفر ریلی'], ['هواپیما', '✈️', 'پرواز داخلی'], ['تاکسی', '🚕', 'سفر خصوصی و کوتاه'], ['خودروی همکار', '🚗', 'سفر کوچک با خودروی همکار'], ['مینی‌بوس', '🚐', 'گروه‌های کوچک‌تر']];
const DEFAULT_METHODS = [
  ['پرداخت نقدی', 'cash', 1, 100, 30, 0, 'پرداخت حضوری در دفتر یا هنگام هماهنگی با همکاران.', 1],
  ['کارت‌به‌کارت', 'card', 1, 100, 30, 0, 'پس از واریز، رسید را برای همکاران ارسال کنید تا تأیید شود.', 1],
  ['پرداخت آنلاین', 'online', 1, 100, 30, 0, 'پرداخت امن از طریق درگاه بانکی.', 1],
  ['اقساطی ۳ ماهه', 'installment', 3, 40, 30, 5, '۴۰٪ پیش‌پرداخت و باقی در دو قسط ماهانه؛ ۵٪ کارمزد اقساط.', 1]
];
const DEFAULT_TEMPLATES = [
  ['booking_created', 'ثبت رزرو', '{agency}: {name} عزیز، رزرو شما برای «{trip}» ثبت شد. کد پیگیری: {ref} — مبلغ کل: {total} تومان.'],
  ['booking_confirmed', 'تأیید رزرو', '{agency}: {name} عزیز، رزرو {ref} برای «{trip}» ({date}) تأیید شد. سفر خوبی داشته باشید.'],
  ['booking_cancelled', 'لغو رزرو', '{agency}: رزرو {ref} برای «{trip}» لغو شد. {extra}'],
  ['payment_received', 'دریافت پرداخت', '{agency}: مبلغ {amount} تومان برای رزرو {ref} دریافت شد. شمارهٔ رسید: {receipt}. مانده: {balance} تومان.'],
  ['payment_failed', 'پرداخت ناموفق', '{agency}: پرداخت رزرو {ref} انجام نشد. برای پرداخت دوباره از «پیگیری رزرو» اقدام کنید.'],
  ['depart_reminder', 'یادآوری حرکت', '{agency}: {name} عزیز، سفر «{trip}» {when} ({date}) حرکت می‌کند. {extra} کد رزرو: {ref}'],
  ['installment_due', 'یادآوری قسط', '{agency}: قسط {seq} رزرو {ref} به مبلغ {amount} تومان سررسید {date} دارد.'],
  ['trip_delay', 'اطلاع تأخیر حرکت', '{agency}: سفر «{trip}» حدود {minutes} دقیقه تأخیر دارد. {extra}'],
  ['broadcast', 'پیام عمومی', '{agency}: {extra}']
];
const DEFAULT_CONFIG = {
  agencyName: 'همراه سفر', smsEnabled: '1', remindDays: '3,1', installmentRemindDays: '2', lateFeePercentPerDay: '0.5', autoConfirm: '1',
  cancelPolicy: JSON.stringify([{ minDays: 7, percent: 10 }, { minDays: 3, percent: 30 }, { minDays: 1, percent: 50 }, { minDays: 0, percent: 100 }]),
  receiptNote: 'این رسید پس از تأیید نهایی توسط همراه سفر معتبر است.'
};

async function upgrade({ db, client }) {
  await client.batch(DDL, 'write');
  for (const [table, cols] of Object.entries(ADD_COLS)) {
    const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map(r => r.name));
    for (const [c, def] of cols) if (!have.has(c)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${c} ${def}`);
  }
  for (const r of BUILTIN_ROLES) await db.run('INSERT OR IGNORE INTO roles (id, name, perms, builtin, note) VALUES (?,?,?,?,?)', [r.id, r.name, JSON.stringify(r.perms), r.builtin, r.note]);
  if (!(await db.get('SELECT COUNT(*) c FROM transport_types')).c) {
    for (const [i, t] of DEFAULT_TRANSPORTS.entries()) await db.run('INSERT INTO transport_types (name, icon, description, sort_order) VALUES (?,?,?,?)', [...t, i]);
  }
  /* وسایل نقلیهٔ موجود در سفرهای قدیمی هم به فهرست اضافه شوند */
  for (const r of await db.all("SELECT DISTINCT transport FROM trips WHERE transport NOT IN (SELECT name FROM transport_types)"))
    await db.run('INSERT INTO transport_types (name, sort_order) VALUES (?, 99)', [r.transport]);
  if (!(await db.get('SELECT COUNT(*) c FROM payment_methods')).c) {
    for (const [i, m] of DEFAULT_METHODS.entries()) await db.run('INSERT INTO payment_methods (name,type,installments,down_percent,interval_days,fee_percent,terms,public,sort_order) VALUES (?,?,?,?,?,?,?,?,?)', [...m, i]);
  }
  for (const [k, t, b] of DEFAULT_TEMPLATES) await db.run('INSERT OR IGNORE INTO sms_templates (key, title, body) VALUES (?,?,?)', [k, t, b]);
  for (const [k, v] of Object.entries(DEFAULT_CONFIG)) await db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?,?)', [k, v]);
  /* مدیران قدیمی بدون نقش ← مدیر کل */
  await db.run('UPDATE admins SET role_id = 1 WHERE role_id IS NULL');
  /* مشتریان از روی رزروهای قبلی ساخته می‌شوند (یک‌بار؛ بعداً خودکار) */
  await db.run(`INSERT OR IGNORE INTO customers (name, phone, created_at)
    SELECT name, phone, MIN(created_at) FROM bookings WHERE phone NOT IN (SELECT phone FROM customers) GROUP BY phone`);
  await db.run('UPDATE bookings SET customer_id = (SELECT id FROM customers c WHERE c.phone = bookings.phone) WHERE customer_id IS NULL');
  /* برای رزروهای قدیمی، یک ردیف پرداخت متناسب با وضعیت ساخته می‌شود تا حسابداری ناهمخوان نباشد */
  await db.run(`INSERT INTO payments (booking_id, seq, kind, amount, due_date, status, method_name, paid_at, receipt_no, note)
    SELECT id, 1, 'installment', total, substr(created_at,1,10), 'پرداخت شده', 'نامشخص (رزرو قدیمی)', created_at, 'R-' || ref, 'انتقال خودکار از نسخهٔ قبلی'
    FROM bookings WHERE status = 'تأیید شده' AND id NOT IN (SELECT booking_id FROM payments)`);
}

module.exports = { upgrade, PERMISSIONS, ALL, DEFAULT_CONFIG };
