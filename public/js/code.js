// 6-character completion code: HMAC-SHA256(secret, input), base-32 with the
// ambiguous letters (0/O/1/I) removed. Works in browsers and Node 18+.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function completionCode(secret, input, length = 6) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(input)));
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[sig[i] % 32];
  return s;
}
