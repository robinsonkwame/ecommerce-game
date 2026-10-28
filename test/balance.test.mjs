// Guards the design targets in docs/BALANCE.md. If you retune the balanced
// ruleset and this fails, rerun `npm run balance` and decide deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../tools/balance.mjs';
import { makeSettings } from '../public/js/rules.js';

test('balanced ruleset meets its design targets', () => {
  const { rows, bestFixed, beatsRandom } = evaluate(makeSettings('balanced'), { games: 600, seed: 3 });
  for (const [name, r] of Object.entries(rows)) {
    assert.equal(r.negQ4, 0, `${name}: nobody below 0 points after Q4`);
    assert.equal(r.negEnd, 0, `${name}: nobody below 0 points at the end`);
  }
  for (const name of ['optimal', 'thoughtful', 'greedy', 'cautious']) assert.equal(rows[name].brokeQ4, 0, `${name}: never stuck without cash after Q4`);
  assert.ok(rows.random.brokeQ4 < 0.03, 'even random play is rarely stuck');
  assert.ok(rows.optimal.mean / bestFixed > 1.25, 'matching the quarter beats any single strategy by 25%+');
  assert.ok(rows.thoughtful.mean / bestFixed > 1.2, 'a thoughtful player beats any single strategy by 20%+');
  assert.ok(rows.optimal.passRate < 0.03, 'passing is (almost) never the best move');
  assert.ok(rows.greedy.busts > 1.5 && rows.optimal.busts < 1.3, 'ignoring risk costs risk events');
  assert.ok(beatsRandom > 0.9, 'skill beats luck');
  assert.ok(rows.optimal.sold > 0, 'selling points is part of good play');
});
