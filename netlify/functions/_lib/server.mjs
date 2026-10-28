// Glue between the Netlify runtime and the shared game service.
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createService } from '../../../public/js/service.js';
import { completionCode } from '../../../public/js/code.js';

// Netlify Blobs behind the service's small KV interface. Strong consistency so
// a poll right after a write sees it (the default, eventual, can lag ~60s).
function blobStore() {
  const s = getStore({ name: 'ecommerce-game', consistency: 'strong' });
  return {
    async get(key) {
      const r = await s.getWithMetadata(key, { type: 'json' });
      return r ? { data: r.data, etag: r.etag } : null;
    },
    async set(key, data, { ifMatch, ifNew } = {}) {
      const opts = ifMatch ? { onlyIfMatch: ifMatch } : ifNew ? { onlyIfNew: true } : {};
      const r = await s.setJSON(key, data, opts);
      return r.modified ? (r.etag || 'ok') : null;
    },
    del: key => s.delete(key),
    async list(prefix) {
      const { blobs } = await s.list({ prefix });
      return blobs.map(b => b.key);
    },
  };
}

const hostKey = () => process.env.HOST_KEY || '';

export function service() {
  return createService(blobStore(), { codeFor: input => completionCode(hostKey(), input) });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const digest = s => createHash('sha256').update(s).digest();

export function requireHost(req) {
  const key = hostKey();
  if (!key) throw new HttpError('HOST_KEY is not set for this site. Add it under Site configuration → Environment variables.', 500);
  const got = req.headers.get('x-host-key') || '';
  if (!timingSafeEqual(digest(got), digest(key))) throw new HttpError('Wrong host key', 401);
}

export function requireMethod(req, method) {
  if (req.method !== method) throw new HttpError(`Use ${method}`, 405);
}

export async function body(req) {
  const text = await req.text();
  if (text.length > 4096) throw new HttpError('Request too large', 413);
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError('Send JSON', 400); }
}

// Errors with a status (rule violations, auth) go back to the browser as
// readable messages; anything else is logged and hidden.
export function handle(fn) {
  return async req => {
    try {
      return await fn(req);
    } catch (e) {
      if (e && Number.isInteger(e.status)) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on the server. Try again.' }, 500);
    }
  };
}

// Short content hash so pollers get a tiny reply when nothing changed.
export function versionOf(data) {
  return createHash('sha1').update(JSON.stringify(data)).digest('base64url').slice(0, 16);
}
