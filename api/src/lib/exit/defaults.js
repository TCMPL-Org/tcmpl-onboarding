'use strict';
// TCMPL default exit rules. Every client starts from these and changes only what differs (Exit setup tab).
// Taken from the Exit Agent demo v1.1, plus the journey steps (who gets what, when, on which channel).

const STAGES = [
  ['raised', 'Raised'],
  ['accepted', 'Accepted / notice'],
  ['clearances', 'Clearances'],
  ['lastday', 'Last day'],
  ['fnf', 'F&F'],
  ['interview', 'Interview'],
  ['alumni', 'Alumni']
];

const CATEGORIES = ['Voluntary', 'Involuntary', 'Natural'];
const NOTICE = ['Serve notice', 'No notice', 'Pay in lieu of notice', 'As per termination letter', 'As per offer terms', 'Recovery as per policy', 'As per law'];
const ANNOUNCE = ['None', 'Team, on acceptance', 'Team, on last day', 'Department, on last day', 'Company, on last day', 'HR decides'];
const TELL_TA = ['Immediately', 'After manager confirms', 'Never'];
const REPLACE = ['Ask manager', 'Replace now', 'Do not replace', 'Restructure'];
const RAISERS = ['Employee', 'Manager', 'HR'];
const START = { first: 'First conversation with manager', formal: 'Formal resignation', accept: 'Acceptance' };
const CHANNELS = ['whatsapp', 'email', 'both'];
const RECIPIENTS = ['employee', 'manager', 'approvers', 'owners', 'hr', 'payroll', 'recruitment'];
const ANCHORS = { first: 'First told manager', formal: 'Formal date', lwd: 'Last working day' };
const WHEN = { all: 'All separation types', voluntary: 'Voluntary only', notice: 'Types that serve notice', notdeath: 'All except death in service', interview: 'Types with an exit interview', alumni: 'Types invited to alumni' };

