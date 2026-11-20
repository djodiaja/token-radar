/* Token radar value model and farm planner.
 * One file, used twice: main.ts runs it in Node to write board.json, and the page runs it to show
 * how every implied value was reached. Every number comes from the sealed DefiLlama snapshot:
 * no protocol is named anywhere in this file.
 *
 *   implied value = TVL x peer multiple (category, from tokens that already trade)
 *                     x momentum (7-day TVL change) x runway (days live with no token)
 */
(function (root) {
  'use strict';

  // Categories pooled into families so a thin category borrows its peers' multiple.
  var FAMILY = {
    Lending: 'credit', CDP: 'credit', 'CDP Manager': 'credit', 'Uncollateralized Lending': 'credit', 'Collateral Markets': 'credit',
    Dexs: 'trading', Derivatives: 'trading', Options: 'trading', 'Options Vault': 'trading', 'Interest Rate Derivatives': 'trading',
    'Prediction Market': 'trading', 'OTC Marketplace': 'trading',
    Yield: 'vaults', 'Yield Aggregator': 'vaults', 'Risk Curators': 'vaults', 'Onchain Capital Allocator': 'vaults',
    'Basis Trading': 'vaults', 'Liquidity Manager': 'vaults', 'Leveraged Farming': 'vaults', Farm: 'vaults', Indexes: 'vaults',
    'Governance Incentives': 'vaults', CeDeFi: 'vaults', 'Stablecoin Wrapper': 'vaults', 'Dual-Token Stablecoin': 'credit',
    RWA: 'rwa', 'Liquid Staking': 'staking', 'Liquid Restaking': 'staking', Restaking: 'staking', 'Staking Pool': 'staking',
    'Restaked BTC': 'staking', 'Anchor BTC': 'staking', 'Decentralized BTC': 'staking',
    Chain: 'infra', Bridge: 'infra', 'Canonical Bridge': 'infra', 'Cross Chain Bridge': 'infra', Payments: 'infra',
    Privacy: 'infra', Insurance: 'credit', 'Crypto Card Issuer': 'infra'
  };
  var SHRINK = 4;            // pseudo-count pulling a category toward its family
  var RATIO_MIN = 0.02;      // peer multiples are clamped: one outlier token cannot set a category
  var RATIO_MAX = 1.5;
  var SKIP = { CEX: 1, 'Canonical Bridge': 1, 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1, Bridge: 1 };
  var EARLY_ROWS = 160;      // pre-token protocols below the floor added after the watchlist

  function family(cat) { return FAMILY[cat] || 'other'; }
  function median(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function (x, y) { return x - y; }), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function isPreToken(p) { return p.gecko_id === null && p.symbol === null; }
  function trades(p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0; }
  function ageDays(asOf, listed) {
    if (!listed) return null;
    return Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / 86400000));
  }

  /** Peer multiples (market cap / TVL) from every protocol whose token trades, by category and family. */
  function peerMultiples(protocols) {
    var byCat = {}, byFam = {}, all = [];
    protocols.forEach(function (p) {
      if (!trades(p)) return;
      var r = Math.log(clamp(p.mcap_usd / p.tvl_usd, RATIO_MIN / 10, RATIO_MAX * 10));
      (byCat[p.category] = byCat[p.category] || []).push(r);
      (byFam[family(p.category)] = byFam[family(p.category)] || []).push(r);
      all.push(r);
    });
    var global = median(all), fam = {}, cat = {};
    Object.keys(byFam).forEach(function (f) {
      var n = byFam[f].length;
      fam[f] = { log: (n * median(byFam[f]) + SHRINK * global) / (n + SHRINK), n: n };
    });
    Object.keys(byCat).forEach(function (c) {
      var n = byCat[c].length, base = fam[family(c)] ? fam[family(c)].log : global;
      cat[c] = { log: (n * median(byCat[c]) + SHRINK * base) / (n + SHRINK), n: n };
    });
    return { global: global, fam: fam, cat: cat, peers: all.length };
  }

  /** The multiple one protocol is valued at, and where it came from. */
  function multipleFor(category, peers) {
    var c = peers.cat[category], f = peers.fam[family(category)];
    var src = c ? category + ' peers (' + c.n + ')' : f ? family(category) + ' family (' + f.n + ')' : 'all tokens (' + peers.peers + ')';
    var log = c ? c.log : f ? f.log : peers.global;
    return { ratio: clamp(Math.exp(log), RATIO_MIN, RATIO_MAX), source: src };
  }

  /** 7-day TVL change -> multiplier: +/-30% moves the value by about +/-24%. */
  function momentum(change7d) {
    if (change7d === null) return 1;
    return 1 + 0.8 * clamp(change7d, -30, 30) / 100;
  }

  /** Days live with no token -> multiplier. Young books are unproven, a year in is the airdrop window,
   *  and a protocol two-plus years in with no token is less likely to issue one. */
  function runway(age) {
    if (age === null) return 0.9;
    var m = 0.8 + 0.3 * Math.min(age, 365) / 365 - 0.2 * clamp((age - 730) / 730, 0, 1);
    return clamp(m, 0.7, 1.1);
  }

  // ---------------------------------------------------------------- fitted model (v2)
  // ln(market cap) of the protocols whose token trades, regressed on the snapshot's own figures:
  //   ln TVL, 7-day TVL change, ln(1 + years listed) and the category family.
  // Ridge (lambda on every term but the intercept), solved exactly; leave-one-out errors come from
  // the hat matrix, so every number on the page is out-of-sample for the protocol it describes.
  var FAMS = ['credit', 'trading', 'vaults', 'rwa', 'staking', 'infra'];
  var TERMS = ['intercept', 'ln TVL', '7d TVL change', 'years listed', 'credit', 'trading', 'vaults', 'rwa', 'staking', 'infra'];
  var LAMBDA = 2;
  var RATIO_TRIM = Math.log(50);   // a token worth >50x or <1/50 of its TVL is an outlier, not a peer

  function features(p, asOf, medAge) {
    var age = ageDays(asOf, p.listed_at); if (age === null) age = medAge;
    var f = [1, Math.log(p.tvl_usd) - 18, clamp(p.change_7d === null ? 0 : p.change_7d, -30, 30) / 100, Math.log(1 + age / 365)];
    FAMS.forEach(function (fm) { f.push(family(p.category) === fm ? 1 : 0); });
    return f;
  }
  function solve(A, b) {             // Gaussian elimination with partial pivoting
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      var t = M[c]; M[c] = M[piv]; M[piv] = t;
      for (r = 0; r < n; r++) if (r !== c) { var k = M[r][c] / M[c][c]; for (var j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
    }
    return M.map(function (r, i) { return r[n] / r[i]; });
  }
  /** Ridge fit on the columns `cols` of X; returns coefficients (zero outside cols) and LOO residuals. */
  function ridge(X, y, cols) {
    var k = cols.length, A = [], b = [];
    for (var i = 0; i < k; i++) {
      A.push([]); b.push(0);
      for (var j = 0; j < k; j++) { var s = 0; for (var r = 0; r < X.length; r++) s += X[r][cols[i]] * X[r][cols[j]]; A[i].push(s + (i === j && cols[i] > 0 ? LAMBDA : 0)); }
      for (r = 0; r < X.length; r++) b[i] += X[r][cols[i]] * y[r];
    }
    var bc = solve(A, b), inv = cols.map(function (_, c) { return solve(A, cols.map(function (_, i) { return i === c ? 1 : 0; })); });
    var beta = TERMS.map(function () { return 0; }); cols.forEach(function (c, i) { beta[c] = bc[i]; });
    var loo = X.map(function (x, r) {
      var h = 0; for (var i = 0; i < k; i++) for (var j = 0; j < k; j++) h += x[cols[i]] * inv[i][j] * x[cols[j]];
      return (y[r] - dot(x, beta)) / (1 - h);
    });
    return { beta: beta, loo: loo };
  }
  function dot(x, b) { return x.reduce(function (s, v, i) { return s + v * b[i]; }, 0); }
  var STEPS = [['flat (intercept only)', [0]], ['+ size curve, ln TVL', [1]], ['+ category family', [4, 5, 6, 7, 8, 9]], ['+ 7-day TVL change', [2]], ['+ years listed', [3]]];

  /** Walk-forward: fit on tokens listed before the median listing date, predict the newer ones. */
  function walkForward(rows, X, y, cols) {
    var dates = rows.map(function (p) { return p.listed_at || '0000'; }), cut = dates.slice().sort()[dates.length >> 1];
    var old = [], neu = [];
    rows.forEach(function (p, i) { (dates[i] < cut ? old : neu).push(i); });
    var f = ridge(old.map(function (i) { return X[i]; }), old.map(function (i) { return y[i]; }), cols);
    var srt = f.loo.slice().sort(function (a, c) { return a - c; }), lo = srt[Math.floor(.1 * srt.length)], hi = srt[Math.floor(.9 * srt.length)];
    var errs = neu.map(function (i) { return y[i] - dot(X[i], f.beta); });
    return { median_x: Math.exp(median(errs.map(Math.abs))), coverage: errs.filter(function (e) { return e >= lo && e <= hi; }).length / errs.length, n_old: old.length, n_new: neu.length };
  }

  function fitModel(protocols, asOf) {
    var ages = protocols.map(function (p) { return ageDays(asOf, p.listed_at); }).filter(function (a) { return a !== null; });
    var medAge = median(ages) || 365;
    var train = protocols.filter(function (p) { return trades(p) && Math.abs(Math.log(p.mcap_usd / p.tvl_usd)) < RATIO_TRIM; });
    var X = train.map(function (p) { return features(p, asOf, medAge); });
    var y = train.map(function (p) { return Math.log(p.mcap_usd); });
    // backward elimination: start from every term, drop a group only if leaving it out lowers the
    // miss on BOTH held-out tests (leave-one-out and walk-forward older -> newer)
    var score = function (c) { return { loo_x: Math.exp(median(ridge(X, y, c).loo.map(Math.abs))), wf_x: walkForward(train, X, y, c).median_x }; };
    var cols = TERMS.map(function (_, i) { return i; }), cur = score(cols), ablation = [{ step: 'all terms', loo_x: cur.loo_x, wf_x: cur.wf_x, kept: true }];
    STEPS.slice(1).forEach(function (st) {
      var without = cols.filter(function (c) { return st[1].indexOf(c) < 0; }), s = score(without);
      var drop = s.loo_x < cur.loo_x && s.wf_x < cur.wf_x;
      ablation.push({ step: 'without ' + st[0].slice(2), loo_x: s.loo_x, wf_x: s.wf_x, kept: !drop });
      if (drop) { cols = without; cur = s; }
    });
    var fit = ridge(X, y, cols), beta = fit.beta, loo = fit.loo, wfFinal = walkForward(train, X, y, cols);
    // the v1 rule (category median multiple), scored the same way: each protocol left out of its own peers
    var base = train.map(function (p) {
      var others = protocols.filter(function (q) { return q !== p; });
      return Math.log(p.mcap_usd) - Math.log(p.tvl_usd * multipleFor(p.category, peerMultiples(others)).ratio);
    });
    var abs = function (a) { return a.map(Math.abs); };
    var sorted = loo.slice().sort(function (a, c) { return a - c; });
    return {
      beta: beta, medAge: medAge, n: train.length, terms: TERMS,
      loo_median_x: Math.exp(median(abs(loo))), base_median_x: Math.exp(median(abs(base))),
      within2x: loo.filter(function (e) { return Math.abs(e) < Math.LN2; }).length / loo.length,
      base_within2x: base.filter(function (e) { return Math.abs(e) < Math.LN2; }).length / base.length,
      band: [sorted[Math.floor(0.1 * sorted.length)], sorted[Math.floor(0.9 * sorted.length)]],
      ablation: ablation, kept: cols, wf_x: wfFinal.median_x, wf_coverage: wfFinal.coverage, wf_split: [wfFinal.n_old, wfFinal.n_new]
    };
  }
  function predict(p, asOf, fit) {
    var x = features(p, asOf, fit.medAge);
    var parts = x.map(function (v, i) { return v * fit.beta[i]; });
    return { ln: parts.reduce(function (s, v) { return s + v; }, 0), parts: parts };
  }

  /** A pre-token row whose name starts with the first word of a protocol whose token trades may be a
   *  product of that token's protocol; its value is halved and the parent named. */
  function parentIndex(protocols) {
    var idx = {};
    protocols.forEach(function (p) {
      if (!trades(p)) return;
      var w = p.name.split(/[\s.-]+/)[0].toLowerCase();
      if (w.length >= 4 && !idx[w]) idx[w] = p.name;
    });
    return idx;
  }
  function parentOf(p, idx) {
    var w = p.name.split(/[\s.-]+/)[0].toLowerCase();
    return idx[w] && idx[w] !== p.name ? idx[w] : null;
  }

  function value(p, asOf, fit, parents) {
    var age = ageDays(asOf, p.listed_at), parent = parents ? parentOf(p, parents) : null;
    var lineage = parent ? 0.5 : 1, pr = predict(p, asOf, fit);
    var implied = Math.max(1, Math.round(Math.exp(pr.ln) * lineage));
    return {
      implied: implied, low: Math.round(implied * Math.exp(fit.band[0])), high: Math.round(implied * Math.exp(fit.band[1])),
      multiple: implied / p.tvl_usd, parts: pr.parts, age_days: age, lineage: lineage, parent: parent
    };
  }

  /** Expected airdrop value per $1,000 deposited, if `share` of an implied-value token went to
   *  depositors pro rata to TVL (an assumption shown on the page), net of the plan's gas estimate. */
  function netPer1k(implied, tvl, gasUsd, share) {
    return Math.round(implied * share * 1000 / tvl - gasUsd);
  }

  // ---------------------------------------------------------------- farm planner
  var L2 = { Base: 1, Arbitrum: 1, Optimism: 1, Linea: 1, Scroll: 1, 'zkSync Era': 1, Unichain: 1, Ink: 1, Mantle: 1, Blast: 1, 'Robinhood Chain': 1 };
  function gas(chain) {
    if (chain === 'Ethereum') return { cost: '$3-15 gas', bridge: 'none' };
    if (L2[chain]) return { cost: 'under $0.50 gas', bridge: '$1-5 to bridge from Ethereum, 2-20 min' };
    if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos') return { cost: 'under $0.05 in fees', bridge: '$2-8 via a CCTP/Wormhole route, 5-20 min' };
    if (chain === 'Bitcoin') return { cost: '$1-10 in BTC fees', bridge: 'native BTC, 10-60 min to confirm' };
    return { cost: 'under $1 gas', bridge: '$2-10 to bridge in, 5-30 min' };
  }
  /** Round-trip cost in USD of the plan's transactions (fund/bridge in, two actions, withdraw). */
  function gasCost(chain) {
    if (chain === 'Ethereum') return 40;
    if (L2[chain]) return 4;
    if (chain === 'Solana' || chain === 'Sui' || chain === 'Aptos') return 6;
    if (chain === 'Bitcoin') return 20;
    return 10;
  }
  var AIRDROP_SHARE = 0.10;  // assumed share of a launch that goes to depositors (typical range 5-15%)
  function cheapest(chains) {
    var order = ['Base', 'Arbitrum', 'Solana', 'Optimism', 'Hyperliquid L1', 'Binance', 'Ethereum'];
    for (var i = 0; i < order.length; i++) if (chains.indexOf(order[i]) >= 0) return order[i];
    return chains[0] || 'Ethereum';
  }
  var ACTION = {
    credit: ['Supply a stablecoin (start with $500-2,000 of USDC) to the largest market', 'Borrow up to 30% LTV against it and keep the health factor above 2.0 so activity counts on both sides'],
    trading: ['Trade a few round trips of $200-1,000 each (fees about 0.05-0.3% per trade)', 'Add $500+ of liquidity to a deep pair, or open a small hedged position, so the account shows volume and depth'],
    vaults: ['Deposit $500-5,000 of USDC or ETH into the flagship vault', 'Keep the deposit in place: curated vaults usually weight rewards by size x days held'],
    rwa: ['Pass the KYC check if one is required (10-30 min, sometimes a day to approve)', 'Buy or mint $500+ of the tokenised product and hold it through the next distribution date'],
    staking: ['Stake or restake $500+ of the base asset through the protocol', 'Delegate to an operator or pool with a public fee, and leave unbonding time in your plan'],
    infra: ['Move $100-500 through the network or service in two or three transfers over separate weeks', 'Use one more app on it each week so the wallet shows breadth, not one transfer'],
    other: ['Make a first $200-1,000 deposit or trade with the core product', 'Repeat a smaller action every week so the wallet shows a pattern of use']
  };

  /** Concrete steps, each with what it costs and how long it takes. Data-driven: chain, age, growth, size. */
  function farmPlan(p, v) {
    var chain = cheapest(p.chains), g = gas(chain), fam = family(p.category), act = ACTION[fam] || ACTION.other;
    var steps = [];
    steps.push('Confirm there is still no token: search the official site, docs and X for "' + p.name + '" points, season or airdrop terms (free, 10 min).');
    steps.push(g.bridge === 'none'
      ? 'Fund one dedicated wallet on ' + chain + ' with the capital you plan to use plus about $30 for gas (one exchange withdrawal, 10-30 min).'
      : 'Fund a dedicated wallet on ' + chain + (p.chains.length > 1 ? ', the cheapest of its ' + p.chains.length + ' chains' : ', where it runs') + ' (' + g.bridge + ').');
    steps.push(act[0] + ' on ' + p.name + ' (' + g.cost + ' per transaction, about 5 min).');
    steps.push(act[1] + '.');
    if (p.change_7d !== null && p.change_7d > 5) steps.push('TVL rose ' + p.change_7d.toFixed(1) + '% in 7 days: entering early in a growth phase usually earns a larger share of any points pool, so act this week (no extra cost).');
    else if (p.change_7d !== null && p.change_7d < -5) steps.push('TVL fell ' + Math.abs(p.change_7d).toFixed(1) + '% in 7 days: start with half the planned size and add only if deposits recover (saves about half the exposure).');
    if (v.age_days !== null && v.age_days > 540) steps.push('It has run ' + Math.round(v.age_days / 30) + ' months with no token: treat a token as uncertain, so cap capital to what you would hold for the yield alone.');
    else if (v.age_days !== null && v.age_days < 120) steps.push('Listed ' + v.age_days + ' days ago: early users are often weighted most, so build history now and keep it running for 60-90 days.');
    var gross = v.implied * AIRDROP_SHARE * 1000 / p.tvl_usd, cost = gasCost(chain);
    steps.push('Expected value: if ' + Math.round(AIRDROP_SHARE * 100) + '% of the implied ' + fmtUsd(v.implied) + ' went to depositors pro rata, each $1,000 kept in earns about $' + gross.toFixed(gross < 10 ? 1 : 0) +
      ' against ~$' + cost + ' of fees for the whole plan: ' + (gross > cost ? 'worth it from about $' + Math.ceil(cost / gross * 1000) + ' deposited.' : 'fees exceed the expected drop at $1,000; only worth it with a larger deposit or for the yield itself.'));
    steps.push('Track it: note deposit date, size and tx hashes in a sheet, and re-check the dashboard and points page every 2 weeks (5 min each).');
    steps.push('Exit rule: withdraw if TVL drops below ' + fmtUsd(p.tvl_usd * 0.6) + ' (40% below today) or if an audit or exploit warning appears (one withdrawal, ' + g.cost + ').');
    return steps;
  }

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }

  /** Every snapshot protocol in exactly one group, so the page can show nothing was dropped silently. */
  function accounting(snapshot, board) {
    var on = {}, watch = {}, g = { 'Ranked: watchlist': 0, 'Ranked: radar picks': 0, 'Token trades (peers)': 0, 'Token recorded, no cap': 0, 'Set aside: bridge/staking/exchange/wrapper': 0, 'Pre-token, below the cut': 0 };
    board.forEach(function (r) { on[r.slug] = 1; });
    snapshot.watchlist.forEach(function (s) { watch[s] = 1; });
    snapshot.protocols.forEach(function (p) {
      var k = on[p.slug] ? (watch[p.slug] ? 'Ranked: watchlist' : 'Ranked: radar picks')
        : trades(p) ? 'Token trades (peers)' : !isPreToken(p) ? 'Token recorded, no cap'
        : (SKIP[p.category] || /\b(wrapped|staked|staking)\b/i.test(p.name)) ? 'Set aside: bridge/staking/exchange/wrapper' : 'Pre-token, below the cut';
      g[k]++;
    });
    return g;
  }
  /** FARM when $1,000 nets at least $10 after the plan's fees, MARGINAL when it nets anything, else SKIP. */
  var FARM_LINE = 10;
  function verdict(net) { return net >= FARM_LINE ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP'; }

  /** Watchlist first, then the strongest pre-token protocols below the floor; ranked by implied value. */
  function buildBoard(snapshot) {
    var peers = peerMultiples(snapshot.protocols), parents = parentIndex(snapshot.protocols), watch = {};
    var fit = fitModel(snapshot.protocols, snapshot.as_of);
    snapshot.watchlist.forEach(function (s) { watch[s] = 1; });
    var scored = snapshot.protocols.filter(isPreToken).map(function (p) {
      var v = value(p, snapshot.as_of, fit, parents);
      return { p: p, v: v, watch: !!watch[p.slug] };
    });
    var early = scored.filter(function (r) {
      return !r.watch && !SKIP[r.p.category] && !/\b(wrapped|staked|staking)\b/i.test(r.p.name);
    }).sort(function (a, b) { return b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd; }).slice(0, EARLY_ROWS);
    var rows = scored.filter(function (r) { return r.watch; }).concat(early);
    rows.sort(function (a, b) { return b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1); });
    var board = rows.map(function (r, i) {
      return {
        rank: i + 1, slug: r.p.slug, name: r.p.name, category: r.p.category, chains: r.p.chains,
        tvl_usd: r.p.tvl_usd, change_7d: r.p.change_7d, listed_at: r.p.listed_at, watchlist: r.watch,
        implied_value_usd: r.v.implied, implied_low_usd: r.v.low, implied_high_usd: r.v.high,
        multiple: +r.v.multiple.toFixed(4), parts: r.v.parts.map(function (x) { return +x.toFixed(4); }), age_days: r.v.age_days,
        lineage: r.v.lineage, parent: r.v.parent,
        net_per_1k_usd: netPer1k(r.v.implied, r.p.tvl_usd, gasCost(cheapest(r.p.chains)), AIRDROP_SHARE),
        verdict: verdict(netPer1k(r.v.implied, r.p.tvl_usd, gasCost(cheapest(r.p.chains)), AIRDROP_SHARE)),
        farm_steps: farmPlan(r.p, r.v)
      };
    });
    var live = snapshot.protocols.filter(trades).sort(function (a, b) { return b.mcap_usd - a.mcap_usd; }).slice(0, 40).map(function (p) {
      return { slug: p.slug, name: p.name, category: p.category, symbol: p.symbol, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: +(p.mcap_usd / p.tvl_usd).toFixed(3) };
    });
    var model = {
      terms: fit.terms, beta: fit.beta.map(function (b) { return +b.toFixed(4); }), n: fit.n, lambda: LAMBDA,
      loo_median_x: +fit.loo_median_x.toFixed(3), base_median_x: +fit.base_median_x.toFixed(3),
      within2x: +fit.within2x.toFixed(3), base_within2x: +fit.base_within2x.toFixed(3),
      band: fit.band.map(function (b) { return +Math.exp(b).toFixed(3); }), airdrop_share: AIRDROP_SHARE,
      ablation: fit.ablation.map(function (a) { return { step: a.step, loo_x: +a.loo_x.toFixed(2), wf_x: +a.wf_x.toFixed(2), kept: a.kept }; }),
      wf_x: +fit.wf_x.toFixed(2), wf_coverage: +fit.wf_coverage.toFixed(3), wf_split: fit.wf_split,
      accounting: accounting(snapshot, board)
    };
    return { board: board, live: live, peers: peers, model: model };
  }

  var api = { buildBoard: buildBoard, value: value, fitModel: fitModel, predict: predict, peerMultiples: peerMultiples, farmPlan: farmPlan, netPer1k: netPer1k, fmtUsd: fmtUsd, family: family };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RadarModel = api;
})(this);
