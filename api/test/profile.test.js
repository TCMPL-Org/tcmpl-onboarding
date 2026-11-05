'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../src/lib/profile');

const say = (cand, text) => profile.onInbound(cand, { type: 'text', text });

test('family and nominee parsing', () => {
  const f = profile.parseFamily('Priya Pawar, Spouse, 12/01/1996\nSunita Pawar - Mother - 05/05/1969\nAarav Pawar, Son, 01/02/2020');
  assert.equal(f.family.length, 3);
  assert.deepEqual(f.family[1], { name: 'Sunita Pawar', relation: 'Mother', dob: '1969-05-05', livesWith: true });
  assert.equal(profile.parseFamily('just my mom').family.length, 0);
  assert.equal(profile.parseNominees('Priya Pawar', f.family).nominees[0].share, 100);
  const two = profile.parseNominees('Priya Pawar 60%, Sunita Pawar 40%', f.family).nominees;
  assert.deepEqual(two.map(n => [n.relation, n.share]), [['Spouse', 60], ['Mother', 40]]);
  assert.match(profile.parseNominees('Priya Pawar 60%, Sunita Pawar 30%', f.family).error, /90%/);
  assert.match(profile.parseNominees('Ravi Kumar', f.family).error, /couldn't find/);
});

test('full WhatsApp question flow for a married candidate with previous PF (ESIC applies)', () => {
  const cand = { phone: '917000000001', profile: { esic: true } };
  const q = profile.start(cand);
  assert.deepEqual(q.buttons, ['Single', 'Married', 'Other']);
  let r = say(cand, 'Married');
  assert.match(r.replies[0].text, /spouse/);
  r = say(cand, 'priya pawar');
  assert.match(r.replies[0].text, /present address/);
  r = say(cand, 'Pune');
  assert.match(r.replies[0].text, /PIN code/, 'short address refused');
  say(cand, 'Flat 4, Shanti Apts, Baner Road, Pune, Maharashtra 411045');
  r = say(cand, 'Different');
  assert.match(r.replies[0].text, /permanent address/);
  r = say(cand, 'House 12, Gangapur Road, Nashik, Maharashtra 422013');
  assert.match(r.replies[0].text, /family members/);
  assert.match(r.replies[0].text, /Priya Pawar, Spouse/);
  r = say(cand, 'Priya Pawar, Spouse, 12/01/1996\nAarav Pawar, Son, 01/02/2020\nSunita Pawar, Mother, 05/05/1969');
  assert.deepEqual(r.replies[0].buttons, ['Yes, all', 'No']);
  r = say(cand, 'No');
  assert.match(r.replies[0].text, /Where do they live/);
  r = say(cand, 'Nashik, Maharashtra');
  assert.deepEqual(r.replies[0].buttons, ['Priya Pawar', 'Aarav Pawar', 'Sunita Pawar']);
  r = say(cand, 'What is a nominee?');
  assert.equal(r.handled, false, 'questions go to the agent');
  r = say(cand, 'Aarav Pawar');
  assert.match(r.replies[0].text, /under 18/, 'minor nominee needs a guardian');
  r = say(cand, 'Priya Pawar');
  assert.deepEqual(r.replies[0].buttons, ['Yes', 'No']);
  say(cand, 'Yes');
  r = say(cand, '1009 8765 4321');
  assert.match(r.replies[0].text, /member ID/);
  say(cand, 'skip');
  r = say(cand, '31/10/2026');
  assert.deepEqual(r.replies[0].buttons, ['Yes', 'No', 'Not sure']);
  r = say(cand, 'Yes');
  assert.deepEqual(r.replies[0].buttons, ['No', 'Yes']);
  say(cand, 'No');
  r = say(cand, 'Other');
  assert.match(r.replies[0].text, /type your religion/);
  r = say(cand, 'jain');
  assert.equal(r.replies[0].text, profile.DONE_TEXT);
  const d = cand.details;
  assert.equal(d.step, null);
  assert.ok(d.completedAt);
  assert.deepEqual([d.marital, d.spouse, d.permSame, d.uan, d.exitDate, d.prevEps, d.intl, d.religion, d.guardian], ['Married', 'Priya Pawar', false, '100987654321', '2026-10-31', 'Yes', 'No', 'Jain', 'Priya Pawar']);
  assert.equal(d.family.every(f => f.livesWith === false), true);
  assert.equal(d.nominees[0].share, 100);
  assert.equal(say(cand, 'hello').handled, false, 'after the questions, chat goes back to the agent');
});

test('single candidate above the ESIC limit, no previous PF: skips spouse, ESIC and PF questions', () => {
  const cand = { profile: { esic: false } };
  profile.start(cand);
  say(cand, 'Single');
  assert.equal(cand.details.step, 'presAddr');
  say(cand, 'Room 3, Sai Niwas, Andheri East, Mumbai 400069');
  say(cand, 'Same address');
  const r = say(cand, 'Sunita Pawar, Mother, 05/05/1969');
  assert.equal(cand.details.step, 'nominees', 'no "lives with you" question when ESIC does not apply');
  assert.doesNotMatch(cand.details.family.length ? r.replies[0].text : '', /ESIC/);
  say(cand, 'Sunita Pawar');
  assert.equal(cand.details.step, 'prevEpf');
  say(cand, 'No');
  assert.equal(cand.details.step, 'intl');
  assert.equal(cand.details.prevEps, 'No');
});

test('candidate confirms or corrects the forms', () => {
  const cand = { forms: { pendingConfirm: true } };
  let r = say(cand, 'Something is wrong');
  assert.match(r.replies[0].text, /what needs to change/);
  say(cand, 'Nominee should be Mother 100%');
  assert.equal(cand.forms.candidateNote, 'Nominee should be Mother 100%');
  assert.equal(cand.handovers.length, 1);
  cand.forms.pendingConfirm = true;
  say(cand, 'All correct');
  assert.ok(cand.forms.candidateConfirmedAt);
  assert.equal(cand.stage, 'Forms confirmed');
});

test('only missing details are asked: Aadhaar address confirmed, Indian IDs mean not an international worker', () => {
  const cand = { profile: { esic: false }, kyc: { aadhaarLast4: '1234', pan: 'ABCPP1234Q', address: 'Flat 4, Baner Road, Pune 411045' }, details: { marital: 'Unmarried', religion: 'Hindu' } };
  const q = profile.start(cand);
  assert.equal(cand.details.step, 'presConfirm', 'marital status already known, so not asked');
  assert.match(q.text, /still needed/);
  assert.match(q.text, /Baner Road/);
  say(cand, 'Yes');
  assert.equal(cand.details.presAddr, 'Flat 4, Baner Road, Pune 411045');
  say(cand, 'Same address');
  say(cand, 'Sunita Pawar, Mother, 05/05/1969');
  say(cand, 'Sunita Pawar');
  const r = say(cand, 'No');
  assert.equal(r.replies[0].text, profile.DONE_TEXT, 'no international-worker or religion question');
  assert.equal(cand.details.intl, 'No');
});

test('nothing missing: no questions, and asking again with full repeats everything', () => {
  const cand = { kyc: { aadhaarLast4: '1', pan: 'ABCPP1234Q' }, details: { marital: 'Unmarried', presAddr: 'x', permSame: true, family: [{ name: 'Sunita Pawar', relation: 'Mother', dob: '1969-05-05' }], nominees: [{ name: 'Sunita Pawar', share: 100 }], prevEpf: 'No', prevEps: 'No', religion: 'Hindu' } };
  assert.equal(profile.start(cand), null);
  assert.ok(cand.details.completedAt);
  assert.match(say(cand, 'details').replies[0].text, /already have everything/);
  const q = profile.start(cand, { full: true });
  assert.deepEqual(q.buttons, ['Single', 'Married', 'Other']);
});
