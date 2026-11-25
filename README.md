# Pre-token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/djodiaja/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/djodiaja/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's token-radar-01. It ranks the protocols in DefiLlama's sealed snapshot that record no
token, by what a launch would be worth, and gives each one a costed farm plan with a verdict.

## The model (`dashboard/model.js`, run by both `main.ts` and the page)

    implied value = TVL x launch multiple x 12-month token odds

- **Launch multiple**: a median (least-absolute-miss) fit of ln(market cap / TVL) on the 128 traded tokens,
  one row per ticker: a token's cap prices its whole family, so its TVL is the family's sum (Aave V1-V4,
  Horizon). Candidate terms: size curve (ln TVL), 7-day TVL growth, years listed, chains, category family.
  Held-out miss: x4.74 leave-one-out / x5.13 walk-forward (geometric mean), x3.42 / x3.09 median.
- **Token odds**: a logistic "no-token clock" fitted on 499 dated protocols, which ones carry a token
  at which age, with size and growth. The 12-month odds are (p(age + 1) - p(age)) / (1 - p(age)).
  The clock's shape (linear, square root or log age) is picked on the blind tests.
- **Term selection**: backward elimination. A term stays only if leaving it out worsens BOTH blind tests:
  leave-one-out (10-fold for the odds) and walk-forward (fit the older-listed 60%, price the newer 40%).
- **Range**: split-conformal 80% band. Newer tokens miss more than older ones, so it takes the 85th-percentile
  leave-one-out miss; on the walk-forward split 82% of the 38 newer tokens land inside (the 80th covers 71%).
- **Farm verdicts**: at a chosen deposit, expected drop = launch value x 8% to users x your TVL share x
  odds, less gas (per chain) and a risk cost; FARM at $25/h net or more, THIN when net is positive, else
  SKIP. Each plan has six steps with their cost and time, the break-even deposit and the deposit that
  turns it to FARM.

The page recomputes every row from the raw snapshot in the browser and shows the check on its cover:
rows equal to board.json, 758/758 protocols in one ledger group, 40/40 watchlist ranked.

## Run

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
    node tools/shoot.mjs out    # the three screenshots, with headless Chrome or Edge

Node 22+, standard library only. A model's claim from the snapshot, not financial advice.
