/* تقویم شمسی: تبدیل تاریخ، قالب‌بندی فارسی و انتخاب‌گر تاریخ (بدون وابستگی) */
(function () {
  const div = (a, b) => ~~(a / b), mod = (a, b) => a - ~~(a / b) * b;
  const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy) {
    const gy = jy + 621; let leapJ = -14, jp = BREAKS[0], jm, jump = 0;
    for (let i = 1; i < BREAKS.length; i++) {
      jm = BREAKS[i]; jump = jm - jp;
      if (jy < jm) break;
      leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
    }
    let n = jy - jp;
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150, march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
    return { leap, gy, march };
  }
  const g2d = (gy, gm, gd) => div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408 - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  function d2g(jdn) {
    let j = 4 * jdn + 139361631; j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308, gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1;
    return { gy: div(j, 1461) - 100100 + div(8 - gm, 6), gm, gd };
  }
  const j2d = (jy, jm, jd) => { const r = jalCal(jy); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; };
  function d2j(jdn) {
    let jy = d2g(jdn).gy - 621, r = jalCal(jy), k = jdn - g2d(jy + 621, 3, r.march), jm, jd;
    if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186; }
    else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
    jm = 7 + div(k, 30); jd = mod(k, 30) + 1; return { jy, jm, jd };
  }
  const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd));
  const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd));
  const isLeap = jy => jalCal(jy).leap === 0;
  const monthLen = (jy, jm) => jm <= 6 ? 31 : jm <= 11 ? 30 : (isLeap(jy) ? 30 : 29);

  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const WEEK = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const pad = n => String(n).padStart(2, '0');
  const fa = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const en = s => String(s ?? '').replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x6f0).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660);

  const parseISO = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? [+m[1], +m[2], +m[3]] : null; };
  const isoToJ = iso => { const p = parseISO(iso); return p ? toJalali(...p) : null; };
  const jToISO = (jy, jm, jd) => { const g = toGregorian(jy, jm, jd); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; };
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  /* ۱۴۰۵/۰۸/۰۷ */
  const fmtNumeric = iso => { const j = isoToJ(iso); return j ? fa(`${j.jy}/${pad(j.jm)}/${pad(j.jd)}`) : ''; };
  /* ۷ آبان ۱۴۰۵ */
  const fmtLong = iso => { const j = isoToJ(iso); return j ? fa(`${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}`) : ''; };
  /* برای زمان‌های UTC ذخیره‌شده در پایگاه داده (۷ آبان ۱۴۰۵ — ۱۴:۳۰) */
  function fmtDateTime(utc) {
    if (!utc) return '—';
    const d = new Date(utc); if (isNaN(d)) return '—';
    /* همیشه به وقت تهران نمایش داده می‌شود */
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
    return `${fmtLong(`${p.year}-${p.month}-${p.day}`)} — ${fa(p.hour + ':' + p.minute)}`;
  }
  /* ورودی شمسی تایپ‌شده (۱۴۰۵/۰۸/۰۷) به تاریخ میلادی ISO */
  function parseJalaliText(txt) {
    const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(en(txt).trim()); if (!m) return null;
    const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
    if (jy < 1300 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > monthLen(jy, jm)) return null;
    return jToISO(jy, jm, jd);
  }

  /* ───────── انتخاب‌گر تاریخ ───────── */
  let pop, backdrop, active = null, view = null;

  function ensurePop() {
    if (pop) return;
    backdrop = document.createElement('div'); backdrop.className = 'jd-backdrop'; backdrop.hidden = true;
    pop = document.createElement('div'); pop.className = 'jd-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'انتخاب تاریخ شمسی');
    document.body.append(backdrop, pop);
    backdrop.addEventListener('click', closePop);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) { const t = active.text; closePop(); t.focus(); } });
    document.addEventListener('mousedown', e => { if (active && !pop.contains(e.target) && !active.wrap.contains(e.target)) closePop(); });
    addEventListener('resize', () => active && place());
    addEventListener('scroll', () => active && window.innerWidth > 600 && place(), true);
  }

  function place() {
    if (innerWidth <= 600) { pop.style.cssText = ''; return; }
    const r = active.text.getBoundingClientRect(), w = pop.offsetWidth || 300, h = pop.offsetHeight || 340;
    let left = r.right - w; if (left < 8) left = 8; if (left + w > innerWidth - 8) left = innerWidth - w - 8;
    let top = r.bottom + 6; if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }

  function draw() {
    const { jy, jm } = view, sel = active.input.value, today = todayISO();
    const first = j2d(jy, jm, 1), offset = mod(first + 2, 7), len = monthLen(jy, jm);
    const minISO = active.min === 'today' ? today : (active.min || '');
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span class="jd-empty"></span>';
    for (let d = 1; d <= len; d++) {
      const iso = jToISO(jy, jm, d), dis = minISO && iso < minISO;
      cells += `<button type="button" class="jd-day${iso === sel ? ' sel' : ''}${iso === today ? ' today' : ''}" data-iso="${iso}"${dis ? ' disabled' : ''} aria-label="${fmtLong(iso)}">${fa(d)}</button>`;
    }
    pop.innerHTML = `<div class="jd-head"><button type="button" class="jd-nav" data-nav="-1" aria-label="ماه قبل">›</button>
      <div class="jd-title"><select class="jd-month" aria-label="ماه">${MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === jm ? ' selected' : ''}>${m}</option>`).join('')}</select>
      <select class="jd-year" aria-label="سال">${Array.from({ length: 13 }, (_, i) => jy - 4 + i).map(y => `<option value="${y}"${y === jy ? ' selected' : ''}>${fa(y)}</option>`).join('')}</select></div>
      <button type="button" class="jd-nav" data-nav="1" aria-label="ماه بعد">‹</button></div>
      <div class="jd-week">${WEEK.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="jd-grid">${cells}</div>
      <div class="jd-foot"><button type="button" class="jd-link" data-act="today">امروز</button><button type="button" class="jd-link" data-act="clear">پاک کردن</button><button type="button" class="jd-link close" data-act="close">بستن</button></div>`;
    place();
  }

  document.addEventListener('click', e => {
    if (!pop || pop.hidden) return;
    const b = e.target.closest('button'); if (!b || !pop.contains(b)) return;
    if (b.dataset.nav) { let { jy, jm } = view; jm += Number(b.dataset.nav); if (jm > 12) { jm = 1; jy++; } if (jm < 1) { jm = 12; jy--; } view = { jy, jm }; draw(); return; }
    if (b.dataset.iso) { setValue(active.input, b.dataset.iso, true); closePop(); return; }
    if (b.dataset.act === 'today') { const t = todayISO(), min = active.min === 'today' ? t : active.min; setValue(active.input, !min || t >= min ? t : min, true); closePop(); }
    if (b.dataset.act === 'clear') { setValue(active.input, '', true); closePop(); }
    if (b.dataset.act === 'close') closePop();
  });
  document.addEventListener('change', e => {
    if (!pop || pop.hidden || !pop.contains(e.target)) return;
    if (e.target.classList.contains('jd-month')) view.jm = +e.target.value;
    if (e.target.classList.contains('jd-year')) view.jy = +e.target.value;
    draw(); pop.querySelector(e.target.className.split(' ')[0] === 'jd-month' ? '.jd-month' : '.jd-year').focus();
  });

  function openPop(rec) {
    ensurePop(); active = rec;
    const j = isoToJ(rec.input.value) || isoToJ(todayISO());
    view = { jy: j.jy, jm: j.jm };
    pop.hidden = false; backdrop.hidden = innerWidth > 600; if (innerWidth <= 600) { backdrop.hidden = false; document.body.classList.add('jd-lock'); }
    rec.text.setAttribute('aria-expanded', 'true'); draw();
  }
  function closePop() {
    if (!pop || pop.hidden) return;
    pop.hidden = true; backdrop.hidden = true; document.body.classList.remove('jd-lock');
    active?.text.setAttribute('aria-expanded', 'false'); active = null;
  }

  const records = new WeakMap();
  function setValue(input, iso, fire) {
    const rec = records.get(input); input.value = iso || '';
    if (rec) { rec.text.value = iso ? fmtNumeric(iso) : ''; rec.text.classList.remove('invalid'); }
    if (fire) { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  /* هر input با data-jdate به یک فیلد شمسی تبدیل می‌شود؛ مقدار واقعی (میلادی ISO) در input اصلی می‌ماند */
  function init(root = document) {
    root.querySelectorAll('input[data-jdate]').forEach(input => {
      if (records.has(input)) return;
      const wrap = document.createElement('span'); wrap.className = 'jd-wrap';
      const text = document.createElement('input');
      text.type = 'text'; text.className = input.className; text.inputMode = 'numeric'; text.autocomplete = 'off'; text.dir = 'ltr';
      text.placeholder = input.placeholder || '۱۴۰۵/۰۱/۰۱'; text.setAttribute('aria-haspopup', 'dialog'); text.setAttribute('aria-expanded', 'false');
      if (input.id) { text.id = input.id + '-view'; }
      if (input.required) text.required = true;
      input.type = 'hidden';
      input.parentNode.insertBefore(wrap, input); wrap.append(text, input);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'jd-icon'; btn.setAttribute('aria-label', 'باز کردن تقویم'); btn.textContent = '▦'; wrap.append(btn);
      const rec = { input, text, wrap, min: input.dataset.min || '' };
      records.set(input, rec);
      text.addEventListener('focus', () => openPop(rec));
      text.addEventListener('click', () => active !== rec && openPop(rec));
      btn.addEventListener('click', () => (active === rec ? closePop() : (text.focus(), openPop(rec))));
      text.addEventListener('input', () => {
        const v = text.value.trim();
        if (!v) { input.value = ''; text.classList.remove('invalid'); input.dispatchEvent(new Event('change', { bubbles: true })); return; }
        const iso = parseJalaliText(v);
        if (iso && (!rec.min || iso >= (rec.min === 'today' ? todayISO() : rec.min))) { input.value = iso; text.classList.remove('invalid'); input.dispatchEvent(new Event('change', { bubbles: true })); if (active === rec) { const j = isoToJ(iso); view = { jy: j.jy, jm: j.jm }; draw(); } }
        else { input.value = ''; text.classList.add('invalid'); }
      });
      text.addEventListener('blur', () => { if (input.value) text.value = fmtNumeric(input.value); });
      text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closePop(); } });
      if (input.form) input.form.addEventListener('reset', () => setTimeout(() => setValue(input, '', false), 0));
      setValue(input, input.value, false);
    });
  }

  window.JDate = { toJalali, toGregorian, monthLen, MONTHS, fa, en, fmtLong, fmtNumeric, fmtDateTime, parseJalaliText, init, setValue, todayISO };
})();
