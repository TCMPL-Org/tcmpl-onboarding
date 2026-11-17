'use strict';
// The onboarding agent's reply logic, independent of channel (WhatsApp now; email/voice later).
//
// Knowledge for each reply:
//   FACTS        the client's facts from Client setup + this candidate's offer line (role, joining date, CTC, manager)
//   FAQ          approved answers (joining forms and general questions)
//   OFFER LETTER the full text of THIS candidate's own offer letter (every clause, the salary tables, the annexures),
//                read only when the question is about their offer. It is never another candidate's letter.
// Guardrails: answer only from these; never negotiate, change or promise anything; anything else goes to HR.
// Every amount in a letter answer is checked against the letter before it is sent.

const { aiConfigured, completeJson } = require('./ai');

// Questions about the candidate's own offer terms (English, Hindi, Hinglish).
const OFFER_Q = /\b(salary|salaries|ctc|cost to company|basic|hra|house rent|allowance|gross|net|take[\s-]?home|in[\s-]?hand|inhand|deduct\w*|pf|provident|epf|esi|esic|gratuity|bonus|incentive|variable|retiral|contribution|component|breakup|break[\s-]?up|structure|package|pay|paid|payslip|tds|tax|annexure|clause|offer letter|appointment letter|letter|terms?|conditions?|notice|probation|confirm\w*|transfer\w*|posting|relocat\w*|termination|terminate|resign\w*|non[\s-]?compete|non[\s-]?solicit\w*|confidential\w*|disclosure|invention|conflict of interest|consent|retire\w*|leave|leaves|holiday\w*|working hours|medical|background verification|bgv|verification|checklist|joining bonus|designation|grade|reporting|report to|jurisdiction|court|validity|valid till|accept\w*|tankhwa\w*|tankhah|tankha|vetan|paisa|paise|kitna|kitni|kitne|katega|kategi|kat(ega|ta|ti)?|milega|milegi|chhutti|chutti|shart\w*|niyam)\b|₹|rs\.?\s?\d|\d{2},\d{3}/i;

function isOfferQuestion(text) { return OFFER_Q.test(String(text || '')); }

// Questions about opening the offer letter PDF (its password). Answered by a fixed message, never by the AI:
// the password is the candidate's date of birth as DDMMYYYY. The rule is told; the password itself is never written.
const PASSWORD_WORD = /pass\s?word|passcode|\bpwd\b|पासवर्ड/i;
const CANT_OPEN = /\b(can'?t|cannot|unable to|not able to|couldn'?t|could not|not|nahi|nhi)\s+(be\s+)?(open|opening|opened)\b|\bnot\s+opening|\blocked\b|khul\s*(nahi|nhi|na)|open\s*(nahi|nhi)|खुल\s*(नहीं|नही)/i;
const LETTER_WORD = /letter|pdf|file|offer|document|attachment|लेटर|पत्र/i;
const STILL_STUCK = /still|again|not working|doesn'?t work|didn'?t work|wrong|incorrect|invalid|galat|abhi bhi|phir se|नहीं हो रहा|गलत/i;

function isPasswordQuestion(text) { const t = String(text || ''); return PASSWORD_WORD.test(t) || (CANT_OPEN.test(t) && LETTER_WORD.test(t)); }

function passwordReply(c, text) {
  const t = String(text || ''), hi = /[ऀ-ॿ]/.test(t);
  if (!c.letterProtected) {
    return { reply: hi ? 'आपका ऑफ़र लेटर पासवर्ड से लॉक नहीं है, यह सीधे खुल जाना चाहिए। अगर नहीं खुल रहा, तो मैं HR टीम को बता रही हूँ, वे आपको सही कॉपी भेज देंगे।' : "Your offer letter isn't password-protected, so it should open directly. If it still doesn't open, I've let the HR team know and they'll send you a fresh copy.", handover: true, handoverReason: 'Candidate cannot open the offer letter (not password-protected)', callback: '', riskSignals: [] };
  }
  if (STILL_STUCK.test(t)) {
    return { reply: hi ? 'माफ़ कीजिए! मैं यह HR टीम को भेज रही हूँ, वे आपकी जन्मतिथि जाँचकर आपको जल्दी मदद करेंगे।' : "Sorry about that! I've passed this to the HR team. They'll check the date of birth on your offer and help you open it shortly.", handover: true, handoverReason: 'Candidate cannot open the offer letter with the date-of-birth password (check the DOB entered at release)', callback: '', riskSignals: [] };
  }
  return { reply: hi ? 'आपका ऑफ़र लेटर PDF आपकी जन्मतिथि से खुलेगा, DDMMYYYY फ़ॉर्मैट में: 8 अंक, बिना स्पेस या / के। उदाहरण: 5 मार्च 1998 = 05031998।' : 'Your offer letter PDF opens with your *date of birth* as DDMMYYYY: 8 digits, no spaces or slashes. For example, 5 March 1998 would be 05031998.', handover: false, handoverReason: '', callback: '', riskSignals: [] };
}

