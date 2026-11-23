# Shadow Copy Radar — token-radar-01

Which pre-token protocol would a copy-trader follow — and with how much?

Most radars rank by size. This one ranks by **copy signal**: the five
traces a copy-trader reads before mirroring a wallet cohort into a
protocol that has not launched a token yet.

## The model (`shadow-copy-1`)

Every signal comes from the sealed snapshot's own figures; no protocol
name is ever special-cased, and the same function scores every row.

| Signal | Weight | What it measures |
| --- | --- | --- |
| Inflow | 30% | 7-day TVL flow, clamped to −50…+150% and normalised — wallets arriving or leaving |
| Scale | 20% | Log TVL ($5M → 0, $100B → 1) — enough depth to enter and exit |
| Breadth | 15% | Chain count (1 → 0.25, 5+ → 1) — more chains, more wallet cohorts |
| Persistence | 15% | Age — a protocol that survived is likelier to launch |
| Category heat | 20% | Median 7-day flow of the category's pre-token peers |

```
copy_score    = 0.30·inflow + 0.20·scale + 0.15·breadth + 0.15·persistence + 0.20·category_heat
implied_value = TVL × 0.22 × (0.35 + 1.6 × copy_score)
```

**Tiers size the mirror, they never exclude:** A (score ≥ 0.50) mirrors
$250, B (≥ 0.38) $150, C $75, with at most 6 / 4 / 2 mirrors running at
each tier. The board therefore carries the whole rankable universe —
all 40 watchlist protocols plus every rankable pre-token protocol below
the watchlist floor (226 rows) — instead of a capped sample.

**Copy plan:** every row gets six steps generated from its own record
(category, chain, TVL, age, 7-day flow, tier): a fresh copy wallet, the
mirror action, a flow trigger (add only while the weekly flow stays
positive), tier sizing, a hold-and-unwind rule, and a copy log. The
dashboard regenerates the same plan in the browser from the row's data.

## The dashboard

A static page (`dashboard/`, no framework, no network) reading `data.js`:

- **Copy board** — rank, protocol, category, chains, TVL, 7-day flow,
  copy-score bar, tier, implied value. Search, category / chain /
  minimum-score filters, watchlist-only toggle, sorting.
- **Detail view** — click any row: the five signals decomposed, the
  mirror size, and the six-step copy plan.
- **Live tokens** — the protocols that already trade, at the market's
  own values, so a launch is never confused with a listing.

The page recomputes every row's copy score and implied value from the
row's own signals — the number on screen is the model's number.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18+ (standard library only). The program writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`. Open `out/dashboard/index.html` in a browser;
`#/p/<slug>` opens a protocol's detail view and `#/f?minScore=0.65`
opens a filtered board.

## Notes

- "Records no token" means the snapshot records no market cap, no
  CoinGecko id and no symbol — the list's record, never proof a
  protocol has none.
- Implied values are this entry's own claim, never the platform's.
- `vendor/makefun-board.ts` is the kit's library, byte for byte.
