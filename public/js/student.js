import { createApi, isDebug, startPolling } from './api.js';
import { STRATEGIES, VIBES, tableOf, bustOf, describeChoice, validateChoice, lotsNeeded, penaltyFor, penaltyText, fmtMoney, fmtSigned, choiceLabel } from './rules.js';
import { createDie } from './dice.js';

const $ = s => document.querySelector(s);
const S = {
  api: null, poll: null,
  slug: localStorage.getItem('ecg:slug') || '',
  game: null, team: null, teamCount: null,
  choice: null, choiceRound: 0, qty: 1,
  seenRoll: null, revealedRoll: null, revealTimer: null,
  last: { money: null, points: null, risk: null },
};
const die = createDie($('#die'), 130);

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function show(id) {
  for (const s of ['join', 'lobby', 'choose', 'rolled', 'finished']) $('#' + s).hidden = s !== id;
}

function setTile(id, value, key) {
  const el = $('#' + id);
  el.textContent = value;
  if (S.last[key] !== null && S.last[key] !== value) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  S.last[key] = value;
}

function render() {
  const g = S.game, t = S.team;
  const inGame = !!(S.slug && t);
  $('#topbar').hidden = !inGame;
  $('#playbook').hidden = !inGame;

  if (!S.slug || !t) {
    if (S.slug && g && !t) { localStorage.removeItem('ecg:slug'); S.slug = ''; }
    show('join');
    if (g) renderHowTo(g.settings);
    $('#joinBtn').disabled = g?.phase === 'finished';
    $('#joinError').textContent = g?.phase === 'finished' ? 'The game is over. Ask the host to reset it.' : '';
    return;
  }

  $('#teamName').textContent = t.name;
  $('#roundPill').textContent = g.round ? `Q${g.round} · ${VIBES[g.round - 1].name}` : 'Lobby';
  // While the die tumbles, show this quarter's cost/score/risk applied but
  // hold back the bust penalty until the reveal.
  const pre = g.phase === 'rolled' && S.revealedRoll !== g.dice.rollId ? t.history.find(h => h.round === g.round) : null;
  const money = t.money, points = pre ? pre.points + pre.penalty : t.points, risk = pre ? pre.riskBeforeDice : t.risk;
  setTile('tMoney', fmtMoney(money), 'money');
  setTile('tPoints', points.toLocaleString(), 'points');
  setTile('tRisk', String(risk), 'risk');
  $('#tMoney').classList.toggle('neg', money < 0);
  $('#tRiskTile').classList.toggle('hot', risk >= 4);
  renderPlaybook();

  switch (g.phase) {
    case 'lobby':
      show('lobby');
      if (S.teamCount != null) $('#lobbyCount').textContent = `${S.teamCount} team${S.teamCount === 1 ? '' : 's'} joined so far.`;
      break;
    case 'choosing': show('choose'); renderChoose(); break;
    case 'rolled': show('rolled'); renderRolled(); break;
    case 'finished': show('finished'); renderFinished(); break;
  }
}

function currentChoice() {
  const g = S.game, t = S.team;
  if (S.choiceRound !== g.round) { S.choice = null; S.choiceRound = g.round; S.qty = Math.min(1, t.risk) || 1; }
  if (!S.choice && t.pending && t.pending.round === g.round) {
    S.choice = { action: t.pending.action, qty: t.pending.qty };
    if (t.pending.action === 'buydown') S.qty = t.pending.qty;
  }
  return S.choice ? withSale(S.choice) : null;
}

// The choice plus the fewest points to sell so the team can pay for it.
function withSale(choice) {
  const g = S.game, s = g.settings;
  const cost = describeChoice(g.round, choice, s).cost;
  return { ...choice, lots: s.allowDebt ? 0 : lotsNeeded(S.team.money, cost, s) };
}
const canAfford = choice => !validateChoice(S.team, S.game.round, withSale(choice), S.game.settings);

