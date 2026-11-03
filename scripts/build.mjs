import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js']) await copyFile(file, `dist/${file}`);
console.log('Built static template in dist/');
