// CTC calculator (TalentCarriage v22 engine, src/ctc-engine.js) inside the onboarding tool:
//  - tab "8 · CTC calculator": one salary structure from Total Wages, Target CTC or Net Take Home, Excel download;
//  - Client setup → "Salary calculator rules": this client's TC code, default state/zone and skill, and its rules
//    (no bonus / no gratuity / no ESIC / bonus % / fixed minimum wage); admins also edit the statutory constants,
//    the minimum-wage master and the formula columns (shared by all clients);
//  - window.tcmplCTC: the same numbers for the Offer desk (Annexure 1 of the offer letter).
// Stored in the app database: ctc/config = { cfg, mw, fx } (admins only) and clients/<id>.ctc (admins only; the server
// keeps it when HR saves the client record).

const E = window.TCCTC;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => Math.round(Number(n) || 0).toLocaleString('en-IN');
const toast = m => (window.tcmplWAUtil && window.tcmplWAUtil.toast ? window.tcmplWAUtil.toast(m) : console.log(m));
const isAdmin = () => Boolean(window.tcmplAccess && window.tcmplAccess.role === 'admin');
const clientId = () => ($('#clientSel') && $('#clientSel').value) || 'default';
const clientLabel = () => (window.tcmplClientLabel ? window.tcmplClientLabel() : clientId());

