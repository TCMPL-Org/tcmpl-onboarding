// The way in: login page (email + password, or Microsoft), forgot password, set-password page (from an invite or
// reset link), and the "no access yet" page. Runs before the app; the app only loads for someone on the user list.
// Every API call is still checked on the server (api/src/lib/access.js); this file only shapes the screen.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function post(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body || {}) });
    const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
    return { ok: res.ok, status: res.status, body: data };
  } catch { return { ok: false, status: 0, body: null }; }
}

const PROBLEM = {
  too_short: 'Use at least 8 characters.',
  too_long: 'That is too long (200 characters at most).',
  needs_letter: 'Add at least one letter.',
  needs_number: 'Add at least one number.',
  needs_special: 'Add at least one special character, like @ # ! or $.',
  too_common: 'That password is too well known. Choose a different one.'
};
// The same rules as the server (api/src/lib/session.js), shown as a checklist while typing.
const RULES = [
  ['At least 8 characters', p => p.length >= 8],
  ['A letter', p => /[A-Za-z]/.test(p)],
  ['A number', p => /[0-9]/.test(p)],
  ['A special character (like @ # ! $)', p => /[^A-Za-z0-9]/.test(p)]
];

function css() {
  if (document.getElementById('lgStyle')) return;
  const st = document.createElement('style');
  st.id = 'lgStyle';
  st.textContent = `
#lgRoot{--hub:#1E4FA0;--hub-soft:#E6EEF9;--teal:#1E4FA0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#EEF2F7;font-family:'IBM Plex Sans','Source Sans 3','Segoe UI',sans-serif}
#lgRoot h1{font-family:inherit;letter-spacing:0}
#lgRoot input:focus{outline:none;border-color:var(--hub);box-shadow:0 0 0 3px rgba(30,79,160,.18)}
#lgRoot .lg-card{width:100%;max-width:420px;background:var(--surface);border:1px solid #DCE3EC;border-radius:16px;box-shadow:0 18px 50px rgba(19,40,74,.10);padding:28px 28px 22px}
#lgRoot .lg-logo{display:flex;justify-content:center;margin-bottom:14px}
#lgRoot .lg-logo img{height:52px;width:auto;background:#fff;border-radius:10px;padding:6px 10px}
#lgRoot h1{font-size:1.35rem;text-align:center;margin:0 0 4px}
#lgRoot .lg-sub{text-align:center;color:var(--muted);font-size:.9rem;margin:0 0 20px}
#lgRoot label{display:block;font-size:.78rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:12px 0 5px}
#lgRoot input[type=email],#lgRoot input[type=password],#lgRoot input[type=text]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--surface);font-size:1rem}
#lgRoot .lg-pw{position:relative}
#lgRoot .lg-pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;color:var(--hub);font-size:.78rem;font-weight:600;padding:6px}
#lgRoot .lg-btn{width:100%;margin-top:18px;padding:12px;border-radius:10px;border:0;background:var(--hub);color:#fff;font-weight:600;font-size:1rem}
#lgRoot .lg-btn[disabled]{opacity:.6}
#lgRoot .lg-alt{width:100%;margin-top:10px;padding:10px;border-radius:9px;border:1px solid var(--line);background:var(--surface);font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;color:var(--ink)}
#lgRoot .lg-or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:.8rem;margin:16px 0 4px}
#lgRoot .lg-or::before,#lgRoot .lg-or::after{content:"";flex:1;height:1px;background:var(--line)}
#lgRoot .lg-link{background:none;border:0;color:var(--hub);font-size:.88rem;padding:0;text-decoration:underline}
#lgRoot .lg-row{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
#lgRoot .lg-msg{margin-top:12px;font-size:.9rem;border-radius:8px;padding:9px 11px}
#lgRoot .lg-msg.bad{background:var(--bad-soft);color:var(--bad)}
#lgRoot .lg-msg.ok{background:var(--ok-soft);color:var(--ok)}
#lgRoot .lg-hint{font-size:.82rem;color:var(--muted);margin-top:6px}
#lgRoot .lg-rules{list-style:none;padding:0;margin:8px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:.82rem;color:var(--muted)}
#lgRoot .lg-rules li::before{content:"○";display:inline-block;width:1.2em;color:var(--muted)}
#lgRoot .lg-rules li.ok{color:var(--ok)}
#lgRoot .lg-rules li.ok::before{content:"✓";color:var(--ok);font-weight:700}
#lgRoot .lg-foot{text-align:center;color:var(--muted);font-size:.78rem;margin-top:18px}`;
  document.head.append(st);
}

