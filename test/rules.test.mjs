import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEC_TABLE, RULESETS, makeSettings, describeChoice, validateChoice, resolveTeam, penaltyFor, lotsNeeded, tableOf, bustChance } from '../public/js/rules.js';
import * as E from '../public/js/engine.js';
import { completionCode } from '../public/js/code.js';

const SPEC = makeSettings('spec');
const BAL = makeSettings('balanced');
const team = (o = {}) => ({ name: 'T', slug: 't', money: 600, points: 0, risk: 0, pending: null, history: [], updatedAt: 0, ...o });

test('both rulesets have 8 quarters × 3 strategies of [cost, score, risk]', () => {
  for (const S of [SPEC, BAL]) {
    assert.equal(tableOf(S).length, 8);
    for (const row of tableOf(S)) for (const k of ['influencer', 'service', 'innovation']) {
      assert.equal(row[k].length, 3);
      assert.ok(row[k][2] >= 1, 'every strategy adds risk');
    }
  }
});

test('spec ruleset keeps spec.md values', () => {
  assert.deepEqual(describeChoice(1, { action: 'innovation' }, SPEC), { action: 'innovation', qty: 0, lots: 0, sold: 0, raised: 0, cost: 400, score: 50, riskAdded: 3 });
  assert.deepEqual(describeChoice(8, { action: 'service' }, SPEC).cost, 450);
  assert.deepEqual(describeChoice(5, { action: 'influencer' }, SPEC).riskAdded, 5);
  assert.equal(tableOf({}), SPEC_TABLE, 'games saved before rulesets fall back to the spec table');
});

test('buy down costs per point and cannot exceed current risk', () => {
  const t = team({ risk: 2 });
  assert.equal(describeChoice(3, { action: 'buydown', qty: 2 }, SPEC).cost, 100);
  assert.equal(validateChoice(t, 3, { action: 'buydown', qty: 3 }, SPEC), 'You only have 2 risk points');
  assert.equal(validateChoice(t, 3, { action: 'buydown', qty: 2 }, SPEC), null);
});

test('spec: risk > die subtracts 500 and resets risk; money and points may go negative', () => {
  const r = resolveTeam(team({ risk: 2 }), { action: 'influencer' }, 3, 4, SPEC);
  assert.equal(r.points, 150 - 500);
  assert.equal(r.risk, 0);
  assert.equal(resolveTeam(team({ risk: 2 }), { action: 'service' }, 3, 3, SPEC).entry.busted, false);
  assert.equal(resolveTeam(team({ money: 100 }), { action: 'innovation' }, 1, 6, SPEC).money, -300);
});

test('bust chance: risk r loses when the die shows less than r', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 9].map(bustChance), [0, 0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1, 1]);
});

test('balanced: a risk event costs 40% of points, never going below 0', () => {
  assert.equal(penaltyFor(1000, BAL), 400);
  assert.equal(penaltyFor(333, BAL), 130);
  assert.equal(penaltyFor(0, BAL), 0);
  const r = resolveTeam(team({ points: 700, risk: 3 }), { action: 'innovation' }, 4, 1, BAL);
  assert.equal(r.entry.busted, true);
  assert.equal(r.points, (700 + 400) - 440);
  assert.equal(r.risk, 0);
});

test('balanced: no debt, but points sell 1:1 for cash in lots of 50', () => {
  const broke = team({ money: 30, points: 500 });
  assert.match(validateChoice(broke, 4, { action: 'innovation' }, BAL), /need \$120 more\. Sell points/);
  assert.equal(lotsNeeded(30, 150, BAL), 3);
  const ch = { action: 'innovation', lots: 3 };
  assert.equal(validateChoice(broke, 4, ch, BAL), null);
  const r = resolveTeam(broke, ch, 4, 6, BAL);
  assert.equal(r.money, 30);              // 30 + 150 raised − 150 cost
  assert.equal(r.points, 500 - 150 + 400);
  assert.equal(r.entry.sold, 150);
  assert.equal(r.entry.raised, 150);
});

test('balanced: cannot sell more points than you have, or sell under the spec rules', () => {
  assert.match(validateChoice(team({ money: 0, points: 40 }), 4, { action: 'innovation', lots: 3 }, BAL), /only have 40 points/);
  assert.match(validateChoice(team(), 4, { action: 'service', lots: 1 }, SPEC), /not part of these rules/);
});

test('balanced: the strategy that fits the quarter is never riskier than the others', () => {
  // Fit by quarter, from the vibe descriptions.
  const fit = ['influencer', 'service', 'innovation', 'innovation', 'influencer', 'innovation', 'service', 'service'];
  tableOf(BAL).forEach((row, i) => {
    const best = Object.entries(row).sort((a, b) => b[1][1] - a[1][1])[0][0];
    assert.equal(best, fit[i], `Q${i + 1}: highest score should be ${fit[i]}`);
    if (i !== 4 && i !== 5) for (const k of Object.keys(row)) if (k !== fit[i]) assert.ok(row[k][2] > row[fit[i]][2], `Q${i + 1}: ${k} should be riskier than ${fit[i]}`);
  });
});

test('engine: full game flow with a pass for a silent team', async () => {
  let game = E.newGame(SPEC);
  let teams = E.joinTeam(game, {}, 'Alpha').teams;
  teams = E.joinTeam(game, teams, 'Beta').teams;
  game = E.startGame(game);
  teams.alpha = E.submitChoice(game, teams.alpha, { action: 'influencer' });
  ({ game, teams } = E.rollDice(game, teams, 6));
  assert.equal(teams.alpha.points, 300);
  assert.equal(teams.beta.history[0].action, 'pass');
  for (let r = 2; r <= 8; r++) { game = E.nextQuarter(game); ({ game, teams } = E.rollDice(game, teams, 6)); }
  assert.throws(() => E.nextQuarter(game));
  ({ game, teams } = await E.finishGame(game, teams, i => completionCode('k', i)));
  assert.equal(game.phase, 'finished');
  assert.match(teams.alpha.completion.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(teams.alpha.completion.code, teams.beta.completion.code);
});

test('engine: a locked-in sale is applied at the roll', () => {
  let game = E.startGame(E.newGame(BAL));
  let teams = { a: { ...E.newTeam('A', BAL), money: 0, points: 300 } };
  teams.a = E.submitChoice(game, teams.a, { action: 'influencer', lots: 1 });
  assert.deepEqual(teams.a.pending, { round: 1, action: 'influencer', qty: 0, lots: 1 });
  ({ teams } = E.rollDice(game, teams, 6));
  assert.equal(teams.a.money, 0);
  assert.equal(teams.a.points, 300 - 50 + 300);
});

test('new games use the balanced ruleset and store it', () => {
  assert.equal(E.newGame().settings.id, RULESETS.balanced.id);
  assert.deepEqual(E.newGame().settings.table, RULESETS.balanced.table);
});

test('completion code is deterministic for the same input and secret', async () => {
  assert.equal(await completionCode('k', 'x'), await completionCode('k', 'x'));
  assert.notEqual(await completionCode('k', 'x'), await completionCode('k2', 'x'));
});