async function getJson(path) {
  try {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch { return { ok: false, status: 0, body: null }; }
}
async function put(path, body) {
  try {
    const res = await fetch(path, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status };
  } catch { return { ok: false, status: 0 }; }
}

/* ---------- data: global config and per-client rules ---------- */
let config = { cfg: E.makeCfg(), mw: E.makeMW(), fx: [{ name: 'Annual CTC', key: 'ANNUAL_CTC', expr: '[CTC] * 12', dec: 0, prefix: '₹' }], updated: null, updatedBy: '' };
const clientRec = {}; // id -> client record data (for its .ctc)
let loaded = false;

async function loadConfig() {
  const r = await getJson('/api/data/ctc/config');
  if (r.ok && r.body && r.body.data) {
    const d = r.body.data;
    config = { cfg: E.makeCfg(d.cfg), mw: E.makeMW(d.mw), fx: Array.isArray(d.fx) ? d.fx : config.fx, updated: d.updated || null, updatedBy: (r.body.meta && r.body.meta.updatedBy) || '' };
  }
  loaded = true;
}
async function loadClient(id) {
  if (!id || id === 'default') { clientRec[id] = clientRec[id] || {}; return clientRec[id]; }
  const r = await getJson('/api/data/clients/' + encodeURIComponent(id));
  clientRec[id] = (r.ok && r.body && r.body.data) || {};
  return clientRec[id];
}
const rulesOf = id => Object.assign({ code: '', state: 'Gujarat-Zone I', skill: 'SEMI-SKILLED' }, (clientRec[id] && clientRec[id].ctc) || {});

// Everything a calculation needs for one client.
function setupFor(id) {
  const r = rulesOf(id || clientId());
  return {
    cfg: config.cfg, mw: config.mw, fx: config.fx,
    rules: { noBonus: !!r.noBonus, noGratuity: !!r.noGratuity, noESIC: !!r.noESIC, bonusPct: r.bonusPct === '' || r.bonusPct == null ? null : Number(r.bonusPct), mwOverride: r.mwOverride === '' || r.mwOverride == null ? null : Number(r.mwOverride) },
    defaults: { state: r.state, cat: r.skill, code: r.code || '' }
  };
}
function ruleText(id) {
  const s = setupFor(id), r = s.rules, out = [];
  if (r.noBonus) out.push('no statutory bonus');
  if (r.noGratuity) out.push('no gratuity');
  if (r.noESIC) out.push('no ESIC');
  if (r.bonusPct != null && isFinite(r.bonusPct)) out.push(`bonus ${Math.round(r.bonusPct * 10000) / 100}% of Basic when Bonus is Y`);
  if (r.mwOverride) out.push(`minimum wage fixed at ₹${money(r.mwOverride)}`);
  return out;
}

/* ---------- calculator page ---------- */
const DEFAULT_INPUT = () => {
  const d = setupFor().defaults;
  return { name: '', state: d.state, cat: d.cat, basis: 'CTC', amount: 25000, etype: 'REGULAR EMP', pfApp: 'Y', metro: 'Y', pfBasis: 'On 25K', bonusOpt: 'Y', incent: 0, da: 0, fixed: 0 };
};
let input = null, inputClient = null;

const opt = (list, v) => list.map(x => (Array.isArray(x) ? x : [x, x])).map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('');

function renderCalcPage() {
  const sec = $('#tab-ctc');
  if (!sec) return;
  if (!input || inputClient !== clientId()) { input = DEFAULT_INPUT(); inputClient = clientId(); }
  const states = config.mw.map(r => r[0]);
  const rules = ruleText();
  const code = setupFor().defaults.code;
  sec.innerHTML = `
  <div class="intro"><div><h2>CTC calculator</h2><p>TalentCarriage salary structuring engine (v22). Enter Total Wages, a Target CTC or the Net Take Home; everything else follows the statutory rules for ${esc(clientLabel())}.</p></div>
    <div class="row"><span class="chip info">${esc(clientLabel())}${code ? ' · ' + esc(code) : ''}</span></div></div>
  ${rules.length ? `<div class="callout" style="margin-bottom:12px">Client rules${code ? ' (' + esc(code) + ')' : ''}: ${esc(rules.join(', '))}. Change them in Client setup → Salary calculator rules.</div>` : ''}
  <div class="grid2">
    <div class="card"><h3 style="margin-bottom:10px">Input</h3>
      <div class="form" id="ccForm">
        <div class="field full"><label class="lbl" for="ccName">Employee / reference</label><input type="text" id="ccName" value="${esc(input.name)}" placeholder="Optional, shown on the Excel sheet"></div>
        <div class="field"><label class="lbl" for="ccState">State / zone</label><select id="ccState">${opt(states, input.state)}</select></div>
        <div class="field"><label class="lbl" for="ccCat">Skill category</label><select id="ccCat">${opt(E.CATS, input.cat)}</select></div>
        <div class="field"><label class="lbl" for="ccBasis">Input basis</label><select id="ccBasis">${opt([['CTC', 'Target CTC'], ['NETTH', 'Net Take Home'], ['WAGES', 'Total Wages']], input.basis)}</select></div>
        <div class="field"><label class="lbl" for="ccAmt">Monthly amount ₹</label><input type="number" id="ccAmt" step="1" min="0" value="${esc(input.amount)}"></div>
        <div class="field"><label class="lbl" for="ccEtype">Employment type</label><select id="ccEtype">${opt(['REGULAR EMP', 'RETAINER', 'CONSULTING FEE'], input.etype)}</select></div>
        <div class="field"><label class="lbl" for="ccMetro">Metro (HRA)</label><select id="ccMetro">${opt([['Y', 'Yes (HRA 50%)'], ['N', 'No (HRA 40%)']], input.metro)}</select></div>
        <div class="field"><label class="lbl" for="ccPf">PF applicable</label><select id="ccPf">${opt(['Y', 'N'], input.pfApp)}</select></div>
        <div class="field"><label class="lbl" for="ccPfb">PF basis</label><select id="ccPfb">${opt(['On 25K', 'On Actual Basic'], input.pfBasis)}</select></div>
        <div class="field"><label class="lbl" for="ccBonus">Bonus</label><select id="ccBonus">${opt(['Y', 'N'], input.bonusOpt)}</select></div>
        <div class="field"><label class="lbl" for="ccInc">Incentive (% of CTC)</label><input type="number" id="ccInc" step="0.01" min="0" max="100" value="${esc(input.incent)}"></div>
        <div class="field"><label class="lbl" for="ccDa">DA (fixed) ₹</label><input type="number" id="ccDa" step="1" min="0" value="${esc(input.da)}"></div>
        <div class="field"><label class="lbl" for="ccFix">Other fixed heads ₹</label><input type="number" id="ccFix" step="1" min="0" value="${esc(input.fixed)}"></div>
      </div>
      <p class="note" style="margin-top:8px">ESI is worked out from the gross. Statutory bonus applies automatically when Basic is below ₹${money(config.cfg.bonusCeil)}, even when Bonus is N; with Y it is on the actual Basic. Incentive is a % of CTC and gives TTC = CTC + Incentive. Other fixed heads = Conveyance, LTA, CEA, CHA, Meal, reimbursements you want to keep fixed.</p>
      <div class="row" style="margin-top:10px"><button class="btn primary small" id="ccOffer" type="button">Use in Offer desk</button><button class="btn small" id="ccXls" type="button">Download Excel</button><button class="btn small" id="ccReset" type="button">Reset</button></div>
    </div>
    <div><div id="ccAlerts"></div><div class="figs" id="ccKpis" style="margin-top:0"></div>
      <div class="card" style="margin-top:12px"><h3>Salary structure</h3><div class="tscroll" style="margin-top:8px"><table id="ccSlip" class="cc-slip"></table></div>
      <p class="note" id="ccFoot" style="margin-top:8px"></p></div></div>
  </div>`;
  const read = () => {
    input = { name: $('#ccName').value, state: $('#ccState').value, cat: $('#ccCat').value, basis: $('#ccBasis').value, amount: Number($('#ccAmt').value) || 0, etype: $('#ccEtype').value,
      pfApp: $('#ccPf').value, metro: $('#ccMetro').value, pfBasis: $('#ccPfb').value, bonusOpt: $('#ccBonus').value, incent: Number($('#ccInc').value) || 0, da: Number($('#ccDa').value) || 0, fixed: Number($('#ccFix').value) || 0 };
    renderResult();
  };
  $('#ccForm').addEventListener('input', read);
  $('#ccForm').addEventListener('change', read);
  $('#ccReset').onclick = () => { input = DEFAULT_INPUT(); renderCalcPage(); };
  $('#ccXls').onclick = downloadExcel;
  $('#ccOffer').onclick = () => {
    if (!window.tcmplOfferUseCTC) { toast('The Offer desk is still loading.'); return; }
    window.tcmplOfferUseCTC(Object.assign({}, input));
    const b = document.querySelector('nav.tabs button[data-tab="offer"]'); if (b) b.click();
  };
  renderResult();
}

function slipRows(r, fx) {
  const rows = [];
  E.SLIP.forEach(([kind, label, key]) => {
    if (kind === 'grp') rows.push({ group: label });
    else if (kind === 'tot' || r[key]) rows.push({ label, monthly: r[key], annual: r[key] * 12, total: kind === 'tot' });
  });
  if (fx && fx.length) {
    rows.push({ group: 'CUSTOM FORMULA COLUMNS' });
    fx.forEach(c => rows.push({ label: c.name, monthly: r[c.key], fx: c }));
  }
  return rows;
}
const fmtFx = (c, v) => (c.prefix || '') + (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: c.dec || 0, maximumFractionDigits: c.dec || 0 });

