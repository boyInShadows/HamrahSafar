/* پنل عملیات همراه سفر — هسته، رزروها، مشتریان، پرداخت‌ها و گزارش‌ها */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ME = { perms: [], isAgent: false, username: '' };
const can = (...p) => ME.perms.includes('*') || p.some(x => ME.perms.includes(x));
const ACT = {};                       /* کنشکرها: data-act="name" */
const PAGE = { tab: '', el: null };
let toastTimer;

function notify(s) { const t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600); }
const showErr = (el, m) => { if (!el) return; el.textContent = m; el.hidden = !m; };
const num = v => { const t = JDate.en(v).replace(/[,٬،\s]/g, ''); return t === '' || !/^-?\d+(\.\d+)?$/.test(t) ? NaN : Number(t); };
const money = n => fmt(n) + ' تومان';
const jd = iso => (iso ? JDate.fmtLong(String(iso).slice(0, 10)) : '—');
const dtm = iso => (iso ? JDate.fmtDateTime(iso) : '—');
const opt = (items, sel, key = 'id', label = 'name') => items.map(x => `<option value="${safe(x[key])}" ${String(x[key]) === String(sel) ? 'selected' : ''}>${safe(x[label])}</option>`).join('');
const badge = (t, cls = '') => `<span class="badge ${cls}">${safe(t)}</span>`;
const statusBadge = s => badge(s, s === 'تأیید شده' || s === 'پرداخت شده' ? 'ok' : s === 'لغو شده' || s === 'ناموفق' || s === 'لغو شد' ? 'bad' : 'wait');
const csvLink = (path, q = '') => `<a class="btn btn-outline" href="/api/office${path}${q ? '?' + q : ''}" download>⇩ CSV</a>`;
const O = (path, opt) => call('/api/office' + path, opt);

/* ───── فراخوانی با مدیریت پایان نشست ───── */
async function call(path, opt) {
  try { return await api(path, opt); }
  catch (e) { if (e.status === 401) { closeAll(); showLogin(); notify('نشست شما به پایان رسید؛ دوباره وارد شوید.'); } throw e; }
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e.status !== 401) notify(e.message); } };

/* ───── مودال‌ها (پشته + قفل اسکرول شمارنده‌دار) ───── */
const stack = [];
function modal(id) {
  const m = $(id); let last;
  const c = {
    el: m, body: m.querySelector('[id$=body]'), title: m.querySelector('h2'),
    open(title, html) { c.title.textContent = title; c.body.innerHTML = html; last = document.activeElement; m.hidden = false; if (!stack.includes(c)) stack.push(c); document.body.classList.add('modal-open'); JDate.init(m); m.querySelector('.modal').scrollTop = 0; m.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea')?.focus(); },
    close() { if (m.hidden) return; m.hidden = true; const i = stack.indexOf(c); if (i >= 0) stack.splice(i, 1); if (!stack.length) document.body.classList.remove('modal-open'); last?.focus?.(); c.onclose?.(); c.onclose = null; }
  };
  m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', c.close));
  m.addEventListener('mousedown', e => { if (e.target === m) c.close(); });
  m.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...m.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')].filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  return c;
}
let D1, D2;
const closeAll = () => stack.slice().forEach(m => m.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const p = $('.jd-pop'); if (p && !p.hidden) return; stack[stack.length - 1]?.close(); } });

/* فرم‌ساز عمومی: fields = [{name,label,type,options,...}] */
function fieldHtml(f, v) {
  const val = v?.[f.name] ?? f.def ?? '';
  const attr = `name="${f.name}" ${f.req ? 'required' : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${f.ph ? `placeholder="${safe(f.ph)}"` : ''}`;
  if (f.type === 'checkbox') return `<label class="check-row"><input type="checkbox" name="${f.name}" ${val === true || val === 1 || val === '1' ? 'checked' : ''}> ${f.label}</label>`;
  if (f.type === 'select') return `<label>${f.label}<select ${attr}>${f.options.map(o => `<option value="${safe(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${safe(o.t)}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label>${f.label}<textarea ${attr} rows="${f.rows || 3}">${safe(val)}</textarea></label>`;
  if (f.type === 'date') return `<label>${f.label}<input ${attr} data-jdate value="${safe(val)}"></label>`;
  const ltr = f.ltr ? 'dir="ltr" class="ltr-input"' : '';
  return `<label>${f.label}<input ${attr} type="${f.type === 'password' ? 'password' : 'text'}" ${f.num ? 'inputmode="numeric"' : ''} ${ltr} value="${safe(val)}" ${f.auto ? `autocomplete="${f.auto}"` : 'autocomplete="off"'}></label>`;
}
function readForm(form, fields) {
  const v = {};
  for (const f of fields) {
    const el = form.elements[f.name]; if (!el) continue;
    v[f.name] = f.type === 'checkbox' ? el.checked : f.num ? (el.value.trim() === '' ? '' : num(el.value)) : el.value;
    if (f.num && v[f.name] !== '' && isNaN(v[f.name])) throw new Error(`«${f.label.replace(/ \(.*\)/, '')}» را به‌صورت عدد وارد کنید.`);
  }
  return v;
}
/* باز کردن فرم در مودال دوم؛ submit(values) باید خطا پرتاب کند یا موفق شود */
function askForm(title, fields, init, submit, { ctl = D2, label = 'ذخیره', note = '' } = {}) {
  ctl.open(title, `${note ? `<p class="hint">${note}</p>` : ''}<form class="booking-form" novalidate>${fields.map(f => fieldHtml(f, init)).join('')}<p class="form-error" role="alert" hidden></p><button class="btn btn-primary" type="submit">${label}</button></form>`);
  const form = ctl.body.querySelector('form'), err = form.querySelector('.form-error'), btn = form.querySelector('[type=submit]');
  form.addEventListener('submit', async e => {
    e.preventDefault(); showErr(err, ''); btn.disabled = true;
    try { await submit(readForm(form, fields), form); ctl.close(); } catch (ex) { showErr(err, ex.message); if (ex.status === 401) return; }
    btn.disabled = false;
  });
  return form;
}

