// Game state machine. Pure functions over { game, teams }; teams is an
// object keyed by slug. Every mutation returns new objects. Shared by the
// server (service.js, used by the Netlify functions) and the simulator.
import { SETTINGS, validateChoice, resolveTeam } from './rules.js';

// A user-facing rule violation (wrong phase, bad choice). Maps to HTTP 400.
export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function randomId(len = 8) {
  const a = new Uint8Array(len);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

export function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

export function newGame(settings = SETTINGS, id = randomId()) {
  return { id, version: 1, phase: 'lobby', round: 0, dice: null, resolved: true, final: null, settings, startedAt: null, finishedAt: null };
}

export function newTeam(name, settings, now = Date.now()) {
  return {
    name: String(name).trim().replace(/\s+/g, ' ').slice(0, 40), slug: slugify(name),
    money: settings.startMoney, points: 0, risk: 0,
    pending: null, history: [], completion: null,
    joinedAt: now, updatedAt: now,
  };
}

const bump = (g, now = Date.now()) => ({ ...g, version: g.version + 1, updatedAt: now });

export function joinTeam(game, teams, name, now = Date.now()) {
  if (game.phase === 'finished') throw new GameError('The game is over. Ask the host to reset it.');
  const slug = slugify(name);
  if (!slug) throw new GameError('Enter a team name with at least one letter or number');
  if (teams[slug]) return { teams, team: teams[slug], existed: true };
  const team = newTeam(name, game.settings, now);
  return { teams: { ...teams, [slug]: team }, team, existed: false };
}

export function submitChoice(game, team, choice, now = Date.now()) {
  if (game.phase !== 'choosing') throw new GameError('Choices are locked until the host opens the next quarter');
  const err = validateChoice(team, game.round, choice, game.settings);
  if (err) throw new GameError(err);
  const pending = {
    round: game.round, action: choice.action,
    qty: choice.action === 'buydown' ? Math.floor(Number(choice.qty)) : 0,
    lots: Math.max(0, Math.floor(Number(choice.lots) || 0)),
  };
  return { ...team, pending, updatedAt: now };
}

export function startGame(game, now = Date.now()) {
  if (game.phase !== 'lobby') throw new GameError('The game has already started');
  return bump({ ...game, phase: 'choosing', round: 1, startedAt: now }, now);
}

// Rolling happens in two steps so the server can publish the dice before it
// has rewritten every team: beginRoll() flips the game to `rolled` with the
// value and a reveal time; resolveRound() applies it to each team.
export function beginRoll(game, value, now = Date.now()) {
  if (game.phase !== 'choosing') throw new GameError('You can only roll while teams are choosing');
  if (!(Number.isInteger(value) && value >= 1 && value <= 6)) throw new GameError('Dice value must be 1–6');
  const dice = { value, rollId: `${game.id}:${game.round}`, at: now, revealAt: now + game.settings.revealDelayMs };
  return bump({ ...game, phase: 'rolled', dice, resolved: false }, now);
}

// Resolve every team that has no history entry for this round yet, so a retry
// after a partial failure never applies a quarter twice.
export function resolveRound(game, teams, now = Date.now()) {
  if (game.phase !== 'rolled' || !game.dice) throw new GameError('Roll the dice first');
  const out = { ...teams }, changed = [];
  for (const [slug, t] of Object.entries(teams)) {
    if (t.history.some(h => h.round === game.round)) continue;
    const choice = t.pending && t.pending.round === game.round ? t.pending : { action: 'pass' };
    const r = resolveTeam(t, choice, game.round, game.dice.value, game.settings);
    out[slug] = { ...t, money: r.money, points: r.points, risk: r.risk, pending: null, history: [...t.history, r.entry], updatedAt: now };
    changed.push(slug);
  }
  return { teams: out, changed };
}

export function markResolved(game, now = Date.now()) {
  return bump({ ...game, resolved: true }, now);
}

export function rollDice(game, teams, value, now = Date.now()) {
  const g = beginRoll(game, value, now);
  const r = resolveRound(g, teams, now);
  return { game: markResolved(g, now), teams: r.teams };
}

export function nextQuarter(game, now = Date.now()) {
  if (game.phase !== 'rolled') throw new GameError('Roll the dice before moving on');
  if (game.resolved === false) throw new GameError('Still applying the roll to every team. Try again in a moment.');
  if (game.round >= game.settings.rounds) throw new GameError('That was the last quarter. Finish the game instead.');
  return bump({ ...game, phase: 'choosing', round: game.round + 1, dice: null }, now);
}

// Input to the completion code: trajectory + final numbers + finish time.
export function codeInput(team, finishedAt) {
  const path = team.history.map(h => h.action + (h.qty || '')).join(',');
  return [team.slug, team.points, team.money, path, finishedAt].join('|');
}

export async function finishGame(game, teams, codeFor, now = Date.now()) {
  if (game.phase !== 'rolled') throw new GameError('Finish after a roll');
  if (game.resolved === false) throw new GameError('Still applying the roll to every team. Try again in a moment.');
  const out = {};
  for (const [slug, t] of Object.entries(teams)) {
    const code = await codeFor(codeInput(t, now));
    out[slug] = { ...t, completion: { code, at: now }, updatedAt: now };
  }
  // Public standings for every student's final screen. No codes in here.
  const final = leaderboard(out).map(t => ({ slug: t.slug, name: t.name, points: t.points, money: t.money }));
  return { game: bump({ ...game, phase: 'finished', finishedAt: now, final }, now), teams: out };
}

export function removeTeam(teams, slug) {
  const t = { ...teams }; delete t[slug]; return t;
}

export function randomDie() {
  // Rejection sampling keeps all six faces exactly equally likely.
  const a = new Uint8Array(1);
  do globalThis.crypto.getRandomValues(a); while (a[0] >= 252);
  return (a[0] % 6) + 1;
}

export function leaderboard(teams) {
  return Object.values(teams).sort((a, b) => b.points - a.points || b.money - a.money || a.name.localeCompare(b.name));
}