// Under a strategy card: what it would take to pay for it.
function fundingNote(choice) {
  const g = S.game, t = S.team, s = g.settings;
  const d = describeChoice(g.round, withSale(choice), s);
  if (!canAfford(choice)) return `<span class="neg">Can't afford: costs ${fmtMoney(d.cost)}, you have ${fmtMoney(t.money)}${s.exchange ? ` and ${Math.max(t.points, 0).toLocaleString()} pts to sell` : ''}</span>`;
  if (d.sold) return `<span class="warn-text">Sell ${d.sold.toLocaleString()} pts to cover it</span>`;
  return '';
}

function renderChoose() {
  const g = S.game, t = S.team, s = g.settings, round = g.round, vibe = VIBES[round - 1];
  $('#vibeName').textContent = `Quarter ${round}: ${vibe.name}`;
  $('#vibeBlurb').textContent = vibe.blurb;
  const chosen = currentChoice();
  const locked = t.pending && t.pending.round === round ? t.pending : null;
  const box = $('#choices');
  box.replaceChildren();

  for (const key of ['influencer', 'service', 'innovation']) {
    const d = describeChoice(round, { action: key }, s);
    const ok = canAfford({ action: key });
    const b = document.createElement('button');
    b.className = 'choice' + (chosen?.action === key ? ' selected' : '') + (locked?.action === key ? ' locked' : '');
    b.disabled = !ok;
    const note = fundingNote({ action: key });
    b.innerHTML = `<div class="head"><span class="title">${STRATEGIES[key].label}</span><span class="nums">−${fmtMoney(d.cost)} · ${fmtSigned(d.score)} pts · ${fmtSigned(d.riskAdded)} risk</span></div>` +
      `<div class="hint">${STRATEGIES[key].hint}${locked?.action === key ? ' · <strong>locked in</strong>' : ''}${note ? `<br>${note}` : ''}</div>`;
    b.onclick = () => { S.choice = { action: key }; renderChoose(); };
    box.appendChild(b);
  }

  // Buy down: up to the team's risk, and only as much as it can pay for.
  let maxQty = 0;
  for (let q = 1; q <= t.risk; q++) if (canAfford({ action: 'buydown', qty: q })) maxQty = q;
  const bd = document.createElement('button');
  bd.className = 'choice' + (chosen?.action === 'buydown' ? ' selected' : '') + (locked?.action === 'buydown' ? ' locked' : '');
  bd.disabled = maxQty === 0;
  const bdHint = t.risk === 0 ? 'You have no risk to buy down.'
    : maxQty === 0 ? '<span class="neg">You can\'t afford to buy down right now.</span>'
    : 'Remove risk points before the dice. No score this quarter.';
  bd.innerHTML = `<div class="head"><span class="title">${STRATEGIES.buydown.label}</span><span class="nums">−$${s.buyDownCost} per risk point</span></div><div class="hint">${bdHint}${locked?.action === 'buydown' ? ` · <strong>locked in: ${locked.qty}</strong>` : ''}</div>`;
  bd.onclick = () => { S.choice = { action: 'buydown', qty: Math.max(1, Math.min(S.qty, maxQty)) }; renderChoose(); };
  if (chosen?.action === 'buydown' && maxQty > 0) {
    const st = document.createElement('div');
    st.className = 'stepper';
    S.qty = Math.max(1, Math.min(S.qty, maxQty));
    st.innerHTML = `<button type="button" aria-label="fewer">−</button><span class="qty">${S.qty}</span><button type="button" aria-label="more">+</button><span class="small muted">of ${t.risk} risk point${t.risk === 1 ? '' : 's'}</span>`;
    const [minus, , plus] = st.querySelectorAll('button, .qty');
    minus.onclick = e => { e.stopPropagation(); S.qty = Math.max(1, S.qty - 1); S.choice.qty = S.qty; renderChoose(); };
    plus.onclick = e => { e.stopPropagation(); S.qty = Math.min(maxQty, S.qty + 1); S.choice.qty = S.qty; renderChoose(); };
    bd.appendChild(st);
    const note = fundingNote({ action: 'buydown', qty: S.qty });
    if (note) bd.insertAdjacentHTML('beforeend', `<div class="hint">${note}</div>`);
  }
  box.appendChild(bd);

  const pv = $('#preview');
  const live = chosen && canAfford(chosen) ? chosen : null;
  if (live) {
    const d = describeChoice(round, live, s);
    const money = t.money + d.raised - d.cost, risk = Math.max(0, t.risk + d.riskAdded), pts = t.points - d.sold + d.score;
    const loss = penaltyFor(pts, s);
    pv.innerHTML = (d.sold ? `<span class="small">Sells ${d.sold.toLocaleString()} points for ${fmtMoney(d.raised)} to cover the cost.</span><br>` : '') +
      `After this: <span class="${money < 0 ? 'neg' : ''}">${fmtMoney(money)}</span> · ${pts.toLocaleString()} pts · risk ${risk}` +
      (risk > 6 ? `<br><span class="small neg">Risk ${risk} is above any die: a risk event is certain and you'd lose ${loss.toLocaleString()} points</span>`
        : risk > 1 ? `<br><span class="small muted">Risk event if the die rolls below ${risk} (${risk - 1} in 6 chance): you'd lose ${loss.toLocaleString()} points</span>`
        : `<br><span class="small muted">Safe from this roll: risk ${risk} can't be above the die</span>`);
  } else pv.textContent = chosen ? 'You can\'t afford that. Pick something else.' : 'Pick one strategy for this quarter.';

  const lockBtn = $('#lockBtn');
  const same = locked && live && locked.action === live.action && (locked.qty || 0) === (live.qty || 0) && (locked.lots || 0) === (live.lots || 0);
  lockBtn.disabled = !live || same;
  const sold = live ? describeChoice(round, live, s).sold : 0;
  lockBtn.textContent = same ? 'Locked in' : sold ? `Sell ${sold.toLocaleString()} pts and lock in` : (live && s.allowDebt && describeChoice(round, live, s).cost > t.money ? 'Lock in (goes negative)' : 'Lock in');
  $('#lockNote').textContent = locked ? `Locked: ${choiceLabel(locked)}. You can change it until the host rolls.` : 'Nothing locked yet. If you don\'t lock in, your team passes this quarter.';
  $('#lockError').textContent = '';
}

