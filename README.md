# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/djodiaja/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/djodiaja/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar over a sealed DefiLlama snapshot. It ranks every protocol that records no token by an implied value and gives each one a farm plan with costs, times and a net expected value per $1,000. The implied value comes from a ridge regression of ln(market cap) on ln TVL, years listed and category family, fitted on the protocols whose token already trades. Each term is kept only if leaving it out raises the held-out miss on both leave-one-out and walk-forward (older-listed tokens price the newer ones) tests; 7-day TVL change failed and was dropped. Typical miss ×2.73 (leave-one-out) and ×2.67 (walk-forward), against ×3.93 for a category-median multiple; the printed 80% range covers 84% of the newer tokens. The page re-runs the model in the browser and confirms it reproduces board.json row for row, and accounts for all 758 snapshot protocols. A protocol whose name matches a traded token's is halved as a likely product of that token. The model lives in `dashboard/model.js`, used both by `main.ts` to write `board.json` and by the page to show how each value was built. The dashboard is static, dark and works offline: sortable board, category, chain, trend and watchlist filters, a detail view per protocol and a tab of the traded peers that anchor the multiples.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Then open `out/dashboard/index.html`. `node tools/shoot.mjs` re-takes the three screenshots with headless Edge or Chrome.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vkeq2szk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
