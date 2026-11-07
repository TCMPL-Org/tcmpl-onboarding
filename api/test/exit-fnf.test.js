'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DEV_MEMORY_STORE = '1';
delete process.env.COSMOS_CONNECTION_STRING;
delete process.env.WHATSAPP_NUDGE_TEMPLATE;
process.env.WHATSAPP_TOKEN = 't'; process.env.WHATSAPP_PHONE_NUMBER_ID = '1';
process.env.ACS_CONNECTION_STRING = 'endpoint=https://x.communication.azure.com/;accesskey=abc';
process.env.ACS_SENDER = 'DoNotReply@test.azurecomm.net';
process.env.LINK_SECRET = 'link-secret-for-tests';

const email = require('../src/lib/email');
const wa = require('../src/lib/whatsapp');
const handlers = require('../src/lib/handlers');
const modules = require('../src/lib/modules');
const exit = require('../src/lib/exit');
const F = require('../src/lib/exit/fnf');
const D = require('../src/lib/exit/defaults');
const C = require('../src/lib/exit/cases');
const pdf = require('../src/lib/exit/pdf');
const { getStore } = require('../src/lib/store');

const user = { name: 'hr@x' };
const mails = [], docs = [];
email._setClient({ beginSend: async m => { mails.push(m); return { pollUntilDone: async () => ({ id: 'e' + mails.length, status: 'Succeeded' }) }; } });
wa.sendText = async () => ({ id: 'w' });
wa.uploadMedia = async (buf, mime, name) => { docs.push([name, buf]); return 'media-' + docs.length; };
wa.sendDocument = async () => ({ id: 'wd' });

const act = (action, body) => exit.action({ action, body, user });
const setup = D.tcmplDefault();
const base = { employee: { code: 'NP2001', name: 'Kavya Rao', mobile: '9812300000', email: 'kavya@mail.com', designation: 'Analyst', level: 'L3', dept: 'Operations', doj: '2022-01-10', manager: 'Anil Kumar', managerEmail: 'anil@np.com' }, typeId: 'resign', raisedBy: 'Employee', formal: '2026-11-02' };
const ID = 'exit-northpeak-NP2001-20261102';
const tokenOf = (m, label) => { const b = /href="([^"]+)"[^>]*>([^<]+)</g; let x; while ((x = b.exec(m.content.html))) if (x[2].replace(/&amp;/g, '&') === label) return new URL(x[1].replace(/&amp;/g, '&')).searchParams.get('t'); return null; };

test('F&F figures: salary, leave, PF, gratuity at 4 years 240 days, deadlines skip Sunday', () => {
  const { k } = C.build(setup, base, { client: 'northpeak' });
  assert.equal(k.lwd, '2027-01-01');
  k.fnf = { inputs: { gross: 60000, basic: 30000, leaveDays: 10 } };
  const r = F.compute(setup, k);
  assert.deepEqual(r.earn, [['Salary for 1 of 31 days', 1935], ['Leave encashment (10 days)', 11538]]);
  assert.deepEqual(r.ded, [['Provident Fund (employee, 12% of basic)', 116]]);
  assert.equal(r.gratElig, true);
  assert.equal(r.yrs, 5);
  assert.equal(r.gratuity, 86538);
  assert.equal(r.wagesNet, 13358);
  assert.equal(r.net, 99896);
  assert.equal(r.shortfall, 0);
  assert.equal(r.wageDue, '2027-01-04');
  assert.equal(r.gratDue, '2027-01-31');
  assert.deepEqual(r.missing, []);
});

test('F&F: bonus and ESIC for lower pay, notice shortfall recovered unless the waiver is approved, no gratuity under the minimum', () => {
  const { k } = C.build(setup, Object.assign({}, base, { employee: Object.assign({}, base.employee, { doj: '2025-06-01' }), requestedLwd: '2026-12-02' }), { client: 'c' });
  k.fnf = { inputs: { gross: 20000, basic: 10000, pt: 200, loans: 5000 } };
  let r = F.compute(setup, k);
  assert.ok(r.earn.some(([l, v]) => /bonus/.test(l) && v === 5248)); // 8.33% of 7,000 for Apr-Dec (9 months)
  assert.ok(r.ded.some(([l]) => /ESIC/.test(l)));
  assert.ok(r.ded.some(([l, v]) => /Notice shortfall recovery \(30 days\)/.test(l) && v === 10000));
  assert.equal(r.gratuity, 0);
  k.approvals.find(a => a.action === 'Notice waiver').status = 'Approved';
  r = F.compute(setup, k);
  assert.equal(r.shortfall, 0);
  assert.deepEqual(F.compute(setup, Object.assign({}, k, { fnf: {} })).missing, ['monthly gross', 'monthly basic']);
});

