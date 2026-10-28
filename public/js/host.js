import { createApi, isDebug, startPolling } from './api.js';
import { STRATEGIES, VIBES, fmtMoney, choiceLabel, penaltyText } from './rules.js';
import { leaderboard } from './engine.js';
import { createDie } from './dice.js';

const $ = s => document.querySelector(s);
const S = { api: null, poll: null, key: '', busy: false, game: null, teams: [], seenRoll: null, revealedRoll: null, resultsAt: 0, revealTimer: null };
const die = createDie($('#die'), 160);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function storedKey() {
  try { return sessionStorage.getItem('ecg:hostkey') || ''; } catch { return ''; }
}

// Show the host-key form (live mode only) instead of the controls.
function needKey(message = '') {
  $('#keyForm').hidden = false;
  $('#hostUi').hidden = true;
  $('#keyError').textContent = message;
  $('#keyInput').focus();
}

function unlock(e) {
  e.preventDefault();
  const k = $('#keyInput').value.trim();
  if (!k) { $('#keyError').textContent = 'Enter the host key'; return; }
  S.key = k;
  try { sessionStorage.setItem('ecg:hostkey', k); } catch { /* private mode */ }
  $('#keyForm').hidden = true;
  $('#hostUi').hidden = false;
  S.poll.refresh();
}

async function host(action, payload = {}) {
  if (S.busy) return;
  S.busy = true;
  document.querySelectorAll('#phaseActions button').forEach(b => { b.disabled = true; });
  try {
    await S.api.host(action, payload, S.key);
  } catch (e) {
    if (e.status === 401) needKey('That key was rejected. Try again.');
    else toast(e.message, true);
  } finally {
    S.busy = false;
    S.poll.refresh();
    if (S.game) renderActions();
  }
}

function submittedCount() {
  const g = S.game;
  return S.teams.filter(t => t.pending && t.pending.round === g.round).length;
}

