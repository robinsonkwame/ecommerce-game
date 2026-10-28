// Pure game rules. Used by the browser (previews) and by the Netlify
// functions (authoritative resolution), so keep this free of DOM and I/O.

export const VIBES = [
  { name: 'New',            blurb: 'A fresh market. Cheap to reach customers, little to lose.' },
  { name: 'Growing',        blurb: 'Demand is rising, and so is the price of attention.' },
  { name: 'Maturing',       blurb: 'Customers know their options. Service and product matter more than hype.' },
  { name: 'Saturated',      blurb: 'Everyone is shouting. Influencers cost more and deliver less.' },
  { name: 'Disruption',     blurb: 'Something new broke the market. Bold moves pay, but risk runs high.' },
  { name: 'Disruption',     blurb: 'The shake-up continues. Innovation and influence still pay, at a price.' },
  { name: 'Consolidation',  blurb: 'Fewer, bigger players. Keeping customers beats finding new ones.' },
  { name: 'Winner takes all', blurb: 'Network effects lock in the leaders. Service is king; hype barely moves the needle.' },
];

export const STRATEGIES = {
  influencer: { label: 'Influencers',          short: 'Influencers', hint: 'Pay creators to bring in customers' },
  service:    { label: 'Customer service',     short: 'Service',     hint: 'Keep the customers you already have' },
  innovation: { label: 'Business innovation',  short: 'Innovation',  hint: 'Build something competitors lack' },
  buydown:    { label: 'Buy down risk',        short: 'Buy down',    hint: 'Spend money to remove risk points' },
  pass:       { label: 'Pass',                 short: 'Pass',        hint: 'No action this quarter' },
};

// [cost, score, risk] per strategy, one row per quarter, exactly as spec.md has it.
export const SPEC_TABLE = [
  { influencer: [ 50, 300, 1], service: [ 50, 150, 1], innovation: [400,  50, 3] }, // 1 New
  { influencer: [100, 250, 2], service: [150, 300, 1], innovation: [300, 100, 2] }, // 2 Growing
  { influencer: [150, 150, 3], service: [100, 200, 1], innovation: [200, 200, 1] }, // 3 Maturing
  { influencer: [200, 100, 4], service: [100, 250, 1], innovation: [150, 350, 1] }, // 4 Saturated
  { influencer: [200, 400, 5], service: [150, 300, 2], innovation: [100, 350, 3] }, // 5 Disruption
  { influencer: [250, 350, 4], service: [200, 300, 2], innovation: [100, 400, 3] }, // 6 Disruption
  { influencer: [300, 150, 3], service: [250, 400, 1], innovation: [200, 300, 2] }, // 7 Consolidation
  { influencer: [100, 150, 2], service: [450, 400, 1], innovation: [400, 350, 2] }, // 8 Winner takes all
];

// A ruleset is everything that sets the game's difficulty. The game doc keeps
// a copy of the ruleset it was created with, so changing these never alters a
// game in progress. tools/balance.mjs simulates any ruleset.
//
//   bust:      what a risk event costs. kind 'fixed': lose `amount` points.
//              kind 'percent': lose `percent`% of points (at least `min`),
//              rounded to `roundTo`. `floor: true` never takes points below 0.
//   allowDebt: may money go below $0? If not, a team must afford its choice,
//              raising cash by selling points if needed.
//   exchange:  sell points for cash in lots of `lotPoints` points for
//              `lotDollars` dollars, alongside the quarter's choice. null = off.
export const RULESETS = {
  spec: {
    id: 'spec', label: 'Original spec',
    startMoney: 600, buyDownCost: 50,
    bust: { kind: 'fixed', amount: 500, floor: false },
    allowDebt: true, exchange: null,
    table: SPEC_TABLE,
  },
};
// Tuned with tools/balance.mjs (see docs/BALANCE.md). Same shape as the spec
// table, with three deliberate changes:
//  1. Fit sets risk. The strategy that suits the quarter adds 1 risk (2 in the
//     bold Disruption plays); a strategy that doesn't fit adds 2–3.
//  2. A risk event costs 40% of your points, like a breach that scales with the
//     number of customer records, so points never go below 0.
//  3. No debt: pay for your choice, selling points 1:1 for cash when short.
RULESETS.balanced = {
  id: 'balanced', label: 'Balanced',
  startMoney: 600, buyDownCost: 50,
  bust: { kind: 'percent', percent: 40, min: 0, roundTo: 10, floor: true },
  allowDebt: false,
  exchange: { lotPoints: 50, lotDollars: 50 },
  table: [
    { influencer: [ 50, 300, 1], service: [100, 100, 2], innovation: [200, 100, 3] }, // 1 New: influencers
    { influencer: [100, 200, 2], service: [100, 300, 1], innovation: [200, 150, 2] }, // 2 Growing: service
    { influencer: [150, 100, 3], service: [100, 200, 2], innovation: [150, 350, 1] }, // 3 Maturing: innovation
    { influencer: [200,  50, 3], service: [100, 200, 2], innovation: [150, 400, 1] }, // 4 Saturated: innovation
    { influencer: [100, 550, 3], service: [100, 200, 1], innovation: [100, 350, 2] }, // 5 Disruption: influencers, bold
    { influencer: [200, 300, 3], service: [150, 200, 1], innovation: [100, 500, 2] }, // 6 Disruption: innovation, bold
    { influencer: [200, 100, 3], service: [150, 450, 1], innovation: [250, 250, 2] }, // 7 Consolidation: service
    { influencer: [100,  50, 3], service: [250, 550, 1], innovation: [300, 350, 2] }, // 8 Winner takes all: service
  ],
};

export const DEFAULT_RULESET = 'balanced';