function frame(inner) {
  css();
  let root = document.getElementById('lgRoot');
  if (!root) { root = document.createElement('div'); root.id = 'lgRoot'; document.body.prepend(root); }
  root.innerHTML = `<div class="lg-card"><div class="lg-logo"><img src="/tc-logo.png" alt="TalentCarriage"></div>${inner}
    <div class="lg-foot">TalentCarriage · AI Onboarding Agent · <a href="/privacy" style="color:inherit">Privacy</a></div></div>`;
  return root;
}
const $ = s => document.querySelector('#lgRoot ' + s);
function say(text, kind) {
  const m = $('#lgMsg');
  if (!m) return;
  m.hidden = !text;
  m.className = 'lg-msg ' + (kind || 'bad');
  m.textContent = text || '';
}
function eye(btnSel, inputSel) {
  const b = $(btnSel), i = $(inputSel);
  if (!b || !i) return;
  b.onclick = () => { const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; };
}

/* ---------- login ---------- */
function loginPage(prefill) {
  frame(`<h1>Sign in</h1><p class="lg-sub">AI Onboarding Agent</p>
    <form id="lgForm" novalidate>
      <label for="lgEmail">Email</label><input id="lgEmail" type="email" autocomplete="username" value="${esc(prefill || '')}" required>
      <label for="lgPw">Password</label><div class="lg-pw"><input id="lgPw" type="password" autocomplete="current-password" required><button type="button" id="lgEye">Show</button></div>
      <div class="lg-row"><span></span><button type="button" class="lg-link" id="lgForgot">Forgot password?</button></div>
      <button class="lg-btn" id="lgGo" type="submit">Sign in</button>
      <div class="lg-msg" id="lgMsg" hidden></div>
    </form>
    <div class="lg-or">or</div>
    <a class="lg-alt" href="/.auth/login/aad?post_login_redirect_uri=/"><svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9h-9z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#ffb900" d="M11 11h9v9h-9z"/></svg>Sign in with Microsoft</a>
    <p class="lg-hint" style="text-align:center">Access is by invitation. Ask your admin if you do not have an account.</p>`);
  eye('#lgEye', '#lgPw');
  (prefill ? $('#lgPw') : $('#lgEmail')).focus();
  $('#lgForgot').onclick = () => forgotPage($('#lgEmail').value.trim());
  $('#lgForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#lgEmail').value.trim(), password = $('#lgPw').value;
    if (!email || !password) { say('Enter your email and password.'); return; }
    $('#lgGo').disabled = true; say('');
    const r = await post('/api/auth/login', { email, password });
    $('#lgGo').disabled = false;
    if (r.ok) { location.replace('/'); return; }
    const err = r.body && r.body.error;
    if (err === 'locked') say(`Too many wrong tries. This account is locked for ${r.body.minutes || 15} minutes; try again later or use Forgot password.`);
    else if (err === 'wrong_login') say('That email and password do not match.');
    else if (err === 'database_not_configured') say('Sign-in is not available yet: the database is not set up.');
    else say('Could not sign in just now (' + (r.status || 'no connection') + '). Please try again.');
    $('#lgPw').select();
  };
}

/* ---------- forgot password ---------- */
function forgotPage(prefill) {
  frame(`<h1>Forgot password</h1><p class="lg-sub">We will email you a link to choose a new one.</p>
    <form id="lgForm" novalidate>
      <label for="lgEmail">Email</label><input id="lgEmail" type="email" autocomplete="username" value="${esc(prefill || '')}" required>
      <button class="lg-btn" id="lgGo" type="submit">Email me a link</button>
      <div class="lg-msg" id="lgMsg" hidden></div>
    </form>
    <div class="lg-row" style="justify-content:center"><button type="button" class="lg-link" id="lgBack">Back to sign in</button></div>`);
  $('#lgEmail').focus();
  $('#lgBack').onclick = () => loginPage($('#lgEmail').value.trim());
  $('#lgForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('#lgEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Enter your email address.'); return; }
    $('#lgGo').disabled = true;
    await post('/api/auth/forgot', { email });
    say('If that email has an account, a link is on its way. It works for 1 hour. Check your inbox and spam folder.', 'ok');
  };
}

