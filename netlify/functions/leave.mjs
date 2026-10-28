// POST /api/leave { slug }  -> { ok: true }. Only while the game is in the lobby.
import { service, json, handle, requireMethod, body } from './_lib/server.mjs';

export default handle(async req => {
  requireMethod(req, 'POST');
  const { slug } = await body(req);
  return json(await service().leave(slug));
});

export const config = { path: '/api/leave' };
