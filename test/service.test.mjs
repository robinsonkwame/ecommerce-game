import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../public/js/service.js';
import { createKvStore, mapBacking } from '../public/js/kv.js';
import { completionCode } from '../public/js/code.js';

function setup() {
  const map = new Map();
  const store = createKvStore(mapBacking(map));
  let t = 1_000_000;
  const svc = createService(store, { codeFor: i => completionCode('secret', i), now: () => (t += 10) });
  return { svc, store, map };
}

test('full game: join, choose, roll, next, finish with codes', async () => {
  const { svc } = setup();
  const a = await svc.join('Team Rocket');
  assert.equal(a.slug, 'team-rocket');
  assert.equal((await svc.join('team  rocket')).slug, 'team-rocket', 'same name rejoins the same team');
  await svc.join('Beta');
  assert.equal((await svc.studentState('beta')).teamCount, 2);

  await svc.host('start');
  await svc.submit('team-rocket', { action: 'influencer' });
  let s = await svc.studentState('team-rocket');
  assert.deepEqual(s.team.pending, { round: 1, action: 'influencer', qty: 0, lots: 0 });
  assert.equal(s.teamCount, null, 'team count only sent in the lobby');

  await svc.host('roll', { value: 6 });
  s = await svc.studentState('team-rocket');
  assert.equal(s.game.phase, 'rolled');
  assert.equal(s.game.resolved, true);
  assert.equal(s.team.points, 300);
  assert.equal(s.team.money, 550);
  assert.equal((await svc.studentState('beta')).team.history[0].action, 'pass');

  for (let r = 2; r <= 8; r++) { await svc.host('next'); await svc.host('roll', { value: 6 }); }
  await svc.host('finish');
  s = await svc.studentState('team-rocket');
  assert.equal(s.game.phase, 'finished');
  assert.match(s.team.completion.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual(s.game.final.map(x => x.slug), ['team-rocket', 'beta']);
  assert.ok(!JSON.stringify(s.game).includes(s.team.completion.code), 'public game doc never carries codes');
});

test('student state never includes other teams', async () => {
  const { svc } = setup();
  await svc.join('A'); await svc.join('B');
  const s = await svc.studentState('a');
  assert.equal(s.teams, undefined);
  assert.equal(s.team.slug, 'a');
});

test('choices are locked once the dice are rolled', async () => {
  const { svc } = setup();
  await svc.join('A');
  await svc.host('start');
  await svc.host('roll', { value: 3 });
  await assert.rejects(svc.submit('a', { action: 'service' }), /locked/);
});

// Runs `hook` once, the first time the service reads `key` during a submit.
function onRead(store, match, hook) {
  const real = store.get;
  let fired = false;
  store.get = async key => {
    if (!fired && match(key)) { fired = true; await hook(); }
    return real(key);
  };
}

test('a roll that lands just before the choice is saved: player is told, quarter is a pass', async () => {
  const { svc, store } = setup();
  await svc.join('A');
  await svc.host('start');
  onRead(store, k => k.endsWith('/teams/a'), () => svc.host('roll', { value: 6 }));
  await assert.rejects(svc.submit('a', { action: 'service' }), /rolled just as you locked in/);
  const t = (await svc.studentState('a')).team;
  assert.equal(t.history[0].action, 'pass');
});

test('a roll that lands just after the choice is saved: the choice counts', async () => {
  const { svc, store } = setup();
  await svc.join('A');
  await svc.host('start');
  let reads = 0;
  onRead(store, k => k === 'game' && ++reads === 2, () => svc.host('roll', { value: 6 }));
  await assert.rejects(svc.submit('a', { action: 'service' }), /rolled just as you locked in/);
  const t = (await svc.studentState('a')).team;
  assert.equal(t.history[0].action, 'service');
});

test('second roll in the same quarter is rejected', async () => {
  const { svc } = setup();
  await svc.join('A');
  await svc.host('start');
  await svc.host('roll', { value: 2 });
  await assert.rejects(svc.host('roll', { value: 5 }), /only roll while teams are choosing/);
});

test('concurrent host writes: compare-and-swap rejects the loser', async () => {
  const { svc, store } = setup();
  await svc.join('A');
  const realSet = store.set;
  // Another writer changes the game doc right before our conditional write.
  store.set = async (key, data, opts) => {
    if (key === 'game' && opts?.ifMatch) { store.set = realSet; await realSet(key, { ...data, version: 99 }); }
    return realSet(key, data, opts);
  };
  await assert.rejects(svc.host('start'), /changed at the same moment/);
});

test('a partly applied roll can be finished with the same dice, without double-counting', async () => {
  const { svc, store } = setup();
  await svc.join('A'); await svc.join('B');
  await svc.host('start');
  await svc.submit('a', { action: 'influencer' });
  await svc.submit('b', { action: 'influencer' });
  const realSet = store.set;
  let failed = false;
  store.set = async (key, data, opts) => {
    if (key.endsWith('/teams/b') && !failed) { failed = true; throw new Error('network'); }
    return realSet(key, data, opts);
  };
  await assert.rejects(svc.host('roll', { value: 1 }), /network/);
  store.set = realSet;
  let h = await svc.hostState();
  assert.equal(h.game.resolved, false);
  assert.equal(h.teams.find(t => t.slug === 'a').history.length, 1);
  assert.equal(h.teams.find(t => t.slug === 'b').history.length, 0);
  await assert.rejects(svc.host('next'), /Still applying/);

  await svc.host('roll');  // retry
  h = await svc.hostState();
  assert.equal(h.game.resolved, true);
  for (const t of h.teams) {
    assert.equal(t.history.length, 1);
    assert.equal(t.history[0].dice, 1);
    assert.equal(t.history[0].action, 'influencer', 'B keeps its locked-in choice on retry');
  }
});

test('reset swaps to a fresh game and clears old data', async () => {
  const { svc, map, store } = setup();
  await svc.join('A');
  await svc.host('start');
  await svc.submit('a', { action: 'service' });
  const oldId = (await svc.hostState()).game.id;
  const gameDoc = await store.get('game');
  await store.set('game', { ...gameDoc.data, settings: { id: 'old-rules' } });  // a game saved under older rules
  await svc.host('reset');
  const h = await svc.hostState();
  assert.notEqual(h.game.id, oldId);
  assert.equal(h.game.phase, 'lobby');
  assert.equal(h.teams.length, 0);
  assert.equal([...map.keys()].filter(k => k.startsWith(`g/${oldId}/`)).length, 0);
  assert.equal((await svc.studentState('a')).team, null, 'old phones fall back to the join screen');
  assert.equal(h.game.settings.id, 'balanced', 'reset starts on the current default rules');
});

test('kick removes a team; bad slugs are rejected', async () => {
  const { svc } = setup();
  await svc.join('A');
  await svc.host('kick', { slug: 'a' });
  assert.equal((await svc.hostState()).teams.length, 0);
  await assert.rejects(svc.submit('../game', { action: 'service' }), /not found/);
  assert.equal((await svc.studentState('x/../y')).team, null);
});

test('joining is closed after the game finishes', async () => {
  const { svc } = setup();
  await svc.join('A');
  await svc.host('start');
  await svc.host('roll', { value: 6 });
  await svc.host('finish');
  await assert.rejects(svc.join('Late'), /game is over/);
});

test('a team can leave from the lobby, but not once the game has started', async () => {
  const { svc } = setup();
  await svc.join('Typo Teem');
  await svc.join('Other');
  await svc.leave('typo-teem');
  assert.equal((await svc.studentState('typo-teem')).team, null, 'its phones fall back to the join screen');
  assert.equal((await svc.studentState('')).teamCount, 1);
  await svc.leave('typo-teem');  // leaving twice is harmless
  await svc.host('start');
  await assert.rejects(svc.leave('other'), /only leave before the game starts/);
  assert.ok((await svc.studentState('other')).team);
});
