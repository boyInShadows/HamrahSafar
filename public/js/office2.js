/* پنل عملیات — حسابداری، نمایندگان، کاربران و نقش‌ها، حمل‌ونقل و پرداخت، پیامک و سیستم */

/* ==========================================================================
   پنل نماینده
   ========================================================================== */
async function rAgentHome(el) {
  const [s, t] = await Promise.all([O('/agent/summary'), O('/agent/trips')]);
  BK.trips = t.trips.map(x => ({ ...x })); BK.methods = (await O('/paymethods')).methods;
  const a = s.agent;
  el.innerHTML = `<div class="panel-heading"><div><h2>پنل نماینده — ${safe(a.name)}</h2><p>کد نماینده: <b dir="ltr">${safe(a.code)}</b> · کمیسیون ${fmt(a.commissionPercent)}٪ از هر رزرو</p></div></div>
    <div class="stats-grid pad"><article class="stat"><span>رزروهای من</span><strong>${fmt(a.bookings)}</strong><small>${fmt(s.pending)} در انتظار پرداخت</small></article>
    <article class="stat"><span>مجموع فروش</span><strong>${fmt(a.sales)}</strong><small>تومان</small></article>
    <article class="stat"><span>کمیسیون تسویه‌نشده</span><strong>${fmt(a.balance)}</strong><small>از ${fmt(a.commission)} کل کمیسیون</small></article>
    <article class="stat"><span>مانده پرداخت مشتریان</span><strong>${fmt(s.unpaid)}</strong><small>دریافت‌شده: ${fmt(s.collected)}</small></article></div>
    <div class="content-grid"><article class="card-box"><div class="box-head"><h3>سفرهای قابل رزرو</h3></div>${table(['سفر', 'تاریخ', 'قیمت', 'صندلی خالی', ''], t.trips.map(x => [safe(x.title) + `<small class="note">${safe(x.destination)}</small>`, x.date ? jd(x.date) : '—', fmt(x.price), fmt(x.seatsLeft), x.seatsLeft > 0 ? act('bk-new', 'ثبت رزرو', '', '', `data-trip="${safe(x.id)}"`) : badge('تکمیل', 'off')]))}</article>
    <article class="card-box"><div class="box-head"><h3>تسویه‌های دریافتی</h3></div>${table(['تاریخ', 'مبلغ', 'توضیح'], s.settlements.map(x => [jd(x.paidOn), fmt(x.amount), safe(x.note || '—')]), 'هنوز تسویه‌ای انجام نشده است.')}</article></div>`;
  PAGE.reload = () => rAgentHome(el);
}

/* ==========================================================================
   حسابداری
   ========================================================================== */
