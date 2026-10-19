/* منطق صفحه عمومی — وابسته به data.js */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const grid = $('#trip-grid'), tourGrid = $('#tour-grid'), modal = $('#trip-modal'), content = $('#modal-content'), toast = $('#toast');
const state = { filter: 'all', dest: '', date: '', q: '', sort: 'date' };
let TRIPS = [], loadError = '';
const seatsLeft = t => t.seatsLeft;
let toastTimer, lastFocus;

function notify(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* علاقه‌مندی‌ها */
const favs = () => new Set(readLocal(FAV_KEY, []));
function toggleFav(id) {
  const s = favs(); s.has(id) ? s.delete(id) : s.add(id);
  saveLocal(FAV_KEY, [...s]);
  return s.has(id);
}

/* فیلتر مقصد: «شمال» شامل چند شهر/منطقه است */
const NORTH = /ماسال|جنگل|شمال|گیلان|مازندران|رشت|ساحل/;
function matchDest(t, dest) {
  if (!dest) return true;
  const hay = `${t.destination} ${t.title}`;
  return dest === 'شمال' ? NORTH.test(hay) : hay.includes(dest);
}

function filteredTrips() {
  const fv = favs(), q = state.q.trim();
  const list = TRIPS.filter(t =>
    (state.filter === 'all' || (state.filter === 'fav' ? fv.has(t.id) : t.category === state.filter)) &&
    matchDest(t, state.dest) &&
    (!state.date || (t.date && t.date >= state.date)) &&
    (!q || `${t.title} ${t.destination} ${t.description}`.includes(q)));
  const by = {
    date: (a, b) => (a.date || '9').localeCompare(b.date || '9'),
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price
  };
  return list.sort(by[state.sort]);
}

const imgStyle = t => `background-image:url('${cssUrl(t.image)}');background-position:${safe(t.imagePos || 'center')}`;

function seatBadge(t) {
  const left = seatsLeft(t);
  if (left < 1) return '<span class="seat full">تکمیل ظرفیت</span>';
  if (left <= 5) return `<span class="seat low">فقط ${fmt(left)} صندلی باقی مانده</span>`;
  return `<span class="seat">${fmt(left)} صندلی خالی</span>`;
}

function render() {
  if (loadError) {
    $('#result-count').textContent = '';
    grid.innerHTML = `<div class="empty-state"><b>${safe(loadError)}</b><button class="btn btn-primary" id="retry-load">تلاش دوباره</button></div>`;
    $('#retry-load').onclick = loadTrips; return;
  }
  const list = filteredTrips(), fv = favs();
  $('#result-count').textContent = list.length ? `${fmt(list.length)} سفر یافت شد` : '';
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><b>سفری با این مشخصات پیدا نشد.</b><p>فیلترها را تغییر دهید یا جستجو را پاک کنید.</p><button class="btn btn-primary" id="reset-filters">نمایش همه سفرها</button></div>';
    $('#reset-filters').onclick = resetFilters; return;
  }
  grid.innerHTML = list.map(t => `
    <article class="trip-card">
      <div class="trip-image" style="${imgStyle(t)}">
        <span class="trip-category">${CATEGORY_NAMES[t.category] || 'سفر داخلی'}</span>
        <button class="fav-btn ${fv.has(t.id) ? 'on' : ''}" data-fav="${safe(t.id)}" aria-label="افزودن به علاقه‌مندی‌ها" aria-pressed="${fv.has(t.id)}">♥</button>
      </div>
      <div class="trip-body">
        <h3>${safe(t.title)}</h3>
        <div class="trip-meta"><span>⌖ ${safe(t.destination || 'مقصد اعلام می‌شود')}</span><span>▦ ${dateFmt(t.date)}</span><span>♧ ${safe(t.transport)}</span>${t.duration ? `<span>◷ ${safe(t.duration)}</span>` : ''}</div>
        <p class="trip-desc">${safe(t.description || 'برای آشنایی با جزئیات این سفر، اطلاعات بیشتر را مشاهده کنید.')}</p>
        ${seatBadge(t)}
        <div class="trip-bottom">
          <div class="price">${fmt(t.price)} <small>تومان / نفر</small></div>
          <button class="btn btn-primary" data-book="${safe(t.id)}">جزئیات و رزرو ←</button>
        </div>
      </div>
    </article>`).join('');
}