function renderResult() {
  if (!$('#ccSlip')) return;
  const s = setupFor();
  const r = E.evaluate(input, s);
  const al = [];
  if (r.warnings.includes('no_minimum_wage')) al.push('<div class="callout" style="margin-bottom:8px">The minimum wage for this state and category is blank in the master. An admin can enter it in Client setup → Salary calculator rules → Minimum wages.</div>');
  if (r.warnings.includes('below_minimum_wage')) al.push(`<div class="callout" style="margin-bottom:8px;border-color:var(--bad);background:var(--bad-soft)">The wages are below the minimum wage (₹${money(r.MW)}). Increase the amount.</div>`);
  $('#ccAlerts').innerHTML = al.join('');
  const kpi = [['Total wages', r.TOTALWAGES], ['Monthly CTC', r.CTC], ['Annual CTC', r.CTC * 12], ['Net take home', r.TAKEHOME], ['Gross', r.GROSS], ['TTC', r.TTC], ['HRA %', null, (input.metro === 'Y' ? config.cfg.hraMetro : config.cfg.hraNonMetro) * 100 + '%'], ['Minimum wage', r.MW]];
  $('#ccKpis').innerHTML = kpi.map(([k, v, raw]) => `<div class="fig"><div class="k">${esc(k)}</div><div class="v">${raw != null ? esc(raw) : '₹ ' + money(v)}</div></div>`).join('');
  $('#ccSlip').innerHTML = '<tr><th>Component</th><th class="num">Monthly ₹</th><th class="num">Annual ₹</th></tr>' + slipRows(r, s.fx).map(x => x.group
    ? `<tr class="cc-grp"><td colspan="3">${esc(x.group)}</td></tr>`
    : `<tr${x.total ? ' class="cc-tot"' : ''}><td>${esc(x.label)}</td><td class="num">${x.fx ? esc(fmtFx(x.fx, x.monthly)) : money(x.monthly)}</td><td class="num">${x.fx ? '' : money(x.annual)}</td></tr>`).join('');
  $('#ccFoot').textContent = `ESI ${r.ERESIC || r.EEESIC ? 'applies' : 'does not apply'} (gross ${r.GROSS <= config.cfg.esicCeil ? 'within' : 'above'} ₹${money(config.cfg.esicCeil)}). PF wage ₹${money(r.PFWAGE)}. Amounts round up to the next rupee, as in the TC calculator.`;
}

