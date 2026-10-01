const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'public');
const re = /site\.css\?v=(?:light1|light2|fields1)/g;
const next = 'site.css?v=fields2';
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.html')) continue;
  const p = path.join(dir, name);
  const s = fs.readFileSync(p, 'utf8');
  if (!/site\.css\?v=(?:light1|light2|fields1)/.test(s)) continue;
  fs.writeFileSync(p, s.replace(re, next), 'utf8');
}
