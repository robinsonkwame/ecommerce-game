// Simulated backend for `?debug` mode. Runs the real server logic
// (service.js) against localStorage instead of Netlify Blobs, and pings other
// tabs over BroadcastChannel, so one person can play host and several
// students side by side with nothing deployed. Adds bot teams for testing.
import { createService } from './service.js';
import { createKvStore } from './kv.js';
import { completionCode } from './code.js';
import { tableOf, lotsNeeded, describeChoice, validateChoice } from './rules.js';

const P = 'ecg:kv:';
const BOTS = 'ecg:bots';
const BOT_NAMES = ['Nimbus', 'Lumen', 'Kite', 'Orbit', 'Pixel', 'Ember', 'Quill', 'Sable'];
const chan = 'BroadcastChannel' in globalThis ? new BroadcastChannel('ecg') : null;

const store = createKvStore({
  read: k => localStorage.getItem(P + k),
  write: (k, v) => localStorage.setItem(P + k, v),
  remove: k => localStorage.removeItem(P + k),
  keys: () => Object.keys(localStorage).filter(k => k.startsWith(P)).map(k => k.slice(P.length)),
}, { onWrite: () => chan?.postMessage('changed') });

const svc = createService(store, { codeFor: input => completionCode('simulated-host-key', input) });
const latency = () => new Promise(r => setTimeout(r, 80 + Math.random() * 160));
const bots = () => { try { return JSON.parse(localStorage.getItem(BOTS)) || []; } catch { return []; } };

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function createMockApi() {
  localStorage.removeItem('ecg:mock');  // state format from an earlier build
  return {
    mode: 'mock',
    now: () => Date.now(),

    async getState({ slug = '', role = '' } = {}, version) {
      let data;
      if (role === 'host') {
        data = await svc.hostState();
        const b = bots();
        data.teams = data.teams.map(t => (b.includes(t.slug) ? { ...t, bot: true } : t));
      } else data = await svc.studentState(slug);
      const v = hash(JSON.stringify(data));
      if (v === version) return { unchanged: true, version: v, serverNow: Date.now() };
      return { ...data, unchanged: false, version: v, serverNow: Date.now() };
    },

    async join(name) { await latency(); return svc.join(name); },
    async submit(slug, choice) { await latency(); return svc.submit(slug, choice); },

    async host(action, payload = {}) {
      await latency();
      if (action === 'bots') {
        const have = bots(), names = BOT_NAMES.filter(n => !have.includes(n.toLowerCase())).slice(0, payload.count || 4);
        for (const n of names) have.push((await svc.join(n)).slug);
        localStorage.setItem(BOTS, JSON.stringify(have));
        chan?.postMessage('changed');
        return { ok: true };
      }
      if (action === 'botsChoose') {
        const { game, teams } = await svc.hostState();
        if (game.phase !== 'choosing') throw new Error('Bots can only choose during a quarter');
        const S = game.settings, keys = Object.keys(tableOf(S)[0]), b = bots();
        for (const t of teams) {
          if (!b.includes(t.slug) || t.pending) continue;
          let choice = { action: keys[Math.floor(Math.random() * keys.length)] };
          if (t.risk >= 3 && Math.random() < 0.5) choice = { action: 'buydown', qty: Math.min(t.risk, 1 + Math.floor(Math.random() * 2)) };
          // Sell just enough points to afford it; pass if even that isn't enough.
          choice.lots = S.allowDebt ? 0 : lotsNeeded(t.money, describeChoice(game.round, choice, S).cost, S);
          if (validateChoice(t, game.round, choice, S)) choice = { action: 'pass' };
          await svc.submit(t.slug, choice);
        }
        return { ok: true };
      }
      if (action === 'reset') localStorage.removeItem(BOTS);
      return svc.host(action, payload);
    },

    onChange(cb) {
      chan?.addEventListener('message', cb);
      window.addEventListener('storage', e => { if (e.key?.startsWith(P)) cb(); });
    },
  };
}
