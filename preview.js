// A separate, browser-only mailbox. No network transport or production credentials.
const KEY = 'nexa-mail:preview:v1';
const addresses = ['studio+inbox@example.test', 'studio+orders@example.test'];
function sample() {
  const examples = [
    ['Kaisa · Northline', 'Welcome to your preview inbox', 'Explore folders, search, attachments and replies. Changes stay in this browser. Sending is simulated.', 'Inbox', 1, 1],
    ['Marta · Studio Oak', 'Autumn collection — final details', 'The new product photographs are ready. Shall we review the collection on Thursday?', 'Inbox', 1, 0],
    ['Jonas · Paper & Co', 'Invoice for October supplies', 'Here is the sample invoice for last month’s supplies. The attachment contains fictional data.', 'Inbox', 0, 0],
    ['Liisa · Coast Studio', 'A quick question about my order', 'Could you confirm the delivery details for my sample order?', 'Inbox', 1, 0],
    ['Team Northline', 'Friday studio notes', 'A few ideas for next week: update the website, review stock, and prepare the November newsletter.', 'Archive', 0, 0],
    ['studio+inbox@example.test', 'Re: Project schedule', 'Thursday works for us. See you then!', 'Sent', 0, 0],
  ];
  const messages = examples.map(([sender, subject, text, folder, unread, starred], i) => ({ id: crypto.randomUUID(), sender, subject, text, preview: text, address: addresses[i === 3 ? 1 : 0], recipient: folder === 'Sent' ? 'marta@example.test' : addresses[i === 3 ? 1 : 0], replyTo: 'marta@example.test', received_at: Date.UTC(2026, 10, 3, 10, 40 - i * 10), folder, unread, starred, format: 'json', html: '', attachments: i === 2 ? [{ filename: 'sample-invoice.txt', type: 'text/plain', content: btoa('Sample invoice INV-2026-047\nFictional supplier: Paper & Co\nTotal: EUR 128.00\nPreview data only.\n') }] : [] }));
  return { version: 1, messages, drafts: [] };
}
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function createPreviewMailbox(storage) {
  function load() {
    const saved = storage.getItem(KEY);
    if (!saved) return sample();
    const state = JSON.parse(saved);
    if (state.version !== 1 || !Array.isArray(state.messages) || !Array.isArray(state.drafts)) throw fail('Reset the preview to restore sample mail.');
    return state;
  }
  function save(state) {
    const value = JSON.stringify(state);
    if (value.length > 3_000_000 || state.messages.length > 100 || state.drafts.length > 100) throw fail('Preview storage is full. Delete sample mail or reset the preview.', 413);
    try { storage.setItem(KEY, value); } catch { throw fail('Browser storage is unavailable or full. Free some space to save preview changes.'); }
  }
  if (!storage.getItem(KEY)) save(sample());
  return {
    reset() { save(sample()); },
    download(id, index) {
      const message = load().messages.find(item => item.id === id);
      if (!message) throw fail('Message not found.', 404);
      if (index === undefined) return 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(message, null, 2));
      const file = message.attachments[index];
      if (!file) throw fail('Attachment not found.', 404);
      return 'data:application/octet-stream;base64,' + file.content;
    },
    async api(path, body, method = body === undefined ? 'GET' : 'POST') {
      const state = load(), url = new URL(path, 'https://preview.invalid'), route = url.pathname;
      if (route === '/sync' && method === 'POST') return { simulated: true };
      if (route === '/messages' && method === 'GET') {
        const folder = url.searchParams.get('folder') || 'Inbox', address = url.searchParams.get('address'), query = (url.searchParams.get('q') || '').toLowerCase(), offset = Number(url.searchParams.get('offset')) || 0;
        const items = state.messages.filter(item => (folder === 'Starred' ? item.starred && item.folder !== 'Trash' : item.folder === folder) && (!address || item.address === address) && (url.searchParams.get('unread') !== '1' || item.unread) && (!query || `${item.sender} ${item.subject} ${item.text}`.toLowerCase().includes(query))).sort((a, b) => b.received_at - a.received_at);
        return { messages: items.slice(offset, offset + 50), total: items.length, addresses, sender: addresses[0], drafts: state.drafts, preview: true };
      }
      const messageMatch = route.match(/^\/messages\/([a-f0-9-]{36})$/);
      if (messageMatch) {
        const item = state.messages.find(item => item.id === messageMatch[1]);
        if (!item) throw fail('Message not found.', 404);
        if (method === 'GET') return { ...item, attachments: item.attachments.map((file, index) => ({ index, filename: file.filename, bytes: atob(file.content).length })), threadMessages: [{ id: item.id, subject: item.subject, received_at: item.received_at }] };
        if (method === 'PATCH') {
          if (body.folder !== undefined && !['Inbox', 'Archive', 'Trash'].includes(body.folder)) throw fail('Choose a mailbox folder.');
          for (const key of ['folder', 'starred', 'unread']) if (body[key] !== undefined) item[key] = body[key];
        } else if (method === 'DELETE') {
          if (item.folder !== 'Trash') throw fail('Move this message to Trash first.');
          state.messages = state.messages.filter(message => message.id !== item.id);
        } else throw fail('Unsupported preview action.', 405);
        save(state); return { saved: true };
      }
      const draftMatch = route.match(/^\/drafts\/([a-f0-9-]{36})(\/send)?$/);
      if (draftMatch) {
        let draft = state.drafts.find(item => item.id === draftMatch[1]);
        if (method === 'PUT' && !draftMatch[2]) {
          if (draft && (draft.status !== 'draft' || draft.version !== body.version)) throw fail('This draft changed. Reopen it before saving.', 409);
          const message = body.message;
          if (!message || !['to', 'subject', 'text'].every(key => typeof message[key] === 'string')) throw fail('Enter a recipient, subject and message.');
          if (JSON.stringify(message).length > 800000) throw fail('This preview draft is too large.', 413);
          if (!draft) { draft = { id: draftMatch[1], version: 0, status: 'draft' }; state.drafts.push(draft); }
          Object.assign(draft, { body: structuredClone(message), version: draft.version + 1, updated_at: Date.now() });
          save(state); return { id: draft.id, version: draft.version };
        }
        if (!draft) throw fail('Draft not found.', 404);
        if (method === 'GET' && !draftMatch[2]) return draft;
        if (method === 'DELETE' && !draftMatch[2]) { state.drafts = state.drafts.filter(item => item.id !== draft.id); save(state); return { deleted: true }; }
        if (method === 'POST' && draftMatch[2]) {
          if (draft.status === 'simulated') return { status: 'simulated' };
          draft.status = 'simulated';
          const data = draft.body;
          state.messages.unshift({ id: draft.id, sender: data.from, recipient: data.to, address: data.from, replyTo: data.to, subject: data.subject, text: data.text, preview: data.text.slice(0, 200), attachments: data.attachments || [], folder: 'Sent', received_at: Date.now(), unread: 0, starred: 0, format: 'json', html: '' });
          save(state); return { status: 'simulated' };
        }
      }
      throw fail('Unsupported preview action.', 404);
    },
  };
}
