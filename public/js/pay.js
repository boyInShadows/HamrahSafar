/* صفحهٔ درگاه پرداخت: درگاه آزمایشی داخلی (sandbox) و نتیجهٔ بازگشت از درگاه واقعی */
const box = document.getElementById('box'), token = new URLSearchParams(location.search).get('t'), done = new URLSearchParams(location.search).get('done');
const home = '<a class="btn btn-outline" href="index.html">بازگشت به سایت</a>';
function result(ok, ref) {
  box.innerHTML = ok
    ? `<div class="success-box"><div class="success-icon">✓</div><h1>پرداخت با موفقیت انجام شد</h1><p>کد رزرو: <b dir="ltr">${safe(ref || '')}</b></p><p class="muted">رسید پرداخت را از «پیگیری رزرو» ببینید و چاپ کنید.</p>${home}</div>`
    : `<div class="success-box"><div class="success-icon" style="background:#fdecea;color:#b54c3e">!</div><h1>پرداخت انجام نشد</h1><p class="muted">مبلغی از حساب شما کسر نشده یا به‌زودی برگشت می‌خورد. می‌توانید از «پیگیری رزرو» دوباره پرداخت کنید.</p>${home}</div>`;
}
(async () => {
  if (!token) return result(false);
  try {
    const s = await api('/api/pay/session?t=' + encodeURIComponent(token));
    if (done) return result(done === 'ok', s.ref);
    if (s.status !== 'open') return result(s.status === 'paid', s.ref);
    box.innerHTML = `<h1>پرداخت امن</h1><p class="muted">رزرو <b dir="ltr">${safe(s.ref)}</b> — ${safe(s.tripTitle)}</p><div class="pay-amount">${fmt(s.amount)} <small>تومان</small></div>
      ${s.gateway === 'sandbox' ? '<div class="sandbox-note"><b>درگاه آزمایشی:</b> این صفحه شبیه‌ساز درگاه بانکی است و پول واقعی جابه‌جا نمی‌شود. با اتصال درگاه واقعی (زرین‌پال) به‌جای این صفحه به درگاه بانک منتقل می‌شوید.</div>' : ''}
      <div class="pay-actions"><button class="btn btn-primary" id="ok">پرداخت موفق</button><button class="btn btn-outline" id="no">انصراف / ناموفق</button></div><p class="form-error" id="err" role="alert" hidden></p>`;
    for (const [id, ok] of [['ok', true], ['no', false]]) document.getElementById(id).onclick = async () => {
      document.querySelectorAll('button').forEach(b => b.disabled = true);
      try { const r = await api('/api/pay/callback', { method: 'POST', body: { t: token, ok } }); result(r.success, r.ref); }
      catch (e) { const er = document.getElementById('err'); er.textContent = e.message; er.hidden = false; }
    };
  } catch (e) { box.innerHTML = `<p class="form-error">${safe(e.message)}</p>${home}`; }
})();
