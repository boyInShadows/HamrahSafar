# همراه سفر — سایت و پنل مدیریت آژانس سفر داخلی

## Checks and deployment

```sh
npm ci
npm run check   # JavaScript syntax checks; no TypeScript checker is configured
npm test        # API, office, and deployment checks using disposable local databases
npm run build  # Creates the frontend in dist/
npm start      # Runs the full Express app locally
```

### Netlify frontend with a separate Express backend

This app needs a running Node.js backend for login, bookings, payments, database access, uploaded images, and background reminders. Uploading the frontend alone does not provide these services. The Netlify setup proxies `/api/*` and `/uploads/*` to that backend, keeping browser requests and session cookies on the frontend's origin.

1. Deploy this repository to a Node.js host with Node 22 or newer. Install with `npm ci --omit=dev` and start with `npm start`. Use a persistent disk and set `DATA_DIR` to its absolute directory; it holds the SQLite database and uploaded images. Run one backend instance while using a local database and in-memory login rate limits. Keep the backend running for scheduled reminders.
2. Set environment variables on the backend host: `NODE_ENV=production`, `ADMIN_USER`, a strong `ADMIN_PASS`, `COOKIE_SECURE=true`, and `SITE_URL=https://your-site.netlify.app` (or your final custom domain). Admin credentials initialize a new database only. Existing local accounts/data are not uploaded by Git; migrate the database/uploads privately if you need them. A Turso database can use `DATABASE_URL` and `DATABASE_AUTH_TOKEN`, but uploaded images still need persistent disk storage.
3. Enable `TRUST_PROXY=true` only when your backend host's reverse proxy overwrites forwarded headers and prevents clients from spoofing them. Otherwise leave it false; check per-client rate limiting before launch. See the [Express proxy guide](https://expressjs.com/en/guide/behind-proxies/).
4. In Netlify, import the GitHub repository. `netlify.toml` supplies build command `npm run build`, publish directory `dist`, and Node 22. Set **`BACKEND_URL`** in Netlify's build environment to the backend's HTTPS origin, for example `https://your-backend.example.com`, with no path, query, credentials, or fragment. Builds on Netlify fail clearly if this value is absent or invalid. Keep backend passwords, database tokens, and SMS/payment secrets on the backend host, outside the frontend build environment.
5. Deploy and check `/api/trips`, admin login/logout, a test booking, uploaded images, and payment return URLs through the Netlify domain. Real payments and SMS require their provider credentials on the backend host; sandbox payments remain disabled in production unless explicitly enabled for a private test environment. Change `SITE_URL` and redeploy the backend when the frontend domain changes. Unlisted deploy-preview origins are rejected for writes.

Local `npm run build` without `BACKEND_URL` creates a **static preview only**. To prepare a working Netlify frontend build, set `BACKEND_URL` in your shell first. Do not publish the repository root: `.env`, `data/`, caches, and private project notes are excluded from Git and the frontend artifact.