function today() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function buildPrompt(c, history, text, letter) {
  const agentName = c.agentName || 'Asha';
  const company = c.company || c.clientLabel || 'the company';
  const base = `You are "${agentName}", the WhatsApp onboarding assistant for ${company}, run by Talent Carriage for the HR team. You are talking to ${c.name || 'a candidate'}, a candidate who has an offer. Today is ${today()}.
Rules: answer ONLY from FACTS${letter ? ', FAQ and THE CANDIDATE\'S OFFER LETTER' : ' and FAQ'}. Plain WhatsApp style, warm, no headings. Reply in the language and script the candidate used (English, Hindi, Hinglish or Kannada).
Never negotiate or change salary, joining date, role, notice, buyout or any term, and never promise anything. For those, for complaints, harassment, health matters, or anything not covered: say you are passing it to the hiring team who will call within one working day, and set handover true.
The offer letter PDF${c.letterProtected ? ' is password-protected: the password is the candidate\'s date of birth as DDMMYYYY (8 digits). Never say it is the joining date, and never write the password itself' : ' is not password-protected'}.
If the candidate asks to talk to a person or be called back, set "callback" to a short topic in lower case, e.g. "your PF nomination question".`;
  const offerRules = letter ? `
THE CANDIDATE'S OFFER LETTER is the exact document sent to ${c.name || 'this candidate'} (their own letter only). For questions about their offer:
- Explain from the letter in simple words, up to 120 words. Quote the clause or annexure you used, e.g. "as per clause 6.1" or "Annexure 1 shows".
- Use amounts exactly as written in the letter (monthly and yearly). Do not calculate new amounts, estimate tax or give financial advice; if they need a figure the letter does not show, hand over.
- If the letter does not answer the question, say so and hand over. Never guess.
- Only discuss this candidate's own offer. Never discuss anyone else's salary or letter.
- Explaining is fine; changing, negotiating or promising anything is not (hand over).` : `
If the question is about the candidate's own offer letter (salary components, deductions, clauses, notice, probation, transfer, annexures, terms) and FACTS do not answer it, set "needLetter" true; the full letter will then be read.`;
  return `${base}${offerRules}
FACTS:
${(c.facts || '').slice(0, 12000)}
FAQ (approved answers; use them in your own simple words):
${(c.faq || '').slice(0, 8000)}
${letter ? `THE CANDIDATE'S OFFER LETTER (full text, numbered as in the document):\n${String(letter).slice(0, 40000)}\n` : ''}RECENT CHAT:
${history.slice(-8).map(m => (m.direction === 'in' ? 'Candidate: ' : 'Agent: ') + String(m.text || '').slice(0, 300)).join('\n')}
CANDIDATE'S NEW MESSAGE: "${String(text).slice(0, 1000)}"
Reply with only JSON: {"reply":"...","handover":true|false,"handoverReason":"...","callback":"",${letter ? '' : '"needLetter":false,'}"riskSignals":["e.g. counter-offer mentioned"]}`;
}

function scripted(q) {
  const s = String(q || '').toLowerCase();
  if (/counter|another offer|other offer|retain/.test(s)) return { reply: "Thanks for telling me. I'm passing this to the hiring team, who will call you within one working day.", handover: true, handoverReason: 'Candidate mentioned a counter or competing offer.', riskSignals: ['Counter or competing offer mentioned'] };
  if (/salary|ctc|hike|increase|negotiat|package|buyout|joining date|postpone|prepone|extend/.test(s)) return { reply: "That's for the hiring team to decide, so I've passed your question to them. They'll call you within one working day.", handover: true, handoverReason: 'Offer terms question: ' + String(q).slice(0, 80), riskSignals: /buyout|postpone|extend/.test(s) ? ['Asked to change notice or joining date'] : [] };
  if (/harass|complain|posh|unsafe|abuse/.test(s)) return { reply: "I'm sorry to hear this. I'm passing it straight to a senior HR person, who will contact you confidentially today.", handover: true, handoverReason: 'Sensitive matter, routed to senior HR.', riskSignals: [] };
  if (/^(hi|hello|hey|namaste|hii+)\b/.test(s)) return { reply: "Hello! I'm your onboarding assistant. Ask me anything about your joining, documents or Day 1.", handover: false, riskSignals: [] };
  return { reply: "Thanks! I've noted your question and passed it to the hiring team, who will get back to you shortly.", handover: true, handoverReason: 'Question outside scripted answers: ' + String(q).slice(0, 80), riskSignals: [] };
}

function clean(res) {
  if (!res || typeof res.reply !== 'string') return null;
  if (!res.reply.trim() && res.needLetter !== true) return null; // "read the letter" may come with no reply yet
  return {
    reply: res.reply.trim().slice(0, 1200),
    handover: Boolean(res.handover),
    handoverReason: typeof res.handoverReason === 'string' ? res.handoverReason.slice(0, 300) : '',
    callback: typeof res.callback === 'string' ? res.callback.slice(0, 120) : '',
    needLetter: res.needLetter === true,
    riskSignals: Array.isArray(res.riskSignals) ? res.riskSignals.filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, 120)).slice(0, 5) : []
  };
}

// Every amount of 3 or more digits in a reply must be written somewhere in what the agent was given
// (the letter, the facts, the FAQ or the candidate's own message). Returns the first amount that is not.
const numKey = s => String(s).replace(/[,\s]/g, '').replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/\d[\d,]*(?:\.\d+)?/g)) { const k = numKey(m[0]); if (k.replace(/\D/g, '').length >= 3) out.add(k); }
  return out;
}
function unknownAmount(reply, sources) {
  const known = new Set();
  for (const s of sources) for (const k of numbersIn(s)) known.add(k);
  for (const k of numbersIn(reply)) if (!known.has(k)) return k;
  return '';
}
const CHECK_REPLY = "Let me confirm the exact figure with the hiring team so you get it right. They'll get back to you within one working day.";

// opts.letter: the full text of this candidate's own offer letter ('' when there is none)
async function reply(candidate, history, text, opts = {}) {
  const c = candidate || {}, h = history || [];
  const letter = String(opts.letter || '');
  if (isPasswordQuestion(text)) return Object.assign({ source: 'scripted' }, passwordReply(c, text));
  if (aiConfigured()) {
    try {
      let out = null, usedLetter = false;
      if (letter && isOfferQuestion(text)) { out = clean(await completeJson(buildPrompt(c, h, text, letter))); usedLetter = true; }
      else {
        out = clean(await completeJson(buildPrompt(c, h, text, '')));
        // The AI says the answer is in the offer letter: read it and answer again.
        if (out && out.needLetter && letter) { const again = clean(await completeJson(buildPrompt(c, h, text, letter))); if (again) { out = again; usedLetter = true; } }
      }
      if (out && !out.reply) out = null; // asked for the letter but there is none: scripted answer (HR)
      if (out) {
        const bad = unknownAmount(out.reply, [usedLetter ? letter : '', c.facts, c.faq, text]);
        if (bad) return { source: usedLetter ? 'ai-letter' : 'ai', reply: CHECK_REPLY, handover: true, handoverReason: `Answer held back: the amount ${bad} is not in the ${usedLetter ? 'offer letter' : 'facts'}. Question: ${String(text).slice(0, 120)}`, callback: '', riskSignals: out.riskSignals, checked: bad };
        delete out.needLetter;
        return Object.assign({ source: usedLetter ? 'ai-letter' : 'ai' }, out);
      }
    } catch { /* fall back to scripted */ }
  }
  const s = clean(scripted(text)); delete s.needLetter;
  return Object.assign({ source: 'scripted' }, s);
}

function riskWeight(signal) {
  return /counter|competing|another offer/i.test(signal) ? 40 : 15;
}

module.exports = { reply, isPasswordQuestion, passwordReply, buildPrompt, scripted, riskWeight, isOfferQuestion, unknownAmount };
