const $ = selector => document.querySelector(selector);
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const button = (text, action, label) => { const el = node('button', text); el.type = 'button'; if (label) el.setAttribute('aria-label', label); el.onclick = () => run(action); return el; };
let folder = 'Inbox', address = '', offset = 0, snapshot, draft, loading = false, searchTimer, opener;
let previewMailbox;
const dialogs = ['#message-dialog', '#compose-dialog'];
function notify(message) { $('.toast').textContent = message; $('.toast').hidden = false; setTimeout(() => $('.toast').hidden = true, 5000); }
function error(message, target = '#error') { $(target).textContent = message || ''; $(target).hidden = !message; }
async function api(path, body, method) {
  if (previewMailbox) return previewMailbox.api(path, body, method);
  const response = await fetch('/api' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) throw new Error(value?.error || (response.status === 401 ? 'Sign in through Nexa to open this inbox.' : 'The mailbox is unavailable. A static preview has no connected mailbox.'));
  return value;
}
async function run(action, target) { try { error('', target); await action(); } catch (e) { error(e.message, target); } }
function openDialog(selector) { opener = document.activeElement; $(selector).showModal(); }
for (const selector of dialogs) { $(selector).querySelector('[data-close]').onclick = () => $(selector).close(); $(selector).addEventListener('close', () => { if (opener?.isConnected) opener.focus(); }); }
async function load() {
  if (loading) return; loading = true;
  try {
    const query = new URLSearchParams({ folder: folder === 'Drafts' ? 'Inbox' : folder, address, offset: String(offset), q: $('input[type=search]').value, unread: $('#unread').checked ? '1' : '0' });
    snapshot = await api('/messages?' + query); render();
  } finally { loading = false; }
}
function render() {
  $('h1').textContent = folder; document.title = folder + ' · Nexa Mail';
  document.querySelectorAll('[data-folder]').forEach(el => { el.classList.toggle('selected', el.dataset.folder === folder); el.setAttribute('aria-current', el.dataset.folder === folder ? 'page' : 'false'); });
  const items = folder === 'Drafts' ? snapshot.drafts : snapshot.messages;
  const list = $('#messages'); list.replaceChildren();
  for (const item of items) {
    const row = node('article', undefined, 'message' + (item.unread ? ' unread' : ''));
    if (folder !== 'Drafts') { const star = button(item.starred ? '★' : '☆', async () => { await api('/messages/' + item.id, { starred: !item.starred }, 'PATCH'); await load(); }, 'Star ' + item.subject); star.className = 'star'; star.setAttribute('aria-pressed', String(!!item.starred)); row.append(star); }
    const main = button('', async () => folder === 'Drafts' ? compose(await api('/drafts/' + item.id)) : read(item.id)); main.className = 'message-open';
    main.append(node('span', folder === 'Drafts' ? item.body.to || '(No recipient)' : item.sender, 'sender'), node('strong', folder === 'Drafts' ? item.body.subject || '(No subject)' : item.subject), node('span', folder === 'Drafts' ? item.status : item.preview, 'snippet')); row.append(main, node('time', new Date(item.received_at || item.updated_at).toLocaleDateString())); list.append(row);
  }
  if (!items.length) list.append(node('p', 'No messages here.', 'empty'));
  $('#count').textContent = folder === 'Drafts' ? items.length + ' drafts' : snapshot.total + ' messages';
  $('#previous').disabled = offset === 0 || folder === 'Drafts'; $('#next').disabled = offset + items.length >= snapshot.total || folder === 'Drafts';
   $('#sync-status').textContent = previewMailbox ? 'Sample mail · Saved in this browser · Sending is simulated' : snapshot.syncError || (snapshot.lastSync ? 'Last synced ' + new Date(snapshot.lastSync).toLocaleString() : 'Refresh to connect your Nexa addresses.');
  $('#addresses').replaceChildren(button('All addresses', async () => { address = ''; offset = 0; await load(); }));
  for (const value of snapshot.addresses) { const el = button(value, async () => { address = value; offset = 0; await load(); }); el.classList.toggle('selected', value === address); $('#addresses').append(el); }
}
async function read(id, replace = false) {
  const message = await api('/messages/' + id);
  $('#message-title').textContent = message.subject; $('#message-sender').textContent = message.sender + ' → ' + message.recipient + ' · ' + new Date(message.received_at).toLocaleString();
  $('#message-auth').textContent = previewMailbox ? 'Fictional preview message' : message.authenticated ? 'Sender domain authentication passed.' : 'Sender domain authentication was not confirmed. Treat requests and attachments with care.';
  const content = $('#message-content'); content.replaceChildren();
  if (message.text) content.append(node('pre', message.text));
  if (message.html) content.append(button(message.text ? 'Show formatted message' : 'Open formatted message', () => { const frame = document.createElement('iframe'); frame.title = 'Email content'; frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">' + message.html; content.append(frame); }));
  $('#attachments').replaceChildren();
  for (const file of message.attachments) { const link = node('a', file.filename + ' · ' + (file.bytes / 1024).toFixed(1) + ' KiB'); link.href = previewMailbox ? previewMailbox.download(id, file.index) : '/api/messages/' + id + '/attachment/' + file.index; link.download = file.filename; $('#attachments').append(link); }
  $('#thread').replaceChildren();
  if (message.threadMessages.length > 1) for (const part of message.threadMessages) $('#thread').append(button(part.subject + ' · ' + new Date(part.received_at).toLocaleString(), () => read(part.id, true)));
  const move = async target => { await api('/messages/' + id, { folder: target }, 'PATCH'); $('#message-dialog').close(); await load(); };
  $('#message-actions').replaceChildren(button('Reply', () => { $('#message-dialog').close(); compose(null, { from: message.address, to: message.replyTo, subject: /^re:/i.test(message.subject) ? message.subject : 'Re: ' + message.subject, text: '', inReplyTo: message.inReplyTo || undefined, references: message.references || undefined }); }), button(message.folder === 'Archive' || message.folder === 'Trash' ? 'Move to Inbox' : 'Archive', () => move(message.folder === 'Archive' || message.folder === 'Trash' ? 'Inbox' : 'Archive')), button('Mark unread', async () => { await api('/messages/' + id, { unread: true }, 'PATCH'); $('#message-dialog').close(); await load(); }));
  if (message.folder !== 'Trash') $('#message-actions').append(button('Trash', () => move('Trash')));
  else $('#message-actions').append(button('Delete permanently', async () => { if (!confirm('Permanently delete this message and its attachments?')) return; await api('/messages/' + id, undefined, 'DELETE'); $('#message-dialog').close(); await load(); }));
   const exportLink = node('a', previewMailbox ? 'Export preview message' : message.format === 'json' ? 'Export sent message' : 'Download original'); exportLink.href = previewMailbox ? previewMailbox.download(id) : '/api/messages/' + id + '/raw'; exportLink.download = previewMailbox ? 'preview-message.json' : ''; $('#message-actions').append(exportLink);
  if (!replace) openDialog('#message-dialog');
  await api('/messages/' + id, { unread: false }, 'PATCH'); await load();
}
function compose(item, initial = {}) {
  draft = item ? structuredClone(item) : { id: crypto.randomUUID(), version: 0, status: 'draft', body: { from: address || snapshot?.addresses[0] || snapshot?.sender || '', to: '', subject: '', text: '', ...initial } };
  const form = $('#compose-form'); form.reset(); error('', '#draft-error');
  const editable = draft.status === 'draft';
  for (const key of ['from', 'to', 'subject', 'text']) { form.elements[key].value = draft.body[key] || ''; form.elements[key].disabled = !editable; }
  form.elements.files.disabled = !editable;
  $('#sender-choices').replaceChildren(); for (const value of snapshot?.addresses || []) { const el = button(value, () => form.elements.from.value = value); el.disabled = !editable; $('#sender-choices').append(el); }
  $('#draft-attachments').textContent = (draft.body.attachments || []).map(a => a.filename).join(', ');
  $('#save-draft').disabled = !editable;
  $('#delete-draft').disabled = !draft.version || ['unknown', 'pending'].includes(draft.status);
  form.querySelector('[type=submit]').textContent = editable ? previewMailbox ? 'Simulate send' : 'Send' : draft.status === 'simulated' ? 'Simulated' : 'Check delivery';
  form.querySelector('[type=submit]').disabled = ['accepted', 'rejected', 'simulated'].includes(draft.status);
  $('#draft-status').textContent = draft.status === 'simulated' ? 'Simulated send. No email was delivered.' : draft.status === 'draft' ? 'Save your draft before closing to keep it.' : draft.status === 'accepted' ? 'Accepted by the email provider.' : draft.status === 'rejected' ? draft.result?.message || 'This send was rejected. Create a new draft after correcting the issue.' : 'Delivery is unconfirmed. Check this same send; do not create a duplicate.';
   if (!$('#compose-dialog').open) openDialog('#compose-dialog');
}
async function saveDraft() {
  const form = $('#compose-form');
  for (const key of ['from', 'to', 'subject', 'text']) draft.body[key] = form.elements[key].value;
  const files = [...form.elements.files.files];
  if (files.length) {
    if (files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 512 * 1024) throw new Error('Attach up to 10 files totaling 512 KiB.');
    draft.body.attachments = await Promise.all(files.map(async f => { const value = new Uint8Array(await f.arrayBuffer()); let binary = ''; for (let i = 0; i < value.length; i += 8192) binary += String.fromCharCode(...value.subarray(i, i + 8192)); return { filename: f.name, type: f.type || 'application/octet-stream', content: btoa(binary) }; }));
  }
  const result = await api('/drafts/' + draft.id, { message: draft.body, version: draft.version }, 'PUT'); draft.version = result.version;
  $('#draft-status').textContent = 'Draft saved.'; $('#delete-draft').disabled = false; await load();
}
$('#compose-form').onsubmit = event => { event.preventDefault(); const form = event.currentTarget; void run(async () => { form.querySelector('[type=submit]').disabled = true; try { if (draft.status === 'draft') await saveDraft(); draft.status = 'pending'; compose(draft); const result = await api('/drafts/' + draft.id + '/send', {}); draft.status = result.status; draft.result = result; if (['accepted', 'simulated'].includes(result.status)) { $('#compose-dialog').close(); notify(result.status === 'simulated' ? 'Simulated send. No email was delivered.' : 'Email accepted by the provider.'); } await load(); } finally { if ($('#compose-dialog').open) compose(draft); } }, '#draft-error'); };
$('#save-draft').onclick = () => run(saveDraft, '#draft-error');
$('#delete-draft').onclick = () => run(async () => { if (!confirm('Delete this draft?')) return; await api('/drafts/' + draft.id, undefined, 'DELETE'); $('#compose-dialog').close(); await load(); }, '#draft-error');
$('#compose').onclick = () => compose();
$('#sync').onclick = () => run(async () => { $('#sync').disabled = true; try { await api('/sync', {}); await load(); } finally { $('#sync').disabled = false; } });
document.querySelectorAll('[data-folder]').forEach(el => el.onclick = () => run(async () => { folder = el.dataset.folder; offset = 0; await load(); }));
$('#previous').onclick = () => run(async () => { offset = Math.max(0, offset - 50); await load(); }); $('#next').onclick = () => run(async () => { offset += 50; await load(); });
$('#unread').onchange = () => run(async () => { offset = 0; await load(); });
$('input[type=search]').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => run(async () => { offset = 0; await load(); }), 200); };
void run(async () => {
  const identity = await api('/me'); $('#identity').textContent = identity.email;
  if (identity.preview) {
    const { createPreviewMailbox } = await import('./preview.js');
    previewMailbox = createPreviewMailbox(localStorage);
    $('#preview-bar').hidden = false; $('#sync').textContent = 'Refresh';
    $('#reset-preview').onclick = () => run(async () => { if (!confirm('Reset sample mail and remove your preview changes?')) return; previewMailbox.reset(); folder = 'Inbox'; address = ''; offset = 0; $('input[type=search]').value = ''; $('#unread').checked = false; await load(); notify('Preview reset.'); });
  }
  await load();
});
setInterval(() => { if (!document.hidden && !dialogs.some(s => $(s).open)) void run(load); }, 30000);
