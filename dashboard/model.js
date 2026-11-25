/* Pre-token radar model: one file, two runners. main.ts calls run() to write board.json, and the
   page calls run() again in the browser on the raw snapshot, then compares every row with board.json.

   implied value = TVL x launch multiple x 12-month token odds
     launch multiple: ridge fit of ln(market cap / TVL) on the protocols whose token trades
     token odds:      logistic "no-token clock" fitted on which protocols carry a token at which age
   Every term is kept only when BOTH blind tests keep it: leaving it out must worsen the held-out miss
   on leave-one-out (10-fold for the odds) AND on walk-forward (fit on the older-listed, price the newer). */
(function (root) {
  'use strict';

  const P = {
    ridge: 2, oddsRidge: 1, wfShare: 0.6, target: 0.8, folds: 10,
    userShare: 0.08,   // share of a launch's supply that goes to users who supplied TVL (assumption)
    riskYear: 0.003,   // expected loss a year on a deposit (exploit base rate); doubled below the floor
    monitorMin: 120,   // 12 monthly checks of 10 minutes
    farmRate: 25,      // $ per hour of your time for a FARM verdict
    deposit: 10000,    // the plan's reference deposit
  };
  const SET_ASIDE = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const EXCHANGE = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
  const VERSIONED = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;
  const WRAPPED = /\b(wrapped|staked|staking)\b/i;
  const FAMILIES = [
    ['lend', /lending/i], ['dex', /dex|liquidity manager/i], ['perp', /derivative|option|prediction|perp/i],
    ['stable', /cdp|stablecoin|synthetic/i], ['rwa', /rwa|cedefi|payment|card/i],
    ['yield', /yield|farm|curator|capital allocator|basis|staking pool|restaking|leveraged|indexes/i],
  ];
  const GAS = { Ethereum: 6, Bitcoin: 3, Tron: 1, Solana: 0.02, Sui: 0.02, Aptos: 0.02, Polygon: 0.02, BSC: 0.1,
    Arbitrum: 0.1, Avalanche: 0.1, Linea: 0.1, Base: 0.05, 'OP Mainnet': 0.05, Optimism: 0.05, Sonic: 0.05,
    Mantle: 0.05, Ink: 0.05, Unichain: 0.05, Hyperliquid: 0.05, 'Hyperliquid L1': 0.05, Plasma: 0.05 };
  const YEAR = 365.25 * 86400000;

  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

  function family(cat) {
    for (const [f, re] of FAMILIES) if (cat && re.test(cat)) return f;
    return 'other';
  }

  /** Gaussian elimination with partial pivoting; A is k x k, b has k entries. */
  function solve(A, b) {
    const k = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < k; r++) {
        if (r === c) continue;
        const f = M[r][c] / d;
        if (f !== 0) for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((r, i) => r[k] / (M[i][i] || 1e-12));
  }

  /** Standardise the chosen columns on the fitting rows only, so a held-out row never leaks in. */
  function scaler(train, cols) {
    const mu = cols.map((c) => mean(train.map((r) => r.f[c])));
    const sd = cols.map((c, j) => Math.sqrt(mean(train.map((r) => (r.f[c] - mu[j]) ** 2))) || 1);
    return (r) => [1, ...cols.map((c, j) => (r.f[c] - mu[j]) / sd[j])];
  }

  function normal(X, w, z, lam) {
    const k = X[0].length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    X.forEach((x, n) => {
      for (let i = 0; i < k; i++) {
        b[i] += w[n] * x[i] * z[n];
        for (let j = 0; j < k; j++) A[i][j] += w[n] * x[i] * x[j];
      }
    });
    for (let i = 1; i < k; i++) A[i][i] += lam;
    return { A, b };
  }

  /** Ridge regression on standardised terms; the intercept is not penalised. */
  function fitLinear(train, cols) {
    const row = scaler(train, cols), X = train.map(row);
    const { A, b } = normal(X, train.map(() => 1), train.map((r) => r.y), P.ridge);
    const beta = solve(A, b);
    return { beta, cols, predict: (r) => dot(beta, row(r)) };
  }

  /** Penalised logistic regression by Newton steps (IRLS); deterministic, 30 steps at most. */
  function fitLogit(train, cols) {
    const row = scaler(train, cols), X = train.map(row), k = X[0].length;
    let beta = new Array(k).fill(0);
    for (let it = 0; it < 30; it++) {
      const p = X.map((x) => sigmoid(dot(beta, x)));
      const w = p.map((q) => Math.max(q * (1 - q), 1e-6));
      const z = X.map((x, n) => dot(beta, x) + (train[n].y - p[n]) / w[n]);
      const { A, b } = normal(X, w, z, P.oddsRidge);
      const next = solve(A, b);
      const step = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
      beta = next;
      if (step < 1e-9) break;
    }
    return { beta, cols, predict: (r) => sigmoid(dot(beta, row(r))) };
  }

  const absMiss = (fit, r) => Math.abs(fit.predict(r) - r.y);
  const logLoss = (fit, r) => { const p = clamp(fit.predict(r), 1e-6, 1 - 1e-6); return -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); };

  /** Oldest-listed share fits, the newer rest is priced blind. Rows with no listing date stay in the fit. */
  function wfSplit(rows) {
    const dated = rows.filter((r) => r.listed).sort((a, b) => (a.listed < b.listed ? -1 : a.listed > b.listed ? 1 : a.slug < b.slug ? -1 : 1));
    const cut = Math.floor(dated.length * P.wfShare);
    const test = dated.slice(cut), testSet = new Set(test);
    return { train: rows.filter((r) => !testSet.has(r)), test, cutDate: test.length ? test[0].listed : null };
  }

  /** Held-out scores of one term set: [first test, walk-forward]. */
  function heldOut(kind, rows, cols) {
    const fit = kind === 'value' ? fitLinear : fitLogit, loss = kind === 'value' ? absMiss : logLoss;
    let first = 0;
    if (kind === 'value') {
      rows.forEach((r, i) => { first += loss(fit(rows.filter((_, j) => j !== i), cols), r); });
    } else {
      for (let f = 0; f < P.folds; f++) {
        const tr = rows.filter((_, j) => j % P.folds !== f), te = rows.filter((_, j) => j % P.folds === f);
        const m = fit(tr, cols);
        te.forEach((r) => { first += loss(m, r); });
      }
    }
    first /= rows.length;
    const { train, test } = wfSplit(rows), m = fit(train, cols);
    const wf = mean(test.map((r) => loss(m, r)));
    return kind === 'value' ? [Math.exp(first), Math.exp(wf)] : [first, wf];
  }

  /** Backward elimination: drop a term while leaving it out does not hurt on both tests. */
  function select(kind, rows, terms, always) {
    const colsOf = (set) => [...always, ...set.flatMap((t) => terms[t])];
    let active = Object.keys(terms);
    for (;;) {
      const base = heldOut(kind, rows, colsOf(active));
      let worst = null;
      for (const t of active) {
        const s = heldOut(kind, rows, colsOf(active.filter((x) => x !== t)));
        const keptByBoth = s[0] > base[0] && s[1] > base[1];
        const gain = Math.log(s[0] / base[0]) + Math.log(s[1] / base[1]);
        if (!keptByBoth && (worst === null || gain < worst.gain)) worst = { t, gain };
      }
      if (worst === null) break;
      active = active.filter((x) => x !== worst.t);
    }
    const final = heldOut(kind, rows, colsOf(active));
    const table = Object.keys(terms).map((t) => {
      const on = active.includes(t);
      const other = heldOut(kind, rows, colsOf(on ? active.filter((x) => x !== t) : [...active, t]));
      return { term: t, kept: on, with: on ? final : other, without: on ? other : final };
    });
    return { active, cols: colsOf(active), final, table };
  }

  function chainOf(chains) {
    let best = chains && chains.length ? chains[0] : 'Ethereum', cost = GAS[best] ?? 0.3;
    for (const c of chains || []) if ((GAS[c] ?? 0.3) < cost) { best = c; cost = GAS[c] ?? 0.3; }
    return { chain: best, gas: cost };
  }

  /** Classify every snapshot protocol into exactly one group of the ledger. */
  function ledger(s) {
    const watch = new Set(s.watchlist);
    return s.protocols.map((p) => {
      const token = p.gecko_id !== null || p.symbol !== null;
      let group;
      if (watch.has(p.slug)) group = 'watch';
      else if (p.mcap_usd > 0) group = 'traded';
      else if (token) group = 'tokenNoCap';
      else if (SET_ASIDE.has(p.category) || EXCHANGE.test(p.name) || VERSIONED.test(p.name) || WRAPPED.test(p.name)) group = 'setAside';
      else if (p.tvl_usd >= s.floor_usd) group = 'parent'; // above the floor yet off the house list: a traded parent's product
      else group = 'radar';
      return { p, group, token };
    });
  }

  /** The clock's three candidate shapes; the blind tests pick one. */
  const SHAPES = { linear: (a) => a, root: Math.sqrt, log: (a) => Math.log(a + 0.5) };
  function atAge(f, age) {
    const g = { ...f, age };
    for (const k in SHAPES) g['clock_' + k] = SHAPES[k](age);
    return g;
  }

  function features(p, asOf, ageFill) {
    const age = p.listed_at ? Math.max((asOf - Date.parse(p.listed_at)) / YEAR, 0.05) : ageFill;
    const fam = family(p.category);
    const f = atAge({ size: Math.log(p.tvl_usd), growth: clamp(p.change_7d ?? 0, -30, 30) / 100 }, age);
    for (const [name] of FAMILIES) f['f_' + name] = fam === name ? 1 : 0;
    return { f, fam };
  }

  function quantile(sorted, q) {
    const n = sorted.length, k = Math.min(n - 1, Math.ceil(q * (n + 1)) - 1);
    return sorted[Math.max(0, k)];
  }

  /** The plan's economics at one deposit size; the page calls this again when the reader changes it. */
  function farm(r, D) {
    const g = r.gas, txIn = { dex: 3, stable: 3 }[r.fam] ?? 2;
    const fund = r.chain === 'Ethereum' ? 5 : 1;
    const gasCost = fund + g * (txIn + 2);
    const perDollar = (r.launch * P.userShare * r.odds) / (r.tvl + D);
    const risk = P.riskYear * (r.tvl < r.floor ? 2 : 1);
    const expected = perDollar * D, riskCost = D * risk, net = expected - gasCost - riskCost;
    const minutes = 10 + 15 + (r.fam === 'rwa' ? 30 : 0) + 5 + 10 + P.monitorMin, hours = minutes / 60;
    const rate = net / hours, edge = r.launch * P.userShare * r.odds / r.tvl - risk;
    const breakEven = edge > 0 ? gasCost / edge : Infinity;
    const farmAt = edge > 0 ? (gasCost + P.farmRate * hours) / edge : Infinity;
    const verdict = rate >= P.farmRate ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return { D, txIn, fund, gasCost, expected, riskCost, net, hours, minutes, rate, breakEven, farmAt, verdict };
  }

  const usd = (x) => (x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'k' : '$' + x.toFixed(2));

  const ACTION = {
    lend: (n, c) => `Supply USDC to ${n}'s ${c} market (approve + supply)`,
    dex: (n, c) => `Add a USDC/ETH liquidity position on ${n} (${c}), range about +/-10% so it keeps earning (2 approvals + mint)`,
    perp: (n, c) => `Deposit USDC margin or into the liquidity vault of ${n} on ${c}, no leverage (approve + deposit)`,
    stable: (n, c) => `Deposit ETH collateral on ${n} (${c}) and mint its stablecoin at 40% loan-to-value or less, then hold or stake it`,
    rwa: (n, c) => `Pass ${n}'s KYC or whitelist (about 30 min), then subscribe with USDC on ${c} (approve + subscribe)`,
    yield: (n, c) => `Deposit USDC into ${n}'s main vault on ${c} (approve + deposit)`,
    other: (n, c) => `Use ${n}'s main product on ${c} with USDC (approve + deposit)`,
  };

  /** Concrete steps, each with its cost and time, for the reference deposit. */
  function steps(r, e) {
    const g = (k) => usd(r.gas * k);
    return [
      `Fund a fresh wallet on ${r.chain} with ${usd(e.D)} USDC: withdraw from an exchange straight to ${r.chain} (fee about ${usd(e.fund)}, 10 min).`,
      `${ACTION[r.fam](r.name, r.chain)}: ${e.txIn} transactions, about ${g(e.txIn)} gas, 15 min.`,
      `Open ${r.name}'s points or rewards page, if it runs one, and connect the same wallet so the deposit is counted (5 min, $0). No snapshot date is on record.`,
      `Hold for the 12 months the odds cover; check once a month (10 min, 2 h in all). Leave early if TVL falls more than 30% in a week: today's 7-day change is ${(r.change ?? 0).toFixed(1)}%.`,
      `On a token announcement, claim inside the window and withdraw (2 transactions, about ${g(2)} gas, 10 min). No announcement in 12 months: withdraw and re-check the odds.`,
      `At ${usd(e.D)}: expected drop ${usd(e.expected)} (launch value ${usd(r.launch)} x 8% to users x your TVL share x ${(r.odds * 100).toFixed(1)}% odds), less gas ${usd(e.gasCost)} and risk ${usd(e.riskCost)} = ${e.net >= 0 ? '' : '-'}${usd(Math.abs(e.net))} over ${e.hours.toFixed(1)} h, ${e.rate >= 0 ? '' : '-'}${usd(Math.abs(e.rate))}/h: ${e.verdict}. Break-even deposit ${isFinite(e.breakEven) ? usd(e.breakEven) : 'none: risk outweighs the drop'}.`,
    ];
  }

  function run(s) {
    const asOf = Date.parse(s.as_of), all = ledger(s);
    const ages = all.filter((x) => x.p.listed_at).map((x) => Math.max((asOf - Date.parse(x.p.listed_at)) / YEAR, 0.05)).sort((a, b) => a - b);
    const ageFill = ages[Math.floor(ages.length / 2)];
    for (const x of all) Object.assign(x, features(x.p, asOf, ageFill));

    // 1. Launch multiple, fitted on the traded peers.
    const peers = all.filter((x) => x.group === 'traded')
      .map((x) => ({ slug: x.p.slug, listed: x.p.listed_at, f: x.f, y: Math.log(x.p.mcap_usd / x.p.tvl_usd), x }));
    const famCols = FAMILIES.map(([n]) => 'f_' + n);
    const vSel = select('value', peers, { size: ['size'], growth: ['growth'], age: ['age'], family: famCols }, []);
    const flat = heldOut('value', peers, []);
    const vFit = fitLinear(peers, vSel.cols);
    const loo = peers.map((r, i) => Math.abs(fitLinear(peers.filter((_, j) => j !== i), vSel.cols).predict(r) - r.y)).sort((a, b) => a - b);
    const q = quantile(loo, P.target);
    const wf = wfSplit(peers), wfFit = fitLinear(wf.train, vSel.cols);
    const wfLoo = wf.train.map((r, i) => Math.abs(fitLinear(wf.train.filter((_, j) => j !== i), vSel.cols).predict(r) - r.y)).sort((a, b) => a - b);
    const qOld = quantile(wfLoo, P.target);
    const inside = wf.test.filter((r) => Math.abs(wfFit.predict(r) - r.y) <= qOld).length;
    const within2 = loo.filter((e) => e <= Math.log(2)).length;

    // 2. Token odds: which protocols carry a token at which no-token age, from the record of every
    //    protocol that is not set aside. The clock (no-token age) turns a share into 12-month odds:
    //    odds = (p(age + 1) - p(age)) / (1 - p(age)). Its shape is picked on the same two blind tests.
    const pool = all.filter((x) => x.p.listed_at && (x.group === 'traded' || x.group === 'tokenNoCap' || x.group === 'watch' || x.group === 'radar'))
      .map((x) => ({ slug: x.p.slug, listed: x.p.listed_at, f: x.f, y: x.token ? 1 : 0 }));
    const shapes = Object.keys(SHAPES).map((k) => ({ k, s: heldOut('odds', pool, ['clock_' + k, 'size', 'growth']) }));
    const shape = shapes.reduce((a, b) => (b.s[0] + b.s[1] < a.s[0] + a.s[1] ? b : a)).k;
    const oSel = select('odds', pool, { clock: ['clock_' + shape], size: ['size'], growth: ['growth'] }, []);
    const oFlat = heldOut('odds', pool, []);
    const oFit = fitLogit(pool, oSel.cols);
    const useClock = oSel.active.includes('clock');
    const meanAge = mean(pool.map((r) => r.f.age));
    const odds12 = (f) => {
      const p0 = oFit.predict({ f });
      if (!useClock) return clamp(1 - Math.pow(1 - p0, 1 / meanAge), 0.005, 0.9);
      const p1 = oFit.predict({ f: atAge(f, f.age + 1) });
      return clamp((p1 - p0) / (1 - p0), 0.005, 0.9);
    };

    // 3. Price and rank every pre-token protocol.
    const ranked = all.filter((x) => x.group === 'watch' || x.group === 'radar').map((x) => {
      const p = x.p, mult = Math.exp(vFit.predict(x)), launch = p.tvl_usd * mult, odds = odds12(x.f), { chain, gas } = chainOf(p.chains);
      const r = { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl: p.tvl_usd, change: p.change_7d, listed: p.listed_at,
        age: x.f.age, ageKnown: !!p.listed_at, fam: x.fam, watch: x.group === 'watch', floor: s.floor_usd, mult, launch, odds, chain, gas,
        value: launch * odds, lo: launch * odds * Math.exp(-q), hi: launch * odds * Math.exp(q),
        parts: vFit.cols.map((c, j) => ({ term: c, beta: vFit.beta[j + 1] })) };
      r.implied = Math.max(1, Math.round(r.value));
      return r;
    }).sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
    ranked.forEach((r, i) => { r.rank = i + 1; r.plan = farm(r, P.deposit); r.steps = steps(r, r.plan); });

    const sizes = ranked.map((r) => Math.log(r.tvl)).sort((a, b) => a - b);
    const typical = { size: sizes[Math.floor(sizes.length / 2)], growth: 0 };
    const groups = {};
    for (const x of all) groups[x.group] = (groups[x.group] || 0) + 1;
    return {
      asOf: s.as_of, floor: s.floor_usd, total: s.protocols.length, watchTotal: s.watchlist.length, groups, P,
      value: { table: vSel.table, kept: vSel.active, final: vSel.final, flat, q, cover: inside / (wf.test.length || 1), nTest: wf.test.length,
        nPeers: peers.length, cutDate: wf.cutDate, within2: within2 / peers.length, beta: vFit.beta, cols: vFit.cols },
      odds: { table: oSel.table, kept: oSel.active, final: oSel.final, flat: oFlat, n: pool.length, base: mean(pool.map((r) => r.y)), useClock,
        shape, shapes, curve: [0.25, 0.5, 1, 1.5, 2, 3, 4, 5].map((a) => ({ a, h: odds12(atAge(typical, a)) })) },
      rows: ranked,
      peers: peers.map((r) => ({ slug: r.slug, name: r.x.p.name, tvl: r.x.p.tvl_usd, mcap: r.x.p.mcap_usd, fit: Math.exp(vFit.predict(r)), mult: Math.exp(r.y) })),
    };
  }

  /** The rows exactly as board.json carries them. */
  function boardRows(res) {
    return res.rows.map((r) => ({
      slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.steps,
      launch_value_usd: Math.round(r.launch), token_odds_12m: +r.odds.toFixed(4), range_80_usd: [Math.round(r.lo), Math.round(r.hi)],
      verdict: r.plan.verdict, net_usd_per_hour: +r.plan.rate.toFixed(2), break_even_deposit_usd: isFinite(r.plan.breakEven) ? Math.round(r.plan.breakEven) : null,
      watchlist: r.watch, category: r.category,
    }));
  }

  const api = { run, boardRows, farm, steps, usd, P };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Radar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
