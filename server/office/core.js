'use strict';
/* ابزارهای مشترک ماژول‌های عملیاتی */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { db } = require('../db');

const siteUrl = process.env.SITE_URL ? new URL(process.env.SITE_URL) : null;
if (siteUrl && (!['http:', 'https:'].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password || siteUrl.pathname !== '/' || siteUrl.search || siteUrl.hash)) {
  throw new Error('SITE_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.');
}
const SITE_ORIGIN = siteUrl?.origin;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);
const faToEn = s => String(s ?? '').replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const int = (v, def = NaN) => { const n = Number(faToEn(v).replace(/[,٬،\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : def; };
const phoneOk = p => /^09\d{9}$/.test(p);

/* همان کتابخانهٔ تاریخ شمسی سمت مرورگر (منبع واحد) */
const ctx = { window: {}, document: { addEventListener() {}, createElement() { return {}; }, body: {} }, Intl, Date };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'jalali.js'), 'utf8'), ctx);
const J = ctx.window.JDate;
const jdate = iso => (iso ? J.fmtLong(String(iso).slice(0, 10)) : '—');
const jnum = iso => (iso ? J.fmtNumeric(String(iso).slice(0, 10)) : '—');
const fa = n => Number(n || 0).toLocaleString('fa-IR');

/* ───── تنظیمات عملیاتی (جدول config؛ عمومی نیست) ───── */
async function getConfig() { return Object.fromEntries((await db.all('SELECT key, value FROM config')).map(r => [r.key, r.value])); }
async function cfg(key) { return (await db.get('SELECT value FROM config WHERE key = ?', [key]))?.value ?? ''; }

/* ───── نقش‌ها و دسترسی ───── */
const can = (admin, perm) => !!admin && (admin.perms.includes('*') || admin.perms.includes(perm));
async function loadAdmin(row) {
  if (!row) return null;
  let perms = []; try { perms = JSON.parse(row.perms || '[]'); } catch { /* نقش خراب */ }
  return { ...row, perms, isAgent: perms.includes('agent') && !perms.includes('*') };
}
/* پشتیبانی از چند مجوز: need('reports') یا need('payments','accounting') یعنی هر کدام کافی است */
const need = (...perms) => (req, res, next) => {
  if (!perms.some(p => can(req.admin, p))) throw bad('شما به این بخش دسترسی ندارید.', 403);
  next();
};
const notAgent = (req, res, next) => { if (req.admin.isAgent) throw bad('این بخش مخصوص کارکنان است.', 403); next(); };

async function audit(req, action, detail = '') {
  try { await db.run('INSERT INTO audit_log (admin_id, username, action, detail) VALUES (?,?,?,?)', [req.admin?.id ?? null, req.admin?.username || '', clean(action, 80), clean(detail, 300)]); } catch { /* ثبت لاگ نباید عملیات را متوقف کند */ }
}

/* ───── CSV ───── */
const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`;
function sendCsv(res, name, header, rows) {
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvEsc).join(',')).join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` }).send(csv);
}

module.exports = { SITE_ORIGIN, HttpError, bad, faToEn, clean, todayISO, addDays, daysBetween, int, phoneOk, jdate, jnum, fa, getConfig, cfg, can, loadAdmin, need, notAgent, audit, sendCsv };
