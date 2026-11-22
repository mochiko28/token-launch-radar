# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mochiko28/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks DeFi protocols that record no token yet by an implied value, and gives each one a farm plan with costs and times.

- **Value model** (`dashboard/model.js`): the snapshot's own traded tokens are the calibration set. An OLS fit of log market cap on log TVL prices a dollar of TVL. A shrunk per-category residual adjusts it, the 7-day TVL trend is compounded over two weeks, and a retention factor on days without a token discounts young, points-driven TVL. No protocol is named anywhere in the model.
- **Board**: every watchlist protocol, plus every other pre-token protocol in the snapshot that is not a bridge, liquid-staking, CEX, versioned or wrapped product.
- **Farm plans**: seven steps per protocol, each with a dollar cost and a time. The plan picks the cheapest chain the protocol lists, the capital, the hold period and an exit rule, and states the modelled drop and its edge over gas, fees and forgone T-bill yield.
- **One model, two callers**: `main.ts` runs `dashboard/model.js` to write `board.json`. The page runs the same file in the browser and checks every rank and value against `board.json`.

The implied value is this model's own claim of what a token would be worth if the record stayed as it is. It does not predict that a token will launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
# then open out/dashboard/index.html
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
