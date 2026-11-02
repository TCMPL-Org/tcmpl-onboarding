'use strict';
// The onboarding agent's reply logic, independent of channel (WhatsApp now;
// email/voice later). Uses the same rules as the in-app agent.

const { aiConfigured, completeJson } = require('./ai');

function buildPrompt(c, history, text) {
  const agentName = c.agentName || 'Asha';
  const company = c.company || c.clientLabel || 'the company';
  return `You are "${agentName}", the WhatsApp onboarding assistant for ${company}, run by Talent Carriage for the HR team. You are talking to ${c.name || 'a candidate'}, a candidate who has an offer.
Rules: answer ONLY from FACTS. Under 60 words, warm, plain WhatsApp style, no headings. Reply in the language and script the candidate used (English, Hindi, Hinglish or Kannada).
Never negotiate or change salary, joining date, role, notice buyout or any term, and never promise anything. For those, for complaints, harassment, health matters, or anything not in FACTS: say you are passing it to the hiring team who will call within one working day, and set handover true.
If the candidate asks to talk to a person or be called back, set "callback" to a short topic in lower case, e.g. "your PF nomination question".
FACTS:
${(c.facts || '').slice(0, 12000)}
JOINING-FORM HELP (approved answers; use them, in your own simple words):
${(c.faq || '').slice(0, 6000)}
RECENT CHAT:
${history.slice(-8).map(m => (m.direction === 'in' ? 'Candidate: ' : 'Agent: ') + String(m.text || '').slice(0, 300)).join('\n')}
CANDIDATE'S NEW MESSAGE: "${String(text).slice(0, 1000)}"
Reply with only JSON: {"reply":"...","handover":true|false,"handoverReason":"...","callback":"" ,"riskSignals":["e.g. counter-offer mentioned"]}`;
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
  if (!res || typeof res.reply !== 'string' || !res.reply.trim()) return null;
  return {
    reply: res.reply.trim().slice(0, 1000),
    handover: Boolean(res.handover),
    handoverReason: typeof res.handoverReason === 'string' ? res.handoverReason.slice(0, 300) : '',
    callback: typeof res.callback === 'string' ? res.callback.slice(0, 120) : '',
    riskSignals: Array.isArray(res.riskSignals) ? res.riskSignals.filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, 120)).slice(0, 5) : []
  };
}

async function reply(candidate, history, text) {
  if (aiConfigured()) {
    try {
      const out = clean(await completeJson(buildPrompt(candidate || {}, history || [], text)));
      if (out) return Object.assign({ source: 'ai' }, out);
    } catch { /* fall back to scripted */ }
  }
  return Object.assign({ source: 'scripted' }, clean(scripted(text)));
}

function riskWeight(signal) {
  return /counter|competing|another offer/i.test(signal) ? 40 : 15;
}

module.exports = { reply, buildPrompt, scripted, riskWeight };