function renderTours() {
  const tours = TRIPS.filter(t => t.featured).slice(0, 3);
  $('#tours').hidden = !tours.length;
  tourGrid.innerHTML = tours.map(t => `
    <article class="tour-card" style="${imgStyle(t)}">
      <div class="tour-shade"></div>
      <div class="tour-body">
        <span class="tour-chip">${CATEGORY_NAMES[t.category]}</span>
        <h3>${safe(t.destination.split('،')[0])}</h3>
        <p class="tour-tagline">${safe(t.tagline || t.title)}</p>
        <ul class="tour-facts"><li>◷ ${safe(t.duration || '—')}</li><li>♧ ${safe(t.transport)}</li><li>▦ ${dateFmt(t.date)}</li></ul>
        <div class="tour-foot">
          <div class="price">${fmt(t.price)} <small>تومان / نفر</small></div>
          <button class="btn btn-gold" data-book="${safe(t.id)}">برنامه و رزرو ←</button>
        </div>
      </div>
    </article>`).join('');
}

function resetFilters() {
  Object.assign(state, { filter: 'all', dest: '', date: '', q: '' });
  $('#trip-search').value = ''; $('#hero-destination').value = ''; $('#hero-category').value = 'all'; JDate.setValue($('#hero-date'), '', false);
  syncFilterButtons(); render();
}
function syncFilterButtons() { $$('.filter').forEach(x => x.classList.toggle('active', x.dataset.filter === state.filter)); }

/* روش‌های پرداخت (از پنل مدیریت قابل تغییر است) */
let METHODS = [];
api('/api/pay/methods').then(r => { METHODS = r.methods || []; }).catch(() => {});
const methodDesc = m => m.type === 'installment' ? `${fmt(m.installments)} قسط؛ پیش‌پرداخت ${fmt(m.downPercent)}٪${m.feePercent ? ` + کارمزد ${fmt(m.feePercent)}٪` : ''}` : (m.terms || '');
const methodBox = (list, name = 'methodId', first = true) => list.length ? `<div class="method-box" role="radiogroup" aria-label="روش پرداخت">${list.map((m, i) => `<label><input type="radio" name="${name}" value="${m.id}" ${first && i === 0 ? 'checked' : ''}><span><b>${safe(m.name)}</b><br><small class="muted">${safe(methodDesc(m))}</small></span></label>`).join('')}</div>` : '';