const ACC_TABS = [['summary', 'خلاصه مالی'], ['expenses', 'هزینه‌ها'], ['debts', 'بدهی‌ها'], ['delays', 'تأخیرها'], ['penalties', 'خسارت‌ها'], ['config', 'قوانین مالی']];
let ACC = 'summary';
async function rAccounting(el) {
  el.innerHTML = `<div class="panel-heading"><div><h2>حسابداری، خسارت و تأخیر</h2><p>درآمد و هزینه، بدهی مشتریان، جریمه و خسارت لغو، تأخیر پرداخت و تأخیر حرکت سفر.</p></div></div>
    <div class="subtabs">${ACC_TABS.map(([k, t]) => `<button type="button" data-act="acc-tab" data-id="${k}" class="${k === ACC ? 'active' : ''}">${t}</button>`).join('')}</div><div id="acc-body" class="pad"></div>`;
  PAGE.reload = () => ACC_VIEWS[ACC]($('#acc-body')); await PAGE.reload();
}
ACT['acc-tab'] = async id => { ACC = id; $$('.subtabs button').forEach(b => b.classList.toggle('active', b.dataset.id === id)); await PAGE.reload(); };
const ACC_VIEWS = {
  async summary(el) {
    el.innerHTML = `${rangeBar('ac-range')}<div id="ac-out"></div>`;
    const getRange = bindRange('ac-range', load);
    async function load() {
      const q = getRange(), s = await O('/accounting/summary' + (q ? '?' + q : ''));
      $('#ac-out').innerHTML = `<div class="stats-grid"><article class="stat"><span>دریافتی</span><strong>${fmt(s.income)}</strong><small>پس از کسر بازگشت وجه: ${fmt(s.income - s.refunds)}</small></article>
        <article class="stat"><span>هزینه‌ها</span><strong>${fmt(s.expenses)}</strong><small>کمیسیون نماینده‌ها: ${fmt(s.commissions)}</small></article>
        <article class="stat"><span>سود خالص</span><strong class="${s.net < 0 ? 'neg' : ''}">${fmt(s.net)}</strong><small>دریافتی − بازگشت − هزینه − کمیسیون</small></article>
        <article class="stat"><span>مطالبات (بدهی مشتریان)</span><strong>${fmt(s.receivable)}</strong><small>خسارت ثبت‌شده: ${fmt(s.penalties)}</small></article></div>
        <div class="report-grid"><article class="card-box wide"><h3>سود و زیان هر سفر</h3>${table(['سفر', 'تاریخ', 'درآمد', 'هزینه', 'کمیسیون', 'سود'], s.trips.map(t => [safe(t.title), t.date ? jd(t.date) : '—', fmt(t.revenue), fmt(t.expenses), fmt(t.commissions), `<b class="${t.profit < 0 ? 'neg' : ''}">${fmt(t.profit)}</b>`]))}</article>
        <article class="card-box"><h3>دریافتی به تفکیک روش</h3>${table(['روش', 'تعداد', 'مبلغ'], s.byMethod.map(m => [safe(m.name || '—'), fmt(m.n), fmt(m.amount)]))}</article></div>`;
    }
    await load();
  },
  async expenses(el) {
    el.innerHTML = `<div class="btn-row"><button class="btn btn-primary" data-act="exp-new" type="button">＋ ثبت هزینه</button><a class="hint-link" href="#"></a></div>${rangeBar('ex-range')}<div id="ex-out"></div>`;
    const getRange = bindRange('ex-range', load);
    async function load() {
      const { expenses } = await O('/accounting/expenses' + (getRange() ? '?' + getRange() : '')); window.__EXP = expenses;
      const total = expenses.reduce((s, e) => s + e.amount, 0);
      $('#ex-out').innerHTML = `<p class="hint">مجموع هزینه‌های این بازه: <b>${money(total)}</b></p>` + table(['تاریخ', 'عنوان', 'دسته', 'سفر', 'مبلغ (تومان)', ''], expenses.map(e => [jd(e.spentOn), `${safe(e.title)}${e.note ? `<small class="note">${safe(e.note)}</small>` : ''}`, safe(e.category), safe(e.tripTitle || 'عمومی'), fmt(e.amount), actions(act('exp-edit', 'ویرایش', e.id), act('exp-del', 'حذف', e.id, 'delete'))]), 'هزینه‌ای ثبت نشده است.');
    }
    await load();
  },
  async debts(el) {
    const { debts, total } = await O('/accounting/debts');
    el.innerHTML = `<p class="hint">مجموع مطالبات: <b>${money(total)}</b></p>` + table(['رزرو', 'مشتری', 'سفر', 'مبلغ بدهی', 'پرداخت‌شده', 'قسط بعدی', ''],
      debts.map(d => ({ cls: d.late ? 'late-row' : '', cells: [`<span dir="ltr">${safe(d.ref)}</span>`, `${safe(d.name)}<small class="note" dir="ltr">${safe(d.phone)}</small>`, safe(d.tripTitle), `<b class="neg">${fmt(d.balance)}</b>`, fmt(d.net), d.nextDue ? jd(d.nextDue) + (d.late ? ' ' + badge('معوق', 'bad') : '') : '—', act('bk-open', 'جزئیات و دریافت', d.id)] })), 'بدهکاری وجود ندارد.');
  },
  async delays(el) {
    const [{ delays }, { trips }] = await Promise.all([O('/accounting/delays'), call('/api/trips')]);
    window.__TRIPS_D = trips;
    el.innerHTML = `<div class="alert-box"><b>ثبت تأخیر در حرکت سفر</b><form class="inline-form wrap-form" id="delay-form"><select name="tripId" aria-label="سفر">${opt(trips, '', 'id', 'title')}</select><input name="minutes" inputmode="numeric" placeholder="مدت تأخیر (دقیقه)" aria-label="دقیقه" required><input name="reason" placeholder="علت (اختیاری)" maxlength="200" aria-label="علت"><label class="check-row"><input type="checkbox" name="notify" checked> پیامک به مسافران</label><button class="btn btn-primary" type="submit">ثبت تأخیر</button></form></div>` +
      table(['سفر', 'تأخیر', 'علت', 'اطلاع‌رسانی', 'تاریخ ثبت', ''], delays.map(d => [safe(d.tripTitle), `${fmt(d.minutes)} دقیقه`, safe(d.reason || '—'), d.notified ? badge('پیامک شد', 'ok') : '—', dtm(d.createdAt), act('delay-del', 'حذف', d.id, 'delete')]), 'تأخیری ثبت نشده است.');
    $('#delay-form').addEventListener('submit', guard(async e => {
      e.preventDefault(); const f = e.currentTarget, m = num(f.elements.minutes.value); if (isNaN(m)) throw new Error('مدت تأخیر را به‌صورت عدد وارد کنید.');
      const r = await O('/accounting/delays', { method: 'POST', body: { tripId: f.elements.tripId.value, minutes: m, reason: f.elements.reason.value, notify: f.elements.notify.checked } });
      notify(r.notified ? `ثبت شد و برای ${fmt(r.notified)} مسافر پیامک رفت.` : 'تأخیر ثبت شد.'); PAGE.reload();
    }));
  },
  async penalties(el) {
    const { penalties } = await O('/accounting/penalties');
    el.innerHTML = `<div class="btn-row"><button class="btn btn-primary" data-act="pen-new" type="button">＋ ثبت خسارت / جریمه</button></div>` + table(['رزرو', 'مشتری', 'نوع', 'مبلغ (تومان)', 'وضعیت', 'توضیح', ''],
      penalties.map(p => ({ cls: p.status !== 'بدهکار' ? 'inactive' : '', cells: [`<span dir="ltr">${safe(p.ref)}</span>`, safe(p.name), PEN_KINDS[p.kind] || p.kind, fmt(p.amount), p.status === 'بدهکار' ? badge('بدهکار', 'wait') : badge(p.status, 'off'), safe(p.note || '—'),
        actions(act('pen-toggle', p.status === 'بدهکار' ? 'بخشودن' : 'بازگرداندن', p.id, '', `data-s="${p.status === 'بدهکار' ? 'بخشیده شد' : 'بدهکار'}"`), act('pen-del', 'حذف', p.id, 'delete'), act('bk-open', 'رزرو', p.bookingId))] })), 'خسارتی ثبت نشده است.');
  },
  async config(el) {
    const { config: c } = await O('/config');
    el.innerHTML = `<form class="booking-form cfg-form" id="fin-cfg"><fieldset><legend>پرداخت و تأیید</legend><label class="check-row"><input type="checkbox" name="autoConfirm" ${c.autoConfirm === '1' ? 'checked' : ''}> رزرو پس از دریافت پیش‌پرداخت (یا کل مبلغ) خودکار «تأیید شده» شود</label>
      <label>جریمهٔ تأخیر قسط (درصد از مبلغ قسط در هر روز)<input name="lateFeePercentPerDay" inputmode="decimal" value="${safe(c.lateFeePercentPerDay)}"></label></fieldset>
      <fieldset><legend>قوانین خسارت لغو</legend><p class="hint">برای لغو، اولین قانونی اعمال می‌شود که «روز مانده تا حرکت» از حد آن کمتر نباشد. حتماً یک قانون با ۰ روز لازم است.</p><div id="rules">${c.cancelPolicy.map(ruleRow).join('')}</div><button class="btn btn-outline" type="button" data-act="rule-add">＋ قانون جدید</button></fieldset>
      <label>متن پایین رسید<input name="receiptNote" maxlength="200" value="${safe(c.receiptNote)}"></label><p class="form-error" role="alert" hidden></p><div class="sticky-save"><button class="btn btn-primary" type="submit">ذخیرهٔ قوانین مالی</button></div></form>`;
    $('#fin-cfg').addEventListener('submit', guard(async e => {
      e.preventDefault(); const f = e.currentTarget, err = f.querySelector('.form-error'); showErr(err, '');
      const rules = [...f.querySelectorAll('.rule')].map(r => ({ minDays: num(r.querySelector('[name=minDays]').value), percent: num(r.querySelector('[name=percent]').value) }));
      try { await O('/config', { method: 'PUT', body: { autoConfirm: f.elements.autoConfirm.checked, lateFeePercentPerDay: num(f.elements.lateFeePercentPerDay.value), receiptNote: f.elements.receiptNote.value, cancelPolicy: rules } }); notify('قوانین مالی ذخیره شد.'); } catch (ex) { showErr(err, ex.message); }
    }));
  }
};
const ruleRow = r => `<div class="rule"><span>اگر حداقل</span><input name="minDays" inputmode="numeric" value="${JDate.fa(r.minDays)}" aria-label="روز"><span>روز تا حرکت مانده باشد، خسارت</span><input name="percent" inputmode="numeric" value="${JDate.fa(r.percent)}" aria-label="درصد"><span>٪ مبلغ سفر</span><button type="button" class="table-action delete" data-act="rule-del">×</button></div>`;
ACT['rule-add'] = () => $('#rules').insertAdjacentHTML('beforeend', ruleRow({ minDays: 0, percent: 100 }));
ACT['rule-del'] = (_, b) => b.closest('.rule').remove();
ACT['exp-new'] = () => expForm(null);
ACT['exp-edit'] = id => expForm((window.__EXP || []).find(e => String(e.id) === String(id)));
async function expForm(e) {
  const { trips } = await call('/api/trips');
  askForm(e ? 'ویرایش هزینه' : 'ثبت هزینه', [{ name: 'title', label: 'عنوان', max: 100, req: true }, { name: 'amount', label: 'مبلغ (تومان)', num: true, req: true },
    { name: 'category', label: 'دسته', type: 'select', options: ['حمل‌ونقل', 'اقامت', 'غذا', 'راهنما و بلیت', 'تبلیغات', 'حقوق', 'سایر'].map(x => ({ v: x, t: x })) },
    { name: 'tripId', label: 'مربوط به سفر', type: 'select', options: [{ v: '', t: 'عمومی (بدون سفر)' }, ...trips.map(t => ({ v: t.id, t: t.title }))] }, { name: 'spentOn', label: 'تاریخ', type: 'date', def: JDate.todayISO() }, { name: 'note', label: 'توضیح', max: 200 }],
    e ? { ...e, tripId: e.tripId || '' } : null, async v => { await O(e ? '/accounting/expenses/' + e.id : '/accounting/expenses', { method: e ? 'PUT' : 'POST', body: { ...v, tripId: v.tripId || null } }); notify('ذخیره شد.'); PAGE.reload(); }, { ctl: D1.el.hidden ? D1 : D2 });
}
ACT['exp-del'] = id => confirmDo('این هزینه حذف شود؟', async () => { await O('/accounting/expenses/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');
ACT['delay-del'] = id => confirmDo('این مورد حذف شود؟', async () => { await O('/accounting/delays/' + id, { method: 'DELETE' }); PAGE.reload(); });
ACT['pen-new'] = () => askForm('ثبت خسارت یا جریمه', [{ name: 'ref', label: 'کد یا موبایل رزرو (برای جستجو)', max: 30, ltr: true, req: true }, { name: 'kind', label: 'نوع', type: 'select', options: [{ v: 'damage', t: 'خسارت' }, { v: 'delay', t: 'تأخیر پرداخت' }, { v: 'other', t: 'سایر' }] }, { name: 'amount', label: 'مبلغ (تومان)', num: true, req: true }, { name: 'note', label: 'توضیح', max: 200 }], null, async v => {
  const { bookings } = await O('/bookings?q=' + encodeURIComponent(v.ref)); if (bookings.length !== 1) throw new Error(bookings.length ? 'چند رزرو پیدا شد؛ کد دقیق رزرو را بنویسید.' : 'رزروی پیدا نشد.');
  await O('/accounting/penalties', { method: 'POST', body: { bookingId: bookings[0].id, kind: v.kind, amount: v.amount, note: v.note } }); notify('ثبت شد.'); PAGE.reload();
});
ACT['pen-toggle'] = async (id, b) => { await O('/accounting/penalties/' + id, { method: 'PATCH', body: { status: b.dataset.s } }); PAGE.reload(); };
ACT['pen-del'] = id => confirmDo('این مورد حذف شود؟', async () => { await O('/accounting/penalties/' + id, { method: 'DELETE' }); PAGE.reload(); });

/* ==========================================================================
   نمایندگان
   ========================================================================== */
async function rAgents(el) {
  const { agents } = await O('/agents'); window.__AGENTS = agents;
  el.innerHTML = `<div class="panel-heading row"><div><h2>مدیریت نمایندگان</h2><p>هر نماینده حساب ورود و پنل اختصاصی دارد و فقط رزروها و مشتریان خودش را می‌بیند. کمیسیون با رزرو محاسبه و با «تسویه» پرداخت می‌شود.</p></div><div class="panel-tools"><button class="btn btn-primary" data-act="ag-new" type="button">＋ نمایندهٔ جدید</button></div></div><div class="pad">` +
    table(['نماینده', 'کد / ورود', 'شهر', 'کمیسیون', 'رزرو', 'فروش', 'کمیسیون کل', 'تسویه‌شده', 'مانده', ''], agents.map(a => ({ cls: a.active ? '' : 'inactive', cells: [`<b>${safe(a.name)}</b>${a.active ? '' : ' ' + badge('غیرفعال', 'off')}<small class="note" dir="ltr">${safe(a.phone)}</small>`, `<span dir="ltr">${safe(a.code)}<br>${safe(a.username || '')}</span>`, safe(a.city || '—'), fmt(a.commissionPercent) + '٪', fmt(a.bookings), fmt(a.sales), fmt(a.commission), fmt(a.settled), `<b>${fmt(a.balance)}</b>`,
      actions(act('ag-settle', 'تسویه', a.id), act('ag-edit', 'ویرایش', a.id), act('ag-pw', 'رمز', a.id), act('ag-del', 'حذف', a.id, 'delete'))] })), 'هنوز نماینده‌ای ثبت نشده است.') + '</div>';
  PAGE.reload = () => rAgents(el);
}
const AG_FIELDS = [{ name: 'name', label: 'نام نماینده / آژانس', max: 80, req: true }, { name: 'phone', label: 'موبایل', max: 20, ltr: true }, { name: 'city', label: 'شهر', max: 40 }, { name: 'commissionPercent', label: 'درصد کمیسیون', num: true, def: '۵' }, { name: 'notes', label: 'توضیحات', max: 300 }];
ACT['ag-new'] = () => askForm('نمایندهٔ جدید', [...AG_FIELDS, { name: 'username', label: 'نام کاربری ورود (انگلیسی)', max: 30, ltr: true, req: true }, { name: 'password', label: 'رمز عبور (حداقل ۸ نویسه)', type: 'password', ltr: true, auto: 'new-password', req: true }], null, async v => { await O('/agents', { method: 'POST', body: v }); notify('نماینده ساخته شد؛ نام کاربری و رمز را به او بدهید.'); PAGE.reload(); });
ACT['ag-edit'] = id => { const a = window.__AGENTS.find(x => String(x.id) === String(id)); askForm('ویرایش نماینده', [...AG_FIELDS, { name: 'active', label: 'نماینده فعال باشد (امکان ورود و ثبت رزرو)', type: 'checkbox' }], a, async v => { await O('/agents/' + id, { method: 'PUT', body: v }); notify('ذخیره شد.'); PAGE.reload(); }); };
ACT['ag-pw'] = id => askForm('رمز جدید نماینده', [{ name: 'password', label: 'رمز جدید (حداقل ۸ نویسه)', type: 'password', ltr: true, auto: 'new-password', req: true }], null, async v => { await O(`/agents/${id}/password`, { method: 'POST', body: v }); notify('رمز تغییر کرد.'); });
ACT['ag-del'] = id => confirmDo('این نماینده حذف شود؟ (نمایندهٔ دارای رزرو را فقط غیرفعال کنید)', async () => { await O('/agents/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');
ACT['ag-settle'] = async id => {
  const a = window.__AGENTS.find(x => String(x.id) === String(id)), { settlements } = await O(`/agents/${id}/settlements`);
  D1.open(`تسویهٔ کمیسیون — ${a.name}`, `<div class="chips"><div class="chip"><span>کمیسیون کل</span><b>${money(a.commission)}</b></div><div class="chip"><span>تسویه‌شده</span><b>${money(a.settled)}</b></div><div class="chip"><span>مانده</span><b>${money(a.balance)}</b></div></div>
    <form class="inline-form wrap-form" id="settle-form"><input name="amount" inputmode="numeric" placeholder="مبلغ (تومان)" aria-label="مبلغ" required value="${a.balance > 0 ? fmt(a.balance).replace(/٬/g, '') : ''}"><input name="paidOn" data-jdate value="${JDate.todayISO()}" aria-label="تاریخ"><input name="note" placeholder="توضیح (اختیاری)" maxlength="200" aria-label="توضیح"><button class="btn btn-primary" type="submit">ثبت تسویه</button></form>
    ${table(['تاریخ', 'مبلغ', 'توضیح', ''], settlements.map(s => [jd(s.paidOn), fmt(s.amount), safe(s.note || '—'), act('settle-del', 'حذف', s.id, 'delete', `data-a="${id}"`)]), 'تسویه‌ای ثبت نشده است.')}`);
  $('#settle-form').addEventListener('submit', guard(async e => {
    e.preventDefault(); const f = e.currentTarget, amount = num(f.elements.amount.value); if (isNaN(amount)) throw new Error('مبلغ را به‌صورت عدد وارد کنید.');
    await O(`/agents/${id}/settlements`, { method: 'POST', body: { amount, paidOn: f.elements.paidOn.value, note: f.elements.note.value } }); notify('تسویه ثبت شد.'); D1.close(); PAGE.reload();
  }));
};
ACT['settle-del'] = async (id, b) => { if (!confirm('این تسویه حذف شود؟')) return; await O(`/agents/${b.dataset.a}/settlements/${id}`, { method: 'DELETE' }); D1.close(); PAGE.reload(); };

/* ==========================================================================
   کاربران، کارکنان و نقش‌ها
   ========================================================================== */
async function rUsers(el) {
  const [{ users }, { roles, permissions }] = await Promise.all([O('/users'), O('/roles')]);
  window.__ROLES = roles; window.__PERMS = permissions; window.__USERS = users;
  el.innerHTML = `<div class="panel-heading row"><div><h2>کاربران، کارکنان و نقش‌ها</h2><p>هر کاربر یک نقش دارد و فقط به بخش‌های مجاز آن نقش دسترسی پیدا می‌کند. تغییر نقش بلافاصله اعمال می‌شود.</p></div></div>
    <div class="content-grid pad"><article class="card-box wide"><div class="box-head"><h3>حساب‌های کاربری</h3><button class="btn btn-primary" data-act="us-new" type="button">＋ کاربر یا کارمند جدید</button></div>
    ${table(['کاربر', 'نام کاربری', 'نقش', 'رزروهای ثبت‌شده', 'وضعیت', ''], users.map(u => ({ cls: u.active ? '' : 'inactive', cells: [`<b>${safe(u.fullName || '—')}</b><small class="note" dir="ltr">${safe(u.phone)}</small>`, `<span dir="ltr">${safe(u.username)}</span>`, safe(u.roleName || '—') + (u.kind === 'agent' ? ' ' + badge('نماینده', 'off') : ''), fmt(u.bookings), u.active ? badge('فعال', 'ok') : badge('غیرفعال', 'off'),
      actions(u.kind === 'agent' ? '' : act('us-edit', 'ویرایش', u.id), act('us-pw', 'رمز', u.id), u.kind === 'agent' ? '' : act('us-del', 'حذف', u.id, 'delete'))] })))}</article>
    <article class="card-box wide"><div class="box-head"><h3>نقش‌ها و سطح دسترسی</h3><button class="btn btn-outline" data-act="role-new" type="button">＋ نقش جدید</button></div>
    ${table(['نقش', 'توضیح', 'دسترسی‌ها', 'کاربران', ''], roles.map(r => [`<b>${safe(r.name)}</b>${r.builtin ? ' ' + badge('سیستمی', 'off') : ''}`, safe(r.note || '—'), r.perms.includes('*') ? 'همهٔ بخش‌ها' : r.perms.includes('agent') ? 'پنل نماینده' : `<span class="wrap">${r.perms.map(p => safe(permissions[p] || p)).join('، ') || '—'}</span>`, fmt(r.users), r.builtin ? '' : actions(act('role-edit', 'ویرایش', r.id), act('role-del', 'حذف', r.id, 'delete'))]))}</article></div>`;
  PAGE.reload = () => rUsers(el);
}
const roleOpts = () => window.__ROLES.filter(r => r.perms[0] !== 'agent').map(r => ({ v: r.id, t: r.name }));
ACT['us-new'] = () => askForm('کاربر جدید', [{ name: 'fullName', label: 'نام و نام خانوادگی', max: 80 }, { name: 'phone', label: 'موبایل', max: 20, ltr: true }, { name: 'username', label: 'نام کاربری (انگلیسی)', max: 30, ltr: true, req: true }, { name: 'password', label: 'رمز عبور (حداقل ۸ نویسه)', type: 'password', ltr: true, auto: 'new-password', req: true }, { name: 'roleId', label: 'نقش', type: 'select', options: roleOpts(), def: 4 }], null, async v => { await O('/users', { method: 'POST', body: v }); notify('کاربر ساخته شد.'); PAGE.reload(); });
ACT['us-edit'] = id => { const u = window.__USERS.find(x => String(x.id) === String(id)); askForm('ویرایش کاربر', [{ name: 'fullName', label: 'نام و نام خانوادگی', max: 80 }, { name: 'phone', label: 'موبایل', max: 20, ltr: true }, { name: 'roleId', label: 'نقش', type: 'select', options: roleOpts() }, { name: 'active', label: 'حساب فعال باشد', type: 'checkbox' }], u, async v => { await O('/users/' + id, { method: 'PUT', body: v }); notify('ذخیره شد.'); PAGE.reload(); }); };
ACT['us-pw'] = id => { const u = window.__USERS.find(x => String(x.id) === String(id)); const url = u.kind === 'agent' ? `/agents/${u.agentId}/password` : `/users/${id}/password`; askForm('رمز جدید', [{ name: 'password', label: 'رمز جدید (حداقل ۸ نویسه)', type: 'password', ltr: true, auto: 'new-password', req: true }], null, async v => { await O(url, { method: 'POST', body: v }); notify('رمز تغییر کرد و کاربر از همهٔ دستگاه‌ها خارج شد.'); }); };
ACT['us-del'] = id => confirmDo('این کاربر حذف شود؟', async () => { await O('/users/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');
function roleForm(r) {
  const perms = window.__PERMS;
  D2.open(r ? 'ویرایش نقش' : 'نقش جدید', `<form class="booking-form" novalidate><label>نام نقش<input name="name" maxlength="40" required value="${safe(r?.name || '')}"></label><label>توضیح<input name="note" maxlength="120" value="${safe(r?.note || '')}"></label>
    <fieldset><legend>دسترسی‌ها</legend><div class="perm-grid">${Object.entries(perms).map(([k, t]) => `<label class="check-row"><input type="checkbox" name="perm" value="${k}" ${r?.perms.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></fieldset><p class="form-error" role="alert" hidden></p><button class="btn btn-primary" type="submit">ذخیره</button></form>`);
  const f = D2.body.querySelector('form');
  f.addEventListener('submit', guard(async e => {
    e.preventDefault(); const err = f.querySelector('.form-error'); showErr(err, '');
    try { await O(r ? '/roles/' + r.id : '/roles', { method: r ? 'PUT' : 'POST', body: { name: f.elements.name.value, note: f.elements.note.value, perms: [...f.querySelectorAll('[name=perm]:checked')].map(x => x.value) } }); D2.close(); notify('نقش ذخیره شد.'); PAGE.reload(); } catch (ex) { showErr(err, ex.message); }
  }));
}
ACT['role-new'] = () => roleForm(null);
ACT['role-edit'] = id => roleForm(window.__ROLES.find(x => String(x.id) === String(id)));
ACT['role-del'] = id => confirmDo('این نقش حذف شود؟', async () => { await O('/roles/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');

/* ==========================================================================
   حمل‌ونقل و روش‌های پرداخت
   ========================================================================== */
async function rCatalog(el) {
  const [tr, pm] = await Promise.all([can('transports') ? O('/transports') : { transports: [] }, can('paymethods') ? O('/paymethods?all=1') : { methods: [] }]);
  window.__TR = tr.transports; window.__PM = pm.methods; window.__PMT = pm.types;
  el.innerHTML = `<div class="panel-heading"><div><h2>حمل‌ونقل و روش‌های پرداخت</h2><p>وسایل نقلیه در فرم سفر و روش‌های پرداخت در فرم رزرو سایت نمایش داده می‌شوند.</p></div></div><div class="content-grid pad">
    ${can('transports') ? `<article class="card-box"><div class="box-head"><h3>شیوه‌های حمل‌ونقل</h3><button class="btn btn-primary" data-act="tr-new" type="button">＋ افزودن</button></div>${table(['', 'توضیح', 'سفرها', ''], tr.transports.map((t, i) => ({ cls: t.active ? '' : 'inactive', cells: [`<span class="ico">${safe(t.icon)}</span> <b>${safe(t.name)}</b>${t.active ? '' : ' ' + badge('غیرفعال', 'off')}`, safe(t.description || '—'), fmt(t.trips), actions(act('tr-move', '↑', t.id, '', `data-d="-1" ${i === 0 ? 'disabled' : ''}`), act('tr-move', '↓', t.id, '', `data-d="1" ${i === tr.transports.length - 1 ? 'disabled' : ''}`), act('tr-edit', 'ویرایش', t.id), act('tr-del', 'حذف', t.id, 'delete'))] })))}</article>` : ''}
    ${can('paymethods') ? `<article class="card-box wide"><div class="box-head"><h3>روش‌های پرداخت</h3><button class="btn btn-primary" data-act="pm-new" type="button">＋ افزودن</button></div>${table(['روش', 'نوع', 'شرایط', 'نمایش در سایت', ''], pm.methods.map(m => ({ cls: m.active ? '' : 'inactive', cells: [`<b>${safe(m.name)}</b>${m.active ? '' : ' ' + badge('غیرفعال', 'off')}`, safe(m.typeName), m.type === 'installment' ? `${fmt(m.installments)} قسط · پیش‌پرداخت ${fmt(m.downPercent)}٪ · هر ${fmt(m.intervalDays)} روز · کارمزد ${fmt(m.feePercent)}٪` : '—', m.public ? badge('بله', 'ok') : badge('فقط دفتر', 'off'), actions(act('pm-edit', 'ویرایش', m.id), act('pm-del', 'حذف', m.id, 'delete'))] })))}</article>` : ''}</div>`;
  PAGE.reload = () => rCatalog(el);
}
const TR_FIELDS = [{ name: 'name', label: 'نام', max: 40, req: true }, { name: 'icon', label: 'نماد (ایموجی)', max: 8 }, { name: 'description', label: 'توضیح', max: 120 }, { name: 'active', label: 'در فرم سفر نمایش داده شود', type: 'checkbox', def: true }];
ACT['tr-new'] = () => askForm('وسیلهٔ نقلیهٔ جدید', TR_FIELDS, null, async v => { await O('/transports', { method: 'POST', body: v }); notify('افزوده شد.'); PAGE.reload(); });
ACT['tr-edit'] = id => askForm('ویرایش', TR_FIELDS, window.__TR.find(x => String(x.id) === String(id)), async v => { await O('/transports/' + id, { method: 'PUT', body: v }); notify('ذخیره شد (نام در سفرهای قبلی هم به‌روز شد).'); PAGE.reload(); });
ACT['tr-del'] = id => confirmDo('این مورد حذف شود؟', async () => { await O('/transports/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');
ACT['tr-move'] = async (id, b) => { const ids = window.__TR.map(x => x.id), i = ids.indexOf(Number(id)), j = i + Number(b.dataset.d); [ids[i], ids[j]] = [ids[j], ids[i]]; await O('/transports/order', { method: 'POST', body: { ids } }); PAGE.reload(); };
const pmFields = m => [{ name: 'name', label: 'نام روش', max: 60, req: true }, { name: 'type', label: 'نوع', type: 'select', options: Object.entries(window.__PMT).map(([k, t]) => ({ v: k, t })) },
  { name: 'installments', label: 'تعداد اقساط (با پیش‌پرداخت) — فقط اقساطی', num: true, def: '۳' }, { name: 'downPercent', label: 'درصد پیش‌پرداخت — فقط اقساطی', num: true, def: '۴۰' }, { name: 'intervalDays', label: 'فاصلهٔ اقساط (روز) — فقط اقساطی', num: true, def: '۳۰' }, { name: 'feePercent', label: 'کارمزد اقساط (درصد از کل) — فقط اقساطی', num: true, def: '۰' },
  { name: 'terms', label: 'شرایط (برای مشتری نمایش داده می‌شود)', type: 'textarea', max: 300 }, { name: 'public', label: 'در فرم رزرو سایت نمایش داده شود', type: 'checkbox', def: true }, { name: 'active', label: 'فعال باشد', type: 'checkbox', def: true }];
ACT['pm-new'] = () => askForm('روش پرداخت جدید', pmFields(), null, async v => { await O('/paymethods', { method: 'POST', body: v }); notify('افزوده شد.'); PAGE.reload(); });
ACT['pm-edit'] = id => askForm('ویرایش روش پرداخت', pmFields(), window.__PM.find(x => String(x.id) === String(id)), async v => { await O('/paymethods/' + id, { method: 'PUT', body: v }); notify('ذخیره شد.'); PAGE.reload(); });
ACT['pm-del'] = id => confirmDo('این روش حذف شود؟', async () => { await O('/paymethods/' + id, { method: 'DELETE' }); PAGE.reload(); }, 'حذف شد.');

/* ==========================================================================
   پیامک و یادآوری
   ========================================================================== */
async function rSms(el) {
  const [st, tp, lg, cf, pv, { trips }] = await Promise.all([O('/sms/status'), O('/sms/templates'), O('/sms/log?limit=60'), O('/config'), O('/reminders/preview'), call('/api/trips')]);
  const c = cf.config;
  el.innerHTML = `<div class="panel-heading"><div><h2>پیامک و یادآوری</h2><p>قالب پیام‌ها، ارسال گروهی، یادآوری خودکار حرکت و اقساط، و گزارش پیامک‌های ارسالی.</p></div></div>
    <div class="pad">${st.live ? '' : `<div class="alert-box warn"><b>حالت آزمایشی:</b> ارائه‌دهندهٔ پیامک متصل نیست؛ پیامک‌ها فقط در گزارش ثبت می‌شوند و به گوشی نمی‌رسند. برای ارسال واقعی، <code dir="ltr">SMS_PROVIDER=kavenegar</code> و <code dir="ltr">SMS_API_KEY</code> را در فایل .env تنظیم کنید.</div>`}
    <div class="content-grid">
    <form class="card-box booking-form" id="sms-cfg"><div class="box-head"><h3>تنظیمات پیامک و یادآوری</h3></div>
      <label class="check-row"><input type="checkbox" name="smsEnabled" ${c.smsEnabled === '1' ? 'checked' : ''}> ارسال پیامک فعال باشد</label>
      <label>نام آژانس در متن پیامک‌ها<input name="agencyName" maxlength="40" value="${safe(c.agencyName)}"></label>
      <label>یادآوری حرکت: چند روز مانده به سفر (با ویرگول، مثلاً ۳,۱)<input name="remindDays" dir="ltr" class="ltr-input" value="${safe(c.remindDays)}"></label>
      <label>یادآوری قسط: چند روز قبل از سررسید<input name="installmentRemindDays" inputmode="numeric" value="${JDate.fa(c.installmentRemindDays)}"></label>
      <p class="form-error" role="alert" hidden></p><button class="btn btn-primary" type="submit">ذخیره</button></form>
    <article class="card-box"><div class="box-head"><h3>یادآوری‌های در صف</h3><button class="btn btn-primary" data-act="rem-run" type="button">اجرای همین حالا</button></div>
      <p class="hint">یادآوری‌ها هر ۳۰ دقیقه خودکار ارسال می‌شوند و هر مورد فقط یک‌بار.</p>
      ${table(['نوع', 'رزرو', 'مشتری', 'تاریخ'], [...pv.departures.map(d => ['حرکت', `<span dir="ltr">${safe(d.ref)}</span>`, safe(d.name), jd(d.date)]), ...pv.installments.map(d => [d.kind === 'overdue' ? 'قسط معوق' : 'قسط', `<span dir="ltr">${safe(d.ref)}</span>`, safe(d.name), jd(d.dueDate)])], 'یادآوری معلقی وجود ندارد.')}</article>
    <article class="card-box wide"><div class="box-head"><h3>ارسال پیام</h3></div><div class="inline-form wrap-form"><button class="btn btn-outline" data-act="sms-to" data-id="" type="button">پیامک به یک شماره</button>
      <select id="bc-trip" aria-label="سفر">${opt(trips, '', 'id', 'title')}</select><input id="bc-text" maxlength="300" placeholder="متن پیام برای مسافران تأییدشدهٔ این سفر" aria-label="متن"><button class="btn btn-primary" data-act="sms-bc" type="button">ارسال گروهی</button></div></article>
    <article class="card-box wide"><div class="box-head"><h3>قالب پیام‌ها</h3></div><p class="hint">متغیرها: ${tp.vars.map(v => `<code dir="ltr">{${v}}</code>`).join(' ')}</p>${tp.templates.map(t => `<form class="tpl" data-key="${t.key}"><b>${safe(t.title)}</b><textarea name="body" rows="2" maxlength="400" aria-label="${safe(t.title)}">${safe(t.body)}</textarea><div class="row-actions"><label class="check-row"><input type="checkbox" name="enabled" ${t.enabled ? 'checked' : ''}> فعال</label><button class="table-action" type="submit">ذخیره</button></div></form>`).join('')}</article>
    <article class="card-box wide"><div class="box-head"><h3>گزارش پیامک‌ها</h3></div>${table(['تاریخ', 'گیرنده', 'متن', 'نوع', 'وضعیت'], lg.log.map(l => [dtm(l.createdAt), `<span dir="ltr">${safe(l.phone)}</span>`, `<span class="wrap">${safe(l.text)}</span>`, safe(l.kind || '—'), l.status === 'ناموفق' ? badge('ناموفق: ' + l.error, 'bad') : safe(l.status)]), 'پیامکی ثبت نشده است.')}</article></div></div>`;
  $('#sms-cfg').addEventListener('submit', guard(async e => {
    e.preventDefault(); const f = e.currentTarget, err = f.querySelector('.form-error'); showErr(err, '');
    try { await O('/config', { method: 'PUT', body: { smsEnabled: f.elements.smsEnabled.checked, agencyName: f.elements.agencyName.value, remindDays: f.elements.remindDays.value, installmentRemindDays: num(f.elements.installmentRemindDays.value) } }); notify('ذخیره شد.'); PAGE.reload(); } catch (ex) { showErr(err, ex.message); }
  }));
  el.querySelectorAll('.tpl').forEach(f => f.addEventListener('submit', guard(async e => { e.preventDefault(); await O('/sms/templates/' + f.dataset.key, { method: 'PUT', body: { body: f.elements.body.value, enabled: f.elements.enabled.checked } }); notify('قالب ذخیره شد.'); })));
  PAGE.reload = () => rSms(el);
}
ACT['sms-to'] = (phone, b) => askForm('ارسال پیامک' + (b?.dataset.name ? ' به ' + b.dataset.name : ''), [{ name: 'phone', label: 'موبایل', max: 20, ltr: true, req: true, def: phone }, { name: 'text', label: 'متن پیام', type: 'textarea', max: 400 }], { phone }, async v => { await O('/sms/send', { method: 'POST', body: v }); notify('پیامک ثبت/ارسال شد.'); PAGE.reload?.(); }, { label: 'ارسال', ctl: D1.el.hidden ? D1 : D2 });
ACT['sms-bc'] = async () => { const t = $('#bc-text').value; if (!t.trim()) return notify('متن پیام را بنویسید.'); if (!confirm('پیام برای همهٔ مسافران تأییدشدهٔ این سفر ارسال شود؟')) return; const r = await O('/sms/broadcast', { method: 'POST', body: { tripId: $('#bc-trip').value, text: t } }); notify(`برای ${fmt(r.sent)} نفر ارسال شد.`); PAGE.reload(); };
ACT['rem-run'] = async () => { const r = await O('/reminders/run', { method: 'POST' }); notify(`ارسال شد: ${fmt(r.departures)} یادآوری حرکت و ${fmt(r.installments)} یادآوری قسط.`); PAGE.reload(); };

/* ==========================================================================
   سیستم
   ========================================================================== */
async function rSystem(el) {
  const i = await O('/system/info'), up = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${fmt(h)} ساعت و ${fmt(m)} دقیقه` : `${fmt(m)} دقیقه`; };
  const cn = i.db.counts, names = { trips: 'سفر', bookings: 'رزرو', customers: 'مشتری', payments: 'پرداخت', agents: 'نماینده', users: 'کاربر', sms: 'پیامک' };
  el.innerHTML = `<div class="panel-heading row"><div><h2>اطلاعات سیستم</h2><p>وضعیت سرور و پایگاه داده، پشتیبان‌گیری و گزارش فعالیت کاربران.</p></div><div class="panel-tools"><a class="btn btn-primary" href="/api/office/system/backup" download>⇩ دانلود پشتیبان دیتابیس</a></div></div>
    <div class="pad"><div class="stats-grid"><article class="stat"><span>نسخه</span><strong dir="ltr">${safe(i.app.version)}</strong><small dir="ltr">Node ${safe(i.app.node)}</small></article><article class="stat"><span>مدت فعالیت سرور</span><strong>${up(i.app.uptime)}</strong><small>${i.app.env === 'production' ? 'حالت نهایی' : 'حالت توسعه'}</small></article>
    <article class="stat"><span>پایگاه داده</span><strong>${i.db.size ? fmt((i.db.size / 1048576).toFixed(1)) + ' MB' : 'ابری'}</strong><small>${i.db.remote ? 'Turso / libSQL' : 'فایل محلی'}</small></article>
    <article class="stat"><span>پیامک / درگاه</span><strong>${i.services.smsProvider === 'log' ? 'آزمایشی' : 'فعال'}</strong><small>درگاه: ${i.services.gateway}${i.services.gatewayReady ? '' : ' (غیرفعال)'}</small></article></div>
    <div class="chips">${Object.entries(cn).map(([k, v]) => `<div class="chip"><span>${names[k]}</span><b>${fmt(v)}</b></div>`).join('')}</div>
    <article class="card-box"><h3>گزارش فعالیت‌ها (۱۰۰ مورد آخر)</h3>${table(['زمان', 'کاربر', 'عملیات', 'جزئیات'], i.audit.map(a => [dtm(a.createdAt), `<span dir="ltr">${safe(a.username)}</span>`, safe(a.action), safe(a.detail)]), 'هنوز فعالیتی ثبت نشده است.')}</article></div>`;
  PAGE.reload = () => rSystem(el);
}
