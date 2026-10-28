# Game balance

The game ships with a **Balanced** ruleset, tuned with a simulator against the
targets below. The original numbers from `spec.md` are kept as the **Original
spec** ruleset for comparison. Both live in `public/js/rules.js`.

## What changed from the spec, and why

| | Original spec | Balanced |
|---|---|---|
| Running short of cash | Money goes below $0; no consequence | You can't spend money you don't have. **Sell points for cash, 50 points → $50**, as part of the quarter's choice |
| Risk event (risk > die) | Lose 500 points (can go below 0) | **Lose 40% of your points** (never below 0) |
| Risk per strategy | Mostly fixed by strategy | **Set by fit:** the strategy that suits the quarter adds 1 risk; one that doesn't adds 2–3. The bold Disruption plays add 2–3 |
| Scores and costs | See spec table | Reshaped so each quarter has one clearly best strategy that matches its description |
| Starting cash, buy-down | $600, $50 per risk point | Same |

Why each change:

- **Selling points for cash.** Money now matters as a budget, and running out
  has a way out. Points are your customer base, so selling them for cash is
  monetizing customers: the CAC vs. LTV balance from the slides. The rate is
  1:1 because any loss made "Pass" the best move whenever cash was short.
- **A 40% breach penalty.** It follows the spec's own background: IBM puts a
  breach at about $150 per record, so the cost scales with the size of the
  business. Points can't go below zero. An early breach stings, and a late
  breach costs a leader dearly, which makes protecting a lead in
  Consolidation and Winner Takes All worthwhile. At 50%, perfect play stopped
  taking the bold Disruption moves, so 40% it is.
- **Risk set by fit.** This makes matching the quarter both the high-scoring
  play and the safe one. A team that sticks with one strategy piles up risk
  in the quarters it doesn't suit.

## Targets and results

Simulated with `npm run balance`: 5,000 games per player type, and 2,000
classrooms of 12 teams sharing one die per quarter.

| Target | Original spec | Balanced |
|---|---|---|
| Teams below 0 points after Q4 | 29% of random players | **0%** for every player type |
| Teams in debt or stuck after Q4 | 48% of random players | **0%**; 0.8% of random players |
| Perfect play vs best one-strategy player | +17% | **+33%** |
| Thoughtful student vs best one-strategy player | +9% | **+31%** |
| Thoughtful student beats a random one | 97% | 99% |
| Risk events per game: careful / greedy / random | 0.8 / 2.6 / 3.2 | 0.9 / 2.3 / 3.1 |
| Perfect play ever passes | sometimes | **never** |
| Classrooms with no risk event at all | 0% | 0% |

Mean final points:

| Player type | What it does | Spec | Balanced |
|---|---|---:|---:|
| Optimal | Computed best play: maximizes expected final points | 1730 | 1737 |
| Thoughtful | Weighs this quarter's points against the risk it carries forward | 1614 | 1714 |
| Cautious | Highest score now; buys risk down once it reaches 4 | 1482 | 1629 |
| Greedy | Highest score now; ignores risk | 1457 | 1555 |
| Only service | Never changes strategy (best of the three) | 1474 | 1305 |
| Only innovation | Never changes strategy | 997 | 1155 |
| Only influencers | Never changes strategy | 580 | 897 |
| Random | Picks a strategy at random | 506 | 624 |

The "only" players otherwise play perfectly: they buy down, sell, and pass at
the best times. The gap between them and Optimal is what matching the quarter
is worth.

What perfect play does each quarter under Balanced. It follows the vibe
descriptions:

| Quarter | Best move |
|---|---|
| 1 New | Influencers |
| 2 Growing | Customer service |
| 3 Maturing | Buy down risk (83%) or innovation |
| 4 Saturated | Innovation |
| 5 Disruption | Influencers, the bold play |
| 6 Disruption | Innovation or buy down, about half each |
| 7 Consolidation | Customer service or buy down |
| 8 Winner takes all | Customer service |

## The Balanced table

Each cell is cost / score / risk. **Bold** is the strategy that fits the
quarter.

| Quarter | Influencers | Customer service | Business innovation |
|---|---|---|---|
| 1 New | **$50 / +300 / +1** | $100 / +100 / +2 | $200 / +100 / +3 |
| 2 Growing | $100 / +200 / +2 | **$100 / +300 / +1** | $200 / +150 / +2 |
| 3 Maturing | $150 / +100 / +3 | $100 / +200 / +2 | **$150 / +350 / +1** |
| 4 Saturated | $200 / +50 / +3 | $100 / +200 / +2 | **$150 / +400 / +1** |
| 5 Disruption | **$100 / +550 / +3** | $100 / +200 / +1 | $100 / +350 / +2 |
| 6 Disruption | $200 / +300 / +3 | $150 / +200 / +1 | **$100 / +500 / +2** |
| 7 Consolidation | $200 / +100 / +3 | **$150 / +450 / +1** | $250 / +250 / +2 |
| 8 Winner takes all | $100 / +50 / +3 | **$250 / +550 / +1** | $300 / +350 / +2 |

In Disruption, customer service is the safe, modest fallback: in the spec's
words, it is "more important but still not dominant."

## Trade-offs to know about

- **A team that matches every quarter but ignores risk still does well**, at
  about 90% of perfect play. Those teams take two or more breaches per game,
  so they feel the risk lesson, but matching is the bigger lever. That is
  intended.
- **Perfect play buys down risk in about 2 of 8 quarters.** Risk still grows
  every quarter, as the spec says, so a periodic security investment pays off.
- **Under 1% of purely random teams get stuck.** Those teams have no cash and
  too few points to sell, so they can only pass. Real students rarely play
  that randomly. If it happens in class, a reset is the only remedy today.

## Retuning

Edit `RULESETS.balanced` in `public/js/rules.js`, then run:

```bash
npm run balance
npm test
```

`test/balance.test.mjs` fails if a change breaks the targets above. To play
with the original numbers, set `DEFAULT_RULESET = 'spec'` in `rules.js`; the
next game reset uses it. A running game keeps the ruleset it started with.
