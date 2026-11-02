import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8'), markup=fs.readFileSync('src/preserved.html','utf8'), css=fs.readFileSync('src/styles.css','utf8'), js=fs.readFileSync('src/legacy-app.js','utf8'), main=fs.readFileSync('src/main.jsx','utf8');
test('HTML links modular React entry and CSS',()=>{assert.match(html,/href="\/src\/styles\.css"/);assert.match(html,/src="\/src\/main\.jsx"/);});
test('React bootstrap mounts preserved application',()=>{assert.match(main,/createRoot/);assert.match(main,/preserved\.html\?raw/);assert.match(main,/legacy-app\.js/);});
test('original design and app markers remain',()=>{for(const x of ['AI Onboarding Agent','Offer desk in the Client Hub','Candidate journey','Joining forms','Day-1 readiness','Client setup','HR view']) assert.ok((html+markup+css+js).includes(x));});
test('CSS and logic are separate from HTML',()=>{assert.ok(js.length>1000);assert.ok(css.length>1000);assert.ok(!/<style[^>]*>/i.test(html));});
test('env safety rules exist',()=>{const g=fs.readFileSync('.gitignore','utf8');assert.ok(g.includes('.env'));assert.ok(fs.existsSync('.env.example'));});
