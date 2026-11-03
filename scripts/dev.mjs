import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/styles.css', ['styles.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']]]);
const port = Number(process.env.PORT || 3000);
createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  try { const body = await readFile(file[0]); res.writeHead(200, { 'content-type': file[1] + '; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(500); res.end('Unable to read template file'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://localhost:${port}`));
