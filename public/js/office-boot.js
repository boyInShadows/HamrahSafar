/* پنل عملیات — ورود، زبانه‌ها بر اساس دسترسی، تغییر رمز */
const TABS = [
  { id: 'agent', title: 'پنل من', ok: () => !!ME.isAgent, render: rAgentHome },
  { id: 'overview', title: 'گزارش‌ها', ok: () => can('reports'), render: rReports },
  { id: 'bookings', title: 'رزروها', ok: () => can('bookings', 'payments', 'agent'), render: rBookings },
  { id: 'customers', title: 'مشتریان', ok: () => can('customers', 'agent'), render: rCustomers },
  { id: 'payments', title: 'پرداخت‌ها و اقساط', ok: () => can('payments'), render: rPayments },
  { id: 'accounting', title: 'حسابداری', ok: () => can('accounting'), render: rAccounting },
  { id: 'agents', title: 'نمایندگان', ok: () => can('agents'), render: rAgents },
  { id: 'users', title: 'کاربران و نقش‌ها', ok: () => can('users'), render: rUsers },
  { id: 'catalog', title: 'حمل‌ونقل و پرداخت', ok: () => can('transports', 'paymethods'), render: rCatalog },
  { id: 'sms', title: 'پیامک و یادآوری', ok: () => can('sms'), render: rSms },
  { id: 'system', title: 'سیستم', ok: () => can('system'), render: rSystem }
];
let ACTIVE = [];

function showLogin() { $('#dash-view').hidden = true; $('#login-view').hidden = false; $('#login-form').elements.username.focus(); }
async function openTab(id, push = true) {
  const t = ACTIVE.find(x => x.id === id) || ACTIVE[0]; if (!t) return;
  $$('#tabs button').forEach(b => { const on = b.dataset.tab === t.id; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  PAGE.tab = t.id; PAGE.reload = null;
  const el = $('#panel'); el.innerHTML = '<p class="empty-box">در حال بارگذاری…</p>';
  try { await t.render(el); } catch (e) { if (e.status !== 401) el.innerHTML = `<p class="empty-box form-error">${safe(e.message)}</p>`; }
  if (push) try { history.replaceState(null, '', '#' + t.id); } catch { /* ادامه */ }
}
async function showDash(me) {
  Object.assign(ME, me);
  $('#login-view').hidden = true; $('#dash-view').hidden = false;
  $('#who').textContent = '👤 ' + (me.fullName || me.username);
  $('#to-trips').hidden = !can('trips');
  ACTIVE = TABS.filter(t => t.ok());
  $('#tabs').innerHTML = ACTIVE.map(t => `<button role="tab" type="button" data-tab="${t.id}">${t.title}</button>`).join('');
  if (!ACTIVE.length) { $('#panel').innerHTML = '<p class="empty-box">برای حساب شما بخشی فعال نشده است؛ با مدیر تماس بگیرید.</p>'; return; }
  const h = location.hash.slice(1);
  await openTab(ACTIVE.some(t => t.id === h) ? h : ACTIVE[0].id, false);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });

D1 = modal('#dlg'); D2 = modal('#dlg2');
async function boot() {
  try { await showDash(await api('/api/admin/me')); }
  catch (e) { if (e.network) { $('#login-view').hidden = false; showErr($('#login-error'), e.message); } else showLogin(); }
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.currentTarget, btn = f.querySelector('[type=submit]'); showErr($('#login-error'), ''); btn.disabled = true;
  try { await api('/api/admin/login', { method: 'POST', body: { username: f.elements.username.value, password: f.elements.password.value } }); f.reset(); await showDash(await api('/api/admin/me')); }
  catch (ex) { showErr($('#login-error'), ex.message); }
  btn.disabled = false;
});
$('#logout-btn').onclick = async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ادامه */ } closeAll(); showLogin(); };
$('#pw-btn').onclick = () => askForm('تغییر رمز عبور', [{ name: 'current', label: 'رمز فعلی', type: 'password', ltr: true, auto: 'current-password', req: true }, { name: 'next', label: 'رمز جدید (حداقل ۸ نویسه)', type: 'password', ltr: true, auto: 'new-password', req: true }], null,
  async v => { await call('/api/admin/password', { method: 'POST', body: v }); notify('رمز عبور تغییر کرد.'); }, { ctl: D2, label: 'ذخیره رمز جدید' });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h !== PAGE.tab && ACTIVE.some(t => t.id === h)) openTab(h, false); });
JDate.init();
boot();