/* ---------- set password (invite or reset link) ---------- */
async function setPasswordPage() {
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t') || '';
  frame('<p class="lg-sub">Checking your link…</p>');
  const info = token ? await post('/api/auth/link-info', { token }) : { ok: false };
  if (!info.ok) {
    frame(`<h1>This link does not work</h1><p class="lg-sub">It may have expired or already been used.</p>
      <p class="lg-hint">Invitation links work for 7 days and reset links for 1 hour, once each. Ask your admin for a new invitation, or use Forgot password.</p>
      <button class="lg-btn" id="lgToLogin" type="button">Go to sign in</button>`);
    $('#lgToLogin').onclick = () => { history.replaceState(null, '', '/'); loginPage(); };
    return;
  }
  const { email, name, purpose } = info.body;
  frame(`<h1>${purpose === 'invite' ? 'Welcome' + (name ? ', ' + esc(name.split(' ')[0]) : '') : 'Choose a new password'}</h1>
    <p class="lg-sub">${purpose === 'invite' ? 'Set a password to finish setting up your account.' : 'Your new password replaces the old one.'}</p>
    <form id="lgForm" novalidate>
      <label>Email</label><input type="text" value="${esc(email)}" readonly autocomplete="username">
      <label for="lgPw">New password</label><div class="lg-pw"><input id="lgPw" type="password" autocomplete="new-password" required><button type="button" id="lgEye">Show</button></div>
      <ul class="lg-rules" id="lgRules">${RULES.map(([t], i) => `<li data-i="${i}">${esc(t)}</li>`).join('')}</ul>
      <label for="lgPw2">Type it again</label><input id="lgPw2" type="password" autocomplete="new-password" required>
      <button class="lg-btn" id="lgGo" type="submit">${purpose === 'invite' ? 'Set password and sign in' : 'Save and sign in'}</button>
      <div class="lg-msg" id="lgMsg" hidden></div>
    </form>`);
  eye('#lgEye', '#lgPw');
  $('#lgPw').focus();
  const tick = () => { const p = $('#lgPw').value; document.querySelectorAll('#lgRules li').forEach(li => li.classList.toggle('ok', RULES[+li.dataset.i][1](p))); };
  $('#lgPw').addEventListener('input', tick); tick();
  $('#lgForm').onsubmit = async e => {
    e.preventDefault();
    const a = $('#lgPw').value, b = $('#lgPw2').value;
    const miss = RULES.find(([, ok]) => !ok(a));
    if (miss) { say('The password needs: ' + RULES.filter(([, ok]) => !ok(a)).map(([t]) => t.toLowerCase()).join(', ') + '.'); return; }
    if (a !== b) { say('The two passwords are not the same.'); return; }
    $('#lgGo').disabled = true; say('');
    const r = await post('/api/auth/set-password', { token, password: a });
    $('#lgGo').disabled = false;
    if (r.ok) { history.replaceState(null, '', '/'); location.replace('/'); return; }
    const err = r.body && r.body.error;
    if (err === 'weak_password') say(PROBLEM[r.body.problem] || 'Choose a stronger password.');
    else if (err === 'link_invalid') say('This link has expired or was already used. Ask for a new one.');
    else if (err === 'bad_origin') say('This page must be opened from the app\'s own address. Open the link from the email again.');
    else say('Could not save the password just now (' + (r.status || 'no connection') + '). Please try again.');
  };
}

/* ---------- signed in, but not on the user list ---------- */
function noAccessPage(me) {
  const ms = me.provider && me.provider !== 'password';
  frame(`<h1>No access yet</h1>
    <p class="lg-sub">You are signed in as <b>${esc(me.email || 'this account')}</b>, but this account is not on the user list.</p>
    <p class="lg-hint">Ask your admin to invite you in Admin → Users.${ms ? ' If you used the wrong Microsoft account, sign out and sign in again.' : ''}</p>
    <button class="lg-btn" id="lgOut" type="button">Sign out</button>`);
  $('#lgOut').onclick = () => signOut(me.provider);
}

async function signOut(provider) {
  await post('/api/auth/logout');
  if (provider && provider !== 'password') location.href = '/.auth/logout?post_logout_redirect_uri=/';
  else location.replace('/');
}
window.tcmplSignOut = () => signOut(window.tcmplAccess && window.tcmplAccess.provider);

// When the session ends while the app is open (12 hours, password reset, switched off), go back to sign in.
function watchSession() {
  if (window.__tcWatch) return;
  window.__tcWatch = true;
  const orig = window.fetch.bind(window);
  let leaving = false;
  window.fetch = async (input, init) => {
    const res = await orig(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (res.status === 401 && !leaving && /^(\/|https?:\/\/[^/]+\/)api\//.test(url) && !/\/api\/auth\//.test(url)) {
      leaving = true;
      setTimeout(() => location.replace('/'), 50);
    }
    return res;
  };
}

// true when the app may load (the person is on the user list, or the API cannot be reached and the app shows its own errors).
export async function signInGate() {
  if (location.pathname === '/set-password') { await setPasswordPage(); return false; }
  if (location.pathname === '/login') history.replaceState(null, '', '/');
  const r = await post('/api/access/me');
  if (!r.body || r.status >= 500) return true;
  if (r.body.allowed) { window.tcmplAccess = r.body; watchSession(); return true; }
  if (r.body.signedIn) { noAccessPage(r.body); return false; }
  loginPage();
  return false;
}
