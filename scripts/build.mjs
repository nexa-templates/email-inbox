import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'mail.css', 'app.js', 'preview.js']) await copyFile(file, `dist/${file}`);
console.log('Built inbox assets in dist/; deploy src/worker.js with its SQLite Durable Object.');
