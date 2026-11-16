# Pre-Token Radar — which protocol's launch is worth farming?

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/qs8579904/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/qs8579904/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar for the protocols that have no token yet. It reads one frozen snapshot of
every protocol DefiLlama tracks (758 protocols, as of 2026-11-14), finds the ones
still waiting on a launch, ranks them by what that launch would be worth, and
shows a concrete farm plan for each one.

## How the value model works

No hardcoded protocol lists, no outside data — every number comes from the
snapshot itself:

1. **Category multiple, calibrated from the market.** For each category, the
   median market-cap-to-TVL ratio of the snapshot's own live-token protocols
   (small categories shrunk toward the global median). A DEX and a liquid-staking
   protocol are worth different multiples of their TVL, and the snapshot says
   how different: DEXes trade near 0.34x TVL, liquid staking near 0.03x. The
   house model's flat 0.25x for everything overvalues the cheap categories and
   undervalues the dear ones.
2. **Growth.** The protocol's 7-day TVL change, clamped to [-50%, +150%],
   moves the value by up to 0.4x per 100 points.
3. **Maturity.** Older protocols get a higher multiple (0.7 + up to 0.3 by age,
   capped at 3 years); unknown age counts as one year.
4. **Chain breadth.** Each extra chain adds 4%, capped at +20%: a protocol live
   on five chains has more surface for a launch than one on a single chain.

`implied value = TVL x category multiple x growth x maturity x chain breadth`,
rounded to whole dollars. The board ranks 200 protocols: the full 40-protocol
watchlist (TVL >= $50M, no token) plus the 160 largest pre-token protocols
below the floor, by TVL. A separate Live token view shows the 24 largest
protocols that already trade, at their real market caps — never mixed into the
ranked board.

## Farm plans

Every row carries a 7-step farm plan derived from that protocol's own record —
its category, its chains, its TVL and its age. A lending protocol gets a
supply-and-borrow loop; a DEX gets liquidity plus swap volume; an RWA protocol
gets minting plus its whitelist note; a risk curator gets deposits across two
vaults. Capital tiers follow TVL, hold periods follow age, and every plan ends
with the same two disciplines: check the protocol's own points page, and keep a
farm log.

## Run it

Requires Node.js 22.18 or later. No install, no network.

```sh
node main.ts --input /path/to/snapshot.json --output out
```

`main.ts` reads the sealed snapshot, writes `board.json` (the ranked board),
`data.js` (the dashboard's dataset), copies `dashboard/` and `screenshots/`,
and writes `dossier.json` last with the vendored `vendor/makefun-board.ts`
library. Output is deterministic: two runs write byte-identical files.

## Layout

- `main.ts` — entry point: read snapshot, score, write outputs.
- `lib/model.ts` — the model: snapshot parsing, category calibration, implied
  values, farm plans, board checks.
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored, as shipped).
- `dashboard/` — the static page (board, detail view, filter, live view).
- `screenshots/` — the board, a detail view and a filtered view of the page.

## License

MIT. See `LICENSE`.
