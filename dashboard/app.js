/* Pre-token Radar page: board, filters, sorting, detail view. Reads window.RADAR (data.js, written by
 * main.ts from the snapshot) and window.RadarModel (model.js, the model that produced it).
 * State lives in the URL hash, e.g. #cat=RWA&watch=1 or #p=gauntlet, so every view can be linked. */
(function () {
  'use strict';
  var R = window.RADAR, M = window.RadarModel, $ = function (id) { return document.getElementById(id); };
  var usd = M.fmtUsd;
  var state = { tab: 'board', q: '', cat: '', chain: '', trend: '', watch: false, sort: 'rank', dir: 1, p: '' };

  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    state.tab = h.get('tab') || 'board';
    state.q = h.get('q') || ''; state.cat = h.get('cat') || ''; state.chain = h.get('chain') || '';
    state.trend = h.get('trend') || ''; state.watch = h.get('watch') === '1'; state.p = h.get('p') || '';
    state.sort = h.get('sort') || 'rank'; state.dir = h.get('dir') === '-1' ? -1 : 1;
  }
  function writeHash() {
    var h = new URLSearchParams();
    ['tab', 'q', 'cat', 'chain', 'trend', 'p', 'sort'].forEach(function (k) { if (state[k] && !(k === 'tab' && state.tab === 'board') && !(k === 'sort' && state.sort === 'rank')) h.set(k, state[k]); });
    if (state.watch) h.set('watch', '1');
    if (state.dir === -1) h.set('dir', '-1');
    history.replaceState(null, '', '#' + h.toString());
  }

  function pct(x) { return x === null ? '<span class="sub">n/a</span>' : '<span class="' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>'; }
  function age(d) { return d === null ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function header() {
    var total = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var covered = R.rows.filter(function (r) { return r.watchlist; }).length;
    $('meta').textContent = 'snapshot ' + R.as_of + ' · ' + R.protocols + ' protocols · floor ' + usd(R.floor_usd);
    var md = R.model;
    $('kpis').innerHTML = [
      ['Watchlist covered', covered + ' / ' + R.watchlist], ['Pre-token rows', R.rows.length],
      ['Fitted on (traded)', md.n + ' tokens'], ['Held-out error', '×' + md.loo_median_x.toFixed(2) + ' <small>vs ×' + md.base_median_x.toFixed(2) + ' rule</small>'],
      ['Within 2× (LOO)', Math.round(md.within2x * 100) + '% <small>vs ' + Math.round(md.base_within2x * 100) + '%</small>'], ['Sum of implied value', usd(total)]
    ].map(function (k) { return '<div><dt>' + k[0] + '</dt><dd>' + k[1] + '</dd></div>'; }).join('');
    var cats = {}, chains = {};
    R.rows.forEach(function (r) { cats[r.category] = (cats[r.category] || 0) + 1; r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; }); });
    function opts(o, all) {
      return '<option value="">' + all + '</option>' + Object.keys(o).sort(function (a, b) { return o[b] - o[a] || (a < b ? -1 : 1); })
        .map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ' (' + o[k] + ')</option>'; }).join('');
    }
    $('cat').innerHTML = opts(cats, 'All categories');
    $('chain').innerHTML = opts(chains, 'All chains');
  }

  /** The evidence strip: recompute check, protocol accounting, ablation, range honesty, scatter. */
  function evidence() {
    var md = R.model, again = M.buildBoard(R.snapshot).board, same = 0;
    again.forEach(function (r, i) { var o = R.rows[i]; if (o && o.slug === r.slug && o.implied_value_usd === r.implied_value_usd && o.rank === r.rank) same++; });
    var acc = md.accounting, total = Object.keys(acc).reduce(function (s, k) { return s + acc[k]; }, 0);
    var colors = ['#7aa2ff', '#f5b942', '#3fb984', '#56657a', '#8f6bd8', '#3a4656'];
    var bar = Object.keys(acc).map(function (k, i) { return '<i style="flex:' + acc[k] + ';background:' + colors[i] + '"></i>'; }).join('');
    var legend = Object.keys(acc).map(function (k, i) { return '<span><b style="background:' + colors[i] + '"></b>' + esc(k) + ' <em>' + acc[k] + '</em></span>'; }).join('');
    var abl = md.ablation.map(function (a) {
      return '<tr><td>' + esc(a.step) + '</td><td class="num">×' + a.loo_x.toFixed(2) + '</td><td class="num">×' + a.wf_x.toFixed(2) + '</td><td>' + (a.step === 'all terms' ? 'start' : a.kept ? '<span class="up">kept</span>' : '<span class="down">dropped</span>') + '</td></tr>';
    }).join('');
    $('evidence').innerHTML =
      '<div class="ev-col"><h3>Every snapshot protocol, accounted for</h3><div class="acc">' + bar + '</div><div class="legend">' + legend + '</div>' +
      '<p class="ok">✓ ' + same + ' / ' + R.rows.length + ' rows recomputed in this browser from the snapshot by model.js = board.json · ' + total + ' / ' + R.protocols + ' protocols in exactly one group</p></div>' +
      '<div class="ev-col"><h3>Which terms earn their place (held-out miss)</h3><table class="abl"><tr><th>model</th><th class="num">leave-one-out</th><th class="num">older→newer</th><th></th></tr>' + abl + '</table>' +
      '<p class="sub">A term is dropped only if leaving it out lowers the miss on both tests. Walk-forward fits the ' + md.wf_split[0] + ' earliest-listed tokens and prices the ' + md.wf_split[1] + ' newer ones.</p></div>' +
      '<div class="ev-col"><h3>Is the printed range honest?</h3><p class="big">' + Math.round(md.wf_coverage * 100) + '%</p><p class="sub">of the newer tokens\' real market caps land inside the 80% range a fit on the older ones prints (target 80%). Typical miss ×' + md.wf_x.toFixed(2) + ' walk-forward, ×' + md.loo_median_x.toFixed(2) + ' leave-one-out; the old category-multiple rule misses by ×' + md.base_median_x.toFixed(2) + '.</p>' + scatter() + '</div>';
  }
  function scatter() {
    var W = 300, H = 120, pts = [], lx = function (v) { return (Math.log10(v) - 6.5) / 4 * W; }, ly = function (v) { return H - (Math.log10(v) - 6) / 5 * H; };
    R.snapshot.protocols.forEach(function (p) { if (p.mcap_usd > 0 && p.tvl_usd > 0) pts.push('<circle cx="' + lx(p.tvl_usd).toFixed(1) + '" cy="' + ly(p.mcap_usd).toFixed(1) + '" r="2" fill="#56657a"/>'); });
    R.rows.forEach(function (r) { pts.push('<circle cx="' + lx(r.tvl_usd).toFixed(1) + '" cy="' + ly(r.implied_value_usd).toFixed(1) + '" r="2" fill="#f5b942"/>'); });
    return '<svg class="sc" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="market cap against TVL">' + pts.join('') + '</svg><p class="sub">Grey: market cap vs TVL of tokens that trade. Gold: implied value of the ' + R.rows.length + ' ranked rows. Log scales, $3M–$30B TVL.</p>';
  }

  var COLS = {
    board: [['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num'], ['age_days', 'No token for', 'num'], ['net_per_1k_usd', 'Verdict · net / $1k', 'num'], ['implied_value_usd', 'Implied value (80% range)', 'num']],
    peers: [['name', 'Protocol (token trades)', ''], ['category', 'Category', ''], ['tvl_usd', 'TVL', 'num'], ['mcap_usd', 'Market cap', 'num'], ['ratio', 'Mcap / TVL', 'num']]
  };

  function rowsFor() {
    var src = state.tab === 'peers' ? R.live : R.rows, q = state.q.toLowerCase();
    var out = src.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.tab === 'peers') return !q || (r.name + ' ' + r.category).toLowerCase().indexOf(q) >= 0;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watch && !r.watchlist) return false;
      if (state.trend === 'up' && !(r.change_7d > 0)) return false;
      if (state.trend === 'down' && !(r.change_7d < 0)) return false;
      return !q || (r.name + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var k = state.tab === 'peers' && state.sort === 'rank' ? 'mcap_usd' : state.sort, d = state.tab === 'peers' && state.sort === 'rank' ? -1 : state.dir;
    return out.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x === null) return 1; if (y === null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d;
    });
  }

  function table() {
    var cols = COLS[state.tab], rows = rowsFor(), max = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd || 0); }, 1);
    $('grid').tHead.innerHTML = '<tr>' + cols.map(function (c) {
      return '<th data-k="' + c[0] + '" class="' + c[2] + (state.sort === c[0] ? ' sorted' : '') + '">' + c[1] + (state.sort === c[0] ? (state.dir === 1 ? ' ↑' : ' ↓') : '') + '</th>';
    }).join('') + '</tr>';
    $('count').textContent = rows.length + ' of ' + (state.tab === 'peers' ? R.live.length : R.rows.length) + ' shown';
    $('grid').tBodies[0].innerHTML = rows.length ? rows.slice(0, 120).map(function (r) {
      if (state.tab === 'peers') {
        return '<tr><td><span class="name">' + esc(r.name) + '</span> <span class="sub">' + esc(r.symbol || '') + '</span></td><td class="sub">' + esc(r.category) + '</td><td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.mcap_usd) + '</td><td class="num">' + r.ratio.toFixed(2) + 'x</td></tr>';
      }
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.p ? ' class="sel"' : '') + '><td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="w">WATCH</span>' : '') + (r.parent ? '<span class="lin" title="' + esc(r.parent) + ' already trades">PARENT TRADES</span>' : '') + '<div class="sub">' + esc(r.category) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td><td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><span class="vd ' + r.verdict.toLowerCase() + '">' + r.verdict + '</span> <span class="' + (r.net_per_1k_usd > 0 ? 'up' : 'down') + '">' + (r.net_per_1k_usd > 0 ? '+$' : '−$') + Math.abs(r.net_per_1k_usd) + '</span></td>' +
        '<td class="num"><div class="bar"><i style="width:' + Math.max(2, Math.round(70 * r.implied_value_usd / max)) + 'px"></i>' + usd(r.implied_value_usd) + '</div><div class="sub">' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">No protocol matches these filters.</td></tr>';
  }

  function detail() {
    var el = $('detail');
    if (state.tab === 'peers') {
      var md = R.model;
      el.innerHTML = '<h3>The fitted model</h3><p class="sub">ln(market cap) of ' + md.n + ' traded protocols (tokens worth over 50× or under 1/50 of their TVL left out as outliers), ridge λ=' + md.lambda + '. Coefficients:</p>' +
        '<table class="peers">' + md.terms.map(function (t, i) { return '<tr><td>' + esc(t) + '</td><td class="num">' + md.beta[i].toFixed(3) + '</td></tr>'; }).join('') + '</table>' +
        '<h3>Tested held-out</h3><p class="sub">Each traded protocol predicted with itself left out (leave-one-out): typical miss ×' + md.loo_median_x.toFixed(2) + ', ' + Math.round(md.within2x * 100) + '% within 2×. The v1 rule (category median multiple) scored the same way: ×' + md.base_median_x.toFixed(2) + ', ' + Math.round(md.base_within2x * 100) + '% within 2×. 80% of held-out errors fall within ×' + md.band[0] + ' to ×' + md.band[1] + ', the range shown on every row.</p>' +
        '<h3>Net / $1k</h3><p class="sub">Assumes ' + Math.round(md.airdrop_share * 100) + '% of a launch at the implied value goes to depositors pro rata to TVL, minus the plan\'s fees on the cheapest chain. An assumption, not a forecast of any airdrop.</p>';
      return;
    }
    var r = R.rows.filter(function (x) { return x.slug === state.p; })[0] || rowsFor()[0] || R.rows[0];
    var P = r.parts, fam = P.slice(4).reduce(function (s, v) { return s + v; }, 0);
    var check = Math.round(Math.exp(P.reduce(function (s, v) { return s + v; }, 0)) * r.lineage);
    var f = function (x) { return '×' + Math.exp(x).toFixed(3); };
    var peers = R.live.filter(function (p) { return p.category === r.category; }).slice(0, 5);
    var where = r.watchlist ? ' · on the watchlist' : r.tvl_usd >= R.floor_usd ? ' · above the floor, added by the radar' : ' · below the floor, early';
    el.innerHTML = '<div class="sub">Rank ' + r.rank + ' of ' + R.rows.length + where + '</div>' +
      '<h2>' + esc(r.name) + '</h2><div class="chips"><span class="chip">' + esc(r.category) + '</span>' + r.chains.slice(0, 6).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '<span class="chip">no token on record</span></div>' +
      '<h3>How the implied value is built (fitted terms)</h3><div class="wf">' +
      '<span>Base: $66M TVL, flat week, just listed, other category</span><span>' + usd(Math.exp(P[0])) + '</span>' +
      '<span>× size, TVL ' + usd(r.tvl_usd) + '</span><span>' + f(P[1]) + '</span>' +
      (P[2] ? '<span>× momentum, 7d TVL ' + (r.change_7d === null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</span><span>' + f(P[2]) + '</span>' : '<span>momentum (7d TVL change)</span><span class="sub">dropped by test</span>') +
      '<span>× time listed, ' + age(r.age_days) + ' with no token</span><span>' + f(P[3]) + '</span>' +
      '<span>× category family (' + esc(M.family(r.category)) + ')</span><span>' + f(fam) + '</span>' +
      (r.parent ? '<span>× lineage: ' + esc(r.parent) + ' already trades</span><span>×' + r.lineage.toFixed(3) + '</span>' : '') +
      '<span class="total">= implied value</span><span class="total">' + usd(check) + '</span>' +
      '<span>80% range from held-out errors</span><span>' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '</span></div>' +
      (peers.length ? '<h3>Traded peers in ' + esc(r.category) + '</h3><table class="peers">' + peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + p.ratio.toFixed(2) + 'x</td></tr>'; }).join('') + '</table>' : '') +
      '<h3>Farm plan — cost and time per step</h3><ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  function render() {
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === state.tab); });
    $('q').value = state.q; $('cat').value = state.cat; $('chain').value = state.chain; $('trend').value = state.trend; $('watch').checked = state.watch;
    ['chain', 'trend', 'watch'].forEach(function (id) { $(id).closest('label').style.display = state.tab === 'peers' ? 'none' : ''; });
    document.body.classList.toggle('focus', !!state.p);
    table(); detail(); writeHash();
  }

  header(); evidence(); readHash(); render();
  $('tabs').addEventListener('click', function (e) { var t = e.target.dataset.tab; if (t) { state.tab = t; state.sort = 'rank'; state.dir = 1; render(); } });
  ['q', 'cat', 'chain', 'trend'].forEach(function (id) { $(id).addEventListener('input', function () { state[id] = this.value; render(); }); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; render(); });
  $('grid').tHead.addEventListener('click', function (e) {
    var k = e.target.closest('th') && e.target.closest('th').dataset.k; if (!k) return;
    state.dir = state.sort === k ? -state.dir : (k === 'rank' || k === 'name' ? 1 : -1); state.sort = k; render();
  });
  $('grid').tBodies[0].addEventListener('click', function (e) { var tr = e.target.closest('tr[data-slug]'); if (tr) { state.p = tr.dataset.slug; render(); } });
})();
