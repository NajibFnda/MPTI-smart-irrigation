const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const FILES = ['index.html', 'login.html', 'styles.css', 'app.js', 'login.js'];

fs.mkdirSync(PUBLIC_DIR, { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(PUBLIC_DIR, file));
}

fs.writeFileSync(path.join(PUBLIC_DIR, '_redirects'), '/  /login.html  200!\n', 'utf8');
console.log('Static publish directory ready:', PUBLIC_DIR);