/* جزئیات سفر و فرم رزرو */
function openTrip(id) {
  const t = TRIPS.find(x => x.id === id); if (!t) return;
  const available = seatsLeft(t), past = t.date && t.date < JDate.todayISO();
  const list = (arr, cls = '') => arr?.length ? `<ul class="${cls}">${arr.map(x => `<li>${safe(x)}</li>`).join('')}</ul>` : '';
  const timeline = t.itinerary?.length ? `<h3 class="modal-h">برنامه سفر</h3><ol class="timeline">${t.itinerary.map(([d, txt]) => `<li><b>${safe(d)}</b><span>${safe(txt)}</span></li>`).join('')}</ol>` : '';
  lastFocus = document.activeElement;
  content.innerHTML = `
    <div class="modal-cover" style="${imgStyle(t)}"></div>
    <span class="eyebrow">${CATEGORY_NAMES[t.category] || 'سفر داخلی'}</span>
    <h2 id="modal-title">${safe(t.title)}</h2>
    <p class="modal-intro">${safe(t.destination)} · ${dateFmt(t.date)} · ${safe(t.transport)}${t.duration ? ' · ' + safe(t.duration) : ''}</p>
    <p>${safe(t.description || '')}</p>
    ${t.highlights?.length ? `<h3 class="modal-h">جاذبه‌ها و نکات برجسته</h3>${list(t.highlights, 'check-list')}` : ''}
    ${timeline}
    ${t.includes?.length ? `<h3 class="modal-h">خدمات شامل</h3>${list(t.includes, 'check-list')}` : ''}
    ${t.bestSeason ? `<p class="season">بهترین زمان سفر: <b>${safe(t.bestSeason)}</b></p>` : ''}
    <div class="notice">قیمت هر نفر: ${fmt(t.price)} تومان · ظرفیت باقی‌مانده: ${fmt(available)} نفر</div>
    <div id="booking-area">${past ? '<p class="full-msg">زمان حرکت این سفر گذشته است.</p>' : available < 1 ? '<p class="full-msg">ظرفیت این سفر تکمیل شده است.</p>' : `
    <form class="booking-form" id="booking-form" novalidate>
      <input type="hidden" name="tripId" value="${safe(t.id)}">
      <label>نام و نام خانوادگی<input name="name" required minlength="3" maxlength="80" autocomplete="name"></label>
      <div class="form-grid">
        <label>شماره موبایل<input name="phone" required inputmode="tel" dir="ltr" class="ltr-input" placeholder="09123456789" autocomplete="tel"></label>
        <label>تعداد مسافران<select name="count" id="count-select">${Array.from({ length: Math.min(10, available) }, (_, i) => `<option value="${i + 1}">${fmt(i + 1)} نفر</option>`).join('')}</select></label>
      </div>
      <label>توضیحات (اختیاری)<textarea name="notes" rows="2" maxlength="500"></textarea></label>
      ${METHODS.length ? `<b class="sub-h">روش پرداخت</b>${methodBox(METHODS)}` : ''}
      <div class="total-box">مبلغ کل: <b id="total-price">${fmt(t.price)}</b> تومان</div>
      <div class="notice">پس از ثبت درخواست، کد پیگیری به شما نمایش داده می‌شود. پرداخت و اقساط را می‌توانید در هر زمان از «پیگیری رزرو» انجام دهید و پس از تأیید، پیامک دریافت می‌کنید.</div>
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">ثبت درخواست رزرو</button>
    </form>`}</div>`;
  showModal();

  $('#count-select')?.addEventListener('change', e => { $('#total-price').textContent = fmt(Number(e.target.value) * Number(t.price)); });
  $('#booking-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form), err = $('#form-error'), btn = form.querySelector('[type=submit]');
    err.hidden = true;
    const name = f.get('name').trim(), phone = JDate.en(f.get('phone')).trim();
    if (name.length < 3) return showErr('نام و نام خانوادگی را کامل وارد کنید.');
    if (!/^09\d{9}$/.test(phone)) return showErr('شماره موبایل معتبر نیست (مثال: 09123456789).');
    function showErr(m) { err.textContent = m; err.hidden = false; }
    btn.disabled = true; btn.textContent = 'در حال ثبت…';
    try {
      const r = await api('/api/bookings', { method: 'POST', body: { tripId: t.id, name, phone, count: Number(f.get('count')), notes: f.get('notes'), methodId: f.get('methodId') || null } });
      $('#booking-area').innerHTML = `<div class="success-box"><div class="success-icon">✓</div><h3>درخواست رزرو ثبت شد</h3>
        <p>کد پیگیری شما:</p><div class="ref-code" dir="ltr">${safe(r.ref)}</div>
        <p class="muted">مبلغ کل: ${fmt(r.total)} تومان · همکاران ما برای هماهنگی نهایی با شما تماس می‌گیرند.</p>
        <div class="btn-row" style="justify-content:center"><button class="btn btn-primary" type="button" id="success-pay">پرداخت و پیگیری رزرو</button><button class="btn btn-outline" type="button" id="success-close">بستن</button></div></div>`;
      $('#success-close').onclick = closeModal;
      $('#success-pay').onclick = () => openTrack(r.ref, phone);
      loadTrips(true);
    } catch (ex) {
      showErr(ex.message); btn.disabled = false; btn.textContent = 'ثبت درخواست رزرو';
      if (ex.status === 409) loadTrips(true);
    }
  });
}
function showModal() { modal.hidden = false; document.body.classList.add('modal-open'); modal.scrollTop = 0; $('.modal', modal).scrollTop = 0; $('#modal-close').focus(); }
function closeModal() { modal.hidden = true; document.body.classList.remove('modal-open'); lastFocus?.focus?.(); }
/* نگه داشتن فوکوس صفحه‌کلید داخل مودال */
modal.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const f = $$('button:not([disabled]),input:not([type=hidden]),select,textarea,a[href]', modal).filter(x => x.offsetParent);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* رویدادها */
document.addEventListener('click', e => {
  const book = e.target.closest('[data-book]'); if (book) { openTrip(book.dataset.book); return; }
  const fav = e.target.closest('[data-fav]');
  if (fav) { const on = toggleFav(fav.dataset.fav); fav.classList.toggle('on', on); fav.setAttribute('aria-pressed', on); notify(on ? 'به علاقه‌مندی‌ها اضافه شد.' : 'از علاقه‌مندی‌ها حذف شد.'); if (state.filter === 'fav') render(); return; }
  const dest = e.target.closest('[data-dest]');
  if (dest) { state.dest = dest.dataset.dest; state.filter = 'all'; syncFilterButtons(); render(); }
});
$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