async function lockIn() {
  const chosen = currentChoice();
  const err = validateChoice(S.team, S.game.round, chosen, S.game.settings);
  if (err) { $('#lockError').textContent = err; return; }
  $('#lockBtn').disabled = true;
  try {
    S.team = await S.api.submit(S.slug, chosen);
    render();
    toast(`Locked in: ${choiceLabel(S.team.pending)}`);
  } catch (e) {
    $('#lockError').textContent = e.message;
    $('#lockBtn').disabled = false;
    S.poll.refresh();
  }
}

function renderRolled() {
  const g = S.game, t = S.team, dice = g.dice;
  const entry = t.history.find(h => h.round === g.round);
  if (!entry && t.joinedAt >= dice.at) {
    // Joined after this roll: it doesn't apply to this team.
    die.set(dice.value);
    $('#diceLabel').textContent = `Risk Dice: ${dice.value}`;
    $('#outcome').hidden = false;
    $('#verdict').className = 'verdict safe';
    $('#verdict').innerHTML = '<div class="big">Welcome aboard</div><div>You joined after this roll, so it doesn\'t affect you.</div>';
    $('#delta').textContent = '';
    $('#afterNote').textContent = 'Waiting for the host to open the next quarter…';
    return;
  }
  if (S.seenRoll !== dice.rollId) {
    S.seenRoll = dice.rollId;
    clearTimeout(S.revealTimer);
    $('#outcome').hidden = true;
    const wait = dice.revealAt - S.api.now();
    if (wait > 200) {
      die.tumble();
      $('#diceLabel').textContent = 'Rolling the Risk Dice…';
      S.revealTimer = setTimeout(tryReveal, wait);
    } else tryReveal();
  } else if (S.revealedRoll !== dice.rollId && S.api.now() >= dice.revealAt) tryReveal();
}

