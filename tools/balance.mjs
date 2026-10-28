// Balance simulator. Plays thousands of games on the real rules (rules.js)
// with different kinds of players and reports how hard the game is.
//
//   node tools/balance.mjs [ruleset] [--games N] [--seed S]
//
// ruleset: a key of RULESETS (spec, balanced) or a path to a JSON ruleset.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RULESETS, makeSettings, describeChoice, validateChoice, resolveTeam, bustChance, lotsNeeded, penaltyFor, VIBES } from '../public/js/rules.js';

const STRATS = ['influencer', 'service', 'innovation'];

// ---------- deterministic RNG so runs are comparable ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Every legal move this quarter: pass, each strategy, each buy-down amount,
// each with the fewest points sold to afford it (if the rules need that).
export function moves(team, round, S, allowed = null) {
  const out = [];
  const add = c => {
    if (allowed && !allowed.has(c.action)) return;
    const cost = describeChoice(round, c, S).cost;
    const ch = { ...c, lots: S.allowDebt ? 0 : lotsNeeded(team.money, cost, S) };
    if (!validateChoice(team, round, ch, S)) out.push(ch);
  };
  add({ action: 'pass' });
  for (const a of STRATS) add({ action: a });
  for (let q = 1; q <= team.risk; q++) add({ action: 'buydown', qty: q });
  return out;
}

// The two things the dice can do to a move: nothing, or a risk event.
function outcomes(team, ch, round, S) {
  const d = describeChoice(round, ch, S);
  const riskAfter = Math.max(0, team.risk + d.riskAdded);
  const pB = bustChance(riskAfter);
  const res = [];
  if (pB < 1) res.push({ p: 1 - pB, r: resolveTeam(team, ch, round, Infinity, S) });
  if (pB > 0) res.push({ p: pB, r: resolveTeam(team, ch, round, -Infinity, S) });
  return res;
}
const next = (team, r) => ({ ...team, money: r.money, points: r.points, risk: r.risk });