function downloadExcel() {
  const s = setupFor();
  const r = E.evaluate(input, s);
  const cell = (v, st) => `<td${st ? ` style="${st}"` : ''}>${esc(v)}</td>`;
  const border = 'border:1px solid #B9D2DA;padding:6px 9px;';
  const numSt = border + 'text-align:right;mso-number-format:"#,##0";';
  let h = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse}th{background:#1E5AA9;color:#fff;border:1px solid #B9D2DA;padding:7px 9px;text-align:left}.grp{background:#E4F4F4;font-weight:bold}.tot{background:#E7F0FA;font-weight:bold}</style></head><body>';
  h += '<table><tr><td colspan="3" style="background:#0E2233;color:#fff;font-size:16pt;font-weight:bold;padding:10px">TalentCarriage - CTC Structure</td></tr>';
  [['Employee / Reference', input.name || ''], ['Client', clientLabel() + (s.defaults.code ? ' (' + s.defaults.code + ')' : '')], ['State / Zone', input.state], ['Skill Category', input.cat],
    ['Input Basis', { CTC: 'Target CTC', NETTH: 'Net Take Home', WAGES: 'Total Wages' }[input.basis]], ['Input Amount', input.amount]].forEach(([k, v]) => {
    h += '<tr>' + cell(k, border + 'font-weight:bold;') + cell(v, k === 'Input Amount' ? numSt : border) + cell('', border) + '</tr>';
  });
  h += '<tr><td colspan="3" style="height:10px"></td></tr><tr><th>Component</th><th>Monthly INR</th><th>Annual INR</th></tr>';
  slipRows(r, s.fx).forEach(x => {
    if (x.group) h += `<tr><td class="grp" colspan="3">${esc(x.group)}</td></tr>`;
    else h += `<tr class="${x.total ? 'tot' : ''}">` + cell(x.label, border) + cell(x.fx ? Math.round((Number(x.monthly) || 0) * 100) / 100 : x.monthly, numSt) + cell(x.fx ? '' : x.annual, numSt) + '</tr>';
  });
  h += '</table></body></html>';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([h], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  const safe = String(input.name || 'CTC_Structure').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'CTC_Structure';
  a.download = `TC_CTC_Structure_${safe}_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Excel file downloaded');
}

/* ---------- Client setup: salary calculator rules (+ admin: constants, minimum wages, formula columns) ---------- */
let cfgView = 'client', fxEditing = -1;

function renderSetupCard() {
  const box = $('#ctcCfgCard');
  if (!box) return;
  const id = clientId();
  const adm = isAdmin();
  const r = rulesOf(id);
  const states = config.mw.map(x => x[0]);
  const dis = adm ? '' : 'disabled';
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h3>Salary calculator rules</h3>
      <div class="seg" role="group" aria-label="Salary calculator settings"><button type="button" data-cv="client" aria-pressed="${cfgView === 'client'}">This client</button>${adm ? `<button type="button" data-cv="stat" aria-pressed="${cfgView === 'stat'}">Constants</button><button type="button" data-cv="mw" aria-pressed="${cfgView === 'mw'}">Minimum wages</button><button type="button" data-cv="fx" aria-pressed="${cfgView === 'fx'}">Formula columns</button>` : ''}</div></div>
    <div id="ccCfgBody" style="margin-top:10px"></div>`;
  box.querySelectorAll('[data-cv]').forEach(b => { b.onclick = () => { cfgView = b.dataset.cv; fxEditing = -1; renderSetupCard(); }; });
  const body = $('#ccCfgBody');

  if (cfgView === 'client' || !adm) {
    body.innerHTML = `<p class="note" style="margin:0 0 8px">Used by the CTC calculator and the Offer desk for ${esc(clientLabel())}.${adm ? '' : ' Only admins can change these rules.'}</p>
      <div class="form">
        <div class="field"><label class="lbl" for="crCode">TC company code</label><input type="text" id="crCode" value="${esc(r.code || '')}" placeholder="e.g. C1008" ${dis}></div>
        <div class="field"><label class="lbl" for="crState">Default state / zone</label><select id="crState" ${dis}>${opt(states, r.state)}</select></div>
        <div class="field"><label class="lbl" for="crSkill">Default skill category</label><select id="crSkill" ${dis}>${opt(E.CATS, r.skill)}</select></div>
        <div class="field"><label class="lbl" for="crMw">Fixed minimum wage ₹ (blank = state master)</label><input type="number" id="crMw" min="0" step="1" value="${esc(r.mwOverride == null ? '' : r.mwOverride)}" ${dis}></div>
        <div class="field"><label class="lbl" for="crBp">Bonus % of Basic when Bonus is Y (blank = statutory)</label><input type="number" id="crBp" min="0" max="100" step="0.01" value="${esc(r.bonusPct == null || r.bonusPct === '' ? '' : Math.round(Number(r.bonusPct) * 10000) / 100)}" ${dis}></div>
        <div class="field full" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:6px 22px"><label class="chk"><input type="checkbox" id="crNoBonus" ${r.noBonus ? 'checked' : ''} ${dis}> No statutory bonus</label>
          <label class="chk"><input type="checkbox" id="crNoGrat" ${r.noGratuity ? 'checked' : ''} ${dis}> No gratuity</label>
          <label class="chk"><input type="checkbox" id="crNoEsic" ${r.noESIC ? 'checked' : ''} ${dis}> No ESIC (employer and employee)</label></div>
      </div>
      ${adm ? `<div class="row" style="margin-top:10px"><button class="btn primary small" id="crSave" type="button">Save rules for ${esc(clientLabel())}</button><button class="btn small" id="crFill" type="button" title="Fill the rules the v22 calculator had for this code">Fill rules from code</button><span class="note" id="crState2"></span></div>` : ''}
      <p class="note" style="margin-top:8px">The v22 calculator had these codes built in: C1008 no bonus, gratuity or ESIC; C1020 no bonus; C1017 bonus 20%; C1021 minimum wage ₹15,100.</p>`;
    if (!adm) return;
    $('#crFill').onclick = () => {
      const k = E.KNOWN_CODE_RULES[$('#crCode').value.trim().toUpperCase()];
      if (!k) { $('#crState2').textContent = 'No built-in rules for this code; set them by hand.'; return; }
      $('#crNoBonus').checked = !!k.noBonus; $('#crNoGrat').checked = !!k.noGratuity; $('#crNoEsic').checked = !!k.noESIC;
      $('#crBp').value = k.bonusPct != null ? k.bonusPct * 100 : ''; $('#crMw').value = k.mwOverride || '';
      $('#crState2').textContent = 'Filled. Save to keep.';
    };
    $('#crSave').onclick = async () => {
      if (id === 'default') { $('#crState2').textContent = 'Pick a client first (the TCMPL default has no rules of its own).'; return; }
      const bp = $('#crBp').value.trim(), mwv = $('#crMw').value.trim();
      const ctc = { code: $('#crCode').value.trim().toUpperCase().slice(0, 20), state: $('#crState').value, skill: $('#crSkill').value,
        noBonus: $('#crNoBonus').checked, noGratuity: $('#crNoGrat').checked, noESIC: $('#crNoEsic').checked,
        bonusPct: bp === '' ? null : Math.max(0, Math.min(100, Number(bp))) / 100, mwOverride: mwv === '' ? null : Math.max(0, Number(mwv)), updated: new Date().toISOString() };
      const cur = await getJson('/api/data/clients/' + encodeURIComponent(id));
      const data = Object.assign({}, (cur.ok && cur.body && cur.body.data) || { client: id }, { ctc });
      const res = await put('/api/data/clients/' + encodeURIComponent(id), data);
      $('#crState2').textContent = res.ok ? 'Saved.' : res.status === 403 ? 'Only admins can change these rules.' : 'Not saved (' + res.status + ').';
      if (res.ok) { clientRec[id] = data; afterChange(); }
    };
    return;
  }

  if (cfgView === 'stat') {
    body.innerHTML = `<p class="note" style="margin:0 0 8px">Statutory constants for every client. ${config.updated ? 'Last changed ' + esc(new Date(config.updated).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })) + (config.updatedBy ? ' by ' + esc(config.updatedBy) : '') + '.' : 'Using the v22 defaults.'}</p>
      <div class="form">${E.CFG_META.map(([k, lab, kind]) => `<div class="field"><label class="lbl" for="cs_${k}">${esc(lab)}</label>${kind === 'yn' ? `<select id="cs_${k}" data-k="${k}">${opt(['Y', 'N'], config.cfg[k])}</select>` : `<input type="number" id="cs_${k}" data-k="${k}" step="${kind === 'pct' ? '0.0001' : '1'}" value="${esc(config.cfg[k])}">`}${kind === 'pct' ? '<span class="note">as a fraction: 0.12 = 12%</span>' : ''}</div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn primary small" id="csSave" type="button">Save constants</button><button class="btn small" id="csReset" type="button">Restore v22 defaults</button><span class="note" id="csState"></span></div>`;
    $('#csSave').onclick = async () => {
      const cfg = Object.assign({}, config.cfg);
      body.querySelectorAll('[data-k]').forEach(i => { cfg[i.dataset.k] = i.dataset.k === 'pfCapOn' ? i.value : Number(i.value); });
      await saveConfig({ cfg }, '#csState');
    };
    $('#csReset').onclick = async () => { if (window.confirm('Restore the v22 default constants for every client?')) await saveConfig({ cfg: E.makeCfg() }, '#csState', true); };
    return;
  }

  if (cfgView === 'mw') {
    body.innerHTML = `<p class="note" style="margin:0 0 8px">Monthly minimum wages by state/zone and skill. Blank means not set (Kerala and Telangana were blank in v22). Edits apply to every client except those with a fixed minimum wage.</p>
      <div class="tscroll" style="max-height:60vh"><table class="cc-mw"><tr><th>State / zone</th><th>Revised</th>${E.CATS.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr>
      ${config.mw.map((row, i) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1] || '—')}</td>${[2, 3, 4, 5].map(c => `<td class="num"><input type="number" data-r="${i}" data-c="${c}" value="${row[c] == null ? '' : esc(row[c])}" placeholder="missing" style="width:96px;text-align:right"></td>`).join('')}</tr>`).join('')}</table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary small" id="mwSave" type="button">Save minimum wages</button><span class="note" id="mwState"></span></div>`;
    $('#mwSave').onclick = async () => {
      const mw = config.mw.map(r => r.slice());
      body.querySelectorAll('[data-r]').forEach(i => { mw[+i.dataset.r][+i.dataset.c] = i.value === '' ? null : Number(i.value); });
      await saveConfig({ mw }, '#mwState');
    };
    return;
  }

  // formula columns
  const ed = fxEditing >= 0 ? config.fx[fxEditing] : { name: '', expr: '', dec: 0, prefix: '₹' };
  body.innerHTML = `<p class="note" style="margin:0 0 8px">Extra lines shown under the salary structure for every client. Use a column in square brackets, e.g. <code>[CTC] * 12</code> or <code>IF([BASIC] &gt; 21000, 0, ROUND([BASIC] * 0.0833, 0))</code>. Functions: ${Object.keys(E.FN_ARITY).join(', ')}.</p>
    <table class="cc-fx"><tr><th>Column</th><th>Formula</th><th class="num">Sample</th><th></th></tr>
    ${config.fx.map((c, i) => `<tr><td><b>${esc(c.name)}</b><br><span class="note">[${esc(c.key)}]</span></td><td><code>${esc(c.expr)}</code></td><td class="num">${esc(fmtFx(c, sample()[c.key]))}</td>
      <td style="white-space:nowrap"><button class="btn small" data-fu="${i}" type="button" ${i ? '' : 'disabled'}>↑</button> <button class="btn small" data-fe="${i}" type="button">Edit</button> <button class="btn small" data-fd="${i}" type="button">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="note">No formula columns.</td></tr>'}</table>
    <h4 class="subh">${fxEditing >= 0 ? 'Edit column' : 'New column'}</h4>
    <div class="form"><div class="field"><label class="lbl" for="fxName">Column name</label><input type="text" id="fxName" value="${esc(ed.name)}" placeholder="Annual CTC"></div>
      <div class="field"><label class="lbl" for="fxDec">Decimals</label><select id="fxDec">${opt([0, 1, 2], ed.dec || 0)}</select></div>
      <div class="field"><label class="lbl" for="fxPre">Prefix</label><input type="text" id="fxPre" value="${esc(ed.prefix == null ? '₹' : ed.prefix)}"></div>
      <div class="field full"><label class="lbl" for="fxExpr">Formula</label><input type="text" id="fxExpr" value="${esc(ed.expr)}" placeholder="[CTC] * 12"></div>
      <div class="field full"><span class="note">Columns: ${E.BASE_KEYS.concat(config.fx.map(c => c.key)).map(k => '<code>[' + esc(k) + ']</code>').join(' ')}</span></div></div>
    <div class="row" style="margin-top:8px"><button class="btn primary small" id="fxSave" type="button">${fxEditing >= 0 ? 'Save column' : 'Add column'}</button>${fxEditing >= 0 ? '<button class="btn small" id="fxCancel" type="button">Cancel</button>' : ''}<span class="note" id="fxState"></span></div>`;
  const test = () => {
    const ex = $('#fxExpr').value.trim();
    if (!ex) { $('#fxState').textContent = ''; return null; }
    try { const v = E.compile(ex)(sample()); $('#fxState').textContent = '✓ Sample result: ' + (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); return v; } catch (err) { $('#fxState').textContent = '✗ ' + err.message; return null; }
  };
  $('#fxExpr').oninput = test;
  body.querySelectorAll('[data-fe]').forEach(b => { b.onclick = () => { fxEditing = +b.dataset.fe; renderSetupCard(); }; });
  body.querySelectorAll('[data-fu]').forEach(b => { b.onclick = async () => { const i = +b.dataset.fu; const fx = config.fx.slice(); [fx[i - 1], fx[i]] = [fx[i], fx[i - 1]]; await saveConfig({ fx }, '#fxState'); }; });
  body.querySelectorAll('[data-fd]').forEach(b => { b.onclick = async () => { const c = config.fx[+b.dataset.fd]; if (!window.confirm(`Delete the column "${c.name}"?`)) return; await saveConfig({ fx: config.fx.filter((_, i) => i !== +b.dataset.fd) }, '#fxState'); }; });
  if ($('#fxCancel')) $('#fxCancel').onclick = () => { fxEditing = -1; renderSetupCard(); };
  $('#fxSave').onclick = async () => {
    const name = $('#fxName').value.trim(), expr = $('#fxExpr').value.trim();
    if (!name || !expr) { $('#fxState').textContent = 'Enter a name and a formula.'; return; }
    try { E.compile(expr)(sample()); } catch (err) { $('#fxState').textContent = '✗ ' + err.message; return; }
    const fx = config.fx.slice();
    const col = { name: name.slice(0, 60), expr: expr.slice(0, 500), dec: Number($('#fxDec').value) || 0, prefix: $('#fxPre').value.slice(0, 6) };
    if (fxEditing >= 0) fx[fxEditing] = Object.assign({}, fx[fxEditing], col);
    else fx.push(Object.assign(col, { key: E.keyFromName(name, fx.map(c => c.key)) }));
    fxEditing = -1;
    await saveConfig({ fx }, '#fxState');
  };
  test();
}

function sample() {
  const s = setupFor();
  return E.evaluate(Object.assign(DEFAULT_INPUT(), { basis: 'CTC', amount: 25000 }), s);
}

async function saveConfig(part, stateSel, quiet) {
  const data = { cfg: part.cfg || config.cfg, mw: part.mw || config.mw, fx: (part.fx || config.fx).map(c => ({ name: c.name, key: c.key, expr: c.expr, dec: c.dec || 0, prefix: c.prefix == null ? '₹' : c.prefix })), updated: new Date().toISOString() };
  const res = await put('/api/data/ctc/config', data);
  const st = $(stateSel);
  if (!res.ok) { if (st) st.textContent = res.status === 403 ? 'Only admins can change this.' : 'Not saved (' + res.status + ').'; return false; }
  config = { cfg: E.makeCfg(data.cfg), mw: E.makeMW(data.mw), fx: data.fx, updated: data.updated, updatedBy: (window.tcmplAccess && window.tcmplAccess.email) || '' };
  afterChange();
  if (!quiet) toast('Saved for every client.');
  return true;
}

function afterChange() {
  renderSetupCard();
  if (!$('#tab-ctc').hidden) renderCalcPage();
  window.dispatchEvent(new Event('tcmpl-ctc-change'));
}

/* ---------- for the Offer desk ---------- */
window.tcmplCTC = {
  engine: E,
  loaded: () => loaded,
  setupFor,
  ruleText,
  states: () => config.mw.map(r => r[0]),
  evaluate: (inp, id) => E.evaluate(inp, setupFor(id)),
  slipRows: (r, id) => slipRows(r, setupFor(id).fx),
  async refresh(id) { await loadClient(id || clientId()); window.dispatchEvent(new Event('tcmpl-ctc-change')); }
};

/* ---------- styles and start ---------- */
function style() {
  if ($('#ccStyle')) return;
  const st = document.createElement('style');
  st.id = 'ccStyle';
  st.textContent = `.cc-slip,.cc-mw,.cc-fx{width:100%;border-collapse:collapse;font-size:.9rem}
