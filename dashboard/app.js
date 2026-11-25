/* Pre-token Radar page. It recomputes the whole board from the raw snapshot with model.js, checks the
   result against board.json row by row, then renders the cover, the board and the detail view. */
(function () {
  'use strict';
  const DATA = window.RADAR_DATA, R = window.Radar, $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const usd = R.usd, pct = (x, d = 0) => (x * 100).toFixed(d) + '%', x2 = (v) => '×' + v.toFixed(2);

  const t0 = performance.now();
  const res = R.run(DATA.snapshot);
  const mine = R.boardRows(res);
  const ms = Math.round(performance.now() - t0);
  const rows = res.rows, n = rows.length;

  // ---- self-check: every claim on the cover is recomputed here and can fail ----
  const same = mine.filter((r, i) => DATA.board[i] && JSON.stringify(r) === JSON.stringify(DATA.board[i])).length;
  const ledger = Object.values(res.groups).reduce((a, b) => a + b, 0);
  const watchRanked = rows.filter((r) => r.watch).length;
  const ordered = rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied <= rows[i - 1].implied));
  const plans = mine.filter((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600)).length;
  const v = res.value, o = res.odds;
  const checks = [
    [same === DATA.board.length && mine.length === DATA.board.length, `${same}/${DATA.board.length} rows recomputed in this browser = board.json (every field, ${ms} ms)`],
    [ledger === res.total, `${ledger}/${res.total} snapshot protocols in exactly one ledger group`],
    [watchRanked === res.watchTotal, `${watchRanked}/${res.watchTotal} watchlist ranked`],
    [ordered, `ranks 1–${n}, implied value never rises`],
    [plans === n, `${plans}/${n} farm plans costed and timed`],
    [v.final[0] < v.flat[0] && v.final[1] < v.flat[1], `multiple beats a flat multiple on both blind tests`],
    [o.final[0] < o.flat[0] && o.final[1] < o.flat[1], `token odds beat the base rate on both blind tests`],
    [v.cover >= R.P.target, `80% range holds ${pct(v.cover)} of ${v.nTest} newer tokens (walk-forward split)`],
  ];
  $('checks').innerHTML = checks.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}"><b>${ok ? '✓' : '✗'}</b>${esc(t)}</li>`).join('');

  $('meta').textContent = `snapshot ${res.asOf} · ${res.total} protocols · watchlist floor ${usd(res.floor)} · DefiLlama, sealed`;
  $('headline').textContent = `${n} protocols with no token on record, ranked by what a launch would be worth to you`;
  $('formula').innerHTML = `<b>implied value = TVL × launch multiple × 12-month token odds</b>. The multiple is a median fit on the ${v.nPeers} protocols whose token trades, one row per ticker with the family's TVL summed; the odds on the record of ${o.n} protocols: which ones carry a token at which no-token age. Every term stays only if leaving it out worsens <i>both</i> blind tests. A model's claim from the snapshot, not a forecast.`;

  const ranked = rows.reduce((s, r) => s + r.value, 0);
  const farmN = rows.filter((r) => r.plan.verdict === 'FARM').length;
  const kpi = (k, val, sub) => `<div class="kpi"><span>${k}</span><b>${val}</b><em>${sub}</em></div>`;
  $('kpis').innerHTML = [
    kpi('Watchlist covered', `${watchRanked} / ${res.watchTotal}`, `+${n - watchRanked} below the floor`),
    kpi('Multiple, median blind miss', `${x2(v.median.wf)}`, `walk-forward · leave-one-out ${x2(v.median.loo)}`),
    kpi('Multiple, mean blind miss', x2(v.final[1]), `walk-forward · leave-one-out ${x2(v.final[0])} · flat ${x2(v.flat[1])}`),
    kpi('80% range, newer tokens', pct(v.cover), `of ${v.nTest} newer tokens inside`),
    kpi('Odds log loss', o.final[1].toFixed(3), `walk-forward · base rate ${o.flat[1].toFixed(3)}`),
    kpi('FARM at $10k', `${farmN}`, `net ≥ $${R.P.farmRate}/h after gas + risk · ${usd(ranked)} implied in all`),
  ].join('');

  // ---- evidence cards ----
  const termName = { size: 'Size curve, ln TVL', growth: '7-day TVL growth', age: 'Years listed', chains: 'Chains deployed (log)', family: 'Category family', clock: `No-token clock (${o.shape} age)` };
  const tbl = (t, fmt, heads) => `<table class="mini"><tr><th>Term</th><th>${heads[0]}<small>with / without</small></th><th>${heads[1]}<small>with / without</small></th><th></th></tr>${t.map((r) => `<tr><td>${termName[r.term]}</td><td>${fmt(r.with[0])} / ${fmt(r.without[0])}</td><td>${fmt(r.with[1])} / ${fmt(r.without[1])}</td><td class="${r.kept ? 'kept' : 'drop'}">${r.kept ? 'kept' : 'dropped'}</td></tr>`).join('')}</table>`;
  $('card-value').innerHTML = `<h2>Launch multiple: terms that survive two blind tests</h2>
    ${tbl(v.table, x2, ['Leave-one-out', 'Walk-forward'])}
    <p class="note">Fit: median regression (least absolute miss), since the misses are heavy-tailed. Families: ${v.merged.length} traded tokens priced against their family's TVL (${v.merged.slice(0, 3).map((m) => `${esc(m.name)} ${usd(m.own)}→${usd(m.fam)}`).join(', ')}). Miss = geometric-mean factor between fitted and real market cap on peers the fit never saw. Leave-one-out refits ${v.nPeers} times; walk-forward fits the older-listed 60% and prices the ${v.nTest} listed from ${v.cutDate}. Flat multiple: ${x2(v.flat[0])} / ${x2(v.flat[1])}. Kept: ${v.kept.join(', ') || 'none'}.</p>
    ${scatter()}`;
  $('card-odds').innerHTML = `<h2>Token odds: the no-token clock</h2>
    ${tbl(o.table, (x) => x.toFixed(3), ['10-fold log loss', 'Walk-forward'])}
    <p class="note">Clock shape picked blind: ${o.shapes.map((s) => `${s.k} ${s.s[0].toFixed(3)}/${s.s[1].toFixed(3)}`).join(' · ')}. Base rate (no terms) ${o.flat[0].toFixed(3)}/${o.flat[1].toFixed(3)}. ${pct(o.base)} of the ${o.n} dated protocols carry a token; odds = (p(age+1) − p(age)) / (1 − p(age)).</p>
    ${curve()}`;
  const G = [['watch', 'Watchlist, ranked', '--violet'], ['radar', 'Below floor, ranked', '--amber'], ['traded', 'Token trades: anchors', '--teal'],
    ['tokenNoCap', 'Token on record, no cap', '--slate'], ['parent', 'Above floor, off list: product of a traded parent', '--rose'], ['setAside', 'Bridge, staking, CEX, wrapped, versioned', '--dim']];
  $('card-ledger').innerHTML = `<h2>Ledger: every snapshot protocol, once</h2>
    <div class="stack">${G.map(([k, , c]) => `<i style="flex:${res.groups[k] || 0};background:var(${c})"></i>`).join('')}</div>
    <ul class="legend">${G.map(([k, t, c]) => `<li><i style="background:var(${c})"></i>${t}<b>${res.groups[k] || 0}</b></li>`).join('')}<li class="sum">Total<b>${ledger} / ${res.total}</b></li></ul>
    <h3>Is the printed range honest?</h3>
    <p class="big">${pct(v.cover)} <small>of ${v.nTest} newer tokens land inside the 80% range a fit on the older ones printed (split-conformal, ×÷${Math.exp(v.q).toFixed(1)} on the full fit). Newer tokens miss more than older ones, so the 80% band takes the ${Math.round(v.bandLevel * 100)}th-percentile miss; the level is read off this table, so this split checks it rather than tests it blind. ${pct(v.within2)} of peers land within 2× leave-one-out.</small></p>
    <table class="mini"><tr><th>Miss quantile used</th>${v.coverCurve.map((c) => `<th>${Math.round(c.l * 100)}th</th>`).join('')}</tr><tr><td>Newer tokens inside</td>${v.coverCurve.map((c) => `<td class="${c.l === v.bandLevel ? 'kept' : ''}">${pct(c.c)}</td>`).join('')}</tr></table>`;

  function scatter() {
    const P = res.peers, W = 300, H = 120, lx = (t) => Math.log10(t), xs = P.map((p) => lx(p.famTvl)), ys = P.map((p) => lx(p.mcap));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sx = (x) => 6 + ((x - x0) / (x1 - x0)) * (W - 12), sy = (y) => H - 6 - ((y - y0) / (y1 - y0)) * (H - 12);
    const dots = P.map((p, i) => `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(ys[i]).toFixed(1)}" r="2" class="pd"/>`).join('');
    const fit = P.map((p, i) => [sx(xs[i]), sy(lx(p.famTvl * p.fit))]).sort((a, b) => a[0] - b[0]);
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Market cap against TVL for traded peers">${dots}<polyline points="${fit.map((q) => q.map((z) => z.toFixed(1)).join(',')).join(' ')}" class="fl"/></svg><p class="cap">Traded tokens: market cap vs family TVL (log). Line: fitted launch value.</p>`;
  }
  function curve() {
    const C = o.curve, W = 300, H = 110, top = Math.max(...C.map((c) => c.h)) * 1.15;
    const sx = (a) => 24 + (a / 5) * (W - 34), sy = (h) => H - 18 - (h / top) * (H - 28);
    const pts = C.map((c) => `${sx(c.a).toFixed(1)},${sy(c.h).toFixed(1)}`).join(' ');
    const labels = C.filter((c) => c.a % 1 === 0).map((c) => `<text x="${sx(c.a)}" y="${H - 4}">${c.a}y</text><text x="${sx(c.a)}" y="${sy(c.h) - 6}" class="v">${pct(c.h)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="12-month token odds by no-token age">${labels}<polyline points="${pts}" class="fl"/></svg><p class="cap">12-month odds by no-token age, a median-size protocol with flat TVL.</p>`;
  }

  // ---- board ----
  const state = { sort: 'rank', dir: 1, sel: rows[0] && rows[0].slug, dep: 10000, tab: 'radar' };
  const cats = [...new Set(rows.map((r) => r.category || 'Uncategorised'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('cat').innerHTML = '<option value="">All</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  $('chain').innerHTML = '<option value="">All</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
  const plan = (r) => (state.dep === R.P.deposit ? r.plan : R.farm(r, state.dep));
  const COLS = [
    ['rank', '#', (r) => r.rank], ['name', 'Protocol', (r) => r.name.toLowerCase()], ['tvl', 'TVL', (r) => r.tvl],
    ['change', '7d', (r) => r.change ?? 0], ['age', 'No token for', (r) => r.age], ['odds', 'Odds 12m', (r) => r.odds],
    ['launch', 'Launch value', (r) => r.launch], ['value', 'Implied value · 80% range', (r) => r.value], ['rate', 'Verdict · net $/h', (r) => plan(r).rate],
  ];

  function filtered() {
    const q = $('q').value.trim().toLowerCase(), cat = $('cat').value, ch = $('chain').value, vd = $('verdict').value, w = $('watch').checked;
    const key = COLS.find((c) => c[0] === state.sort)[2];
    return rows.filter((r) => (!q || `${r.name} ${r.category} ${r.chains.join(' ')}`.toLowerCase().includes(q)) && (!cat || (r.category || 'Uncategorised') === cat)
      && (!ch || r.chains.includes(ch)) && (!vd || plan(r).verdict === vd) && (!w || r.watch))
      .sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * state.dir; });
  }

  // Range bars share one log scale, from the board's lowest low to its highest high.
  const lo0 = Math.log10(Math.min(...rows.map((r) => r.lo))), hi0 = Math.log10(Math.max(...rows.map((r) => r.hi)));
  const bar = (r) => { const s = (x) => ((Math.log10(x) - lo0) / (hi0 - lo0)) * 100; return `<span class="rng"><i style="left:${s(r.lo).toFixed(1)}%;width:${(s(r.hi) - s(r.lo)).toFixed(1)}%"></i><b style="left:${s(r.value).toFixed(1)}%"></b></span>`; };

  function renderTable() {
    if (state.tab === 'peers') return renderPeers();
    const list = filtered();
    $('count').textContent = `${list.length} of ${n} shown · * no listing date: median age`;
    $('table').innerHTML = `<thead><tr>${COLS.map(([k, t]) => `<th data-k="${k}" class="${state.sort === k ? (state.dir > 0 ? 'asc' : 'desc') : ''}">${t}</th>`).join('')}</tr></thead><tbody>${list.map((r) => {
      const p = plan(r);
      return `<tr data-s="${r.slug}" class="${r.slug === state.sel ? 'sel' : ''}"><td class="num">${r.rank}</td>
        <td><b>${esc(r.name)}</b>${r.watch ? '<span class="tag w">WATCH</span>' : ''}<br><small>${esc(r.category || 'Uncategorised')} · ${esc(r.chains.slice(0, 2).join(', '))}${r.chains.length > 2 ? ' +' + (r.chains.length - 2) : ''}</small></td>
        <td class="num">${usd(r.tvl)}</td><td class="num ${(r.change ?? 0) >= 0 ? 'up' : 'down'}">${(r.change ?? 0) >= 0 ? '+' : ''}${(r.change ?? 0).toFixed(1)}%</td>
        <td class="num">${r.age.toFixed(1)}y${r.ageKnown ? '' : '*'}</td><td class="num">${pct(r.odds)}</td><td class="num">${usd(r.launch)}</td>
        <td class="val">${bar(r)}<b>${usd(r.value)}</b><small>${usd(r.lo)}–${usd(r.hi)}</small></td>
        <td><span class="pill ${p.verdict}">${p.verdict}</span> <small class="${p.rate >= 0 ? 'up' : 'down'}">${p.rate >= 0 ? '+' : '−'}$${Math.abs(p.rate).toFixed(1)}/h</small></td></tr>`;
    }).join('')}</tbody>`;
    renderDetail();
  }

  function renderPeers() {
    const P = [...res.peers].sort((a, b) => b.mcap - a.mcap);
    $('count').textContent = `${P.length} protocols whose token trades: the anchors of the multiple`;
    $('table').innerHTML = `<thead><tr><th>Protocol</th><th>Family TVL</th><th>Market cap</th><th>Real multiple</th><th>Fitted</th><th>Miss</th></tr></thead><tbody>${P.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${usd(p.famTvl)}</td><td class="num">${usd(p.mcap)}</td><td class="num">${x2(p.mult)}</td><td class="num">${x2(p.fit)}</td><td class="num">${x2(Math.exp(Math.abs(Math.log(p.mult / p.fit))))}</td></tr>`).join('')}</tbody>`;
    $('detail').innerHTML = `<h2>Why anchors</h2><p class="note">A token that trades gives a market cap for its TVL. These ${P.length} are the only rows the multiple is fitted on; none of them is ranked on the board, which holds protocols with no token on record.</p>`;
  }

  function renderDetail() {
    const r = rows.find((x) => x.slug === state.sel);
    if (!r) { $('detail').innerHTML = '<p class="note">Pick a row.</p>'; return; }
    const p = plan(r), st = state.dep === R.P.deposit ? r.steps : R.steps(r, p);
    const sizeBeta = r.parts.find((q) => q.term === 'size');
    $('detail').innerHTML = `<p class="kicker">Rank ${r.rank} of ${n} · ${r.watch ? 'on the watchlist' : 'below the floor, found by the radar'}</p>
      <h2>${esc(r.name)}</h2>
      <p class="chips"><span>${esc(r.category || 'Uncategorised')}</span>${r.chains.slice(0, 5).map((c) => `<span>${esc(c)}</span>`).join('')}<span class="none">no token on record</span></p>
      <h3>How the implied value is built</h3>
      <table class="build">
        <tr><td>TVL today</td><td>${usd(r.tvl)}</td></tr>
        <tr><td>× launch multiple <small>${sizeBeta ? 'size curve from ' + v.nPeers + ' traded peers' : 'flat peer multiple'}</small></td><td>${x2(r.mult)}</td></tr>
        <tr class="sub"><td>= launch value if a token listed</td><td>${usd(r.launch)}</td></tr>
        <tr><td>× 12-month token odds <small>no-token age ${r.age.toFixed(1)}y${r.ageKnown ? '' : ' (date missing: median)'}, 7d ${(r.change ?? 0).toFixed(1)}%</small></td><td>${pct(r.odds, 1)}</td></tr>
        <tr class="tot"><td>= implied value</td><td>${usd(r.value)}</td></tr>
        <tr><td>80% range <small>blind coverage ${pct(v.cover)}</small></td><td>${usd(r.lo)} – ${usd(r.hi)}</td></tr>
      </table>
      <h3>Farm plan at ${usd(p.D)} <span class="pill ${p.verdict}">${p.verdict}</span></h3>
      <div class="econ"><div><span>Expected drop</span><b>${usd(p.expected)}</b></div><div><span>Gas + fees</span><b>${usd(p.gasCost)}</b></div><div><span>Risk cost</span><b>${usd(p.riskCost)}</b></div>
        <div><span>Net</span><b class="${p.net >= 0 ? 'up' : 'down'}">${p.net >= 0 ? '' : '−'}${usd(Math.abs(p.net))}</b></div><div><span>Your time</span><b>${p.hours.toFixed(1)} h</b></div><div><span>Net per hour</span><b class="${p.rate >= 0 ? 'up' : 'down'}">${p.rate >= 0 ? '' : '−'}$${Math.abs(p.rate).toFixed(1)}</b></div></div>
      <p class="be">Break-even deposit <b>${isFinite(p.breakEven) ? usd(p.breakEven) : 'none'}</b> · FARM from <b>${isFinite(p.farmAt) ? usd(p.farmAt) : 'never: risk outweighs the drop'}</b></p>
      <ol class="steps">${st.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  }

  // ---- events and deep links (#slug=…, #cat=…, #verdict=…, #chain=…, #watch=1, #tab=peers) ----
  $('table').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-k]');
    if (th) { const k = th.dataset.k; state.dir = state.sort === k ? -state.dir : (k === 'name' || k === 'rank' ? 1 : -1); state.sort = k; return renderTable(); }
    const tr = e.target.closest('tr[data-s]');
    if (tr) { state.sel = tr.dataset.s; renderTable(); }
  });
  ['q', 'cat', 'chain', 'verdict', 'watch'].forEach((id) => $(id).addEventListener('input', renderTable));
  $('dep').addEventListener('change', () => { state.dep = +$('dep').value; renderTable(); });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
    $('filters').classList.toggle('off', state.tab !== 'radar');
    renderTable();
  }));

  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('cat')) $('cat').value = h.get('cat');
  if (h.get('chain')) $('chain').value = h.get('chain');
  if (h.get('verdict')) $('verdict').value = h.get('verdict');
  if (h.get('watch')) $('watch').checked = true;
  if (h.get('sort')) { state.sort = h.get('sort'); state.dir = h.get('dir') === 'asc' ? 1 : -1; }
  if (h.get('slug')) state.sel = h.get('slug');
  if (h.get('cat') || h.get('verdict') || h.get('chain')) { const f = filtered(); if (f.length && !h.get('slug')) state.sel = f[0].slug; }
  renderTable();
  $('foot').textContent = `Built from DefiLlama's sealed snapshot of ${res.asOf} (${res.total} protocols). Assumptions, stated once: ${pct(R.P.userShare)} of a launch's supply goes to users who supplied TVL, shared by TVL; risk cost ${pct(R.P.riskYear, 1)} of the deposit a year (twice below the $50M floor); a deposit earns about what idle USDC would, so only the drop, gas and risk are counted. A protocol "records no token" here; it may still have one DefiLlama does not carry. Not financial advice.`;
  // #view=board: the board view, with the self-check strip kept on top.
  if (h.get('view') === 'board') document.body.classList.add('focus');
})();
