const conversations = [
  ['EH','Emma Hansen','Autumn collection — final details','The samples look wonderful. Just a few small notes…','10:42','peach','Customers',true,true],
  ['MR','Martin Reed','Re: Website launch next week','Everything is on track for Thursday. I’ve shared…','10:18','sky','',true,true],
  ['SO','Studio Oak','Invoice #1048 · October services','Hi Kaisa, please find the invoice attached for…','09:56','mint','Invoices',true,false],
  ['AL','Anna Lind','A quick update from the team','Here’s where we landed after yesterday’s call.','09:30','lilac','',true,true],
  ['JL','Jonas Lepp','New partnership opportunity','We’ve been following your work and would love…','09:12','sand','Partners',true,false],
  ['LT','Liisa Tamm','Thank you for the lovely delivery!','Just wanted to say everything arrived safely…','08:45','rose','Customers',true,false],
  ['NP','Nord Print','Your order is ready for collection','Good news! Your business cards and packaging…','08:21','sky','',true,false],
  ['RK','Robert Kask','November planning','Sharing a few thoughts ahead of our catch-up.','08:04','mint','',true,true],
  ['HL','Hanna Laur','Re: Project proposal','Thanks for sending this over. The scope looks…','Yesterday','peach','Customers',false,false],
  ['MP','Metsa Paper','Invoice #2026-381','Your monthly invoice is ready. Thank you for…','Yesterday','sand','Invoices',false,false],
  ['TS','Team Studio','Friday inspiration','A few things we saved this week. Hope you enjoy…','Yesterday','lilac','',false,false],
  ['PK','Paul Kuusk','Re: Let’s catch up','Sounds good, see you on Wednesday at 11!','Yesterday','sky','',false,false],
];
let filter = 'all', folder = 'Inbox'; const starred = new Set([0,4]);
const list = document.querySelector('#messages'), search = document.querySelector('input[type=search]');
function render() {
  list.replaceChildren();
  conversations.forEach((m, i) => {
    if (filter === 'unread' && !m[7] || filter === 'assigned' && !m[8] || folder === 'Starred' && !starred.has(i) || ['Customers','Invoices','Partners'].includes(folder) && m[6] !== folder || !m.join(' ').toLowerCase().includes(search.value.toLowerCase())) return;
    const row = document.createElement('article'); row.className = 'message' + (m[7] ? ' unread' : '');
    row.innerHTML = `<input type="checkbox" aria-label="Select conversation from ${m[1]}"><button class="star" aria-label="Star conversation from ${m[1]}" aria-pressed="${starred.has(i)}">${starred.has(i) ? '★' : '☆'}</button><span class="avatar ${m[5]}">${m[0]}</span><div class="message-copy"><div class="sender">${m[1]}</div><div class="subject">${m[6] ? `<span class="tag">${m[6]}</span>` : ''}<strong>${m[2]}</strong><span class="snippet"> — ${m[3]}</span></div></div><time>${m[4]}</time>`;
    row.querySelector('.star').onclick = () => { starred.has(i) ? starred.delete(i) : starred.add(i); render(); };
    list.append(row);
  });
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No conversations match your search.'; list.append(empty); }
}
search.addEventListener('input', render);
document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-selected', String(b === button)); }); render(); });
document.querySelectorAll('[data-folder]').forEach(button => button.onclick = () => { const next = button.dataset.folder; if (!['Inbox','Starred','Customers','Invoices','Partners'].includes(next)) return notify('This folder is part of the starter preview.'); folder = next; document.querySelectorAll('[data-folder]').forEach(b => b.classList.toggle('selected', b === button)); document.querySelector('h1').textContent = folder; render(); });
document.querySelector('[aria-label="Select all conversations"]').onchange = event => list.querySelectorAll('input[type=checkbox]').forEach(box => box.checked = event.target.checked);
let timer; function notify(message) { const toast = document.querySelector('.toast'); toast.textContent = message; toast.hidden = false; clearTimeout(timer); timer = setTimeout(() => toast.hidden = true, 3500); }
document.querySelectorAll('[data-demo]').forEach(button => button.onclick = () => notify('This is a template preview. Connect your email provider to make it yours.'));
render();
