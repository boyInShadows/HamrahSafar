/* ابزارهای مشترک سایت و پنل مدیریت + کلاینت API */
const CATEGORY_NAMES = { nature: 'طبیعت‌گردی', pilgrimage: 'زیارتی', recreation: 'تفریحی و فرهنگی' };
const BOOKING_STATUSES = ['در انتظار پرداخت', 'تأیید شده', 'لغو شده'];
const FAV_KEY = 'hamrahFavorites';

const fmt = n => Number(n || 0).toLocaleString('fa-IR');
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFmt = iso => iso ? JDate.fmtLong(iso) : 'تاریخ اعلام می‌شود';
const cssUrl = u => String(u || '').replace(/['"\\()\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const readLocal = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* حافظه مرورگر در دسترس نیست */ } };

/* فراخوانی API؛ در صورت خطا، Error با پیام فارسی پرتاب می‌شود */
async function api(path, { method = 'GET', body, raw } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (raw) { opt.body = raw; opt.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, opt); } catch { throw Object.assign(new Error('ارتباط با سرور برقرار نشد. اینترنت یا اجرای سرور را بررسی کنید.'), { network: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'خطای ناشناخته رخ داد.'), { status: res.status });
  return data;
}
