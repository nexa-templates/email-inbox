import { test, expect, spyOn } from 'bun:test';
import { createPreviewMailbox } from '../preview.js';
import { isPreview, previewResponse } from '../src/preview.js';

const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
test('preview mail is isolated, persistent, resettable, and sends only a local sample record', async () => {
  const local = storage(), box = createPreviewMailbox(local), other = createPreviewMailbox(storage());
  const network = spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Preview must not use the network'); });
  try {
    const sample = await box.api('/messages'); expect(sample.total).toBe(4);
    const id = sample.messages[0].id;
    await box.api('/messages/' + id, { folder: 'Archive' }, 'PATCH');
    expect((await createPreviewMailbox(local).api('/messages')).total).toBe(3);
    expect((await other.api('/messages')).total).toBe(4);
    const invoice = (await box.api('/messages?q=invoice')).messages[0];
    expect(atob(box.download(invoice.id, 0).split(',')[1])).toContain('Fictional supplier');
    const draftID = crypto.randomUUID(), message = { from: sample.sender, to: 'visitor@example.test', subject: 'Preview draft', text: 'Local only', attachments: [{ filename: 'example.txt', content: btoa('attachment') }] };
    await box.api('/drafts/' + draftID, { message, version: 0 }, 'PUT');
    await expect(box.api('/drafts/' + draftID, { message, version: 0 }, 'PUT')).rejects.toMatchObject({ status: 409 });
    expect((await createPreviewMailbox(local).api('/drafts/' + draftID)).body).toEqual(message);
    expect(await box.api('/drafts/' + draftID + '/send', {})).toEqual({ status: 'simulated' });
    await box.api('/drafts/' + draftID + '/send', {});
    expect((await box.api('/messages?folder=Sent&q=Preview draft')).total).toBe(1);
    expect(atob(box.download(draftID, 0).split(',')[1])).toBe('attachment');
    expect((await other.api('/messages?folder=Sent&q=Preview draft')).total).toBe(0);
    expect(network).not.toHaveBeenCalled();
    box.reset(); expect((await box.api('/messages')).total).toBe(4); expect((await box.api('/messages')).drafts).toHaveLength(0);
  } finally { network.mockRestore(); }
});

test('public preview server rejects real mail operations even with credentials or forged identities', async () => {
  const assets = { fetch: async () => new Response('<h1>Preview</h1>', { headers: { 'content-type': 'text/html' } }) };
  const env = { PREVIEW_MODE: 'true', ASSETS: assets, NEXA_SERVICE_KEY: 'installed-but-unused' };
  expect(isPreview(env)).toBe(true); for (const value of [undefined, 'false', 'TRUE', true]) expect(isPreview({ PREVIEW_MODE: value })).toBe(false);
  const network = spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('No provider calls'); });
  try {
    expect(await (await previewResponse(new Request('https://preview.test/api/me'), env)).json()).toEqual({ preview: true, email: 'Preview' });
    for (const [method, path] of [['GET', '/api/messages'], ['GET', '/api/messages/' + 'a'.repeat(32) + '/raw'], ['POST', '/api/sync'], ['POST', '/api/drafts/' + crypto.randomUUID() + '/send'], ['PUT', '/api/drafts/' + crypto.randomUUID()]]) {
      const result = await previewResponse(new Request('https://preview.test' + path, { method, headers: { 'x-nexa-user-email': 'forged@example.test', authorization: 'Bearer installed-but-unused' } }), env);
      expect(result.status).toBe(403);
    }
    const page = await previewResponse(new Request('https://preview.test/'), env);
    expect(page.status).toBe(200); expect(page.headers.get('cache-control')).toBe('no-store');
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