test('PDFs are valid files with a correct cross-reference table', () => {
  const b = pdf.build('Test – letter ₹', [{ t: 'h', text: 'Heading' }, { t: 'p', text: 'x '.repeat(3000) }, { t: 'table', rows: [['A', 'B'], ['1', '2']] }], 'footer');
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /Test - letter Rs\./);
  const xref = +/startxref\n(\d+)/.exec(s)[1];
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  offs.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`)));
  assert.ok(/\/Count (\d+)/.exec(s)[1] > 1); // long text flows onto more pages
});

test('letters per separation type and per step', () => {
  const { k } = C.build(setup, base, { client: 'c' });
  assert.deepEqual(F.lettersOf(setup, k), ['Resignation acceptance', 'Relieving letter', 'Experience letter', 'F&F statement']);
  assert.deepEqual(F.lettersForStep(setup, k, 'accepted'), ['Resignation acceptance']);
  assert.deepEqual(F.lettersForStep(setup, k, 'lastday'), ['Relieving letter', 'Experience letter']);
  assert.deepEqual(F.lettersForStep(setup, k, 'fnf-paid'), ['F&F statement']);
  const t = F.letterPdf(setup, k, 'Experience letter').toString('latin1');
  assert.match(t, /worked with the company from 10 Jan 2022 to 1 Jan 2027|worked with .* from 10 Jan 2022 to 1 Jan 2027/);
});

test('case flow: acceptance letter attached, F&F to payroll with the statement, approval by link, letters wait for clearances', async () => {
  await modules.httpAction({ action: 'save', body: { client: 'northpeak', exit: true }, user });
  const s = (await act('setup', { client: 'northpeak' })).jsonBody.setup;
  Object.assign(s.contacts, { company: 'Northpeak Logistics', hr: 'hr@np.com', payroll: 'payroll@np.com' });
  s.owners = s.owners.slice(0, 1); s.owners[0].contact = 'it@np.com';
  await act('setup-save', { client: 'northpeak', setup: s });
  assert.equal((await act('raise', { client: 'northpeak', case: base })).status, 200);

  mails.length = 0; docs.length = 0;
  await act('send', { id: ID, key: 'accepted' });
  assert.equal(mails[0].attachments[0].name, 'Resignation_acceptance_Kavya_Rao.pdf');
  assert.equal(docs[0][0], 'Resignation_acceptance_Kavya_Rao.pdf');

  mails.length = 0;
  let r = await act('send', { id: ID, key: 'fnf-draft' });
  assert.equal(r.jsonBody.result.status, 'failed');
  assert.ok(r.jsonBody.case.alerts.some(a => /F&F cannot be worked out yet: add monthly gross, monthly basic/.test(a.why)));
  r = await act('fnf', { id: ID, inputs: { gross: '60,000', basic: 30000, leaveDays: 10 } });
  assert.equal(r.jsonBody.fnf.net, 99896);
  mails.length = 0;
  await act('send', { id: ID, key: 'fnf-draft' });
  const m = mails.find(x => /^F&F draft/.test(x.content.subject));
  assert.deepEqual(m.recipients.to, [{ address: 'payroll@np.com' }]);
  assert.match(m.content.plainText, /Net payable: Rs\. 99,896/);
  assert.match(m.attachments[0].name, /^F_F_statement_Kavya_Rao\.pdf$/);
  assert.match((await handlers.confirmLink({ token: tokenOf(m, 'Approve F&F') })).body, /F&amp;F is approved/);
  let c = (await act('case', { id: ID })).jsonBody;
  assert.equal(c.case.fnf.status, 'Approved');
  assert.equal(c.fnf.wageDue, '2027-01-04');

  mails.length = 0;
  r = await act('send', { id: ID, key: 'lastday' });
  assert.match(r.jsonBody.result.notes.join(' '), /letters wait until every clearance is confirmed/);
  assert.equal((mails[0].attachments || []).length, 0);
  await act('clearance', { id: ID, owner: s.owners[0].id, status: 'cleared' });
  mails.length = 0;
  r = await act('send', { id: ID, key: 'lastday' });
  assert.equal(r.jsonBody.result.status, 'sent');
  assert.deepEqual(mails[0].attachments.map(a => a.name), ['Relieving_letter_Kavya_Rao.pdf', 'Experience_letter_Kavya_Rao.pdf']);
  c = (await act('case', { id: ID })).jsonBody;
  assert.ok(c.case.letters['Relieving letter'].sentAt);
});

test('HR: download a letter, send letters again, payment deadlines turn red, close the case', async () => {
  const d = await act('letter', { id: ID, name: 'Experience letter' });
  assert.ok(Buffer.from(d.jsonBody.base64, 'base64').toString('latin1').startsWith('%PDF'));
  assert.equal((await act('letter', { id: ID, name: 'Secret file' })).status, 400);
  mails.length = 0;
  const r = await act('letters-send', { id: ID, names: ['F&F statement'] });
  assert.equal(r.jsonBody.result.ok, true);
  assert.equal(mails[0].attachments[0].name, 'F_F_statement_Kavya_Rao.pdf');
  await exit.tick(getStore(), Date.parse('2027-01-06T05:00:00Z'));
  let k = (await act('case', { id: ID })).jsonBody.case;
  assert.ok(k.alerts.some(a => a.open && /Wages part of the F&F was due by 4 Jan 2027/.test(a.why)));
  await act('fnf-status', { id: ID, status: 'Wages paid' });
  await act('fnf-status', { id: ID, status: 'Gratuity paid' });
  assert.equal((await act('fnf-status', { id: ID, status: 'Paid twice' })).status, 400);
  await act('fnf-status', { id: ID, status: 'Closed' });
  k = (await act('case', { id: ID })).jsonBody.case;
  assert.equal(k.status, 'closed');
  assert.equal((await act('cases', { client: 'northpeak' })).jsonBody.items[0].fnfStatus, 'Closed');
});
