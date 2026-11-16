[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Unge32/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Unge32/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar — pre-token protocols, priced like the market prices the live ones

An entry for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a program that reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token, and ranks them by what their token launch would be worth — plus a static dashboard a reader can use.

## The model (radar-2)

Each pre-token protocol is priced off the live market, not a hand-written list:

```
implied = clamp( tvl_usd x multiple x maturity x growth x breadth, $1M, $100B )
multiple = category median of mcap / TVL over live-token protocols
           (min 3 comparables, else the global median, else 0.5)
maturity = 0.7 + 0.3 x min(1, age_years / 3)
growth   = 1 + 0.5 x clip(change_7d / 100, -0.5, 1.0)
breadth  = 1 + 0.05 x min(chains, 5)
```

The board covers the snapshot's whole 40-protocol watchlist (the floor, never the ceiling) plus the 160 pre-token protocols below the floor with the most TVL. Every row carries a six-step farm plan with costs in USD and durations, derived from the protocol's own category, chains, TVL and age. Live-token protocols are never ranked; they are the comparables, shown in a panel of their own.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` through, and writes `dossier.json` with the vendored `vendor/makefun-board.ts`. It is deterministic: two runs write identical bytes, and it exits non-zero if the board would fail the gate.

## Layout

- `main.ts` — the entrypoint
- `lib/model.ts` — the model, the board builder, the farm plans
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`; no network, loads `../data.js`)
- `screenshots/` — the board, a detail view and a filtered view
- `vendor/makefun-board.ts` — the make.fun dossier library, unchanged