export function makeSettings(rulesetId = DEFAULT_RULESET) {
  const r = RULESETS[rulesetId] || RULESETS[DEFAULT_RULESET];
  return { ...structuredClone(r), rounds: 8, revealDelayMs: 3000 };
}
export const SETTINGS = makeSettings();

// Games created before rulesets existed carry no table; they used the spec's.
export const tableOf = settings => settings?.table || SPEC_TABLE;
export const bustOf = settings => settings?.bust || { kind: 'fixed', amount: settings?.bustPenalty ?? 500, floor: false };

// Points lost to a risk event when the team holds `points`.
export function penaltyFor(points, settings = SETTINGS) {
  const b = bustOf(settings);
  let amount;
  if (b.kind === 'percent') {
    const raw = Math.max(points, 0) * b.percent / 100;
    const step = b.roundTo || 10;
    amount = Math.max(b.min || 0, Math.round(raw / step) * step);
  } else amount = b.amount;
  if (b.floor) amount = Math.min(amount, Math.max(points, 0));
  return amount;
}

// One line for students: what a risk event costs under these rules.
export function penaltyText(settings = SETTINGS) {
  const b = bustOf(settings);
  if (b.kind === 'percent') return `lose ${b.percent}% of your points${b.min ? ` (at least ${b.min})` : ''}`;
  return `lose ${b.amount} points${b.floor ? ' (never below 0)' : ''}`;
}

// Chance a team holding `risk` points suffers a risk event on a fair d6.
export const bustChance = risk => Math.min(Math.max(risk - 1, 0), 6) / 6;

// What a choice does this quarter: { action, qty, lots, sold, raised, cost, score, riskAdded }.
export function describeChoice(round, choice, settings = SETTINGS) {
  const row = tableOf(settings)[round - 1];
  if (!row) throw new Error(`No such quarter: ${round}`);
  const action = choice?.action || 'pass';
  const ex = settings.exchange;
  const lots = ex ? Math.max(0, Math.floor(Number(choice?.lots) || 0)) : 0;
  const sale = { lots, sold: lots * (ex?.lotPoints || 0), raised: lots * (ex?.lotDollars || 0) };
  if (action === 'pass') return { action, qty: 0, ...sale, cost: 0, score: 0, riskAdded: 0 };
  if (action === 'buydown') {
    const qty = Math.max(0, Math.floor(Number(choice.qty) || 0));
    return { action, qty, ...sale, cost: qty * settings.buyDownCost, score: 0, riskAdded: -qty };
  }
  const t = row[action];
  if (!t) throw new Error(`Unknown strategy: ${action}`);
  return { action, qty: 0, ...sale, cost: t[0], score: t[1], riskAdded: t[2] };
}

// Fewest lots of points to sell so `money` covers `cost` (0 if it already does).
export function lotsNeeded(money, cost, settings = SETTINGS) {
  const ex = settings.exchange;
  if (!ex || money >= cost) return 0;
  return Math.ceil((cost - money) / ex.lotDollars);
}

// Returns an error message, or null when the choice is allowed.
export function validateChoice(team, round, choice, settings = SETTINGS) {
  if (!choice || !STRATEGIES[choice.action]) return 'Pick a strategy first';
  if (choice.lots && !settings.exchange) return 'Selling points is not part of these rules';
  if (!Number.isInteger(Number(choice.lots || 0)) || Number(choice.lots || 0) < 0) return 'Choose how many points to sell';
  if (choice.action === 'buydown') {
    const qty = Math.floor(Number(choice.qty) || 0);
    if (qty < 1) return 'Choose how many risk points to buy down';
    if (qty > team.risk) return `You only have ${team.risk} risk point${team.risk === 1 ? '' : 's'}`;
  }
  let d;
  try { d = describeChoice(round, choice, settings); } catch (e) { return e.message; }
  if (d.sold > Math.max(team.points, 0)) return `You only have ${Math.max(team.points, 0).toLocaleString()} points to sell`;
  if (!settings.allowDebt && team.money + d.raised < d.cost) {
    const short = d.cost - team.money - d.raised;
    return settings.exchange
      ? `You need ${fmtMoney(short)} more. Sell points or pick something cheaper.`
      : `You need ${fmtMoney(short)} more. Pick something cheaper.`;
  }
  return null;
}

// Apply a quarter to a team and test it against the dice. Pure.
// Order: sell points → pay cost → add score → add risk → roll.
export function resolveTeam(team, choice, round, dice, settings = SETTINGS) {
  const d = describeChoice(round, choice, settings);
  const money = team.money + d.raised - d.cost;
  let points = team.points - d.sold + d.score;
  let risk = Math.max(0, team.risk + d.riskAdded);
  const riskBeforeDice = risk;
  const busted = risk > dice;
  const penalty = busted ? penaltyFor(points, settings) : 0;
  if (busted) { points -= penalty; risk = 0; }
  const entry = {
    round, action: d.action, qty: d.qty, lots: d.lots, sold: d.sold, raised: d.raised,
    cost: d.cost, score: d.score, riskAdded: d.riskAdded,
    dice, riskBeforeDice, busted, penalty,
    money, points, risk,
  };
  return { entry, money, points, risk };
}

export function fmtMoney(n) {
  const v = Math.round(n);
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString();
}
export function fmtSigned(n, unit = '') {
  const v = Math.round(n);
  return (v < 0 ? '−' : '+') + unit + Math.abs(v).toLocaleString();
}
export function choiceLabel(c) {
  if (!c) return '—';
  const base = c.action === 'buydown' ? `Buy down ${c.qty}` : (STRATEGIES[c.action]?.short || c.action);
  return c.lots ? `${base} + cash` : base;
}