// Reveal once the reveal time has passed and this team's result has arrived.
// The server publishes the dice a moment before it finishes updating every
// team, so on a slow connection the result can trail the dice by a poll.
function tryReveal() {
  const g = S.game;
  if (g.phase !== 'rolled' || S.revealedRoll === g.dice.rollId) return;
  const entry = S.team.history.find(h => h.round === g.round);
  if (!entry) { die.tumble(); $('#diceLabel').textContent = 'Rolling the Risk Dice…'; return; }
  reveal(entry, g.dice.value, S.api.now() - g.dice.revealAt < 1500);
}

function reveal(entry, value, animate) {
  S.revealedRoll = S.game.dice.rollId;
  if (animate) die.land(value); else die.set(value);
  $('#diceLabel').textContent = `Risk Dice: ${value}`;
  setTimeout(() => {
    const v = $('#verdict');
    v.className = 'verdict ' + (entry.busted ? 'bust' : 'safe');
    v.innerHTML = entry.busted
      ? `<div class="big">Risk event!</div><div>Your risk ${entry.riskBeforeDice} was above the die ${value}.<br>You lost ${entry.penalty.toLocaleString()} points${bustOf(S.game.settings).kind === 'percent' ? ` (${bustOf(S.game.settings).percent}% of your points)` : ''} and risk reset to 0.</div>`
      : `<div class="big">You dodged it</div><div>Your risk ${entry.riskBeforeDice} was not above the die ${value}.</div>`;
    const parts = [];
    if (entry.sold) parts.push(`Sold ${entry.sold.toLocaleString()} pts for ${fmtMoney(entry.raised)}`);
    parts.push(STRATEGIES[entry.action]?.short || entry.action, fmtSigned(-entry.cost, '$'), `${fmtSigned(entry.score)} pts`, `${fmtSigned(entry.riskAdded)} risk`);
    if (entry.busted) parts.push(`−${entry.penalty.toLocaleString()} pts`);
    $('#delta').textContent = parts.join(' · ');
    $('#outcome').hidden = false;
    $('#afterNote').textContent = S.game.round >= S.game.settings.rounds ? 'That was the last quarter. Waiting for the host to finish the game…' : 'Waiting for the host to open the next quarter…';
    setTile('tMoney', fmtMoney(entry.money), 'money');
    setTile('tPoints', entry.points.toLocaleString(), 'points');
    setTile('tRisk', String(entry.risk), 'risk');
    $('#tRiskTile').classList.toggle('hot', entry.risk >= 4);
  }, animate ? 950 : 0);
}

