import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('app loads the Azure bridge before the app logic',()=>{const m=fs.readFileSync('src/main.jsx','utf8');assert.match(m,/azure-bridge\.js/);});
test('backend functions exist',()=>{for(const f of ['health','data','ai']) assert.ok(fs.existsSync(`api/src/functions/${f}.js`));});
test('Static Web Apps config requires sign-in and sets the API runtime',()=>{const c=JSON.parse(fs.readFileSync('public/staticwebapp.config.json','utf8'));assert.ok(c.routes.some(r=>r.route==='/*'&&r.allowedRoles.includes('authenticated')));assert.equal(c.platform.apiRuntime,'node:20');});