$$('.filter').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; syncFilterButtons(); render(); }));
$$('.category-strip [data-cat]').forEach(a => a.addEventListener('click', () => { state.filter = a.dataset.cat; syncFilterButtons(); render(); }));
$('#trip-search').addEventListener('input', e => { state.q = e.target.value; render(); });
$('#trip-sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
$('#hero-search').addEventListener('submit', e => {
  e.preventDefault();
  Object.assign(state, { filter: $('#hero-category').value, dest: $('#hero-destination').value, date: $('#hero-date').value });
  syncFilterButtons(); render();
  $('#trips').scrollIntoView({ behavior: 'smooth' });
});

/* منوی موبایل (کشوی کناری) */
const nav = $('#main-nav'), toggle = $('#menu-toggle'), navBackdrop = $('#nav-backdrop');
function setNav(open) {
  nav.classList.toggle('open', open); navBackdrop.hidden = !open; toggle.setAttribute('aria-expanded', open);
  toggle.setAttribute('aria-label', open ? 'بستن منو' : 'باز کردن منو'); document.body.classList.toggle('nav-open', open);
  if (open) $('a', nav)?.focus();
}
toggle.addEventListener('click', () => setNav(!nav.classList.contains('open')));
$('#nav-close').addEventListener('click', () => { setNav(false); toggle.focus(); });
navBackdrop.addEventListener('click', () => setNav(false));
$$('#main-nav a, #main-nav [data-track]').forEach(a => a.addEventListener('click', () => setNav(false)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setNav(false); toggle.focus(); } });
matchMedia('(min-width: 901px)').addEventListener('change', e => e.matches && setNav(false));

/* هدر چسبان و دکمه بازگشت به بالا */
const header = $('#site-header'), topBtn = $('#to-top');
const onScroll = () => { header.classList.toggle('scrolled', scrollY > 10); topBtn.hidden = scrollY < 700; };
addEventListener('scroll', onScroll, { passive: true }); onScroll();
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

/* اسلایدر قهرمان */
const slides = $$('.hero-slide'), dots = $$('.hero-dots button');
const slideInfo = [['شمال، سبز و آرام', '#tours'], ['مشهد، شهر گنبد طلایی', '#tours'], ['اصفهان، نصف جهان', '#tours']];
let slideIdx = 0, slideTimer;
function showSlide(i) {
  slideIdx = i;
  slides.forEach((s, k) => s.classList.toggle('active', k === i));
  dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', k === i); });
  $('#hero-card-title').textContent = slideInfo[i][0];
}
function autoSlide() { clearInterval(slideTimer); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) slideTimer = setInterval(() => showSlide((slideIdx + 1) % slides.length), 6000); }
dots.forEach(d => d.addEventListener('click', () => { showSlide(Number(d.dataset.slide)); autoSlide(); }));
autoSlide();