function renderFinished() {
  const t = S.team;
  const lb = S.game.final || [];
  const rank = lb.findIndex(x => x.slug === t.slug) + 1 || lb.length + 1;
  const suffix = n => (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th';
  $('#finalRank').textContent = `${rank}${suffix(rank)} of ${lb.length}`;
  const busts = t.history.filter(h => h.busted).length;
  $('#finalLine').textContent = `${t.points.toLocaleString()} points · ${fmtMoney(t.money)} left · ${busts} risk event${busts === 1 ? '' : 's'}`;
  renderTimeline($('#timeline'), t);
  $('#codeBox').textContent = t.completion?.code || '——————';
}

export function renderTimeline(el, team) {
  el.replaceChildren();
  for (let r = 1; r <= 8; r++) {
    const h = team.history.find(x => x.round === r);
    const q = document.createElement('div');
    q.className = 'q pill ' + (h ? h.action : 'pass') + (h?.busted ? ' busted' : '');
    q.title = h ? `Q${r}: ${choiceLabel(h)} · dice ${h.dice}${h.busted ? ' · risk event' : ''}` : `Q${r}`;
    q.textContent = h ? (h.action === 'buydown' ? `↓${h.qty}` : STRATEGIES[h.action].short.slice(0, 3)) : '·';
    el.appendChild(q);
  }
}

// The join page's rule summary, filled in from the live game's ruleset.
function renderHowTo(s) {
  $('#howRisk').textContent = `If your risk is above the die, you suffer a risk event: you ${penaltyText(s)}, and your risk resets to 0.`;
  const ex = s.exchange;
  $('#howCash').innerHTML = `<strong>Watch your cash.</strong> You start with $${s.startMoney.toLocaleString()}. ` +
    (s.allowDebt ? 'You can go below $0 and keep playing.'
      : `You can't spend money you don't have${ex ? `, but you can sell points for cash: ${ex.lotPoints} points for $${ex.lotDollars}` : ''}.`);
}

function renderPlaybook() {
  const g = S.game, t = S.team, s = g.settings;
  const ex = s.exchange;
  $('#pbRules').textContent = [
    'Each cell is cost / score / risk.',
    `Buy down risk: $${s.buyDownCost} per point, instead of a strategy.`,
    `Risk above the die (1–6): ${penaltyText(s)}, and risk resets to 0.`,
    s.allowDebt ? 'Money can go below $0; keep playing.' : 'You can\'t spend money you don\'t have.',
    ex ? `Short on cash? Sell points: ${ex.lotPoints} points for $${ex.lotDollars}.` : '',
  ].filter(Boolean).join(' ');
  const rows = tableOf(s).map((row, i) => {
    const r = i + 1;
    const h = t.history.find(x => x.round === r);
    const cls = r === g.round ? 'now' : (r < g.round ? 'past' : '');
    const cell = k => `<td class="${h?.action === k ? 'picked' : ''}">$${row[k][0]} / +${row[k][1]} / +${row[k][2]}</td>`;
    return `<tr class="${cls}"><td>${r} ${VIBES[i].name}</td>${cell('influencer')}${cell('service')}${cell('innovation')}</tr>`;
  }).join('');
  $('#pbTable').innerHTML = `<tr><th>Quarter</th><th>Influencers</th><th>Service</th><th>Innovation</th></tr>${rows}`;
}

// Lobby only: remove this team (for every phone on it) and go back to joining.
async function leave() {
  const name = S.team?.name || 'this team';
  if (!confirm(`Leave "${name}"? The team is removed for everyone on it, so teammates' phones go back to the join screen too.`)) return;
  $('#leaveBtn').disabled = true;
  try {
    await S.api.leave(S.slug);
    localStorage.removeItem('ecg:slug');
    S.slug = ''; S.team = null;
    $('#nameInput').value = '';
    $('#leaveError').textContent = '';
    S.poll.refresh();
  } catch (e) {
    $('#leaveError').textContent = e.message;
    S.poll.refresh();
  } finally { $('#leaveBtn').disabled = false; }
}

async function join() {
  const name = $('#nameInput').value.trim();
  if (!name) { $('#joinError').textContent = 'Enter a team name'; return; }
  $('#joinBtn').disabled = true;
  try {
    const team = await S.api.join(name);
    S.slug = team.slug;
    localStorage.setItem('ecg:slug', S.slug);
    S.team = team;
    S.poll.refresh();
  } catch (e) {
    $('#joinError').textContent = e.message;
  } finally { $('#joinBtn').disabled = false; }
}

async function main() {
  S.api = await createApi();
  if (isDebug()) {
    const dbg = $('#debug');
    dbg.hidden = false;
    dbg.querySelectorAll('[data-host]').forEach(b => b.onclick = async () => {
      const action = b.dataset.host;
      if (action === 'reset' && !confirm('Reset the simulated game and remove every team?')) return;
      try {
        const payload = action === 'roll' && $('#dbgDie').value ? { value: Number($('#dbgDie').value) } : {};
        await S.api.host(action, payload);
        if (action === 'reset') { localStorage.removeItem('ecg:slug'); S.slug = ''; S.team = null; S.seenRoll = null; S.revealedRoll = null; }
        S.poll.refresh();
      } catch (e) { toast(e.message, true); }
    });
  }
  $('#joinBtn').onclick = join;
  $('#leaveBtn').onclick = leave;
  $('#nameInput').onkeydown = e => { if (e.key === 'Enter') join(); };
  $('#lockBtn').onclick = lockIn;
  $('#copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('#codeBox').textContent); toast('Code copied'); }
    catch { toast('Select the code and copy it', true); }
  };
  S.poll = startPolling(S.api, () => ({ slug: S.slug }), s => { S.game = s.game; S.team = s.team; S.teamCount = s.teamCount; render(); });
}
main();
