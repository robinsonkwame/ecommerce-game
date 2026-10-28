// GET /api/state?team=<slug>&v=<version>        a student's view
// GET /api/state?role=host&v=<version>          the host's view (needs X-Host-Key)
import { service, json, handle, requireHost, requireMethod, versionOf } from './_lib/server.mjs';

export default handle(async req => {
  requireMethod(req, 'GET');
  const url = new URL(req.url);
  const svc = service();
  let data;
  if (url.searchParams.get('role') === 'host') {
    requireHost(req);
    data = await svc.hostState();
  } else {
    data = await svc.studentState(url.searchParams.get('team') || '');
  }
  const version = versionOf(data);
  const serverNow = Date.now();
  if (url.searchParams.get('v') === version) return json({ unchanged: true, version, serverNow });
  return json({ ...data, unchanged: false, version, serverNow });
});

export const config = { path: '/api/state' };
