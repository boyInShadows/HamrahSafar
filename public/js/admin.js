/* پنل مدیریت — ارتباط با API سرور */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const toast = $('#toast');
let timer, trips = [], bookings = [], messages = [];

function notify(s) { toast.textContent = s; toast.classList.add('show'); clearTimeout(timer); timer = setTimeout(() => toast.classList.remove('show'), 3200); }
const showErr = (el, m) => { el.textContent = m; el.hidden = !m; };
/* اعداد فارسی/عربی و جداکننده هزارگان را به عدد تبدیل می‌کند */
const num = v => { const t = JDate.en(v).replace(/[,٬،\s]/g, ''); return t === '' || !/^\d+$/.test(t) ? NaN : Number(t); };
const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);

/* ───────── ورود / خروج ───────── */
function showLogin() { $('#dash-view').hidden = true; $('#login-view').hidden = false; $('#login-form').elements.username.focus(); }
/* فهرست وسایل نقلیه از «پنل عملیات» مدیریت می‌شود */
let TRANSPORTS = ['اتوبوس', 'خودروی همکار'];
api('/api/transports').then(r => { if (r.transports?.length) TRANSPORTS = r.transports.map(x => x.name); }).catch(() => {});
async function showDash(username) {
  try { const me = await api('/api/admin/me'); if (me.isAgent) { location.href = 'office.html'; return; } } catch { /* ادامه */ }
  $('#login-view').hidden = true; $('#dash-view').hidden = false; $('#admin-name').textContent = '👤 ' + username;
  await refresh();
}
async function boot() {
  try { const me = await api('/api/admin/me'); await showDash(me.username); }
  catch (e) { if (e.network) { $('#login-view').hidden = false; showErr($('#login-error'), e.message); } else showLogin(); }
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget, btn = f.querySelector('[type=submit]'); showErr($('#login-error'), '');
  btn.disabled = true;
  try { const r = await api('/api/admin/login', { method: 'POST', body: { username: f.elements.username.value, password: f.elements.password.value } }); f.reset(); await showDash(r.username); }
  catch (ex) { showErr($('#login-error'), ex.message); }
  btn.disabled = false;
});
$('#logout-btn').onclick = async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ادامه */ } showLogin(); };

/* در صورت پایان نشست، به صفحه ورود برمی‌گردیم */
async function call(path, opt) {
  try { return await api(path, opt); }
  catch (e) { if (e.status === 401) { showLogin(); notify('نشست شما به پایان رسید؛ دوباره وارد شوید.'); } throw e; }
}

/* ───────── بارگذاری و نمایش ───────── */
async function refresh() {
  try {
    const [t, b, m, s] = await Promise.all([call('/api/admin/trips'), call('/api/admin/bookings'), call('/api/admin/messages'), call('/api/admin/stats')]);
    trips = t.trips; bookings = b.bookings; messages = m.messages;
    $('#stat-trips').textContent = fmt(s.trips);
    $('#stat-bookings').textContent = fmt(s.bookings);
    $('#stat-pending').textContent = `${fmt(s.pending)} مورد در انتظار پرداخت`;
    $('#stat-seats').textContent = fmt(s.seatsBooked);
    $('#stat-capacity').textContent = `از ${fmt(s.capacity)} ظرفیت`;
    $('#stat-revenue').textContent = fmt(s.revenue);
    $('#cnt-trips').textContent = fmt(trips.length); $('#cnt-bookings').textContent = fmt(bookings.length); $('#cnt-messages').textContent = fmt(s.newMessages);
    renderTrips(); renderBookings(); renderMessages();
  } catch (e) { if (e.status !== 401) notify(e.message); }
}

const cell = (label, html) => `<td data-label="${label}">${html}</td>`;

