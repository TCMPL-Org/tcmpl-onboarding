'use strict';
// Is the candidate answering the question we asked, or writing about something else?
// A pending date / rating / quiz question must never trap the candidate: "hi", a question, or a
// sentence without numbers goes to the AI agent, and the pending question is asked again after its reply.

const OTHER_START = /^(hi+|hello|hey|namaste|namaskar|good\s+(morning|afternoon|evening)|what|when|where|why|who|which|how|can|could|will|would|is|are|do|does|did|should|shall|may|please|pls|plz|kya|kab|kaise|kyu|kyon|kahan|kitna|mujhe|mera|meri|i\s+(want|need|have|am|will|would|can|cannot|can't|don't|do not)|i'm|thanks?|thank\s+you|sorry|ok\s+but|but)\b/i;

function isOtherMessage(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (OTHER_START.test(t)) return true;
  if (!/\d/.test(t) && t.split(/\s+/).length >= 5) return true;
  return false;
}

module.exports = { isOtherMessage };
