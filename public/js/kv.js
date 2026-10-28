// A tiny key-value store with etags, matching the subset of Netlify Blobs the
// service uses. Backed by anything with string read/write/remove/keys, so it
// runs on a Map (tests) or localStorage (the in-browser simulator).
//
//   get(key)                      -> { data, etag } | null
//   set(key, data, { ifMatch, ifNew }) -> new etag, or null if the condition failed
//   del(key)
//   list(prefix)                  -> keys
export function createKvStore(backing, { onWrite } = {}) {
  let n = 0;
  const etag = () => `${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const read = key => {
    const raw = backing.read(key);
    return raw == null ? null : JSON.parse(raw);
  };
  return {
    async get(key) { return read(key); },
    async set(key, data, { ifMatch, ifNew } = {}) {
      const cur = read(key);
      if (ifNew && cur) return null;
      if (ifMatch && (!cur || cur.etag !== ifMatch)) return null;
      const tag = etag();
      backing.write(key, JSON.stringify({ data, etag: tag }));
      onWrite?.();
      return tag;
    },
    async del(key) { backing.remove(key); onWrite?.(); },
    async list(prefix) { return backing.keys().filter(k => k.startsWith(prefix)); },
  };
}

export function mapBacking(map = new Map()) {
  return { read: k => map.get(k) ?? null, write: (k, v) => map.set(k, v), remove: k => map.delete(k), keys: () => [...map.keys()] };
}
