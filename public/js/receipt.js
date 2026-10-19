/* رسید پرداخت قابل چاپ — فقط با کد رزرو و موبایل مشتری باز می‌شود */
const root = document.getElementById('receipt-root'), q = new URLSearchParams(location.search);
(async () => {
  try {
    const r = await api(`/api/receipt?ref=${encodeURIComponent(q.get('ref') || '')}&phone=${encodeURIComponent(q.get('phone') || '')}`), b = r.booking;
    root.innerHTML = `<h1>${safe(r.agency)} — رسید پرداخت</h1>
      <dl><dt>کد رزرو</dt><dd dir="ltr">${safe(b.ref)}</dd><dt>مشتری</dt><dd>${safe(b.name)}</dd><dt>سفر</dt><dd>${safe(b.tripTitle)}</dd><dt>تاریخ حرکت</dt><dd>${dateFmt(b.date)}</dd><dt>تعداد نفرات</dt><dd>${fmt(b.count)}</dd><dt>مبلغ کل</dt><dd>${fmt(b.total + b.surcharge)} تومان</dd></dl>
      <table class="resp-table"><thead><tr><th>رسید</th><th>تاریخ</th><th>روش</th><th>مبلغ (تومان)</th></tr></thead><tbody>${r.payments.map(p => `<tr><td data-label="رسید" dir="ltr">${safe(p.receiptNo || '')}</td><td data-label="تاریخ">${JDate.fmtDateTime(p.paidAt)}</td><td data-label="روش">${safe(p.methodName)}</td><td data-label="مبلغ">${fmt(p.amount)}</td></tr>`).join('') || '<tr><td colspan="4">پرداختی ثبت نشده است.</td></tr>'}</tbody></table>
      <dl><dt>جمع پرداخت‌شده</dt><dd>${fmt(r.paid)} تومان</dd><dt>مانده</dt><dd>${fmt(r.balance)} تومان</dd><dt>وضعیت رزرو</dt><dd>${safe(b.status)}</dd></dl>
      <p class="muted">${safe(r.note)}</p><div class="btn-row"><button class="btn btn-primary" id="print" type="button">چاپ رسید</button><a class="btn btn-outline" href="index.html">بازگشت به سایت</a></div>`;
    document.getElementById('print').onclick = () => print();
  } catch (e) { root.innerHTML = `<p class="form-error">${safe(e.message)}</p><a class="btn btn-outline" href="index.html">بازگشت به سایت</a>`; }
})();