/* فرم تماس */
$('#contact-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget, f = new FormData(form), btn = form.querySelector('[type=submit]');
  const phone = JDate.en(f.get('phone')).trim();
  if (!/^09\d{9}$/.test(phone)) { notify('شماره موبایل معتبر نیست (مثال: 09123456789).'); return; }
  btn.disabled = true;
  try {
    await api('/api/messages', { method: 'POST', body: { name: f.get('name'), phone, message: f.get('message') } });
    form.reset(); notify('درخواست مشاوره ثبت شد؛ به‌زودی با شما تماس می‌گیریم.');
  } catch (ex) { notify(ex.message); }
  btn.disabled = false;
});

/* نمایش نرم بخش‌ها هنگام اسکرول */
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12 });
  $$('.section-heading,.tour-grid,.why-grid article,.steps article,.faq,.cta,.service-band').forEach(el => { el.classList.add('reveal'); io.observe(el); });
}

/* پیگیری رزرو */
function openTrack(prefRef = '', prefPhone = '') {
  lastFocus = document.activeElement;
  content.innerHTML = `<span class="eyebrow">پیگیری</span><h2 id="modal-title">پیگیری رزرو</h2>
    <p class="modal-intro">کد پیگیری و شماره موبایلی که هنگام رزرو وارد کرده‌اید را بنویسید.</p>
    <form class="booking-form" id="track-form" novalidate>
      <label>کد پیگیری<input name="ref" required dir="ltr" class="ltr-input" placeholder="HS-1A2B3C4D" autocomplete="off" maxlength="20" value="${safe(prefRef)}"></label>
      <label>شماره موبایل<input name="phone" required inputmode="tel" dir="ltr" class="ltr-input" placeholder="09123456789" autocomplete="tel" maxlength="20" value="${safe(prefPhone)}"></label>
      <p class="form-error" id="track-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">پیگیری</button>
    </form><div id="track-result"></div>`;
  showModal();
  const renderTrack = (b, ref, phone) => {
    const cls = b.status === 'تأیید شده' ? 'ok' : b.status === 'لغو شده' ? 'no' : 'wait', out = $('#track-result');
    const online = b.methods.some(m => m.type === 'online'), paidAny = b.payments.some(p => p.status === 'پرداخت شده' && p.kind === 'installment');
    out.innerHTML = `<div class="track-card"><div class="track-status ${cls}">${safe(b.status)}</div><dl>
      <dt>سفر</dt><dd>${safe(b.tripTitle)}</dd><dt>تاریخ حرکت</dt><dd>${dateFmt(b.date)}</dd>
      <dt>تعداد نفرات</dt><dd>${fmt(b.count)} نفر</dd><dt>مبلغ کل</dt><dd>${fmt(b.total + b.surcharge)} تومان${b.surcharge ? ` <small class="muted">(شامل کارمزد اقساط)</small>` : ''}</dd>
      <dt>پرداخت‌شده</dt><dd>${fmt(b.paid)} تومان</dd><dt>مانده</dt><dd>${fmt(b.balance)} تومان</dd>
      <dt>تاریخ ثبت</dt><dd>${JDate.fmtDateTime(b.createdAt)}</dd></dl></div>
      ${b.payments.length ? `<h3 class="modal-h">برنامهٔ پرداخت</h3><div class="pay-list">${b.payments.map(p => `<div class="pay-item"><span>${p.kind === 'refund' ? 'بازگشت وجه' : `قسط ${fmt(p.seq)}`} — <b>${fmt(Math.abs(p.amount))}</b> تومان${p.dueDate && p.status !== 'پرداخت شده' ? ` <small class="muted">سررسید ${dateFmt(p.dueDate)}</small>` : ''}</span>
        <span>${safe(p.status)}${p.status === 'پرداخت شده' && p.kind !== 'refund' ? '' : (p.kind !== 'refund' && online && b.status !== 'لغو شده' ? ` <button class="btn btn-primary" type="button" data-pay="${p.id}">پرداخت آنلاین</button>` : '')}</span></div>`).join('')}</div>
        <p class="muted">${b.methods.some(m => m.type === 'online') ? '' : 'پرداخت‌ها را با هماهنگی همکاران ما (نقدی یا کارت‌به‌کارت) انجام دهید؛ پس از ثبت، پیامک تأیید می‌گیرید.'}</p>` : ''}
      ${b.canChooseMethod && b.methods.length ? `<h3 class="modal-h">${b.payments.length ? 'تغییر روش پرداخت' : 'انتخاب روش پرداخت'}</h3><form id="method-form" class="booking-form">${methodBox(b.methods)}<button class="btn btn-primary" type="submit">ثبت روش پرداخت</button></form>` : ''}
      ${paidAny ? `<a class="btn btn-outline" style="margin-top:12px" target="_blank" rel="noopener" href="receipt.html?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}">مشاهده و چاپ رسید</a>` : ''}
      <p class="form-error" id="pay-error" role="alert" hidden></p>`;
    const perr = m => { const e = $('#pay-error'); e.textContent = m; e.hidden = false; };
    out.querySelectorAll('[data-pay]').forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try { const r = await api('/api/pay/start', { method: 'POST', body: { ref, phone, paymentId: Number(btn.dataset.pay) } }); location.href = r.url; }
      catch (ex) { perr(ex.message); btn.disabled = false; }
    });
    $('#method-form')?.addEventListener('submit', async e => {
      e.preventDefault(); const mid = new FormData(e.currentTarget).get('methodId');
      try { const r = await api('/api/bookings/method', { method: 'POST', body: { ref, phone, methodId: Number(mid) } }); renderTrack(r.booking, ref, phone); }
      catch (ex) { perr(ex.message); }
    });
  };
  async function runTrack(form) {
    const f = new FormData(form), err = $('#track-error'), out = $('#track-result'), btn = form.querySelector('[type=submit]');
    err.hidden = true; out.innerHTML = ''; btn.disabled = true;
    const ref = String(f.get('ref')).trim(), phone = JDate.en(f.get('phone')).trim();
    try { const { booking: b } = await api(`/api/bookings/track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`); renderTrack(b, ref, phone); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false;
  }
  $('#track-form').addEventListener('submit', e => { e.preventDefault(); runTrack(e.currentTarget); });
  if (prefRef && prefPhone) runTrack($('#track-form'));
}
document.addEventListener('click', e => { if (e.target.closest('[data-track]')) openTrack(); });

