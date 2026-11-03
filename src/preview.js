// Preview requests never enter authentication, the mailbox DO, or Nexa services.
export const isPreview = env => env.PREVIEW_MODE === 'true';
export async function previewResponse(request, env) {
  const path = new URL(request.url).pathname;
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" };
  if (path === '/api/me' && request.method === 'GET') return Response.json({ preview: true, email: 'Preview' }, { headers });
  if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) return Response.json({ error: 'Preview mail stays in your browser. Live mailbox access is disabled.' }, { status: 403, headers });
  const response = await env.ASSETS.fetch(request);
  const output = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) output.headers.set(name, value);
  return output;
}
