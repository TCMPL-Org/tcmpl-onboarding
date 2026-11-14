'use strict';
// Approved WhatsApp templates for the candidate journey.
//
// WhatsApp delivers normal messages only within 24 hours of the candidate's last message. Outside that
// window Meta still answers "accepted" and then drops the message, so the app checks the window first.
// When it is closed, the app sends the step's approved template (it always arrives), keeps the real
// message, and sends it automatically the moment the candidate replies.
//
// Every step template has exactly two variables: {{1}} = candidate's first name, {{2}} = company.
// A step whose template is not approved (or not created yet) falls back to the general reminder
// WHATSAPP_NUDGE_TEMPLATE ({{1}} = first name, {{2}} = what it is about).
//
// Settings (optional):
//   WHATSAPP_STEP_TEMPLATES      overrides / additions, e.g. "resign=resignation_check,day1kit=joining_details"
//                                (a step set to "-" uses the general reminder)
//   WHATSAPP_STEP_TEMPLATE_LANG  language code of the step templates (default: en)

const wa = require('./whatsapp');

// Journey step (touchpoint key or check-in id) -> template name.
const DEFAULTS = {
  // resignation and notice
  resign: 'resignation_check',
  // documents and KYC
  docs: 'documents_request',
  // joining forms and details
  forms: 'forms_ready', confirm: 'forms_ready', details: 'forms_ready',
  // joining information: time, address, point of contact, map
  day1kit: 'joining_details', 'joining-info': 'joining_details', eve: 'joining_details', travel: 'joining_details',
  // Day 1
  welcome: 'day1_welcome', arrive: 'day1_welcome',
  // induction and orientation
  induct: 'induction_reminder', induction: 'induction_reminder', 'induction-due': 'induction_reminder',
  'induction-late': 'induction_reminder', 'orient-confirm': 'induction_reminder',
  // check-ins and pulses before and after joining
  checkin: 'onboarding_checkin', 'pulse-pre': 'onboarding_checkin', 'exit-agree': 'onboarding_checkin',
  relieving: 'onboarding_checkin', 'notice-pay': 'onboarding_checkin', 'day1-check': 'onboarding_checkin',
  survey_d1: 'onboarding_checkin', 'day1-survey': 'onboarding_checkin', week1: 'onboarding_checkin',
  pulse: 'onboarding_checkin', pulse15: 'onboarding_checkin', pulse30: 'onboarding_checkin', pulse45: 'onboarding_checkin',
  pulse60: 'onboarding_checkin', pulse75: 'onboarding_checkin', pulse90: 'onboarding_checkin',
  role: 'onboarding_checkin', intros: 'onboarding_checkin', buddy: 'onboarding_checkin', goals: 'onboarding_checkin',
  manager_intro: 'onboarding_checkin', story: 'onboarding_checkin', 'close-survey': 'onboarding_checkin',
  // closure
  'close-msg': 'onboarding_complete'
};

const WINDOW_MS = 24 * 3600 * 1000 - 10 * 60 * 1000; // 10-minute safety margin
function windowOpen(cand) {
  const t = Date.parse((cand && cand.lastInboundAt) || '');
  return Number.isFinite(t) && Date.now() - t < WINDOW_MS;
}

function overrides() {
  const out = {};
  for (const pair of String(process.env.WHATSAPP_STEP_TEMPLATES || '').split(',')) {
    const [k, v] = pair.split('=').map(s => (s || '').trim());
    if (k && v) out[k] = v;
  }
  return out;
}

// "resign:2026-11-20" or "cx:abc" style keys use their base part.
function templateFor(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  const o = overrides();
  const base = k.split(':')[0];
  const name = o[k] || o[base] || DEFAULTS[k] || DEFAULTS[base] || '';
  return name === '-' ? '' : name;
}

// Templates Meta refused (not created, not approved, wrong variables): skip them for an hour.
const refused = new Map();
const isRefused = n => { const t = refused.get(n); return t && Date.now() - t < 3600e3; };

function firstName(cand) {
  return (cand.profile && cand.profile.first) || cand.first || (cand.name || '').split(' ')[0] || 'there';
}

// Sends the reminder template for a step. Returns { template, id } or null when nothing could be sent.
async function remind(cand, key, about) {
  const first = firstName(cand);
  const company = cand.company || cand.clientLabel || 'your new company';
  const step = templateFor(key);
  if (step && !isRefused(step)) {
    try {
      const r = await wa.sendNamedTemplate(cand.phone, step, (process.env.WHATSAPP_STEP_TEMPLATE_LANG || 'en').trim(), [first, company]);
      return { template: step, id: r.id || '' };
    } catch (e) {
      refused.set(step, Date.now());
      console.error(`step template ${step} not sent, using the general reminder:`, e && e.message);
    }
  }
  const tpl = (process.env.WHATSAPP_NUDGE_TEMPLATE || '').trim();
  if (!tpl) return null;
  const r = await wa.sendNamedTemplate(cand.phone, tpl, (process.env.WHATSAPP_NUDGE_TEMPLATE_LANG || 'en').trim(), [first, about || 'your onboarding']);
  return { template: tpl, id: r.id || '' };
}

// One reminder per template per 12 hours, so the scheduler never repeats it every hour.
function shouldRemind(cand, key) {
  const name = templateFor(key) || 'general';
  const at = cand.nudges && cand.nudges[name];
  return !at || Date.now() - Date.parse(at) > 12 * 3600e3;
}
function markReminded(cand, key) {
  const name = templateFor(key) || 'general';
  cand.nudges = Object.assign({}, cand.nudges, { [name]: new Date().toISOString() });
  cand.nudgedAt = cand.nudges[name];
}

module.exports = { windowOpen, templateFor, remind, shouldRemind, markReminded, DEFAULTS, _refused: refused };