The routing follows [Netlify's proxy documentation](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/). This setup uses a separate Node host rather than converting the application to [Netlify Functions](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/). To roll back frontend changes, restore the previous Netlify deploy; back up persistent backend data before backend releases.

سایت فارسی/راست‌چین با بک‌اند **Express 5** و پایگاه داده **libSQL** (نسل جدید SQLite)، تاریخ شمسی و طراحی ریسپانسیو کامل.

## اجرا
نیازمندی: **Node.js نسخه ۲۰ یا بالاتر**.

```bash
npm install               # فقط بار اول
cp .env.example .env      # و رمز مدیر را در آن تنظیم کنید
npm start                 # http://localhost:3000
npm test                  # آزمون‌های API
```
- سایت: `http://localhost:3000` — پنل مدیریت: `http://localhost:3000/admin.html`
- اگر `ADMIN_PASS` تنظیم نشود، در اولین اجرا رمز تصادفی در ترمینال چاپ می‌شود (فقط یک بار). بعد از ورود از «تغییر رمز» عوضش کنید.
- فایل `index.html` را مستقیم باز نکنید؛ صفحه‌ها باید از طریق سرور اجرا شوند.

## امکانات
- **تاریخ شمسی** در همه‌جا: نمایش، تقویم انتخاب تاریخ (جستجو و پنل مدیریت)، ورود اعداد فارسی/انگلیسی، زمان‌ها به وقت تهران. تاریخ‌ها در پایگاه داده میلادی (ISO) ذخیره می‌شوند.
- **پایگاه داده libSQL** (فایل محلی `data/hamrah.db`؛ با `DATABASE_URL` به Turso ابری هم وصل می‌شود): سفرها، رزروها، پیام‌ها، مدیران، نشست‌ها و تنظیمات.
- **رزرو تراکنشی**: قیمت و ظرفیت سمت سرور بررسی می‌شود؛ فروش بیش از ظرفیت ممکن نیست. کد پیگیری (`HS-XXXXXXXX`) و صفحه «پیگیری رزرو» با کد + موبایل.
- **پنل مدیریت**: ورود امن (کوکی HttpOnly)، آمار، افزودن/ویرایش/حذف سفر، بارگذاری تصویر، تغییر وضعیت رزرو، پیام‌های مشاوره، خروجی CSV (تاریخ شمسی)، تنظیمات تماس سایت (تلفن، ایمیل، نشانی…) و تغییر رمز.
- **امنیت**: رمز با scrypt، محدودیت نرخ ورود/رزرو، بررسی Origin، CSP و هدرهای امنیتی، اعتبارسنجی ورودی، بررسی امضای بایتی تصاویر آپلودی، جلوگیری از path traversal.
- **ریسپانسیو**: نقاط شکست ۱۱۰۰/۹۰۰/۶۰۰/۳۶۰؛ منوی کشویی موبایل، مودال‌ها و تقویم به‌شکل برگهٔ پایین در موبایل، جدول‌های پنل به‌شکل کارت.

## ساختار
```
server/   server.js (API + فایل‌های استاتیک) · db.js (اسکیما و داده اولیه) · seed.json
public/   index.html · admin.html · css/style.css · js/{app,admin,jalali,data}.js · assets/
data/     hamrah.db و uploads/ (خودکار ساخته می‌شود؛ از آن‌ها نسخه پشتیبان بگیرید)
test/     api.test.js
```

## نکات استقرار
- پشت HTTPS قرار دهید و `COOKIE_SECURE=true` بگذارید. بهتر است پشت Nginx/Caddy با reverse proxy اجرا شود.
- پرداخت آنلاین هنوز متصل نیست (وضعیت «در انتظار پرداخت» دستی تغییر می‌کند). اتصال درگاه باید با تأیید سمت سرور (callback/verify) انجام شود.
- فونت وزیرمتن از Google Fonts بارگذاری می‌شود؛ برای کار آفلاین فایل‌های فونت را در `public/assets/fonts` بگذارید و `@font-face` اضافه کنید.
- قیمت‌ها، برنامه روزانه و خدمات تورها نمونه‌اند و از پنل قابل ویرایش‌اند. تصویر تور «قم» و دو سفر یک‌روزه، برش‌هایی از سه عکس شما هستند؛ از پنل می‌توانید عکس اختصاصی بارگذاری کنید.

## پنل عملیات (نسخه ۸) — `/office.html`
پنل جدا از پنل افزودن/حذف تور (`/admin.html` بدون تغییر ماند). تب‌ها بر اساس دسترسی هر کاربر نمایش داده می‌شوند.
- **گزارش‌ها و داشبورد**: فروش، رزرو، کاربران، خروجی CSV، اطلاعات سیستم و پشتیبان‌گیری.
- **نقش‌ها و کاربران**: نقش‌های مدیر کل، مدیر عملیات، حسابدار، کارمند فروش، نماینده؛ نقش دلخواه با انتخاب دسترسی‌ها.
- **نمایندگان**: پنل اختصاصی (فقط رزرو/مشتریان خود)، کمیسیون، تسویه‌حساب.
- **حمل‌ونقل**: اتوبوس، قطار، هواپیما، تاکسی (قابل ویرایش).
- **روش‌های پرداخت**: نقدی، کارت‌به‌کارت، آنلاین، اقساطی (پیش‌پرداخت، تعداد قسط، کارمزد) و وضعیت هر قسط.
- **رزرو و پرداخت آنلاین**: پیگیری رزرو با کد و موبایل، پرداخت قسط، رسید قابل چاپ.
- **پیامک و یادآوری**: قالب‌های قابل ویرایش، یادآوری حرکت و سررسید قسط (هر ۳۰ دقیقه، بدون ارسال تکراری).
- **حسابداری**: بدهکاران، دیرکرد، هزینه‌ها، جریمه لغو (بر اساس قانون قابل تنظیم)، تأخیر/لغو سفر.
- **CRM**: پروفایل مشتری، یادداشت و پیگیری.

### نکات مهم
- پیامک به‌صورت پیش‌فرض آزمایشی است (`SMS_PROVIDER=log`). برای ارسال واقعی کاوه‌نگار، کلید و شماره را در `.env` بگذارید. (بدون تست با سرویس واقعی)
- درگاه پرداخت پیش‌فرض شبیه‌ساز است. برای زرین‌پال `PAYMENT_GATEWAY=zarinpal` و مرچنت را بگذارید. (بدون تست با سرویس واقعی)
- لغو از پنل قدیمی تور، جریمه محاسبه نمی‌کند؛ لغو با جریمه از پنل عملیات انجام می‌شود.
- با اولین اجرا، دیتابیس قدیمی خودکار ارتقا می‌یابد.