function renderTrips() {
  $('#admin-trip-rows').innerHTML = trips.length ? trips.map(t => `<tr class="${t.active ? '' : 'inactive'}">
    ${cell('عنوان سفر', `<b>${safe(t.title)}</b>${t.featured ? ' <span class="badge">ویژه</span>' : ''}${t.active ? '' : ' <span class="badge off">غیرفعال</span>'}`)}
    ${cell('نوع', CATEGORY_NAMES[t.category] || 'سفر')}${cell('حمل‌ونقل', safe(t.transport))}${cell('تاریخ حرکت', t.date ? dateFmt(t.date) : '—')}
    ${cell('قیمت (تومان)', fmt(t.price))}${cell('ظرفیت', fmt(t.capacity))}${cell('رزرو شده', fmt(t.booked))}
    ${cell('عملیات', `<div class="row-actions"><button class="table-action" data-edit="${safe(t.id)}">ویرایش</button><button class="table-action delete" data-delete="${safe(t.id)}">حذف</button></div>`)}</tr>`).join('')
    : '<tr><td colspan="8" class="empty-row">هنوز سفری تعریف نشده است.</td></tr>';
}

function renderBookings() {
  const q = JDate.en($('#booking-search').value).trim().toLowerCase(), st = $('#booking-filter').value;
  const list = bookings.filter(b => (!st || b.status === st) && (!q || `${b.name} ${b.phone} ${b.ref} ${b.tripTitle}`.toLowerCase().includes(q)));
  $('#admin-booking-rows').innerHTML = list.length ? list.map(b => `<tr>
    ${cell('کد', `<span dir="ltr" class="ref">${safe(b.ref)}</span>`)}${cell('مشتری', safe(b.name) + (b.notes ? `<small class="note" title="${safe(b.notes)}">✎ ${safe(b.notes)}</small>` : ''))}
    ${cell('موبایل', `<span dir="ltr">${safe(b.phone)}</span>`)}${cell('سفر', safe(b.tripTitle))}${cell('نفرات', fmt(b.count))}${cell('مبلغ (تومان)', fmt(b.total))}
    ${cell('تاریخ ثبت', JDate.fmtDateTime(b.createdAt))}
    ${cell('وضعیت', `<select class="status-select s-${BOOKING_STATUSES.indexOf(b.status)}" data-status="${b.id}" aria-label="وضعیت رزرو">${BOOKING_STATUSES.map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}</tr>`).join('')
    : `<tr><td colspan="8" class="empty-row">${bookings.length ? 'موردی با این فیلتر پیدا نشد.' : 'هنوز درخواست رزروی ثبت نشده است.'}</td></tr>`;
}

function renderMessages() {
  $('#admin-message-rows').innerHTML = messages.length ? messages.map(m => `<tr class="${m.handled ? 'inactive' : ''}">
    ${cell('نام', safe(m.name))}${cell('موبایل', `<span dir="ltr">${safe(m.phone)}</span>`)}${cell('پیام', `<span class="wrap">${safe(m.message || '—')}</span>`)}
    ${cell('تاریخ', JDate.fmtDateTime(m.createdAt))}
    ${cell('عملیات', `<div class="row-actions"><button class="table-action" data-handled="${m.id}" data-v="${m.handled ? 0 : 1}">${m.handled ? 'بازگرداندن' : 'پیگیری شد'}</button><button class="table-action delete" data-msgdel="${m.id}">حذف</button></div>`)}</tr>`).join('')
    : '<tr><td colspan="5" class="empty-row">هنوز پیامی ثبت نشده است.</td></tr>';
}

$('#booking-filter').innerHTML += BOOKING_STATUSES.map(s => `<option>${s}</option>`).join('');
$('#booking-search').addEventListener('input', renderBookings);
$('#booking-filter').addEventListener('change', renderBookings);

document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.edit) edit(b.dataset.edit);
    else if (b.dataset.delete) {
      if (!confirm('این سفر حذف شود؟')) return;
      await call('/api/admin/trips/' + b.dataset.delete, { method: 'DELETE' }); notify('سفر حذف شد.'); refresh();
    } else if (b.dataset.handled) { await call('/api/admin/messages/' + b.dataset.handled, { method: 'PATCH', body: { handled: b.dataset.v === '1' } }); refresh(); }
    else if (b.dataset.msgdel) { if (!confirm('این پیام حذف شود؟')) return; await call('/api/admin/messages/' + b.dataset.msgdel, { method: 'DELETE' }); refresh(); }
  } catch (ex) { notify(ex.message); }
});
document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-status]'); if (!sel) return;
  try { await call('/api/admin/bookings/' + sel.dataset.status, { method: 'PATCH', body: { status: sel.value } }); notify('وضعیت رزرو به‌روزرسانی شد.'); }
  catch (ex) { notify(ex.message); }
  refresh();
});

/* ───────── مودال‌ها ───────── */
function modalCtl(id, closeId) {
  const m = $(id); let last;
  const open = () => { last = document.activeElement; m.hidden = false; document.body.classList.add('modal-open'); m.querySelector('input:not([type=hidden]),select,textarea')?.focus(); };
  const close = () => { m.hidden = true; document.body.classList.remove('modal-open'); last?.focus?.(); };
  $(closeId).onclick = close;
  m.addEventListener('mousedown', e => { if (e.target === m) close(); });
  m.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('.jd-pop')?.hidden && $('.jd-pop')) return; close(); }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')].filter(x => !x.disabled && x.offsetParent);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  return { open, close };
}
const tripModal = modalCtl('#admin-modal', '#admin-modal-close'), pwModal = modalCtl('#pw-modal', '#pw-close');
const form = $('#trip-form');
JDate.init();

function preview() {
  const v = form.elements.image.value.trim(), box = $('#image-preview');
  box.hidden = !v; box.style.backgroundImage = v ? `url('${cssUrl(v.startsWith('assets') ? '/' + v : v)}')` : '';
}
form.elements.image.addEventListener('input', preview);
/* نمایش قیمت با جداکننده هزارگان فارسی هنگام تایپ */
['price', 'capacity'].forEach(k => form.elements[k].addEventListener('input', e => { const n = num(e.target.value); if (!isNaN(n)) e.target.value = k === 'price' ? fmt(n) : JDate.fa(n); }));

function fillForm(t) {
  form.reset(); showErr($('#trip-error'), '');
  const names = [...TRANSPORTS]; if (t?.transport && !names.includes(t.transport)) names.push(t.transport);
  form.elements.transport.innerHTML = names.map(n => `<option>${safe(n)}</option>`).join('');
  const set = (k, v) => { if (t && form.elements[k]) form.elements[k].value = v ?? ''; };
  ['id', 'title', 'category', 'transport', 'destination', 'duration', 'bestSeason', 'tagline', 'description', 'image'].forEach(k => set(k, t?.[k]));
  JDate.setValue(form.elements.date, t?.date || '', false);
  form.elements.price.value = t ? fmt(t.price) : ''; form.elements.capacity.value = t ? JDate.fa(t.capacity) : '';
  form.elements.highlights.value = (t?.highlights || []).join('\n');
  form.elements.itinerary.value = (t?.itinerary || []).map(([a, b]) => `${a} | ${b}`).join('\n');
  form.elements.includes.value = (t?.includes || []).join('\n');
  form.elements.featured.checked = !!t?.featured;
  form.elements.active.checked = t ? t.active : true;
  preview();
}
function edit(id) { const t = trips.find(x => x.id === id); if (!t) return; fillForm(t); $('#trip-form-title').textContent = 'ویرایش سفر'; tripModal.open(); }
$('#add-trip').onclick = () => { fillForm(null); $('#trip-form-title').textContent = 'افزودن سفر'; tripModal.open(); };

$('#image-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { notify('حجم تصویر باید کمتر از ۵ مگابایت باشد.'); return; }
  try { const r = await call('/api/admin/upload', { method: 'POST', raw: file }); form.elements.image.value = r.url; preview(); notify('تصویر بارگذاری شد.'); }
  catch (ex) { notify(ex.message); }
});

form.addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#trip-error'), btn = form.querySelector('[type=submit]'); showErr(err, '');
  const el = form.elements;
  if (el.date.value === '' && form.querySelector('.jd-wrap input.invalid')) return showErr(err, 'تاریخ شمسی را به‌صورت ۱۴۰۵/۰۸/۰۷ وارد کنید یا از تقویم انتخاب کنید.');
  if (isNaN(num(el.price.value))) return showErr(err, 'قیمت را به‌صورت عدد وارد کنید.');
  if (isNaN(num(el.capacity.value))) return showErr(err, 'ظرفیت را به‌صورت عدد وارد کنید.');
  const body = {
    title: el.title.value, category: el.category.value, transport: el.transport.value, destination: el.destination.value,
    date: el.date.value || null, price: num(el.price.value), capacity: num(el.capacity.value),
    duration: el.duration.value, bestSeason: el.bestSeason.value, tagline: el.tagline.value, description: el.description.value, image: el.image.value,
    highlights: lines(el.highlights.value), includes: lines(el.includes.value),
    itinerary: lines(el.itinerary.value).map(l => { const i = l.indexOf('|'); return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(Boolean),
    featured: el.featured.checked, active: el.active.checked
  };
  const old = trips.find(t => t.id === el.id.value); if (old?.imagePos) body.imagePos = old.imagePos;
  btn.disabled = true;
  try {
    await call(el.id.value ? '/api/admin/trips/' + el.id.value : '/api/admin/trips', { method: el.id.value ? 'PUT' : 'POST', body });
    tripModal.close(); notify('اطلاعات سفر ذخیره شد.'); refresh();
  } catch (ex) { showErr(err, ex.message); }
  btn.disabled = false;
});

/* تغییر رمز */
$('#pw-btn').onclick = () => { $('#pw-form').reset(); showErr($('#pw-error'), ''); pwModal.open(); };
$('#pw-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget; showErr($('#pw-error'), '');
  try { await call('/api/admin/password', { method: 'POST', body: { current: f.elements.current.value, next: f.elements.next.value } }); pwModal.close(); notify('رمز عبور تغییر کرد.'); }
  catch (ex) { showErr($('#pw-error'), ex.message); }
});

/* زبانه‌ها */
function setTab(name) {
  $$('.admin-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  $$('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== name);
  try { history.replaceState(null, '', '#' + name); } catch { /* ادامه */ }
}
$$('.admin-tabs [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
if (['trips', 'bookings', 'messages'].includes(location.hash.slice(1))) setTab(location.hash.slice(1));

/* خروجی CSV با تاریخ شمسی (BOM برای نمایش درست فارسی در اکسل) */
$('#export-csv').onclick = () => {
  if (!bookings.length) { notify('رزروی برای خروجی وجود ندارد.'); return; }
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@\t\r])/, "'$1")}"`;
  const rows = [['کد رزرو', 'نام', 'موبایل', 'سفر', 'تعداد', 'مبلغ (تومان)', 'وضعیت', 'تاریخ ثبت (شمسی)'],
    ...bookings.map(b => [b.ref, b.name, b.phone, b.tripTitle, b.count, b.total, b.status, JDate.fmtDateTime(b.createdAt)])];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'bookings.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* تنظیمات تماس */
const setModal = modalCtl('#settings-modal', '#settings-close');
$('#settings-btn').onclick = async () => {
  const f = $('#settings-form'); showErr($('#settings-error'), '');
  try { const { settings } = await call('/api/settings'); Object.entries(settings).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v; }); setModal.open(); }
  catch (ex) { notify(ex.message); }
};
$('#settings-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget; showErr($('#settings-error'), '');
  try { await call('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); setModal.close(); notify('تنظیمات ذخیره شد.'); }
  catch (ex) { showErr($('#settings-error'), ex.message); }
});

boot();