const TYPES = [
  { id: 'resign', name: 'Resignation', cat: 'Voluntary', raise: 'Employee, Manager, HR', notice: 'Serve notice', letters: 'Resignation acceptance; Relieving letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'Team, on acceptance', ta: 'After manager confirms' },
  { id: 'vrs', name: 'Voluntary retirement', cat: 'Voluntary', raise: 'Employee, HR', notice: 'Serve notice', letters: 'Acceptance letter; Service certificate; F&F statement', interview: true, alumni: true, announce: 'Department, on last day', ta: 'After manager confirms' },
  { id: 'nonrenew', name: 'Contract not renewed by employee', cat: 'Voluntary', raise: 'Employee, HR', notice: 'Serve notice', letters: 'Relieving letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'Team, on last day', ta: 'Immediately' },
  { id: 'retire', name: 'Retirement (superannuation)', cat: 'Natural', raise: 'HR', notice: 'No notice', letters: 'Retirement letter; Service certificate; F&F statement', interview: true, alumni: true, announce: 'Company, on last day', ta: 'Immediately' },
  { id: 'death', name: 'Death in service', cat: 'Natural', raise: 'HR', notice: 'No notice', letters: 'F&F statement to nominee; Service certificate', interview: false, alumni: false, announce: 'HR decides', ta: 'After manager confirms' },
  { id: 'misconduct', name: 'Termination: misconduct', cat: 'Involuntary', raise: 'HR', notice: 'As per termination letter', letters: 'Termination letter; F&F statement', interview: false, alumni: false, announce: 'None', ta: 'After manager confirms' },
  { id: 'performance', name: 'Termination: performance', cat: 'Involuntary', raise: 'Manager, HR', notice: 'Pay in lieu of notice', letters: 'Separation letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'Team, on last day', ta: 'Immediately' },
  { id: 'bgv', name: 'Background verification failure', cat: 'Involuntary', raise: 'HR', notice: 'As per offer terms', letters: 'Separation letter; F&F statement', interview: false, alumni: false, announce: 'None', ta: 'Immediately' },
  { id: 'coi', name: 'Conflict of interest', cat: 'Involuntary', raise: 'HR', notice: 'As per termination letter', letters: 'Separation letter; F&F statement', interview: false, alumni: false, announce: 'None', ta: 'After manager confirms' },
  { id: 'medical', name: 'Medical incapacity', cat: 'Involuntary', raise: 'HR', notice: 'Pay in lieu of notice', letters: 'Separation letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'HR decides', ta: 'After manager confirms' },
  { id: 'abandon', name: 'Abandonment (absconding)', cat: 'Involuntary', raise: 'Manager, HR', notice: 'Recovery as per policy', letters: 'Return-to-work notice 1; Return-to-work notice 2; Separation letter; F&F statement', interview: false, alumni: false, announce: 'None', ta: 'Immediately' },
  { id: 'retrench', name: 'Retrenchment or layoff', cat: 'Involuntary', raise: 'HR', notice: 'As per law', letters: 'Retrenchment letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'HR decides', ta: 'Never' },
  { id: 'fte_end', name: 'End of fixed term (employer)', cat: 'Involuntary', raise: 'HR', notice: 'No notice', letters: 'Completion letter; Experience letter; F&F statement', interview: true, alumni: true, announce: 'Team, on last day', ta: 'Immediately' }
];

const NOTICE_RULES = [
  { id: 'n1', level: 'L1', dept: 'Any', prob: 15, conf: 30 },
  { id: 'n2', level: 'L2', dept: 'Any', prob: 15, conf: 30 },
  { id: 'n3', level: 'L3', dept: 'Any', prob: 30, conf: 60 },
  { id: 'n4', level: 'L4', dept: 'Any', prob: 30, conf: 90 },
  { id: 'n5', level: 'L5', dept: 'Any', prob: 60, conf: 90 }
];

const APPROVALS = [
  { id: 'a1', action: 'Accept resignation', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager', mode: 'Sequential', sla: 48, delegate: 'HR business partner' },
  { id: 'a2', action: 'Notice waiver', level: 'L1-L2', dept: 'Any', type: 'Any', over: 0, chain: 'Manager', mode: 'Sequential', sla: 24, delegate: 'HR business partner' },
  { id: 'a3', action: 'Notice waiver', level: 'L3-L5', dept: 'Any', type: 'Any', over: 0, chain: 'Manager > Department head', mode: 'Sequential', sla: 24, delegate: 'HR head' },
  { id: 'a4', action: 'Notice waiver', level: 'Any', dept: 'Sales', type: 'Any', over: 0, chain: 'Manager > Sales head > HR head', mode: 'Sequential', sla: 24, delegate: 'HR head' },
  { id: 'a5', action: 'Notice buyout', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager > HR head', mode: 'Sequential', sla: 24, delegate: 'HR head' },
  { id: 'a6', action: 'Early release', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager', mode: 'Sequential', sla: 24, delegate: 'Department head' },
  { id: 'a7', action: 'Last working day extension', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager', mode: 'Sequential', sla: 24, delegate: 'HR business partner' },
  { id: 'a8', action: 'Resignation withdrawal', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Manager > HR head', mode: 'Sequential', sla: 48, delegate: 'HR head' },
  { id: 'a9', action: 'Recovery waiver', level: 'Any', dept: 'Any', type: 'Any', over: 25000, chain: 'Finance head + HR head', mode: 'Parallel', sla: 48, delegate: 'CFO' },
  { id: 'a10', action: 'Recovery waiver', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'Finance head', mode: 'Sequential', sla: 48, delegate: 'CFO' },
  { id: 'a11', action: 'Rehire eligibility', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'HR head', mode: 'Sequential', sla: 72, delegate: 'HR business partner' },
  { id: 'a12', action: 'Involuntary separation', level: 'Any', dept: 'Any', type: 'Any', over: 0, chain: 'HR head > Business head', mode: 'Sequential', sla: 48, delegate: 'CHRO' }
];

const OWNERS = [
  { id: 'o1', area: 'IT', owner: 'IT SPOC', contact: '', channel: 'email', sla: 48, items: 'Laptop and charger, phone, email and system access' },
  { id: 'o2', area: 'Admin', owner: 'Admin SPOC', contact: '', channel: 'email', sla: 48, items: 'ID card, locker key, parking sticker, uniform' },
  { id: 'o3', area: 'Finance', owner: 'Finance SPOC', contact: '', channel: 'email', sla: 48, items: 'Loans, salary advance, expense advances, corporate card' },
  { id: 'o4', area: 'Security', owner: 'Security SPOC', contact: '', channel: 'email', sla: 24, items: 'Access card deactivation, gate pass' },
  { id: 'o5', area: 'Manager', owner: 'Reporting manager', contact: '', channel: 'email', sla: 48, items: 'Knowledge transfer and handover sign-off' },
  { id: 'o6', area: 'HR', owner: 'Client HR', contact: '', channel: 'email', sla: 48, items: 'Exit documents, PF and ESIC exit, final attendance' }
];

// People behind the approval roles, per client. "Manager" is always the employee's own manager.
// Write contacts like: Priya Malhotra <priya@client.com>
const PEOPLE = ['Department head', 'Sales head', 'HR head', 'HR business partner', 'Finance head', 'Business head', 'CFO', 'CHRO']
  .map((role, i) => ({ id: 'p' + (i + 1), role, contact: '' }));

// Journey steps. day is counted from the anchor (formal date, first told manager, or last working day).
// Placeholders: {first} {name} {code} {designation} {dept} {location} {company} {type} {formal} {lwd} {notice} {manager} {replace}
const STEPS = [
  { key: 'ack', stage: 'raised', title: 'Acknowledge the exit and confirm the last day', to: 'employee', channel: 'both', anchor: 'formal', day: 0, time: '11:00', when: 'notdeath', on: true,
    text: 'Hi {first}, this is the HR assistant of {company}. We have recorded your {type} dated {formal}. Your notice is {notice}, so your last working day is {lwd}. Reply here if anything is not right; this stays private until it is accepted.' },
  { key: 'approval', stage: 'raised', title: 'Ask the approvers to accept', to: 'approvers', channel: 'email', anchor: 'formal', day: 0, time: '11:00', when: 'all', on: true,
    text: 'Please review the {type} of {name} ({designation}, {dept}). Proposed last working day: {lwd}. Approve or reject with one click below.' },
  { key: 'accepted', stage: 'accepted', title: 'Acceptance and last working day', to: 'employee', channel: 'both', anchor: 'formal', day: 1, time: '11:00', when: 'voluntary', on: true,
    text: 'Hi {first}, your resignation has been accepted. Your last working day is {lwd}. Over the coming days I will help you with handover, asset returns and your full and final settlement.' },
  { key: 'announce', stage: 'accepted', title: 'Announcement to the team (as per the type rule)', to: 'manager', channel: 'email', anchor: 'formal', day: 1, time: '15:00', when: 'voluntary', on: true,
    text: '{name} will be leaving {company}; the last working day is {lwd}. Please share this with the team as per the announcement rule.' },
  { key: 'recruitment', stage: 'accepted', title: 'Tell recruitment about the vacancy', to: 'recruitment', channel: 'email', anchor: 'formal', day: 1, time: '15:00', when: 'all', on: true,
    text: 'A position is opening: {designation}, {dept}, {location}. {name} leaves on {lwd}. Replacement: {replace}.' },
  { key: 'clearance-start', stage: 'clearances', title: 'Start clearances with every owner', to: 'owners', channel: 'email', anchor: 'formal', day: 1, time: '12:00', when: 'notdeath', on: true,
    text: '{name} ({code}) leaves on {lwd}. Please check what is pending in your area and confirm clearance with one click below. You can clear provisionally now and confirm on the last day.' },
  { key: 'assets', stage: 'clearances', title: 'Employee declares assets with photos', to: 'employee', channel: 'whatsapp', anchor: 'formal', day: 2, time: '11:00', when: 'notdeath', on: true,
    text: 'Hi {first}, to make your last day easy, please send a photo of each company item you have (laptop, ID card, access card, phone). Reply "none" if you have nothing to return.' },
  { key: 'handover', stage: 'clearances', title: 'Handover reminder to the manager', to: 'manager', channel: 'email', anchor: 'lwd', day: -14, time: '10:30', when: 'notice', on: true,
    text: '{name} leaves on {lwd}, two weeks from now. Please agree the handover plan and confirm when knowledge transfer is complete.' },
  { key: 'clearance-remind', stage: 'clearances', title: 'Reminder to owners with open items', to: 'owners', channel: 'email', anchor: 'lwd', day: -3, time: '10:30', when: 'notdeath', on: true,
    text: '{name} leaves on {lwd}. Your clearance is still open. Please confirm with one click below or report what is pending.' },
  { key: 'fnf-draft', stage: 'fnf', title: 'F&F draft to payroll for approval', to: 'payroll', channel: 'email', anchor: 'lwd', day: -1, time: '11:00', when: 'all', on: true,
    text: 'Please review and approve the full and final settlement draft for {name} ({code}), last working day {lwd}.' },
  { key: 'lastday', stage: 'lastday', title: 'Last day: returns, access, letters, farewell', to: 'employee', channel: 'both', anchor: 'lwd', day: 0, time: '10:00', when: 'notdeath', on: true,
    text: 'Hi {first}, today is your last working day at {company}. Please hand over your items as declared. Your relieving and experience letters follow once clearances are confirmed. Thank you for everything you did here.' },
  { key: 'access', stage: 'lastday', title: 'Access closure at the end of the last day', to: 'owners', channel: 'email', anchor: 'lwd', day: 0, time: '17:00', when: 'all', on: true,
    text: 'Please deactivate system and building access for {name} ({code}) at the end of today, {lwd}, and confirm below.' },
  { key: 'fnf-paid', stage: 'fnf', title: 'Wages paid within the legal deadline', to: 'employee', channel: 'both', anchor: 'lwd', day: 2, time: '12:00', when: 'notdeath', on: true,
    text: 'Hi {first}, your final wages have been processed. Your full and final settlement statement is attached. Reply here with any question.' },
  { key: 'interview', stage: 'interview', title: 'Exit interview (in the employee\'s language)', to: 'employee', channel: 'whatsapp', anchor: 'lwd', day: 7, time: '11:00', when: 'interview', on: true,
    text: 'Hi {first}, would you share how your time at {company} was? Six short questions, about three minutes. Your answers are reported only in groups, never by name.' },
  { key: 'alumni', stage: 'alumni', title: 'Alumni invitation', to: 'employee', channel: 'whatsapp', anchor: 'lwd', day: 8, time: '11:00', when: 'alumni', on: true,
    text: 'Hi {first}, would you like to join the {company} alumni network? We share openings and news once a month. Reply YES to join; you can leave any time.' }
];

function tcmplDefault() {
  return JSON.parse(JSON.stringify({
    types: TYPES,
    noticeRules: NOTICE_RULES,
    probationMonths: 6,
    noticeStart: { company: 'formal', allowCase: true, seg: [{ id: 's1', level: 'Any', dept: 'Sales', start: 'first' }] },
    approvals: APPROVALS,
    owners: OWNERS,
    people: PEOPLE,
    contacts: { company: '', hr: '', payroll: '', recruitment: '', replyTo: '', cc: '' },
    fnf: { approver: 'Client HR', wageDays: 2, gratYears: 5, gratDays: 30 },
    interview: { threshold: 5 },
    alumni: { on: true, exclude: 'Misconduct exits' },
    steps: STEPS
  }));
}

module.exports = { tcmplDefault, STAGES, CATEGORIES, NOTICE, ANNOUNCE, TELL_TA, REPLACE, RAISERS, START, CHANNELS, RECIPIENTS, ANCHORS, WHEN };
