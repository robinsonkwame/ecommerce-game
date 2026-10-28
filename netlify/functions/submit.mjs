// POST /api/submit { slug, action, qty?, lots? }  -> the team doc with its locked-in choice
// lots: how many lots of points to sell for cash this quarter (see rules.js)
import { service, json, handle, requireMethod, body } from './_lib/server.mjs';

export default handle(async req => {
  requireMethod(req, 'POST');
  const { slug, action, qty, lots } = await body(req);
  return json(await service().submit(slug, { action, qty, lots }));
});

export const config = { path: '/api/submit' };
