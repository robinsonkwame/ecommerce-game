// POST /api/join { name }  -> the team doc (new, or existing for the same name)
import { service, json, handle, requireMethod, body } from './_lib/server.mjs';

export default handle(async req => {
  requireMethod(req, 'POST');
  const { name } = await body(req);
  return json(await service().join(String(name || '')));
});

export const config = { path: '/api/join' };