.cc-slip th,.cc-slip td,.cc-mw th,.cc-mw td,.cc-fx th,.cc-fx td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}
.cc-slip .num,.cc-mw .num,.cc-fx .num{text-align:right;font-variant-numeric:tabular-nums}
.cc-grp td{background:var(--teal-soft);font-weight:700;font-size:.78rem;letter-spacing:.05em;color:var(--teal-ink)}
.cc-tot td{background:var(--blue-soft);font-weight:700}
.cc-mw input{padding:4px 6px}`;
  document.head.append(st);
}

(async function start(n) {
  if (!$('#tab-ctc') || !$('#clientSel')) { if (n < 100) setTimeout(() => start(n + 1), 100); return; }
  style();
  const tabBtn = document.querySelector('nav.tabs button[data-tab="ctc"]');
  setTimeout(() => { if (tabBtn && tabBtn.parentNode) tabBtn.parentNode.append(tabBtn); }, 1500);
  await loadConfig();
  await loadClient(clientId());
  window.dispatchEvent(new Event('tcmpl-ctc-change'));
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab === 'ctc') renderCalcPage();
    if (b.dataset.tab === 'config') renderSetupCard();
  }));
  $('#clientSel').addEventListener('change', async () => {
    await loadClient(clientId());
    window.dispatchEvent(new Event('tcmpl-ctc-change'));
    if (!$('#tab-ctc').hidden) renderCalcPage();
    if (!$('#tab-config').hidden) renderSetupCard();
  });
  if (!$('#tab-config').hidden) renderSetupCard();
})(0);