/* اطلاعات تماس از تنظیمات سایت */
async function loadSettings() {
  try {
    const { settings: s } = await api('/api/settings');
    if (s.phone) { const el = $('#topline-phone'); el.hidden = false; el.innerHTML = `<a href="tel:${safe(JDate.en(s.phone).replace(/[^\d+]/g, ''))}" dir="ltr">${safe(s.phone)}</a><span class="sep"> | </span>`; }
    const items = [];
    if (s.phone) items.push(`<a href="tel:${safe(JDate.en(s.phone).replace(/[^\d+]/g, ''))}" dir="ltr">${safe(s.phone)}</a>`);
    if (s.email) items.push(`<a href="mailto:${safe(s.email)}" dir="ltr">${safe(s.email)}</a>`);
    if (/^[\w.]{1,60}$/.test(s.instagram || '')) items.push(`<a href="https://instagram.com/${safe(s.instagram)}" target="_blank" rel="noopener noreferrer" dir="ltr">@${safe(s.instagram)}</a>`);
    if (s.address) items.push(`<span class="foot-text">${safe(s.address)}</span>`);
    if (s.hours) items.push(`<span class="foot-text">${safe(s.hours)}</span>`);
    $('#footer-contact').insertAdjacentHTML('beforeend', items.join(''));
  } catch { /* اطلاعات تماس اختیاری است */ }
}

/* بارگذاری سفرها از سرور */
async function loadTrips(silent) {
  if (!silent) { loadError = ''; grid.innerHTML = '<div class="skeleton-grid">' + '<div class="skeleton"></div>'.repeat(3) + '</div>'; }
  try { TRIPS = (await api('/api/trips')).trips; loadError = ''; }
  catch (ex) { if (!silent) loadError = ex.message; }
  renderTours(); render();
}
JDate.init();
loadTrips();
loadSettings();
