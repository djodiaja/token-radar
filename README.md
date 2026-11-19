# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/djodiaja/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/djodiaja/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token radar over a sealed DefiLlama snapshot. It ranks every protocol that records no token by an implied value and gives each one a farm plan with costs and times. The implied value is the protocol's TVL times the market-cap/TVL multiple that traded tokens in its category carry (shrunk toward the category's family when peers are few), times 7-day momentum, times a runway factor for how long it has run with no token, halved when a protocol whose token already trades shares its name. The model lives in `dashboard/model.js`, used both by `main.ts` to write `board.json` and by the page to show how each value was built. The dashboard is static, dark and works offline: sortable board, category, chain, trend and watchlist filters, a detail view per protocol and a tab of the traded peers that anchor the multiples.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Then open `out/dashboard/index.html`. `node tools/shoot.mjs` re-takes the three screenshots with headless Edge or Chrome.

---

<sub>Entered on [make.fun](https://make.fun/?ref=vkeq2szk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
