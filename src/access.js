// The Nexa deployment guard signs identities after checking live project access.
// Header names alone never authorize a request, including on an unguarded deployment.
export async function verifiedUser(request, secret) {
  if (!secret) return null;
  const at = request.headers.get('x-nexa-access-time'), proof = request.headers.get('x-nexa-access-proof');
  const id = request.headers.get('x-nexa-user-id'), email = request.headers.get('x-nexa-user-email');
  if (!at || !proof || !id || !email || !/^\d{13}$/.test(at) || Math.abs(Date.now() - Number(at)) > 60000 || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return null;
  try {
    const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const bytes = Uint8Array.from(atob(proof.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    return await crypto.subtle.verify('HMAC', key, bytes, encoder.encode([at, request.method, request.url, id, email].join('\n'))) ? { id, email } : null;
  } catch { return null; }
}
