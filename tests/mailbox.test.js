import { test, expect, mock, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
mock.module('cloudflare:workers', () => ({ DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } }));
const { Mailbox, default: worker } = await import('../src/worker.js');
const { verifiedUser } = await import('../src/access.js');
test('preview worker skips auth, the real mailbox and cron, while production still fails closed', async () => {
  const network = spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Preview must not call services'); });
  const env = { PREVIEW_MODE: 'true', NEXA_SERVICE_KEY: 'installed-key', NEXA_SERVICE_ORIGIN: 'https://nexa.test', MAILBOX: new Proxy({}, { get() { throw Error('Real mailbox accessed'); } }), ASSETS: { fetch: async () => new Response('preview') } };
  try {
    expect((await worker.fetch(new Request('https://preview.test/'), env)).status).toBe(200);
    expect((await worker.fetch(new Request('https://preview.test/api/messages'), env)).status).toBe(403);
    await worker.scheduled({}, env, { waitUntil() { throw Error('Preview cron ran'); } });
    expect(network).not.toHaveBeenCalled();
    expect((await worker.fetch(new Request('https://preview.test/?preview=true'), { PREVIEW_MODE: 'false' })).status).toBe(503);
  } finally { network.mockRestore(); }
});
function setup() {
  const db = new Database(':memory:');
  const sql = { exec(query, ...args) { if (!args.length && query.includes(';')) { db.exec(query); return; } const result = db.query(query).all(...args); return { toArray: () => result, one: () => result[0] }; } };
  const box = new Mailbox({ storage: { sql, transactionSync: fn => db.transaction(fn)() } }, { NEXA_SERVICE_ORIGIN: 'https://nexa.test', NEXA_SERVICE_KEY: 'local-test-secret' });
  const call = (path, body, method) => box.fetch(new Request('https://inbox.test/api' + path, { method: method || (body ? 'POST' : 'GET'), body: body ? JSON.stringify(body) : undefined }));
  return { db, box, call };
}
test('sync saves MIME and attachments before ack; duplicate delivery recovers lost acknowledgements', async () => {
  const f = setup(), id = 'a'.repeat(32), raw = 'From: Sender <sender@test>\r\nTo: org+accounting@mail.test\r\nSubject: Invoice\r\nMessage-ID: <invoice@test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nInvoice text\r\n--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="invoice.txt"\r\n\r\nfile\r\n--x--\r\n';
  let acks = 0;
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const path = new URL(url).pathname;
    if (path === '/v1/email/incoming') return Response.json({ aliases: [{ alias: 'accounting' }], messages: [{ id, recipient: 'org+accounting@mail.test', sender: 'sender@test', receivedAt: Date.now(), authenticated: true }] });
    if (path === '/v1/usage') return Response.json({ sender: 'org@mail.test' });
    if (path.endsWith('/ack')) { expect(f.db.query('SELECT COUNT(*) AS n FROM messages').get().n).toBe(1); acks++; if (acks === 1) throw Error('network'); return Response.json({ acknowledged: true }); }
    return new Response(raw);
  });
  try {
    await expect(f.box.sync()).rejects.toThrow('network'); await f.box.sync();
    const list = await (await f.call('/messages')).json(); expect(list.messages).toHaveLength(1); expect(list.addresses).toEqual(['org+accounting@mail.test']); expect(acks).toBe(2);
    const detail = await (await f.call('/messages/' + id)).json(); expect(detail.text).toContain('Invoice text'); expect(detail.attachments[0].filename).toBe('invoice.txt');
    expect(await (await f.call('/messages/' + id + '/attachment/0')).text()).toContain('file');
    expect((await f.call('/messages/' + id, undefined, 'DELETE')).status).toBe(400);
    await f.call('/messages/' + id, { folder: 'Trash' }, 'PATCH'); expect((await f.call('/messages/' + id, undefined, 'DELETE')).status).toBe(200);
  } finally { fetcher.mockRestore(); f.db.close(); }
});
test('draft versions, ambiguous sends, retries and sent exports preserve one immutable operation', async () => {
  const f = setup(), id = crypto.randomUUID(), body = { from: 'org+accounting@mail.test', to: 'to@test', subject: 'Invoice', text: 'hello' }; let calls = 0, keys = [];
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => { calls++; keys.push(init.headers['idempotency-key']); if (calls === 1) throw Error('lost response'); return Response.json({ status: 'accepted', messageId: '<sent@test>' }); });
  try {
    expect((await f.call('/drafts/' + id, { message: body, version: 0 }, 'PUT')).status).toBe(200);
    expect((await f.call('/drafts/' + id, { message: body, version: 0 }, 'PUT')).status).toBe(409);
    expect((await f.call('/drafts/' + id + '/send', {})).status).toBe(500);
    expect((await f.call('/drafts/' + id, undefined, 'DELETE')).status).toBe(409);
    expect((await f.call('/drafts/' + id, { message: body, version: 1 }, 'PUT')).status).toBe(409);
    expect((await (await f.call('/drafts/' + id + '/send', {})).json()).status).toBe('accepted');
    expect((await (await f.call('/drafts/' + id + '/send', {})).json()).status).toBe('accepted'); expect(calls).toBe(2); expect(new Set(keys).size).toBe(1);
    const sent = await (await f.call('/messages/' + id)).json(); expect(sent.replyTo).toBe('to@test'); expect(sent.inReplyTo).toBe('<sent@test>');
    const list = await (await f.call('/messages')).json(); expect(list.drafts[0].body.text).toBeUndefined();
    expect((await (await f.call('/drafts/' + id)).json()).body).toEqual(body);
    await f.call('/messages/' + id, { folder: 'Trash' }, 'PATCH'); expect((await (await f.call('/messages/' + id)).json()).text).toBe('hello');
    const exported = await f.call('/messages/' + id + '/raw'); expect(exported.headers.get('content-type')).toBe('application/json'); expect(await exported.json()).toEqual(body);
  } finally { fetcher.mockRestore(); f.db.close(); }
});
test('full mailbox prevents provider send; upstream rejection cannot be edited and reused', async () => {
  const f = setup(), id = crypto.randomUUID(), body = { to: 'to@test', subject: 'Invoice', text: 'hello' }; let calls = 0;
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async () => { calls++; return Response.json({ error: { message: 'Recipient is suppressed.' } }, { status: 403 }); });
  try {
    await f.call('/drafts/' + id, { message: body, version: 0 }, 'PUT');
    f.box.save({ id: 'a'.repeat(32), recipient: 'to@test', receivedAt: Date.now() }, new Uint8Array([1]), {});
    f.db.query('UPDATE messages SET bytes=?').run(512 * 1024 * 1024);
    expect((await f.call('/drafts/' + id + '/send', {})).status).toBe(413); expect(calls).toBe(0);
    f.db.query('DELETE FROM messages').run();
    expect((await (await f.call('/drafts/' + id + '/send', {})).json()).status).toBe('rejected');
    expect((await f.call('/drafts/' + id, { message: body, version: 1 }, 'PUT')).status).toBe(409); await f.call('/drafts/' + id + '/send', {}); expect(calls).toBe(1);
  } finally { fetcher.mockRestore(); f.db.close(); }
});
test('mailbox rejects forged identity and verifies signed method, URL, user and expiry', async () => {
  const secret = 'test-secret', time = String(Date.now()), url = 'https://inbox.test/api/me', user = 'user123', email = 'user@test';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode([time, 'GET', url, user, email].join('\n')));
  const proof = Buffer.from(signature).toString('base64url'), headers = { 'x-nexa-access-time': time, 'x-nexa-access-proof': proof, 'x-nexa-user-id': user, 'x-nexa-user-email': email };
  expect(await verifiedUser(new Request(url, { headers }), secret)).toEqual({ id: user, email });
  for (const request of [new Request(url + '/other', { headers }), new Request(url, { method: 'POST', headers }), new Request(url, { headers: { ...headers, 'x-nexa-user-email': 'forged@test' } }), new Request(url, { headers: { ...headers, 'x-nexa-access-time': '1000000000000' } })]) expect(await verifiedUser(request, secret)).toBeNull();
  expect((await worker.fetch(new Request(url, { headers: { 'x-nexa-user-id': user } }), { NEXA_SERVICE_KEY: secret })).status).toBe(503); // Missing Auth setup never opens the mailbox.
});
test('a slow draft write cannot overwrite a newer version or alter a started send', async () => {
  const f = setup(), id = crypto.randomUUID(), body = { from: 'org@mail.test', to: 'to@test', subject: 'First', text: 'hello' };
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ status: 'accepted', messageId: '<sent@test>' }));
  let stream;
  try {
    await f.call('/drafts/' + id, { message: body, version: 0 }, 'PUT');
    const slow = () => f.box.fetch(new Request('https://inbox.test/api/drafts/' + id, { method: 'PUT', body: new ReadableStream({ start(controller) { stream = controller; } }), duplex: 'half' }));
    const pending = slow();
    await f.call('/drafts/' + id, { message: { ...body, subject: 'Newer' }, version: 1 }, 'PUT');
    stream.enqueue(new TextEncoder().encode(JSON.stringify({ message: body, version: 1 }))); stream.close();
    expect((await pending).status).toBe(409);
    const duringSend = slow();
    expect((await (await f.call('/drafts/' + id + '/send', {})).json()).status).toBe('accepted');
    stream.enqueue(new TextEncoder().encode(JSON.stringify({ message: body, version: 2 }))); stream.close();
    expect((await duringSend).status).toBe(409);
    expect((await (await f.call('/messages/' + id)).json()).subject).toBe('Newer');
  } finally { fetcher.mockRestore(); f.db.close(); }
});
