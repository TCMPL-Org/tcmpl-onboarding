import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const main = fs.readFileSync('src/main.jsx', 'utf8'), sw = fs.readFileSync('src/module-switch.js', 'utf8'), css = fs.readFileSync('src/exit/exit.css', 'utf8'), app = fs.readFileSync('src/exit/exit-app.js', 'utf8');
test('module switch loads after the onboarding modules', () => { assert.ok(main.indexOf('module-switch.js') > main.indexOf('checkins-live.js')); });
test('Exit screens are loaded only on demand', () => { assert.match(sw, /import\('\.\/exit\/exit-app\.js'\)/); assert.ok(!/exit-app/.test(main)); });
test('Exit CSS only uses ex- classes', () => { const sels = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(b => b.split('{')[0]).join(',').match(/\.[a-zA-Z][\w-]*/g) || []; assert.ok(sels.every(s => /^\.(ex-|chip$|note$|w\d+$)/.test(s)), sels.filter(s => !/^\.(ex-|chip$|note$|w\d+$)/.test(s)).join(' ')); });
test('Exit screens talk only to /api/exit', () => { assert.ok(!/\/api\/(data|wa|notify|forms|induction|checkins)\//.test(app)); });