/* ───── جدول ریسپانسیو (در موبایل به کارت تبدیل می‌شود) ───── */
function table(heads, rows, empty = 'موردی وجود ندارد.') {
  if (!rows.length) return `<p class="empty-box">${empty}</p>`;
  return `<div class="table-wrap"><table class="resp-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => {
    const cells = Array.isArray(r) ? r : r.cells, cls = Array.isArray(r) ? '' : (r.cls || '');
    return `<tr class="${cls}">${cells.map((c, i) => `<td data-label="${safe(heads[i] || '')}">${c ?? ''}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}
const actions = (...items) => `<div class="row-actions">${items.filter(Boolean).join('')}</div>`;
const act = (name, label, id = '', cls = '', extra = '') => `<button class="table-action ${cls}" data-act="${name}" data-id="${safe(id)}" ${extra}>${label}</button>`;

/* ───── نوار بازهٔ تاریخ ───── */
function rangeBar(id) {
  return `<div class="range-bar" id="${id}"><label>از<input data-jdate name="from" placeholder="تاریخ شمسی"></label><label>تا<input data-jdate name="to" placeholder="تاریخ شمسی"></label>
    <div class="quick"><button type="button" data-q="0">امروز</button><button type="button" data-q="7">۷ روز</button><button type="button" data-q="30">۳۰ روز</button><button type="button" data-q="365">یک سال</button><button type="button" data-q="all">همه</button></div></div>`;
}
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function bindRange(id, onChange) {
  const bar = $('#' + id); if (!bar) return () => '';
  JDate.init(bar);
  const f = bar.querySelector('[name=from]'), t = bar.querySelector('[name=to]');
  const fire = () => onChange();
  [f, t].forEach(x => x.addEventListener('change', fire));
  bar.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.q, today = JDate.todayISO();
    if (q === 'all') { JDate.setValue(f, '', false); JDate.setValue(t, '', false); } else { JDate.setValue(f, addDaysISO(today, -Number(q)), false); JDate.setValue(t, today, false); }
    fire();
  }));
  return () => { const p = new URLSearchParams(); if (f.value) p.set('from', f.value); if (t.value) p.set('to', t.value); return p.toString(); };
}
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ───── کنشکر مرکزی ───── */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  try { await fn(b.dataset.id, b); } catch (ex) { if (ex.status !== 401) notify(ex.message); }
});
const confirmDo = async (msg, fn, ok) => { if (!confirm(msg)) return; await fn(); if (ok) notify(ok); };

/* ==========================================================================
   رزروها
   ========================================================================== */
let BK = { trips: [], methods: [], agents: [] };
async function rBookings(el) {
  const [t, m] = await Promise.all([call('/api/trips'), O('/paymethods').catch(() => ({ methods: [] }))]);
  BK.trips = t.trips; BK.methods = m.methods;
  if (can('agents')) BK.agents = (await O('/agents')).agents;
  el.innerHTML = `<div class="panel-heading row"><div><h2>${ME.isAgent ? 'رزروهای من' : 'رزروها و پرداخت‌ها'}</h2><p>جزئیات، دریافت پرداخت، اقساط، لغو و خسارت هر رزرو از «جزئیات».</p></div>
    <div class="panel-tools"><button class="btn btn-primary" data-act="bk-new" type="button">＋ ثبت رزرو</button><span id="bk-csv"></span></div></div>
    <div class="filters"><input type="search" id="bk-q" placeholder="جستجوی نام، موبایل، کد…" aria-label="جستجو">
    <select id="bk-status" aria-label="وضعیت"><option value="">همه وضعیت‌ها</option>${BOOKING_STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
    <select id="bk-trip" aria-label="سفر"><option value="">همهٔ سفرها</option>${opt(BK.trips, '', 'id', 'title')}</select>
    ${can('agents') ? `<select id="bk-agent" aria-label="نماینده"><option value="">همهٔ نماینده‌ها</option>${opt(BK.agents, '')}</select>` : ''}
    <label class="check-row"><input type="checkbox" id="bk-unpaid"> فقط دارای مانده</label></div>${rangeBar('bk-range')}<div id="bk-list"></div>`;
  const getRange = bindRange('bk-range', load);
  async function load() {
    const p = new URLSearchParams(getRange());
    const g = id => $('#' + id)?.value; if (g('bk-q')) p.set('q', g('bk-q')); if (g('bk-status')) p.set('status', g('bk-status')); if (g('bk-trip')) p.set('tripId', g('bk-trip')); if (g('bk-agent')) p.set('agentId', g('bk-agent')); if ($('#bk-unpaid').checked) p.set('unpaid', '1');
    $('#bk-csv').innerHTML = csvLink('/bookings.csv', p.toString());
    const { bookings } = await O('/bookings?' + p);
    $('#bk-list').innerHTML = table(['کد', 'مشتری', 'سفر', 'نفرات', 'مبلغ', 'پرداخت‌شده', 'مانده', 'وضعیت', ...(ME.isAgent ? [] : ['نماینده']), ''],
      bookings.map(b => ({ cls: b.status === 'لغو شده' ? 'inactive' : '', cells: [`<span dir="ltr" class="ref">${safe(b.ref)}</span>`, `${safe(b.name)}<small class="note" dir="ltr">${safe(b.phone)}</small>`, safe(b.tripTitle), fmt(b.count), fmt(b.charge), fmt(b.net),
        b.balance ? `<b class="neg">${fmt(b.balance)}</b>` : '۰', statusBadge(b.status), ...(ME.isAgent ? [] : [safe(b.agentName || '—')]), act('bk-open', 'جزئیات', b.id)] })), 'رزروی با این فیلتر پیدا نشد.');
  }
  ['bk-status', 'bk-trip', 'bk-agent', 'bk-unpaid'].forEach(i => $('#' + i)?.addEventListener('change', load));
  $('#bk-q').addEventListener('input', debounce(load));
  PAGE.reload = load; await load();
}
ACT['bk-new'] = (_, btn) => newBooking(btn?.dataset.trip);
function newBooking(tripId) {
  const trips = BK.trips.filter(t => t.seatsLeft > 0 && (!t.date || t.date >= JDate.todayISO()));
  if (!trips.length) return notify('سفر دارای ظرفیت وجود ندارد.');
  const fields = [
    { name: 'tripId', label: 'سفر', type: 'select', options: trips.map(t => ({ v: t.id, t: `${t.title} — ${t.date ? jd(t.date) : 'بدون تاریخ'} (${fmt(t.seatsLeft)} صندلی)` })), def: tripId },
    { name: 'name', label: 'نام و نام خانوادگی', max: 80, req: true }, { name: 'phone', label: 'موبایل', max: 20, ltr: true, ph: '09123456789', req: true },
    { name: 'count', label: 'تعداد نفرات (۱ تا ۱۰)', num: true, def: '۱' },
    { name: 'methodId', label: 'روش پرداخت', type: 'select', options: [{ v: '', t: 'بعداً مشخص می‌شود' }, ...BK.methods.map(m => ({ v: m.id, t: `${m.name} (${m.typeName})` }))] },
    ...(can('agents') && BK.agents.length ? [{ name: 'agentId', label: 'نماینده (اختیاری)', type: 'select', options: [{ v: '', t: 'فروش مستقیم' }, ...BK.agents.filter(a => a.active).map(a => ({ v: a.id, t: a.name }))] }] : []),
    { name: 'notes', label: 'یادداشت', max: 500 }
  ];
  askForm('ثبت رزرو جدید', fields, null, async v => {
    const r = await O('/bookings', { method: 'POST', body: { ...v, methodId: v.methodId || null, agentId: v.agentId || null } });
    notify(`رزرو ثبت شد؛ کد ${r.ref}`); PAGE.reload?.(); if (can('bookings', 'payments', 'agent')) openBooking(r.id);
  }, { ctl: D1.el.hidden ? D1 : D2, label: 'ثبت رزرو' });
}

async function openBooking(id) {
  const d = await O('/bookings/' + id), b = d.booking, canPay = can('payments');
  const f = [['مبلغ سفر', money(b.total)], b.surcharge ? ['کارمزد اقساط', money(b.surcharge)] : null, b.penalties ? ['خسارت‌ها', money(b.penalties)] : null, ['پرداخت‌شده (خالص)', money(b.net)], ['مانده', money(b.balance)]].filter(Boolean);
  const live = b.status !== 'لغو شده', noPaid = !d.payments.some(p => p.status === 'پرداخت شده' && p.kind === 'installment');
  const rows = d.payments.map(p => ({ cls: p.status === 'لغو شد' ? 'inactive' : '', cells: [p.kind === 'refund' ? 'بازگشت' : fmt(p.seq), fmt(p.amount), p.dueDate ? jd(p.dueDate) : '—', statusBadge(p.status), safe(p.methodName || '—'), p.receiptNo ? `<span dir="ltr">${safe(p.receiptNo)}</span>` : '—',
    actions(canPay && ['در انتظار', 'ناموفق'].includes(p.status) && p.amount > 0 ? act('pay-row', 'دریافت', p.id, '', `data-bk="${b.id}"`) : '', p.status === 'پرداخت شده' && p.kind !== 'refund' ? `<a class="table-action" target="_blank" rel="noopener" href="receipt.html?ref=${encodeURIComponent(b.ref)}&phone=${encodeURIComponent(b.phone)}">رسید</a>` : '')] }));
  D1.open(`رزرو ${b.ref}`, `<div class="detail-head"><div><b>${safe(b.name)}</b> <span dir="ltr" class="muted">${safe(b.phone)}</span><br><span class="muted">${safe(b.tripTitle)} · ${b.tripDate ? jd(b.tripDate) : 'بدون تاریخ'} · ${fmt(b.count)} نفر</span>${b.agentName ? `<br><span class="muted">نماینده: ${safe(b.agentName)}</span>` : ''}</div>${statusBadge(b.status)}</div>
    <div class="chips">${f.map(([k, v]) => `<div class="chip"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <h3 class="modal-h">برنامهٔ پرداخت و اقساط</h3>${table(['قسط', 'مبلغ (تومان)', 'سررسید', 'وضعیت', 'روش', 'رسید', ''], rows, 'هنوز روش پرداخت انتخاب نشده است.')}
    ${live && noPaid && can('bookings', 'payments', 'agent') ? `<form class="inline-form" data-form="plan" data-id="${b.id}"><select name="methodId" aria-label="روش پرداخت">${opt(BK.methods, b.methodId)}</select><button class="btn btn-outline" type="submit">${d.payments.length ? 'تغییر روش پرداخت' : 'تعیین روش پرداخت'}</button></form>` : ''}
    ${canPay && b.balance > 0 ? `<form class="inline-form" data-form="addpay" data-id="${b.id}"><input name="amount" inputmode="numeric" placeholder="مبلغ (تومان)" aria-label="مبلغ" value="${fmt(b.balance).replace(/٬/g, '')}"><select name="methodName" aria-label="روش"><option>نقدی</option><option>کارت‌خوان</option><option>کارت‌به‌کارت</option><option>حواله</option></select><button class="btn btn-primary" type="submit">ثبت پرداخت دستی</button></form>` : ''}
    ${d.penalties.length ? `<h3 class="modal-h">خسارت و جریمه‌ها</h3>${table(['نوع', 'مبلغ', 'وضعیت', 'توضیح'], d.penalties.map(p => [PEN_KINDS[p.kind] || p.kind, fmt(p.amount), statusBadge(p.status === 'بدهکار' ? 'در انتظار' : p.status), safe(p.note)]))}` : ''}
    <div class="btn-row" style="margin-top:16px">${b.customerId && can('customers') ? act('cust-open', 'پروندهٔ مشتری', b.customerId) : ''}${live && can('bookings', 'accounting', 'agent') ? act('bk-cancel', 'لغو رزرو…', b.id, 'delete') : ''}</div>`);
  D1.refresh = () => openBooking(id);
}
const PEN_KINDS = { cancellation: 'لغو رزرو', delay: 'تأخیر پرداخت', damage: 'خسارت', other: 'سایر' };
ACT['bk-open'] = id => openBooking(id);
ACT['pay-row'] = async (id, b) => { if (!confirm('دریافت این مبلغ ثبت شود؟')) return; await O(`/payments/${id}/pay`, { method: 'POST', body: {} }); notify('پرداخت ثبت شد.'); D1.refresh?.(); PAGE.reload?.(); };
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
  try {
    if (f.dataset.form === 'plan') { await O(`/bookings/${f.dataset.id}/plan`, { method: 'POST', body: { methodId: f.elements.methodId.value } }); notify('روش پرداخت تعیین شد.'); }
    if (f.dataset.form === 'addpay') { const amount = num(f.elements.amount.value); if (isNaN(amount)) throw new Error('مبلغ را به‌صورت عدد وارد کنید.'); await O(`/bookings/${f.dataset.id}/payments`, { method: 'POST', body: { amount, methodName: f.elements.methodName.value } }); notify('پرداخت ثبت شد.'); }
    D1.refresh?.(); PAGE.reload?.();
  } catch (ex) { if (ex.status !== 401) notify(ex.message); }
});
ACT['bk-cancel'] = async id => {
  const pv = await O(`/bookings/${id}/cancel-preview`);
  askForm('لغو رزرو و محاسبهٔ خسارت', [
    { name: 'penalty', label: 'مبلغ خسارت (تومان)', num: true, def: pv.penalty }, { name: 'reason', label: 'دلیل لغو', max: 200 }, { name: 'notify', label: 'پیامک اطلاع‌رسانی به مشتری', type: 'checkbox', def: true }
  ], null, async v => {
    const r = await O(`/bookings/${id}/cancel`, { method: 'POST', body: { penalty: ME.isAgent ? 0 : v.penalty, reason: v.reason, notify: v.notify } });
    notify(r.refund ? `رزرو لغو شد؛ ${money(r.refund)} باید به مشتری بازگردد.` : r.debt ? `رزرو لغو شد؛ ${money(r.debt)} بدهی خسارت باقی است.` : 'رزرو لغو شد.'); D1.refresh?.(); PAGE.reload?.();
  }, { label: 'لغو رزرو', note: `${pv.days === null ? 'تاریخ حرکت ندارد' : pv.days + ' روز تا حرکت'} · طبق قوانین لغو ${fmt(pv.percent)}٪ خسارت (${money(pv.penalty)}). پرداخت‌شده: ${money(pv.paid)} ← بازگشت وجه: ${money(pv.refund)}${pv.debt ? ` · بدهی مشتری: ${money(pv.debt)}` : ''}.` });
};

/* ==========================================================================
   مشتریان (CRM)
   ========================================================================== */
async function rCustomers(el) {
  el.innerHTML = `<div class="panel-heading row"><div><h2>مشتریان</h2><p>مشتری‌ها هنگام رزرو خودکار ساخته می‌شوند. سوابق، یادداشت و پیگیری هر مشتری در پرونده‌اش است.</p></div>
    <div class="panel-tools"><button class="btn btn-primary" data-act="cust-new" type="button">＋ مشتری جدید</button><span id="cu-csv"></span></div></div>
    <div id="cu-follow"></div>
    <div class="filters"><input type="search" id="cu-q" placeholder="جستجوی نام، موبایل، کد ملی، شهر، برچسب…" aria-label="جستجو"><select id="cu-cat" aria-label="دسته"></select>
    <select id="cu-sort" aria-label="مرتب‌سازی"><option value="recent">جدیدترین</option><option value="spent">بیشترین پرداخت</option><option value="bookings">بیشترین رزرو</option><option value="name">نام</option></select></div><div id="cu-list"></div>`;
  async function load() {
    const p = new URLSearchParams({ q: $('#cu-q').value, category: $('#cu-cat').value, sort: $('#cu-sort').value });
    const { customers, categories } = await O('/customers?' + p);
    if (!$('#cu-cat').options.length) $('#cu-cat').innerHTML = `<option value="">همهٔ دسته‌ها</option>${categories.map(c => `<option>${c}</option>`).join('')}`;
    $('#cu-csv').innerHTML = can('customers') ? csvLink('/customers.csv', p.toString()) : '';
    $('#cu-list').innerHTML = table(['مشتری', 'موبایل', 'شهر', 'دسته', 'رزرو', 'مجموع پرداخت', 'آخرین رزرو', ''],
      customers.map(c => [`<b>${safe(c.name)}</b>${c.tags ? `<small class="note">${safe(c.tags)}</small>` : ''}`, `<span dir="ltr">${safe(c.phone)}</span>`, safe(c.city || '—'), badge(c.category, c.category === 'VIP' ? '' : 'off'), fmt(c.bookings), fmt(c.spent), c.lastBooking ? jd(c.lastBooking) : '—', act('cust-open', 'پرونده', c.id)]), 'مشتری‌ای پیدا نشد.');
  }
  $('#cu-q').addEventListener('input', debounce(load)); ['cu-cat', 'cu-sort'].forEach(i => $('#' + i).addEventListener('change', load));
  PAGE.reload = load; await load();
  if (can('customers')) {
    const { followups, today } = await O('/customers/followups');
    $('#cu-follow').innerHTML = followups.length ? `<div class="alert-box"><b>پیگیری‌های باز (${fmt(followups.length)})</b>${followups.slice(0, 6).map(f => `<div class="follow-row ${f.followUp < today ? 'late' : ''}"><span>${jd(f.followUp)}${f.followUp < today ? ' — معوق' : ''}</span><a href="#" data-act="cust-open" data-id="${f.customerId}">${safe(f.name)}</a><span class="muted">${safe(f.text)}</span></div>`).join('')}</div>` : '';
  }
}
const CUST_FIELDS = cats => [{ name: 'name', label: 'نام و نام خانوادگی', max: 80, req: true }, { name: 'phone', label: 'موبایل', max: 20, ltr: true, req: true }, { name: 'nationalId', label: 'کد ملی', max: 10, ltr: true, num: false },
  { name: 'city', label: 'شهر', max: 40 }, { name: 'email', label: 'ایمیل', max: 100, ltr: true }, { name: 'category', label: 'دسته‌بندی', type: 'select', options: cats.map(c => ({ v: c, t: c })) }, { name: 'tags', label: 'برچسب‌ها (با ویرگول)', max: 120 }, { name: 'notes', label: 'توضیحات', type: 'textarea', max: 1000 }];
ACT['cust-new'] = () => askForm('مشتری جدید', CUST_FIELDS(['عادی', 'VIP', 'وفادار', 'سازمانی', 'بالقوه']), null, async v => { const r = await O('/customers', { method: 'POST', body: v }); notify('مشتری ثبت شد.'); PAGE.reload?.(); openCustomer(r.id); }, { ctl: D1.el.hidden ? D1 : D2 });
ACT['cust-open'] = id => openCustomer(id);
async function openCustomer(id) {
  const d = await O('/customers/' + id), c = d.customer;
  D1.open(`پروندهٔ ${c.name}`, `<div class="chips"><div class="chip"><span>رزرو فعال</span><b>${fmt(c.bookings)}</b></div><div class="chip"><span>مجموع پرداخت</span><b>${money(c.spent)}</b></div><div class="chip"><span>دسته</span><b>${safe(c.category)}</b></div><div class="chip"><span>موبایل</span><b dir="ltr">${safe(c.phone)}</b></div></div>
    <div class="btn-row">${act('cust-edit', 'ویرایش مشخصات', id)}${can('customers') ? act('cust-del', 'حذف', id, 'delete') : ''}${can('sms') ? act('sms-to', 'ارسال پیامک', c.phone, '', `data-name="${safe(c.name)}"`) : ''}</div>
    ${c.nationalId || c.city || c.email || c.notes ? `<p class="muted">${[c.nationalId && 'کد ملی: ' + safe(c.nationalId), c.city && 'شهر: ' + safe(c.city), c.email && safe(c.email), c.tags && 'برچسب: ' + safe(c.tags)].filter(Boolean).join(' · ')}${c.notes ? '<br>' + safe(c.notes) : ''}</p>` : ''}
    <h3 class="modal-h">سوابق رزرو</h3>${table(['کد', 'سفر', 'مبلغ', 'پرداخت', 'مانده', 'وضعیت', ''], d.bookings.map(b => [`<span dir="ltr">${safe(b.ref)}</span>`, safe(b.tripTitle), fmt(b.finance.charge), fmt(b.finance.net), fmt(b.finance.balance), statusBadge(b.status), act('bk-open', 'جزئیات', b.id)]), 'رزروی ندارد.')}
    <h3 class="modal-h">ارتباطات و پیگیری</h3>
    <form class="note-form" data-id="${id}"><select name="kind">${d.kinds.map(k => `<option>${k}</option>`).join('')}</select><input name="text" placeholder="یادداشت یا نتیجهٔ تماس…" maxlength="1000" required aria-label="یادداشت"><input name="followUp" data-jdate placeholder="تاریخ پیگیری (اختیاری)"><button class="btn btn-primary" type="submit">افزودن</button></form>
    <ul class="timeline-list">${d.notes.map(n => `<li class="${n.done ? 'done' : ''}"><div><b>${safe(n.kind)}</b> <span class="muted">${dtm(n.createdAt)} ${n.adminName ? '· ' + safe(n.adminName) : ''}</span><p>${safe(n.text)}</p>${n.followUp ? `<small>پیگیری: ${jd(n.followUp)}${n.done ? ' (انجام شد)' : ''}</small>` : ''}</div>
      <div class="row-actions">${n.followUp ? act('note-done', n.done ? 'بازگشایی' : 'انجام شد', n.id, '', `data-v="${n.done ? 0 : 1}" data-c="${id}"`) : ''}${act('note-del', '×', n.id, 'delete', `data-c="${id}"`)}</div></li>`).join('') || '<li class="muted">هنوز یادداشتی ثبت نشده است.</li>'}</ul>
    ${d.sms.length ? `<h3 class="modal-h">پیامک‌های ارسالی</h3>${table(['تاریخ', 'متن', 'وضعیت'], d.sms.map(s => [dtm(s.createdAt), `<span class="wrap">${safe(s.text)}</span>`, safe(s.status)]))}` : ''}`);
  D1.refresh = () => openCustomer(id); JDate.init(D1.el);
  D1.body.querySelector('.note-form').addEventListener('submit', guard(async e => {
    e.preventDefault(); const f = e.currentTarget;
    await O(`/customers/${id}/notes`, { method: 'POST', body: { kind: f.elements.kind.value, text: f.elements.text.value, followUp: f.elements.followUp.value || null } }); openCustomer(id);
  }));
}
ACT['cust-edit'] = async id => { const d = await O('/customers/' + id); askForm('ویرایش مشتری', CUST_FIELDS(d.categories), d.customer, async v => { await O('/customers/' + id, { method: 'PUT', body: v }); notify('ذخیره شد.'); D1.refresh?.(); PAGE.reload?.(); }); };
ACT['cust-del'] = id => confirmDo('این مشتری حذف شود؟', async () => { await O('/customers/' + id, { method: 'DELETE' }); D1.close(); PAGE.reload?.(); }, 'مشتری حذف شد.');
ACT['note-done'] = async (id, b) => { await O('/notes/' + id, { method: 'PATCH', body: { done: b.dataset.v === '1' } }); openCustomer(b.dataset.c); };
ACT['note-del'] = async (id, b) => { if (confirm('این یادداشت حذف شود؟')) { await O('/notes/' + id, { method: 'DELETE' }); openCustomer(b.dataset.c); } };

/* ==========================================================================
   پرداخت‌ها و اقساط
   ========================================================================== */
async function rPayments(el) {
  el.innerHTML = `<div class="panel-heading row"><div><h2>پرداخت‌ها و اقساط</h2><p>دفتر کل دریافت‌ها، اقساط پیش‌رو و اقساط معوق.</p></div><div class="panel-tools"><span id="pm-csv"></span></div></div>
    <div id="pm-overdue"></div>
    <div class="filters"><input type="search" id="pm-q" placeholder="جستجوی نام، موبایل، کد رزرو…" aria-label="جستجو"><select id="pm-status" aria-label="وضعیت"><option value="">همه وضعیت‌ها</option><option>در انتظار</option><option>پرداخت شده</option><option>ناموفق</option><option>لغو شد</option></select></div>${rangeBar('pm-range')}<div id="pm-list"></div>`;
  const getRange = bindRange('pm-range', load);
  async function load() {
    const p = new URLSearchParams(getRange()); if ($('#pm-q').value) p.set('q', $('#pm-q').value); if ($('#pm-status').value) p.set('status', $('#pm-status').value);
    $('#pm-csv').innerHTML = csvLink('/payments.csv', getRange());
    const { payments, today } = await O('/payments?' + p);
    $('#pm-list').innerHTML = table(['رسید', 'رزرو', 'مشتری', 'قسط', 'مبلغ (تومان)', 'سررسید', 'وضعیت', 'روش', 'تاریخ پرداخت', ''],
      payments.map(x => ({ cls: x.status === 'لغو شد' ? 'inactive' : '', cells: [x.receiptNo ? `<span dir="ltr">${safe(x.receiptNo)}</span>` : '—', `<span dir="ltr">${safe(x.ref)}</span>`, safe(x.name), x.kind === 'refund' ? 'بازگشت' : fmt(x.seq), `<span class="${x.amount < 0 ? 'neg' : ''}">${fmt(x.amount)}</span>`,
        x.dueDate ? `${jd(x.dueDate)}${x.status === 'در انتظار' && x.dueDate < today ? ' ' + badge('معوق', 'bad') : ''}` : '—', statusBadge(x.status), safe(x.methodName || '—'), x.paidAt ? dtm(x.paidAt) : '—',
        actions(['در انتظار', 'ناموفق'].includes(x.status) && x.amount > 0 ? act('pay-row', 'دریافت', x.id) : '', act('bk-open', 'رزرو', x.bookingId))] })), 'پرداختی با این فیلتر پیدا نشد.');
  }
  $('#pm-q').addEventListener('input', debounce(load)); $('#pm-status').addEventListener('change', load);
  PAGE.reload = async () => { await load(); await loadOverdue(); };
  async function loadOverdue() {
    const { overdue } = await O('/accounting/overdue');
    $('#pm-overdue').innerHTML = overdue.length ? `<div class="alert-box"><b>اقساط معوق (${fmt(overdue.length)})</b>${table(['رزرو', 'مشتری', 'قسط', 'مبلغ', 'تأخیر', 'جریمهٔ پیشنهادی', ''], overdue.map(o => [`<span dir="ltr">${safe(o.ref)}</span>`, `${safe(o.name)}<small class="note" dir="ltr">${safe(o.phone)}</small>`, fmt(o.seq), fmt(o.amount), `${fmt(o.days)} روز`, fmt(o.lateFee), actions(act('pay-row', 'دریافت', o.id), can('accounting') && o.lateFee ? act('late-fee', 'ثبت جریمه', o.id, 'delete') : '')]))}</div>` : '';
  }
  await Promise.all([load(), loadOverdue()]);
}
ACT['late-fee'] = id => confirmDo('جریمهٔ تأخیر طبق درصد روزانه ثبت شود؟', async () => { await O(`/accounting/overdue/${id}/fee`, { method: 'POST', body: {} }); PAGE.reload?.(); }, 'جریمه ثبت شد.');

/* ==========================================================================
   گزارش‌ها
   ========================================================================== */
async function rReports(el) {
  el.innerHTML = `<div class="panel-heading row"><div><h2>گزارش فروش و عملکرد</h2><p>رزروها، فروش، نمایندگان، مشتریان و عملکرد کارکنان در بازهٔ دلخواه.</p></div><div class="panel-tools"><span id="rp-csv"></span></div></div>${rangeBar('rp-range')}<div id="rp-body"></div>`;
  const getRange = bindRange('rp-range', load);
  const bars = (rows, key, label) => { const max = Math.max(1, ...rows.map(r => r[key])); return `<div class="bars">${rows.map(r => `<div class="bar-row"><span>${safe(label(r))}</span><div class="bar"><i style="width:${Math.max(2, Math.round(r[key] / max * 100))}%"></i></div><b>${fmt(r[key])}</b></div>`).join('')}</div>`; };
  async function load() {
    const q = getRange(); $('#rp-csv').innerHTML = csvLink('/reports/sales.csv', q);
    const r = await O('/reports/overview' + (q ? '?' + q : '')), k = r.kpi;
    $('#rp-body').innerHTML = `<div class="stats-grid pad"><article class="stat"><span>رزروهای فعال</span><strong>${fmt(k.bookings)}</strong><small>${fmt(k.seats)} صندلی · ${fmt(k.cancelled)} لغو</small></article>
      <article class="stat"><span>ارزش فروش</span><strong>${fmt(k.value)}</strong><small>تومان</small></article><article class="stat"><span>دریافتی (نقدینگی)</span><strong>${fmt(k.income)}</strong><small>تومان</small></article><article class="stat"><span>مشتری جدید</span><strong>${fmt(k.customers)}</strong><small>در همین بازه</small></article></div>
      <div class="report-grid">
      <article class="card-box"><h3>فروش روزانه (تومان)</h3>${r.daily.length ? bars(r.daily.slice(-14), 'value', d => JDate.fmtNumeric(d.day).slice(5)) : '<p class="hint">دادهای نیست.</p>'}</article>
      <article class="card-box"><h3>فروش به تفکیک دسته</h3>${r.byCategory.length ? bars(r.byCategory, 'value', c => c.name) : '<p class="hint">دادهای نیست.</p>'}</article>
      <article class="card-box wide"><h3>فروش به تفکیک سفر</h3>${table(['سفر', 'رزرو', 'صندلی', 'ارزش فروش', 'دریافتی'], r.byTrip.map(t => [safe(t.title), fmt(t.bookings), fmt(t.seats), fmt(t.value), fmt(t.paid)]))}</article>
      <article class="card-box"><h3>نمایندگان و فروش مستقیم</h3>${table(['', 'رزرو', 'فروش', 'کمیسیون'], r.byAgent.map(a => [safe(a.name), fmt(a.bookings), fmt(a.value), fmt(a.commission)]))}</article>
      <article class="card-box"><h3>منبع رزرو</h3>${table(['منبع', 'رزرو', 'فروش'], r.bySource.map(s => [{ site: 'سایت', agent: 'نماینده', staff: 'کارمند' }[s.key] || s.key, fmt(s.bookings), fmt(s.value)]))}</article>
      <article class="card-box"><h3>مشتریان برتر</h3>${table(['مشتری', 'رزرو', 'خرید'], r.topCustomers.map(c => [safe(c.name), fmt(c.bookings), fmt(c.value)]))}</article>
      <article class="card-box"><h3>عملکرد کارکنان</h3>${table(['کاربر', 'نقش', 'رزرو ثبت‌شده', 'پرداخت ثبت‌شده'], r.staff.map(s => [safe(s.fullName || s.username), safe(s.roleName || ''), fmt(s.bookings), fmt(s.payments)]))}</article>
      <article class="card-box"><h3>وضعیت رزروها</h3>${table(['وضعیت', 'تعداد'], r.statuses.map(s => [statusBadge(s.name), fmt(s.n)]))}</article></div>`;
  }
  PAGE.reload = load; await load();
}
