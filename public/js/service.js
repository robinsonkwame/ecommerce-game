// Server-side game logic over a key-value store with etags (see kv.js for the
// interface). The Netlify functions run this against Netlify Blobs; the
// simulator runs the very same code against localStorage.
//
// Layout (all keys scoped by game id, so Reset is a single atomic swap):
//   game                               the game doc (phase, round, dice, final standings)
//   g/<gameId>/teams/<slug>            one doc per team, written only by join and host actions
//   g/<gameId>/choices/<round>/<slug>  a team's locked-in choice, written only by that team
//
// Teams and the host never write the same key, so a student locking in can't
// clobber a roll that's being applied, and vice versa.
import * as E from './engine.js';
import { SETTINGS } from './rules.js';

const { GameError } = E;
export const MAX_TEAMS = 80;

export function createService(store, { codeFor, now = () => Date.now(), settings = SETTINGS } = {}) {
  const teamPrefix = gid => `g/${gid}/teams/`;
  const teamKey = (gid, slug) => `g/${gid}/teams/${slug}`;
  const choicePrefix = (gid, round) => `g/${gid}/choices/${round}/`;
  const choiceKey = (gid, round, slug) => `g/${gid}/choices/${round}/${slug}`;

  function cleanSlug(slug) {
    const s = String(slug || '');
    return s && s === E.slugify(s) ? s : '';
  }

  async function loadGame() {
    const r = await store.get('game');
    if (r) return { game: r.data, etag: r.etag };
    await store.set('game', E.newGame(settings), { ifNew: true });
    const again = await store.get('game');
    return { game: again.data, etag: again.etag };
  }

  // Compare-and-swap on the game doc so two host clicks can't both apply.
  async function saveGame(game, etag) {
    const tag = await store.set('game', game, { ifMatch: etag });
    if (!tag) throw new GameError('The game changed at the same moment. Try again.', 409);
    return tag;
  }

  async function listTeams(gid) {
    const keys = await store.list(teamPrefix(gid));
    const docs = await Promise.all(keys.map(k => store.get(k)));
    const teams = {};
    for (const d of docs) if (d) teams[d.data.slug] = d.data;
    return teams;
  }

  async function listChoices(gid, round) {
    const keys = await store.list(choicePrefix(gid, round));
    const docs = await Promise.all(keys.map(k => store.get(k)));
    const out = {};
    keys.forEach((k, i) => { if (docs[i]) out[k.slice(k.lastIndexOf('/') + 1)] = docs[i].data; });
    return out;
  }

  function withPending(game, team, choice) {
    if (!team) return null;
    const live = game.phase === 'choosing' && choice && choice.round === game.round;
    return { ...team, pending: live ? choice : null };
  }

  async function teamsWithChoices(game) {
    const teams = await listTeams(game.id);
    if (game.phase !== 'choosing') return teams;
    const choices = await listChoices(game.id, game.round);
    for (const slug of Object.keys(teams)) teams[slug] = withPending(game, teams[slug], choices[slug]);
    return teams;
  }

  // Applies the current roll to every unresolved team, then marks it done.
  async function applyRoll(game) {
    const teams = await teamsWithChoices({ ...game, phase: 'choosing' });
    const r = E.resolveRound(game, teams, now());
    await Promise.all(r.changed.map(slug => store.set(teamKey(game.id, slug), r.teams[slug])));
    const cur = await loadGame();
    if (cur.game.dice?.rollId === game.dice.rollId && cur.game.resolved === false) {
      await store.set('game', E.markResolved(cur.game, now()), { ifMatch: cur.etag });
    }
  }

  return {
    // What a student's phone needs: the game, its own team, and in the lobby
    // how many teams have joined. Never other teams' docs (they hold codes).
    async studentState(slug) {
      const { game } = await loadGame();
      slug = cleanSlug(slug);
      let team = null;
      if (slug) {
        const [t, c] = await Promise.all([
          store.get(teamKey(game.id, slug)),
          game.phase === 'choosing' ? store.get(choiceKey(game.id, game.round, slug)) : null,
        ]);
        team = withPending(game, t?.data, c?.data);
      }
      const teamCount = game.phase === 'lobby' ? (await store.list(teamPrefix(game.id))).length : null;
      return { game, team, teamCount };
    },

    async hostState() {
      const { game } = await loadGame();
      const teams = await teamsWithChoices(game);
      return { game, teams: Object.values(teams) };
    },

    async join(name) {
      const { game } = await loadGame();
      if (game.phase === 'finished') throw new GameError('The game is over. Ask the host to reset it.');
      const slug = E.slugify(name);
      if (!slug) throw new GameError('Enter a team name with at least one letter or number');
      const existing = await store.get(teamKey(game.id, slug));
      if (existing) return existing.data;  // a teammate's phone, or a reload: rejoin the same team
      const count = (await store.list(teamPrefix(game.id))).length;
      if (count >= MAX_TEAMS) throw new GameError('This game is full');
      const team = E.newTeam(name, game.settings, now());
      const ok = await store.set(teamKey(game.id, slug), team, { ifNew: true });
      if (!ok) return (await store.get(teamKey(game.id, slug))).data;
      return team;
    },

    // A team can leave while the game is still in the lobby (a typo in its
    // name, the wrong group). It removes the team for every phone on it.
    async leave(slug) {
      const { game } = await loadGame();
      if (game.phase !== 'lobby') throw new GameError('You can only leave before the game starts. Ask the host if you need to.');
      slug = cleanSlug(slug);
      if (!slug || !(await store.get(teamKey(game.id, slug)))) return { ok: true };  // already gone
      await store.del(teamKey(game.id, slug));
      return { ok: true };
    },

    async submit(slug, choice) {
      const { game } = await loadGame();
      slug = cleanSlug(slug);
      const t = slug && await store.get(teamKey(game.id, slug));
      if (!t) throw new GameError('Your team was not found. Join again.', 404);
      const updated = E.submitChoice(game, t.data, choice, now());
      await store.set(choiceKey(game.id, game.round, slug), updated.pending);
      // The host flips the game to `rolled` before reading choices, so if the
      // game is still `choosing` now, this choice is guaranteed to be counted.
      const after = await loadGame();
      if (after.game.phase !== 'choosing' || after.game.round !== game.round) {
        throw new GameError('The host rolled just as you locked in. Your result is on its way.', 409);
      }
      return updated;
    },

    async host(action, payload = {}) {
      const { game, etag } = await loadGame();
      switch (action) {
        case 'start':
          await saveGame(E.startGame(game, now()), etag);
          break;
        case 'roll': {
          if (game.phase === 'rolled' && game.resolved === false) {
            await applyRoll(game);  // retry after a partial failure, same dice
            break;
          }
          const value = payload.value ? Number(payload.value) : E.randomDie();
          const rolled = E.beginRoll(game, value, now());
          await saveGame(rolled, etag);
          await applyRoll(rolled);
          break;
        }
        case 'next':
          await saveGame(E.nextQuarter(game, now()), etag);
          break;
        case 'finish': {
          const teams = await listTeams(game.id);
          const r = await E.finishGame(game, teams, codeFor, now());
          await Promise.all(Object.values(r.teams).map(t => store.set(teamKey(game.id, t.slug), t)));
          await saveGame(r.game, etag);
          break;
        }
        case 'reset': {
          // Fresh game on the current default rules (not the old game's copy).
          await saveGame(E.newGame(settings), etag);
          const old = await store.list(`g/${game.id}/`);
          await Promise.all(old.map(k => store.del(k)));
          break;
        }
        case 'kick': {
          const slug = cleanSlug(payload.slug);
          if (!slug) throw new GameError('No such team');
          await store.del(teamKey(game.id, slug));
          if (game.round) await store.del(choiceKey(game.id, game.round, slug));
          break;
        }
        default:
          throw new GameError(`Unknown host action: ${action}`);
      }
      return { ok: true };
    },
  };
}