// Exact dynamic program: the move that maximizes expected final points.
function makeOptimal(S, allowed = null) {
  const memo = new Map();
  function V(round, team) {
    if (round > S.rounds) return { v: team.points };
    const key = `${round}|${team.money}|${team.points}|${team.risk}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = { v: -Infinity, ch: null };
    for (const ch of moves(team, round, S, allowed)) {
      let v = 0;
      for (const o of outcomes(team, ch, round, S)) v += o.p * V(round + 1, next(team, o.r)).v;
      if (v > best.v + 1e-9) best = { v, ch };
    }
    memo.set(key, best);
    return best;
  }
  const policy = (team, round) => V(round, team).ch;
  policy.value = team => V(1, team).v;
  policy.states = () => memo.size;
  return policy;
}

// One-quarter expected value, pricing each risk point carried forward at one
// sixth of what a risk event would cost now (each point adds a 1-in-6 chance).
// Roughly what a thoughtful student does with the playbook in front of them.
function makeThoughtful(S) {
  return (team, round) => {
    let best = null, bestV = -Infinity;
    for (const ch of moves(team, round, S)) {
      let v = 0;
      for (const o of outcomes(team, ch, round, S)) {
        const riskPrice = round < S.rounds ? penaltyFor(o.r.points, S) / 6 : 0;
        v += o.p * (o.r.points - riskPrice * o.r.risk);
      }
      if (ch.action === 'pass') v -= 1;  // prefer doing something on a tie
      if (v > bestV) { bestV = v; best = ch; }
    }
    return best;
  };
}

function scoreOf(ch, round, S) { return describeChoice(round, ch, S).score; }

const POLICIES = {
  optimal: S => makeOptimal(S),
  thoughtful: S => makeThoughtful(S),
  // Highest score this quarter, never manages risk.
  greedy: S => (team, round) => {
    const ms = moves(team, round, S).filter(m => STRATS.includes(m.action));
    if (!ms.length) return { action: 'pass' };
    return ms.sort((a, b) => scoreOf(b, round, S) - scoreOf(a, round, S) || a.lots - b.lots)[0];
  },
  // Greedy, but buys risk down to 1 once it reaches 4.
  cautious: S => (team, round) => {
    if (team.risk >= 4) {
      const bd = moves(team, round, S).filter(m => m.action === 'buydown').sort((a, b) => b.qty - a.qty);
      const target = bd.find(m => team.risk - m.qty <= 1) || bd[0];
      if (target) return target;
    }
    return POLICIES.greedy(S)(team, round);
  },
  // Picks a strategy at random each quarter.
  random: (S, R) => (team, round) => {
    const ms = moves(team, round, S).filter(m => STRATS.includes(m.action));
    return ms.length ? ms[Math.floor(R() * ms.length)] : { action: 'pass' };
  },
};
// Never changes strategy, but otherwise plays perfectly (optimal buy-downs,
// selling, passing). The gap to `optimal` is what matching the quarter is worth.
for (const a of STRATS) POLICIES[`only-${a}`] = S => makeOptimal(S, new Set([a, 'buydown', 'pass']));

function play(S, policy, R, rollDie = () => 1 + Math.floor(R() * 6)) {
  let team = { money: S.startMoney, points: 0, risk: 0 };
  const log = [];
  let stuck = 0;
  for (let round = 1; round <= S.rounds; round++) {
    const legal = moves(team, round, S).filter(m => STRATS.includes(m.action));
    if (!legal.length && !stuck) stuck = round;
    const ch = policy(team, round) || { action: 'pass' };
    const err = validateChoice(team, round, ch, S);
    if (err) throw new Error(`policy chose an illegal move in Q${round}: ${err}`);
    const r = resolveTeam(team, ch, round, rollDie(round), S);
    team = next(team, r);
    log.push(r.entry);
  }
  return { team, log, stuck };
}

const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const r0 = n => Math.round(n);
const p1 = n => `${(100 * n).toFixed(1)}%`;

export function evaluate(S, { games = 4000, seed = 1 } = {}) {
  const rows = {}, raw = {};
  for (const [name, make] of Object.entries(POLICIES)) {
    const R = rng(seed);
    const policy = make(S, R);
    const finals = [], q4neg = [], q4broke = [], endneg = [], busts = [], sold = [], stuckAt = [], picks = Array.from({ length: S.rounds }, () => ({}));
    for (let g = 0; g < games; g++) {
      const { team, log, stuck } = play(S, policy, R);
      finals.push(team.points);
      q4neg.push(log[3].points < 0);
      q4broke.push(log[3].money < 0 || moves({ money: log[3].money, points: log[3].points, risk: log[3].risk }, 5, S).filter(m => STRATS.includes(m.action)).length === 0);
      endneg.push(team.points < 0);
      busts.push(log.filter(e => e.busted).length);
      sold.push(log.reduce((a, e) => a + (e.sold || 0), 0));
      stuckAt.push(stuck);
      log.forEach((e, i) => { picks[i][e.action] = (picks[i][e.action] || 0) + 1; });
    }
    raw[name] = { finals, picks };
    rows[name] = {
      mean: r0(mean(finals)), p10: pct(finals, 0.1), p50: pct(finals, 0.5), p90: pct(finals, 0.9),
      negQ4: mean(q4neg), brokeQ4: mean(q4broke), negEnd: mean(endneg),
      busts: mean(busts), sold: r0(mean(sold)), stuck: mean(stuckAt.map(x => x > 0 && x <= 5)),
      passRate: picks.reduce((a, p) => a + (p.pass || 0), 0) / (games * S.rounds),
      buydownRate: picks.reduce((a, p) => a + (p.buydown || 0), 0) / (games * S.rounds),
    };
  }
  const bestFixed = Math.max(...STRATS.map(a => rows[`only-${a}`].mean));
  const beatsRandom = mean(raw.thoughtful.finals.map((f, i) => f > raw.random.finals[i]));
  return { rows, raw, bestFixed, beatsRandom };
}

// A class of 12 teams sharing one die per quarter, as in the classroom.
export function classroom(S, { classes = 2000, seed = 7 } = {}) {
  const R = rng(seed);
  const mix = ['optimal', 'thoughtful', 'thoughtful', 'thoughtful', 'cautious', 'cautious', 'cautious', 'greedy', 'greedy', 'greedy', 'random', 'random'];
  const pols = mix.map(n => POLICIES[n](S, R));
  const negQ4 = [], negEnd = [], zeroBustClass = [];
  for (let c = 0; c < classes; c++) {
    const dice = Array.from({ length: S.rounds }, () => 1 + Math.floor(R() * 6));
    const res = pols.map(p => play(S, p, R, round => dice[round - 1]));
    negQ4.push(res.filter(r => r.log[3].points < 0).length);
    negEnd.push(res.filter(r => r.team.points < 0).length);
    zeroBustClass.push(res.every(r => !r.log.some(e => e.busted)));
  }
  return { negQ4mean: mean(negQ4), negQ4p90: pct(negQ4, 0.9), negEndMean: mean(negEnd), quietGames: mean(zeroBustClass) };
}

export function report(S, opts) {
  const { rows, raw, bestFixed, beatsRandom } = evaluate(S, opts);
  const cls = classroom(S);
  const lines = [];
  lines.push(`Ruleset: ${S.label} (${S.id}) · ${opts.games} games per player type`);
  lines.push('');
  lines.push('| Player | Mean pts | p10 | p50 | p90 | <0 pts after Q4 | Broke after Q4 | <0 pts at end | Risk events | Pts sold |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [n, r] of Object.entries(rows)) lines.push(`| ${n} | ${r.mean} | ${r.p10} | ${r.p50} | ${r.p90} | ${p1(r.negQ4)} | ${p1(r.brokeQ4)} | ${p1(r.negEnd)} | ${r.busts.toFixed(2)} | ${r.sold} |`);
  lines.push('');
  lines.push(`Optimal vs best single-strategy player: ${rows.optimal.mean} vs ${bestFixed} (+${p1(rows.optimal.mean / bestFixed - 1)})`);
  lines.push(`Thoughtful vs best single-strategy player: +${p1(rows.thoughtful.mean / bestFixed - 1)}`);
  lines.push(`Thoughtful beats random in ${p1(beatsRandom)} of head-to-head games`);
  lines.push(`Classroom of 12 (shared die): teams below 0 after Q4 avg ${cls.negQ4mean.toFixed(2)} (p90 ${cls.negQ4p90}); below 0 at end avg ${cls.negEndMean.toFixed(2)}; games with no risk event at all ${p1(cls.quietGames)}`);
  lines.push('');
  lines.push('Optimal player\'s choice by quarter:');
  raw.optimal.picks.forEach((p, i) => {
    const tot = Object.values(p).reduce((a, b) => a + b, 0);
    lines.push(`  Q${i + 1} ${VIBES[i].name.padEnd(17)} ` + Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${p1(v / tot)}`).join(', '));
  });
  lines.push('Thoughtful player\'s choice by quarter:');
  raw.thoughtful.picks.forEach((p, i) => {
    const tot = Object.values(p).reduce((a, b) => a + b, 0);
    lines.push(`  Q${i + 1} ${VIBES[i].name.padEnd(17)} ` + Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${p1(v / tot)}`).join(', '));
  });
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
  const name = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'balanced';
  const S = RULESETS[name] ? makeSettings(name) : { ...makeSettings('spec'), ...JSON.parse(readFileSync(name, 'utf8')) };
  console.log(report(S, { games: flag('--games', 4000), seed: flag('--seed', 1) }));
}
