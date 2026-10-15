/* Biodefense Budget — interface script. Loads data/programs.json, then builds the charts and the program table. */
(function () {
  'use strict';
  const META = JSON.parse(document.getElementById('meta-data').textContent);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Y = { a: '2024A', e: '2025E', r: '2026R' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (html) e.innerHTML = html; return e; };
  const money = (v, d = 1) => v == null ? '—' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + 'M';
  const big = v => v == null ? '—' : Math.abs(v) >= 1000 ? '$' + (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'B' : '$' + v.toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'M';
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function change(a, b) { // from a to b
    if (a == null && b == null) return { html: '<span class="chg none">—</span>' };
    const from = a || 0, to = b || 0, d = to - from;
    if (!from && !to) return { html: '<span class="chg none">—</span>' };
    const pct = from ? (d / from) * 100 : null;
    const cls = d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : 'flat';
    const sign = d > 0 ? '+' : d < 0 ? '−' : '';
    const txt = `${sign}${money(Math.abs(d))}` + (pct != null && from ? ` (${sign}${Math.abs(pct).toFixed(pct >= 100 ? 0 : 1)}%)` : to && !from ? ' (new)' : !to && from ? ' (to zero)' : '');
    return { html: `<span class="chg ${cls}">${txt}</span>`, d, cls };
  }

  /* nav */
  (function nav() {
    const nav = document.getElementById('nav'), toggle = document.getElementById('nav-toggle');
    const links = [...document.querySelectorAll('.nav-link')];
    toggle.addEventListener('click', () => { const open = nav.classList.toggle('menu-open'); toggle.setAttribute('aria-expanded', String(open)); });
    links.forEach(l => l.addEventListener('click', () => { nav.classList.remove('menu-open'); toggle.setAttribute('aria-expanded', 'false'); }));
    const targets = links.map(l => document.getElementById(l.dataset.target)).filter(Boolean);
    const onScroll = () => { nav.classList.toggle('scrolled', window.scrollY > 20); const probe = window.scrollY + 120; let active = null; targets.forEach(t => { if (t.offsetTop <= probe) active = t.id; }); links.forEach(l => { if (l.dataset.target === active) l.setAttribute('aria-current', 'true'); else l.removeAttribute('aria-current'); }); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  })();

  fetch('data/programs.json?v=' + encodeURIComponent(META.converted)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(init).catch(err => {
    document.querySelectorAll('.needs-data').forEach(n => { n.innerHTML = `<p class="note"><strong>The program data could not be loaded</strong> (${esc(err.message)}). If this page was opened from a local file, serve the folder instead: <code>python3 -m http.server</code>.</p>`; });
  });

  function init(ALL) {
    ALL.forEach(r => { r.id = slug(r.dept + '-' + r.program); r.active = !!(r.years[Y.a] || r.years[Y.e] || r.years[Y.r]); });
    const q = document.getElementById('f-q'), dept = document.getElementById('f-dept'), cat = document.getElementById('f-cat'), all = document.getElementById('f-all'), sortSel = document.getElementById('f-sort');
    META.departments.forEach(d => dept.appendChild(el('option', { value: d }, esc(d))));
    META.categories.forEach(c => cat.appendChild(el('option', { value: c }, esc(c))));
    const DEPT_NAMES = { HHS: 'Health and Human Services', DoD: 'Defense', USDA: 'Agriculture', DHS: 'Homeland Security', State: 'State (incl. USAID)', EPA: 'Environmental Protection Agency', DOE: 'Energy', Commerce: 'Commerce', NSF: 'National Science Foundation', VA: 'Veterans Affairs' };

    let state = { q: '', dept: 'ALL', cat: 'ALL', all: false, sort: '2026R:desc', page: 1 };
    const PAGE = 50;
    let rows = [];

    function readHash() {
      const p = new URLSearchParams(location.hash.replace(/^#/, ''));
      state = { q: p.get('q') || '', dept: p.get('dept') || 'ALL', cat: p.get('cat') || 'ALL', all: p.get('all') === '1', sort: p.get('sort') || '2026R:desc', page: +(p.get('page') || 1) || 1 };
      q.value = state.q; dept.value = [...dept.options].some(o => o.value === state.dept) ? state.dept : 'ALL'; cat.value = [...cat.options].some(o => o.value === state.cat) ? state.cat : 'ALL'; all.checked = state.all; sortSel.value = [...sortSel.options].some(o => o.value === state.sort) ? state.sort : '2026R:desc';
      state.dept = dept.value; state.cat = cat.value; state.sort = sortSel.value;
    }
    function writeHash() {
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q); if (state.dept !== 'ALL') p.set('dept', state.dept); if (state.cat !== 'ALL') p.set('cat', state.cat); if (state.all) p.set('all', '1'); if (state.sort !== '2026R:desc') p.set('sort', state.sort); if (state.page > 1) p.set('page', String(state.page));
      const h = p.toString(); history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
    }

    function apply() {
      const s = state.q.toLowerCase().trim();
      rows = ALL.filter(r => (state.all || r.active) && (state.dept === 'ALL' || r.dept === state.dept) && (state.cat === 'ALL' || r.category === state.cat) &&
        (!s || r.program.toLowerCase().includes(s) || r.unit.toLowerCase().includes(s) || (r.desc || '').toLowerCase().includes(s) || (r.pe || '').toLowerCase().includes(s)));
      const [k, dir] = state.sort.split(':'); const m = dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        let av, bv;
        if (k === 'program') { av = a.program; bv = b.program; } else if (k === 'dept') { av = a.dept + a.unit; bv = b.dept + b.unit; } else if (k === 'category') { av = a.category; bv = b.category; }
        else if (k === 'change') { av = (a.years[Y.r] || 0) - (a.years[Y.e] || 0); bv = (b.years[Y.r] || 0) - (b.years[Y.e] || 0); }
        else { av = a.years[k]; bv = b.years[k]; }
        if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
        return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * m;
      });
      renderSummary(); renderCharts(); renderTable(); writeHash();
    }

    function sum(key, list) { return list.reduce((t, r) => t + (r.years[key] || 0), 0); }
    function renderSummary() {
      const a = sum(Y.a, rows), e = sum(Y.e, rows), r = sum(Y.r, rows);
      document.getElementById('s-count').textContent = rows.length.toLocaleString();
      document.getElementById('s-a').textContent = big(a); document.getElementById('s-e').textContent = big(e); document.getElementById('s-r').textContent = big(r);
      document.getElementById('s-chg').innerHTML = change(e, r).html;
      document.getElementById('s-scope').textContent = (state.dept === 'ALL' && state.cat === 'ALL' && !state.q) ? (state.all ? 'all lines since 2019' : 'lines with funding in 2024–2026') : 'current filter';
    }

    /* charts: horizontal bars by department and by category, for the current filter; totals by year */
    function bars(containerId, groups, keyLabel) {
      const box = document.getElementById(containerId); box.innerHTML = '';
      const max = Math.max(1, ...groups.map(g => Math.max(g.a, g.e, g.r)));
      groups.forEach(g => {
        const row = el('button', { type: 'button', class: 'bar-row', 'aria-label': `${g.name}: FY2026 request ${money(g.r)}, FY2025 enacted ${money(g.e)}, FY2024 actual ${money(g.a)}. Filter by this ${keyLabel}.` });
        row.innerHTML = `<span class="bar-name">${esc(g.label || g.name)}</span>
          <span class="bar-track"><span class="bar ghost" style="width:${(g.a / max) * 100}%" title="FY2024 actual"></span><span class="bar ghost e" style="width:${(g.e / max) * 100}%" title="FY2025 enacted"></span><span class="bar req" style="width:${(g.r / max) * 100}%"></span></span>
          <span class="bar-val">${big(g.r)} <small>${change(g.e, g.r).html}</small></span>`;
        row.addEventListener('click', () => { if (keyLabel === 'department') { dept.value = state.dept === g.name ? 'ALL' : g.name; state.dept = dept.value; } else { cat.value = state.cat === g.name ? 'ALL' : g.name; state.cat = cat.value; } state.page = 1; apply(); });
        if ((keyLabel === 'department' && state.dept === g.name) || (keyLabel === 'category' && state.cat === g.name)) row.classList.add('active');
        box.appendChild(row);
      });
    }
    function renderCharts() {
      const base = ALL.filter(r => (state.all || r.active) && (!state.q || rows.includes(r)));
      const byDept = {}; base.filter(r => state.cat === 'ALL' || r.category === state.cat).forEach(r => { const g = byDept[r.dept] = byDept[r.dept] || { name: r.dept, label: `${r.dept} · ${DEPT_NAMES[r.dept] || ''}`, a: 0, e: 0, r: 0 }; g.a += r.years[Y.a] || 0; g.e += r.years[Y.e] || 0; g.r += r.years[Y.r] || 0; });
      bars('chart-dept', Object.values(byDept).sort((x, y) => y.r - x.r || y.e - x.e), 'department');
      const byCat = {}; base.filter(r => state.dept === 'ALL' || r.dept === state.dept).forEach(r => { const g = byCat[r.category] = byCat[r.category] || { name: r.category, a: 0, e: 0, r: 0 }; g.a += r.years[Y.a] || 0; g.e += r.years[Y.e] || 0; g.r += r.years[Y.r] || 0; });
      bars('chart-cat', Object.values(byCat).sort((x, y) => y.r - x.r || y.e - x.e), 'category');
      // totals by year for the current filter: actuals 2019–2024, enacted 2025, request 2026
      const seq = ['2019A', '2020A', '2021A', '2022A', '2023A', '2024A', '2025E', '2026R'];
      const vals = seq.map(k => ({ k, v: sum(k, rows) }));
      const box = document.getElementById('chart-years'); box.innerHTML = '';
      const mx = Math.max(1, ...vals.map(x => x.v));
      vals.forEach(x => {
        const col = el('div', { class: 'ycol ' + x.k.slice(-1), title: `FY${x.k.slice(0, 4)} ${x.k.endsWith('A') ? 'actual' : x.k.endsWith('E') ? 'enacted' : 'request'}: ${money(x.v)}` });
        col.innerHTML = `<span class="yv">${big(x.v)}</span><span class="ybar" style="height:${Math.max(2, (x.v / mx) * 100)}%"></span><span class="yl">${x.k.slice(2, 4)}<small>${x.k.slice(-1)}</small></span>`;
        box.appendChild(col);
      });
    }

    function renderTable() {
      const pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (state.page > pages) state.page = pages;
      const slice = rows.slice((state.page - 1) * PAGE, state.page * PAGE);
      const body = document.getElementById('t-body'); body.innerHTML = '';
      slice.forEach(r => {
        const ch = change(r.years[Y.e], r.years[Y.r]);
        const tr = el('tr', { id: r.id });
        tr.innerHTML = `<th scope="row"><span class="pname">${esc(r.program)}</span><span class="punit">${esc(r.dept)} · ${esc(r.unit)}${r.pe ? ' · ' + esc(r.pe) : ''}</span>${r.moved ? `<span class="moved" title="${esc(r.moved)}">moved</span>` : ''}${r.desc ? `<button type="button" class="more" aria-expanded="false">About this line</button><div class="desc" hidden>${esc(r.desc)}${r.moved ? `<p class="movednote">${esc(r.moved)}</p>` : ''}</div>` : ''}</th>
          <td class="cat"><span class="pill">${esc(r.category)}</span></td>
          <td class="num">${money(r.years[Y.a])}</td><td class="num">${money(r.years[Y.e])}</td><td class="num req">${money(r.years[Y.r])}</td><td class="num">${ch.html}</td>`;
        const btn = tr.querySelector('.more'); if (btn) btn.addEventListener('click', () => { const d = tr.querySelector('.desc'); const open = d.hidden; d.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Hide' : 'About this line'; });
        body.appendChild(tr);
      });
      document.getElementById('pg-info').textContent = `Page ${state.page} of ${pages} · ${rows.length.toLocaleString()} lines`;
      document.getElementById('pg-prev').disabled = state.page <= 1; document.getElementById('pg-next').disabled = state.page >= pages;
      document.querySelectorAll('#t-head th[data-k]').forEach(th => { const [k, dir] = state.sort.split(':'); if (th.dataset.k === k) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); });
    }

    q.addEventListener('input', () => { state.q = q.value; state.page = 1; apply(); });
    dept.addEventListener('change', () => { state.dept = dept.value; state.page = 1; apply(); });
    cat.addEventListener('change', () => { state.cat = cat.value; state.page = 1; apply(); });
    all.addEventListener('change', () => { state.all = all.checked; state.page = 1; apply(); });
    sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 1; apply(); });
    document.getElementById('f-reset').addEventListener('click', () => { state = { q: '', dept: 'ALL', cat: 'ALL', all: false, sort: '2026R:desc', page: 1 }; q.value = ''; dept.value = 'ALL'; cat.value = 'ALL'; all.checked = false; sortSel.value = state.sort; apply(); });
    document.getElementById('pg-prev').addEventListener('click', () => { state.page--; apply(); document.getElementById('programs').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); });
    document.getElementById('pg-next').addEventListener('click', () => { state.page++; apply(); document.getElementById('programs').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); });
    document.querySelectorAll('#t-head th[data-k] button').forEach(b => b.addEventListener('click', () => { const k = b.parentElement.dataset.k; const [ck, cd] = state.sort.split(':'); const dir = ck === k ? (cd === 'asc' ? 'desc' : 'asc') : (k === 'program' || k === 'dept' || k === 'category' ? 'asc' : 'desc'); state.sort = `${k}:${dir}`; sortSel.value = [...sortSel.options].some(o => o.value === state.sort) ? state.sort : sortSel.value; state.page = 1; apply(); }));
    document.getElementById('f-copy').addEventListener('click', async e => { const url = location.href; try { await navigator.clipboard.writeText(url); e.target.textContent = 'Link copied'; setTimeout(() => e.target.textContent = 'Copy link to this view', 1600); } catch { prompt('Copy this link', url); } });
    document.querySelectorAll('[data-q]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); q.value = a.dataset.q; state = { ...state, q: a.dataset.q, dept: 'ALL', cat: 'ALL', all: true, page: 1 }; dept.value = 'ALL'; cat.value = 'ALL'; all.checked = true; apply(); document.getElementById('programs').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }); }));
    window.addEventListener('hashchange', () => { readHash(); apply(); });
    readHash(); apply();
  }
})();
