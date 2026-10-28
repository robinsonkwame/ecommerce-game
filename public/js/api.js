// Picks the backend: the Netlify functions, or the in-browser simulator when
// the page was opened with ?debug (sticky until ?debug=0).
export function isDebug() {
  const p = new URLSearchParams(location.search);
  try {
    if (p.has('debug')) {
      if (p.get('debug') === '0') localStorage.removeItem('ecg:debug');
      else localStorage.setItem('ecg:debug', '1');
    }
    return localStorage.getItem('ecg:debug') === '1';
  } catch {
    return p.has('debug') && p.get('debug') !== '0';
  }
}

export async function createApi() {
  if (isDebug()) {
    const m = await import('./mock-api.js');
    return m.createMockApi();
  }
  return createNetApi();
}

// Tracks the gap between this device's clock and the server's, so the dice
// reveal lands at the same moment on every screen even if a phone's clock is off.
export function createClock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    sync(serverNow, sentAt) {
      if (!serverNow) return;
      const rtt = Date.now() - sentAt;
      if (rtt < 2000) offset = serverNow + rtt / 2 - Date.now();
    },
  };
}

function createNetApi() {
  const clock = createClock();
  async function call(url, opts) {
    const r = await fetch(url, { cache: 'no-store', ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return data;
  }
  const post = (url, payload, headers = {}) =>
    call(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return {
    mode: 'net',
    now: clock.now,
    async getState({ slug = '', role = '', key = '' } = {}, version = '') {
      const q = new URLSearchParams({ v: version || '' });
      if (role === 'host') q.set('role', 'host'); else q.set('team', slug || '');
      const sentAt = Date.now();
      const s = await call(`/api/state?${q}`, { headers: role === 'host' ? { 'x-host-key': key } : {} });
      clock.sync(s.serverNow, sentAt);
      return s;
    },
    join: name => post('/api/join', { name }),
    submit: (slug, choice) => post('/api/submit', { slug, ...choice }),
    host: (action, payload = {}, key = '') => post('/api/host', { action, ...payload }, { 'x-host-key': key }),
    onChange() {},
  };
}

// Poll for state; also refresh right away when the simulator signals a change
// or the tab comes back to the foreground (phones pause background tabs).
export function startPolling(api, getQuery, onState, { intervalMs = 1500, onError } = {}) {
  let version = null, busy = false, again = false;
  async function tick() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const s = await api.getState(getQuery(), version);
      if (!s.unchanged) { version = s.version; onState(s); }
    } catch (e) {
      onError ? onError(e) : console.warn('poll failed', e);
    } finally {
      busy = false;
      if (again) { again = false; tick(); }
    }
  }
  tick();
  const id = setInterval(tick, intervalMs);
  api.onChange?.(() => tick());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return { refresh() { version = null; tick(); }, stop: () => clearInterval(id) };
}
