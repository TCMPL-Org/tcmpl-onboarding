'use strict';
const test = require('node:test');
const assert = require('node:assert');
const agent = require('../src/lib/agent');

test('password questions get the date-of-birth rule, never the joining date', async () => {
  const c = { name: 'Asha Test', letterProtected: true, doj: '2026-12-01', facts: 'offer: joining 1 Dec 2026' };
  for (const q of ['What is the password of the PDF?', 'letter khul nahi raha', 'पासवर्ड क्या है?']) {
    const r = await agent.reply(c, [], q);
    assert.match(r.reply, /DDMMYYYY|जन्मतिथि/);
    assert.doesNotMatch(r.reply, /joining/i);
    assert.strictEqual(r.handover, false);
  }
});

test('still cannot open goes to HR', async () => {
  const r = await agent.reply({ letterProtected: true }, [], 'Password is not working, I tried it');
  assert.strictEqual(r.handover, true);
  assert.match(r.handoverReason, /date-of-birth/);
});

test('unlocked letter: says no password and hands over', async () => {
  const r = await agent.reply({ letterProtected: false }, [], 'what is the password');
  assert.match(r.reply, /isn't password-protected/);
  assert.strictEqual(r.handover, true);
});

test('ordinary questions are not treated as password questions', () => {
  for (const q of ['Is the office open on Saturday?', 'What is my joining date?', 'Can I open a bank account later?']) assert.strictEqual(agent.isPasswordQuestion(q), false);
});