function render() {
  const g = S.game;
  const vibe = g.round ? VIBES[g.round - 1] : null;
  $('#cRound').textContent = g.round ? `Quarter ${g.round} · ${vibe.name}` : 'Lobby';
  $('#cPhase').textContent = g.phase;
  $('#cPhase').className = 'pill ' + ({ lobby: 'muted', choosing: '', rolled: 'good', finished: 'warn' }[g.phase]);
  $('#cSubmitted').textContent = g.phase === 'choosing' ? `${submittedCount()} of ${S.teams.length} teams locked in` : `${S.teams.length} team${S.teams.length === 1 ? '' : 's'}`;
  renderActions();
  renderTeamTable();

  $('#bTitle').textContent = g.round ? `Quarter ${g.round}: ${vibe.name}` : 'E-commerce strategy game';
  $('#bPill').textContent = g.phase === 'finished' ? 'Game over' : g.round ? `Year ${g.round <= 4 ? 1 : 2}` : 'Waiting for teams';
  $('#bBlurb').textContent = vibe && g.phase !== 'finished' ? vibe.blurb : '';
  $('#bLobby').hidden = g.phase !== 'lobby';
  $('#bPlay').hidden = !(g.phase === 'choosing' || g.phase === 'rolled');
  $('#bDebrief').hidden = g.phase !== 'finished';

  if (g.phase === 'lobby') {
    $('#joinUrl').textContent = joinUrl().replace(/^https?:\/\//, '');
    renderQr();
    $('#lobbyChips').innerHTML = S.teams.map(t => `<span class="pill">${esc(t.name)}</span>`).join('') || '<span class="muted">No teams yet</span>';
  }
  if (g.phase === 'choosing') {
    clearTimeout(S.revealTimer);
    S.seenRoll = null;
    S.revealedRoll = null;
    die.set(0);
    $('#diceText').innerHTML = `Waiting for choices<br><span class="sub">${submittedCount()} of ${S.teams.length} locked in</span>`;
    $('#resultChips').innerHTML = '';
    renderLeaderboard($('#lb'), false);
  }
  if (g.phase === 'rolled') renderRolled();
  if (g.phase === 'finished') renderDebrief();
}

function joinUrl() {
  // The student page lives at the site root; keep ?debug when simulating.
  const base = location.origin + location.pathname.replace(/host(\.html)?$/, '');
  return isDebug() ? base + '?debug=1' : base;
}

let qrFor = '';
function renderQr() {
  const el = $('#qr'), url = joinUrl();
  if (qrFor === url) return;
  qrFor = url;
  if (typeof qrcode !== 'function') { el.innerHTML = ''; return; }
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  el.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function renderActions() {
  const g = S.game, box = $('#phaseActions');
  box.replaceChildren();
  const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; box.appendChild(b); return b; };
  if (g.phase === 'lobby') add('Start game', 'primary big', () => {
    if (S.teams.length === 0 && !confirm('No teams have joined yet. Start anyway?')) return;
    host('start');
  });
  if (g.phase === 'choosing') add('Roll the Risk Dice', 'primary big', () => {
    const n = submittedCount();
    if (n < S.teams.length && !confirm(`${S.teams.length - n} team(s) have not locked in and will pass. Roll anyway?`)) return;
    host('roll', $('#dieValue').value ? { value: Number($('#dieValue').value) } : {});
  });
  if (g.phase === 'rolled' && g.resolved === false && S.api.now() - g.dice.at > 6000) {
    add('Finish applying the roll', 'primary big', () => host('roll'));
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = 'Some teams were not updated with this roll, probably a network hiccup. This applies the same dice value to them.';
    box.appendChild(p);
  } else if (g.phase === 'rolled') {
    if (g.round < g.settings.rounds) {
      add(`Open quarter ${g.round + 1}`, 'primary big', () => host('next'));
      add('Finish game early', 'small', () => { if (confirm('End the game now and issue completion codes?')) host('finish'); });
    } else add('Finish game and issue codes', 'primary big', () => host('finish'));
  }
  if (g.phase === 'finished') { const p = document.createElement('p'); p.className = 'small muted'; p.textContent = 'Game over. Reset to play again.'; box.appendChild(p); }
  $('#dieRow').hidden = g.phase !== 'choosing';
  if (S.busy) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
}

// While the die is still tumbling, show this quarter's cost/score/risk
// applied but hold back the bust penalty, so nothing spoils the reveal.
function preRevealView() {
  const g = S.game;
  if (g.phase !== 'rolled' || S.revealedRoll === g.dice?.rollId) return S.teams;
  return S.teams.map(t => {
    const h = t.history.find(x => x.round === g.round);
    return h ? { ...t, points: h.points + h.penalty, risk: h.riskBeforeDice, history: [...t.history.slice(0, -1), { ...h, busted: false }] } : t;
  });
}

function renderTeamTable() {
  const g = S.game;
  const rows = leaderboard(Object.fromEntries(preRevealView().map(t => [t.slug, t]))).map(t => {
    let pick = '—';
    if (g.phase === 'choosing') pick = t.pending && t.pending.round === g.round ? `<span class="pill ${t.pending.action}">${choiceLabel(t.pending)}</span>` : '<span class="muted">…</span>';
    else if (g.phase === 'rolled' || g.phase === 'finished') { const h = t.history.find(x => x.round === g.round); if (h) pick = `<span class="pill ${h.action}">${choiceLabel(h)}</span>${h.busted ? ' <span class="pill bad">bust</span>' : ''}`; }
    return `<tr><td>${esc(t.name)}${t.bot ? ' <span class="small muted">bot</span>' : ''}</td><td>${pick}</td><td class="${t.money < 0 ? 'neg' : ''}">${fmtMoney(t.money)}</td><td>${t.points}</td><td>${t.risk}</td><td><button class="kick" data-slug="${t.slug}" title="Remove team">✕</button></td></tr>`;
  }).join('');
  $('#teamTable').innerHTML = `<tr><th>Team</th><th>Pick</th><th>Money</th><th>Pts</th><th>Risk</th><th></th></tr>${rows || '<tr><td colspan="6" class="muted">No teams yet</td></tr>'}`;
  $('#teamTable').querySelectorAll('.kick').forEach(b => b.onclick = () => { if (confirm(`Remove team "${b.dataset.slug}"?`)) host('kick', { slug: b.dataset.slug }); });
}

function renderLeaderboard(el, final, preReveal = false) {
  const view = preReveal ? preRevealView() : S.teams;
  const lb = leaderboard(Object.fromEntries(view.map(t => [t.slug, t])));
  const rows = lb.map((t, i) => {
    const mini = final ? `<div class="mini">${Array.from({ length: 8 }, (_, r) => { const h = t.history.find(x => x.round === r + 1); return `<span style="background:var(--${h ? h.action : 'pass'})" title="Q${r + 1}: ${h ? choiceLabel(h) : '—'}${h?.busted ? ' (bust)' : ''}"></span>`; }).join('')}</div>` : '';
    const busts = t.history.filter(h => h.busted).length;
    return `<tr><td>${i + 1}</td><td>${esc(t.name)}${mini}</td><td><strong>${t.points.toLocaleString()}</strong></td><td class="${t.money < 0 ? 'neg' : ''}">${fmtMoney(t.money)}</td><td>${final ? busts : t.risk}</td>${final ? `<td><div class="code">${t.completion?.code || ''}</div></td>` : ''}</tr>`;
  }).join('');
  el.innerHTML = `<tr><th>#</th><th>Team</th><th>Points</th><th>Money</th><th>${final ? 'Busts' : 'Risk'}</th>${final ? '<th>Code</th>' : ''}</tr>${rows}`;
}

function renderRolled() {
  const g = S.game, dice = g.dice;
  if (S.seenRoll !== dice.rollId) {
    S.seenRoll = dice.rollId;
    clearTimeout(S.revealTimer);
    const wait = dice.revealAt - S.api.now();
    $('#resultChips').innerHTML = '';
    if (wait > 200) {
      die.tumble();
      $('#diceText').innerHTML = 'Rolling…';
      S.revealTimer = setTimeout(() => revealRoll(true), wait);
    } else revealRoll(false);
  }
  // Re-render results on every poll after the reveal, so teams whose update
  // arrived a moment late still show up.
  if (S.revealedRoll === dice.rollId) { if (Date.now() >= S.resultsAt) renderResults(); }
  else renderLeaderboard($('#lb'), false, true);
}

function revealRoll(animate) {
  const g = S.game, v = g.dice.value;
  S.revealedRoll = g.dice.rollId;
  S.resultsAt = Date.now() + (animate ? 950 : 0);
  if (animate) die.land(v); else die.set(v);
  $('#diceText').innerHTML = `Risk Dice: ${v}<br><span class="sub">Teams with more than ${v} risk ${penaltyText(g.settings).replace(/your/g, 'their')}</span>`;
  setTimeout(renderResults, animate ? 950 : 0);
}

function renderResults() {
  const g = S.game;
  if (g.phase !== 'rolled') return;
  $('#resultChips').innerHTML = S.teams.map(t => {
    const h = t.history.find(x => x.round === g.round);
    if (!h) return '';
    return h.busted ? `<span class="pill bad">${esc(t.name)} −${h.penalty}</span>` : `<span class="pill good">${esc(t.name)} safe</span>`;
  }).join('');
  renderLeaderboard($('#lb'), false);
  renderTeamTable();
}

function renderDebrief() {
  renderLeaderboard($('#lbFinal'), true);
  if (S.game.settings.allowDebt) {
    $('#brokeTitle').textContent = 'Fell under $0';
    const broke = S.teams.filter(t => t.money < 0 || t.history.some(h => h.money < 0));
    $('#brokeChips').innerHTML = broke.map(t => `<span class="pill bad">${esc(t.name)} (${fmtMoney(t.money)} now)</span>`).join('') || '<span class="muted">Nobody</span>';
  } else {
    // Under no-debt rules nobody goes below $0; who had to sell points instead?
    $('#brokeTitle').textContent = 'Sold points for cash';
    const sellers = S.teams.map(t => ({ t, sold: t.history.reduce((a, h) => a + (h.sold || 0), 0) })).filter(x => x.sold > 0).sort((a, b) => b.sold - a.sold);
    $('#brokeChips').innerHTML = sellers.map(x => `<span class="pill warn">${esc(x.t.name)}: ${x.sold.toLocaleString()} pts</span>`).join('') || '<span class="muted">Nobody</span>';
  }
}

function verify() {
  const code = $('#verifyInput').value.trim().toUpperCase();
  const t = S.teams.find(x => x.completion?.code === code);
  $('#verifyOut').innerHTML = t
    ? `<span class="pill good">Valid</span> ${esc(t.name)} · ${t.points} points · finished ${new Date(t.completion.at).toLocaleString()}`
    : `<span class="pill bad">Not found</span>`;
}

// CSV cell: quote it, double inner quotes, and defuse spreadsheet formulas
// (a team named "=HYPERLINK(...)" must stay text when opened in Excel).
function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const head = ['team', 'code', 'finished_at', 'points', 'money', 'busts', 'points_sold', ...Array.from({ length: 8 }, (_, i) => `q${i + 1}`)];
  const lines = [head.join(',')];
  for (const t of leaderboard(Object.fromEntries(S.teams.map(t => [t.slug, t])))) {
    const q = Array.from({ length: 8 }, (_, i) => { const h = t.history.find(x => x.round === i + 1); return h ? choiceLabel(h) + (h.busted ? ' (bust)' : '') : ''; });
    lines.push([t.name, t.completion?.code || '', t.completion ? new Date(t.completion.at).toISOString() : '', t.points, t.money, t.history.filter(h => h.busted).length, t.history.reduce((a, h) => a + (h.sold || 0), 0), ...q].map(cell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ecommerce-game-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function main() {
  S.api = await createApi();
  S.key = storedKey();
  $('#modeLine').textContent = isDebug() ? 'Simulated mode: everything lives in this browser. Open a student tab to play along.' : 'Live game';
  $('#keyForm').onsubmit = unlock;
  if (isDebug()) {
    $('#debugTools').hidden = false;
    $('#botsBtn').onclick = () => host('bots', { count: 4 });
    $('#botsChooseBtn').onclick = () => host('botsChoose');
  }
  $('#copyLinkBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl()); toast('Join link copied'); }
    catch { prompt('Copy this link:', joinUrl()); }
  };
  $('#resetBtn').onclick = () => { if (confirm('Reset the game and remove every team? This cannot be undone.')) host('reset'); };
  $('#projectorBtn').onclick = () => { document.body.classList.add('projector'); $('#showControls').hidden = false; };
  $('#showControls').onclick = () => { document.body.classList.remove('projector'); $('#showControls').hidden = true; };
  $('#verifyBtn').onclick = verify;
  $('#verifyInput').onkeydown = e => { if (e.key === 'Enter') verify(); };
  $('#csvBtn').onclick = downloadCsv;
  S.poll = startPolling(S.api, () => ({ role: 'host', key: S.key }), s => { S.game = s.game; S.teams = s.teams; render(); }, {
    onError(e) {
      if (e.status === 401) needKey(S.key ? 'That key was rejected. Try again.' : '');
      else if (e.status === 500) toast(e.message, true);
    },
  });
  if (!isDebug() && !S.key) needKey();
}
main();
