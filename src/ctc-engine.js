// TalentCarriage CTC engine: a faithful port of "TC CTC Calculator v22" (TC_CTC_Calculator_v22.html, 16 Nov 2026).
// Pure functions, no screen and no storage, so the Calculator page and the Offer desk get identical numbers.
// Loaded in the browser (window.TCCTC) and in Node tests (module.exports).
//
// What changed from the v22 file, on purpose:
//  - The per-client rules that v22 hardcodes by company code (C1008 no bonus/gratuity/ESIC, C1020 no bonus,
//    C1017 bonus 20%, C1021 minimum wage 15,100) are passed in as `rules`, set per client in Client setup.
//    KNOWN_CODE_RULES keeps v22's table so a client given one of those codes starts with the same rules.
//  - v22's own self-check expected PF on Basic only (Er PF 1,630 for wages 24,347); v22 computes PF on Basic + Other
//    allowance (Labour Codes "wages", 21 Nov 2025), giving Er PF 1,760. The engine keeps v22's behaviour and
//    SELF_TEST holds v22's actual figures.
(function (root) {
  'use strict';

  /* ---------- minimum wage master (49 state/zone rows x 4 skill categories) ---------- */
  const MW_SEED = [
["Andhra Pradesh Zone I","01-Oct-2025",12410,12812,13432,14267],
["Andhra Pradesh Zone II","01-Oct-2025",12080,12596,13012,13848],
["Andhra Pradesh Zone III","01-Oct-2025",12080,12596,13012,13848],
["Arunachal Pradesh Zone-I","01-Apr-2016",6000,6300,6600,null],
["Arunachal Pradesh Zone-II","01-Apr-2016",6600,6900,7200,null],
["Assam","01-Dec-2024",10344,12025,15032,19326],
["Bihar","01-Oct-2025",11128,11544,14066,17160],
["Chhattisgarh Zone I","01-Oct-2025",11176,11826,12606,13386],
["Chhattisgarh Zone II","01-Oct-2025",10916,11566,12346,13126],
["Chhattisgarh Zone III","01-Oct-2025",10656,11306,12086,12866],
["Delhi","01-Oct-2025",19846,21813,23905,null],
["Goa Zone I","01-Oct-2025",14300,15886,17316,null],
["Goa Zone II","01-Oct-2025",14170,15756,17186,null],
["Gujarat-Zone I","01-Oct-2026",13637,13897,14209,null],
["Gujarat-Zone II","01-Oct-2026",13351,13637,13897,null],
["Haryana Class A","01-Jul-2025",11275,11838,13052,14390],
["Haryana Class B","01-Jul-2025",11275,12430,13704,14390],
["Himachal Pradesh","01-Apr-2025",11820,13170,13620,14250],
["Jharkhand Area A","01-Oct-2025",13050,13692,18042,20802],
["Jharkhand Area B","01-Oct-2025",12437,13050,17205,19854],
["Jharkhand Area C","01-Oct-2025",11851,12437,16396,18906],
["Karnataka Zone I","01-Apr-2025",15701,16860,18134,19537],
["Karnataka Zone II","01-Apr-2025",15149,16253,17467,18802],
["Karnataka Zone III","01-Apr-2025",14624,15675,16831,18103],
["Karnataka Zone IV","01-Apr-2025",14124,15125,16226,17437],
["Kerala","",null,null,null,null],
["Madhya Pradesh","01-Oct-2025",12150,13146,14869,16494],
["Maharashtra Zone-I","01-Jul-2025",14155,14990,15766,null],
["Maharashtra Zone-II","01-Jul-2025",13039,13874,14650,null],
["Maharashtra Zone-III","01-Jul-2025",12442,13278,14054,null],
["Manipur","12-Mar-2025",12000,13200,14400,null],
["Meghalaya","01-Apr-2025",14066,15158,16224,17290],
["Mizoram","01-Apr-2023",10920,11960,14820,null],
["Nagaland","14-Jun-2019",5280,6300,7050,null],
["Odisha","01-Oct-2025",12012,13312,14612,15912],
["Punjab","01-Mar-2025",11390,12170,13067,14099],
["Rajasthan","01-Jan-2023",7410,7722,8034,9334],
["Sikkim","11-Jul-2022",13000,13520,13910,14690],
["Tamil Nadu Zone-A","01-Apr-2025",14004,14142,14193,14703],
["Tamil Nadu Zone-B","01-Apr-2025",13932,14066,14128,14641],
["Tamil Nadu Zone-C","01-Apr-2025",13854,13993,14066,14577],
["Tamil Nadu Zone-D","01-Apr-2025",13783,13932,14004,14527],
["Telangana","",null,null,null,null],
["Tripura","01-Oct-2025",8010,8787,9828,null],
["Uttarakhand (Towns >1 Lakh population)","01-Apr-2024",12539,13280,14023,null],
["Uttarakhand (Remaining parts of the State)","01-Apr-2024",12391,13110,13838,null],
["Uttar Pradesh","01-Oct-2025",11021,12123,13580,null],
["West Bengal Zone A","01-Jul-2025",10329,11363,12499,13748],
["West Bengal Zone B","01-Jul-2025",9760,10733,11807,12990]
];

  const CATS = ['UNSKILLED', 'SEMI-SKILLED', 'SKILLED', 'HIGHLY SKILLED'];
  // Revisions pushed onto saved masters, applied only while the row's "Revised" date differs (later manual edits stay).
  const MW_REVISIONS = [
    ['Gujarat-Zone I', '01-Oct-2026', 13637, 13897, 14209, null],
    ['Gujarat-Zone II', '01-Oct-2026', 13351, 13637, 13897, null]
  ];
  const KNOWN_CODE_RULES = {
    C1008: { noBonus: true, noGratuity: true, noESIC: true },
    C1020: { noBonus: true },
    C1017: { bonusPct: 0.20 },
    C1021: { mwOverride: 15100 }
  };
  const DEFAULT_CFG = {
    erPF: 0.12, eePF: 0.12, pfCap: 25000, pfCapOn: 'Y',
    bonusPct: 0.0833, bonusCeil: 21000,
    erESIC: 0.0325, eeESIC: 0.0075, esicCeil: 21000,
    gratuity: 0.0481, hraMetro: 0.50, hraNonMetro: 0.40, minBasicPct: 0.50
  };
  const CFG_META = [
    ['erPF', 'Employer PF %', 'pct'], ['eePF', 'Employee PF %', 'pct'],
    ['pfCap', 'PF wage ceiling ₹', 'num'], ['pfCapOn', 'Apply PF ceiling (Y/N)', 'yn'],
    ['bonusPct', 'Statutory bonus %', 'pct'], ['bonusCeil', 'Bonus eligibility ceiling ₹', 'num'],
    ['erESIC', 'Employer ESIC %', 'pct'], ['eeESIC', 'Employee ESIC %', 'pct'],
    ['esicCeil', 'ESIC gross ceiling ₹', 'num'],
    ['gratuity', 'Gratuity %', 'pct'], ['hraMetro', 'HRA metro %', 'pct'],
    ['hraNonMetro', 'HRA non-metro %', 'pct'], ['minBasicPct', 'Minimum basic % of wages', 'pct']
  ];
  const PF_CEIL_BASIS = 'On 25K';
  function normPfBasis(v) {
    const t = String(v == null ? '' : v).trim();
    if (/^on\s*(15|25)\s*k$/i.test(t) || /^on\s*(pf\s*)?ceiling$/i.test(t)) return PF_CEIL_BASIS;
    return t || PF_CEIL_BASIS;
  }

  // A saved config on top of the defaults; an old 15,000 PF ceiling is moved to 25,000 once (v22: pfCapV flag).
  function makeCfg(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const c = Object.assign({}, DEFAULT_CFG, s);
    if (s.pfCapV !== 2 && (s.pfCap == null || Number(s.pfCap) === 15000)) c.pfCap = 25000;
    c.pfCapV = 2;
    return c;
  }
  function makeMW(saved) {
    const mw = (Array.isArray(saved) && saved.length ? saved : MW_SEED).map(r => r.slice());
    MW_REVISIONS.forEach(rev => {
      const i = mw.findIndex(r => r[0] === rev[0]);
      if (i >= 0 && mw[i][1] !== rev[1]) mw[i] = rev.slice();
    });
    return mw;
  }

  /* ---------- engine ---------- */
  // v22 rounds every amount UP to the next rupee.
  const R = x => Math.ceil((Number(x) || 0) - 1e-9);
  const num = x => { const n = Number(x); return isFinite(n) ? n : 0; };

  function lookupMW(mw, stateName, category, rules) {
    if (rules && rules.mwOverride != null && rules.mwOverride !== '' && isFinite(Number(rules.mwOverride)) && Number(rules.mwOverride) > 0) return Number(rules.mwOverride);
    const row = (mw || MW_SEED).find(r => r[0] === stateName);
    if (!row) return 0;
    const idx = CATS.indexOf(category);
    if (idx < 0) return 0;
    return num(row[2 + idx]);
  }

  function calc(wages, mw, o, cfg, rules) {
    const c = cfg || DEFAULT_CFG;
    const rl = rules || {};
    const etype = o.etype || 'REGULAR EMP';
    const pfApp = o.pfApp || 'Y';
    const metro = o.metro || 'Y';
    const pfBasis = normPfBasis(o.pfBasis);
    const da = num(o.da);
    const fixed = num(o.fixed);
    const bonusOpt = o.bonusOpt === 'N' ? 'N' : 'Y';
    const incPct = Math.max(0, num(o.incent));
    const noBonus = Boolean(rl.noBonus);
    const noGratuity = Boolean(rl.noGratuity);
    const noESIC = Boolean(rl.noESIC);

    let basic;
    if (etype === 'CONSULTING FEE') basic = 0;
    else if (wages <= mw) basic = mw;
    else if ((wages - mw) >= wages * c.minBasicPct) basic = R(wages * c.minBasicPct);
    else basic = mw;
    basic = R(basic);

    const ceilingOn = (pfBasis === PF_CEIL_BASIS) || (c.pfCapOn === 'Y');
    const bonusRateOverride = rl.bonusPct != null && rl.bonusPct !== '' && isFinite(Number(rl.bonusPct)) ? Number(rl.bonusPct) : null;
    // Bonus: below the eligibility ceiling it applies even when the switch is N; with Y it is on actual Basic, no cap.
    const bonus = noBonus ? 0
      : bonusOpt === 'Y' ? R(basic * (bonusRateOverride !== null ? bonusRateOverride : c.bonusPct))
        : basic < c.bonusCeil ? R(basic * c.bonusPct) : 0;
    const hraPct = metro === 'Y' ? c.hraMetro : c.hraNonMetro;

    // PF wage = Basic + Other allowance; Other depends on Er PF, so iterate until both settle (a few passes).
    let pfWage = ceilingOn ? Math.min(basic, c.pfCap) : basic;
    let erPF = pfApp === 'Y' ? R(pfWage * c.erPF) : 0;
    let hra = 0, other = 0;
    for (let i = 0; i < 12; i++) {
      const room = wages - basic - da - erPF - bonus;
      hra = R(Math.min(basic * hraPct, room));
      other = etype === 'CONSULTING FEE' ? 0 : R(wages - basic - da - erPF - hra - fixed - bonus);
      const pfBase = basic + Math.max(0, other);
      const nextWage = ceilingOn ? Math.min(pfBase, c.pfCap) : pfBase;
      const nextErPF = pfApp === 'Y' ? R(nextWage * c.erPF) : 0;
      if (nextWage === pfWage && nextErPF === erPF) break;
      pfWage = nextWage; erPF = nextErPF;
    }

    const retainer = etype === 'REGULAR EMP' ? 0 : num(o.offered);
    const gross = basic + da + hra + fixed + other + retainer;
    const erESIC = noESIC ? 0 : (gross <= c.esicCeil ? R(gross * c.erESIC) : 0);
    const gratuity = noGratuity ? 0 : R(basic * c.gratuity);
    const socSec = erESIC + gratuity + bonus + erPF;
    const ctc = gross + socSec;
    const eePF = pfApp === 'Y' ? R(pfWage * c.eePF) : 0;
    const eeESIC = noESIC ? 0 : (gross >= c.esicCeil ? 0 : R(gross * c.eeESIC));
    const incent = R(ctc * incPct / 100);
    const ttc = ctc + incent;

    return {
      WAGES: wages, MW: mw, BASIC: basic, DA: da, PFWAGE: pfWage, ERPF: erPF, BONUS: bonus,
      HRA: hra, FIXED: fixed, OTHER: other, RETAINER: retainer, GROSS: gross,
      ERESIC: erESIC, GRATUITY: gratuity, SOCSEC: socSec, CTC: ctc,
      INCENTPCT: incPct, INCENT: incent, TTC: ttc,
      TOTALWAGES: gross + erPF + bonus,
      EEPF: eePF, EEESIC: eeESIC, TAKEHOME: gross - eePF - eeESIC
    };
  }

  // Reverse solvers: target CTC or Net Take Home -> Total Wages (converges in ~3 passes).
  function solveWages(key, target, mw, o, cfg, rules) {
    let u = target;
    for (let i = 0; i < 16; i++) {
      const r = calc(u, mw, o, cfg, rules);
      if (!r[key]) break;
      if (i > 2 && Math.abs(r[key] - target) <= 1) break;
      u = u * target / r[key];
    }
    return Math.round(u);
  }

  /* ---------- formula columns: tokenizer + shunting-yard + RPN (no eval) ---------- */
  const FN_ARITY = { IF: 3, MIN: -1, MAX: -1, ROUND: -1, ROUNDUP: -1, ROUNDDOWN: -1, ABS: 1, SUM: -1, AVG: -1, AND: -1, OR: -1, NOT: 1, SQRT: 1 };
  const PREC = { 'u-': 5, '^': 4, '*': 3, '/': 3, '%': 3, '+': 2, '-': 2, '<': 1, '>': 1, '<=': 1, '>=': 1, '=': 1, '<>': 1 };
  const RIGHT = { '^': true, 'u-': true };
  const BASE_KEYS = ['AMOUNT', 'WAGES', 'MW', 'BASIC', 'DA', 'PFWAGE', 'ERPF', 'BONUS', 'HRA', 'FIXED', 'OTHER', 'INCENT', 'TTC', 'INCENTPCT',
    'RETAINER', 'GROSS', 'ERESIC', 'GRATUITY', 'SOCSEC', 'CTC', 'TOTALWAGES', 'EEPF', 'EEESIC', 'TAKEHOME'];

  function tokenize(src) {
    const out = []; let i = 0;
    const prev = () => (out.length ? out[out.length - 1] : null);
    const unaryOK = () => { const p = prev(); return !p || p.t === 'op' || p.t === 'lp' || p.t === 'comma'; };
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '[') {
        const j = src.indexOf(']', i);
        if (j < 0) throw new Error('Unclosed [ bracket');
        out.push({ t: 'var', v: src.slice(i + 1, j).trim().toUpperCase() }); i = j + 1; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i; while (j < src.length && /[0-9._]/.test(src[j])) j++;
        out.push({ t: 'num', v: parseFloat(src.slice(i, j).replace(/_/g, '')) }); i = j; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j); i = j;
        let k = i; while (k < src.length && /\s/.test(src[k])) k++;
        if (src[k] === '(') { out.push({ t: 'fn', v: word.toUpperCase() }); i = k; } else out.push({ t: 'var', v: word.toUpperCase() });
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
      if (two === '!=') { out.push({ t: 'op', v: '<>' }); i += 2; continue; }
      if (two === '==') { out.push({ t: 'op', v: '=' }); i += 2; continue; }
      if ('+-*/^%<>='.includes(ch)) { out.push({ t: 'op', v: ch === '-' && unaryOK() ? 'u-' : ch }); i++; continue; }
      if (ch === '(') { out.push({ t: 'lp' }); i++; continue; }
      if (ch === ')') { out.push({ t: 'rp' }); i++; continue; }
      if (ch === ',' || ch === ';') { out.push({ t: 'comma' }); i++; continue; }
      throw new Error('Invalid character: ' + ch);
    }
    return out;
  }
  function toRPN(tokens) {
    const out = [], ops = [], argc = [];
    for (const tk of tokens) {
      if (tk.t === 'num' || tk.t === 'var') { out.push(tk); continue; }
      if (tk.t === 'fn') { ops.push(tk); argc.push(1); continue; }
      if (tk.t === 'comma') {
        while (ops.length && ops[ops.length - 1].t !== 'lp') out.push(ops.pop());
        if (!ops.length) throw new Error('Comma is not in a valid position');
        argc[argc.length - 1]++;
        continue;
      }
      if (tk.t === 'op') {
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top.t !== 'op') break;
          const higher = PREC[top.v] > PREC[tk.v];
          const equalLeft = PREC[top.v] === PREC[tk.v] && !RIGHT[tk.v];
          if (!(higher || equalLeft)) break;
          out.push(ops.pop());
        }
        ops.push(tk); continue;
      }
      if (tk.t === 'lp') { ops.push(tk); continue; }
      if (tk.t === 'rp') {
        while (ops.length && ops[ops.length - 1].t !== 'lp') out.push(ops.pop());
        if (!ops.length) throw new Error('Unmatched ) bracket');
        ops.pop();
        if (ops.length && ops[ops.length - 1].t === 'fn') { const fn = ops.pop(); out.push({ t: 'call', v: fn.v, n: argc.pop() }); }
        continue;
      }
    }
    while (ops.length) {
      const top = ops.pop();
      if (top.t === 'lp') throw new Error('Unclosed ( bracket');
      out.push(top);
    }
    return out;
  }
  function applyFn(name, a) {
    switch (name) {
      case 'IF': return a[0] ? a[1] : a[2];
      case 'MIN': return Math.min.apply(null, a);
      case 'MAX': return Math.max.apply(null, a);
      case 'ABS': return Math.abs(a[0]);
      case 'SQRT': return a[0] < 0 ? 0 : Math.sqrt(a[0]);
      case 'SUM': return a.reduce((s, x) => s + x, 0);
      case 'AVG': return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
      case 'AND': return a.every(Boolean) ? 1 : 0;
      case 'OR': return a.some(Boolean) ? 1 : 0;
      case 'NOT': return a[0] ? 0 : 1;
      case 'ROUND': { const d = a.length > 1 ? a[1] : 0, p = Math.pow(10, d); return Math.round(a[0] * p + 1e-9) / p; }
      case 'ROUNDUP': { const d = a.length > 1 ? a[1] : 0, p = Math.pow(10, d); return Math.ceil(a[0] * p - 1e-9) / p; }
      case 'ROUNDDOWN': { const d = a.length > 1 ? a[1] : 0, p = Math.pow(10, d); return Math.floor(a[0] * p + 1e-9) / p; }
      default: throw new Error('Unsupported function: ' + name);
    }
  }
  function runRPN(rpn, scope) {
    const st = [];
    const pop = () => { if (!st.length) throw new Error('Formula is incomplete'); return st.pop(); };
    for (const tk of rpn) {
      if (tk.t === 'num') { st.push(tk.v); continue; }
      if (tk.t === 'var') { st.push(num(scope[tk.v])); continue; }
      if (tk.t === 'op') {
        if (tk.v === 'u-') { st.push(-pop()); continue; }
        const b = pop(), a = pop();
        switch (tk.v) {
          case '+': st.push(a + b); break;
          case '-': st.push(a - b); break;
          case '*': st.push(a * b); break;
          case '/': st.push(b === 0 ? 0 : a / b); break;
          case '%': st.push(b === 0 ? 0 : a % b); break;
          case '^': st.push(Math.pow(a, b)); break;
          case '<': st.push(a < b ? 1 : 0); break;
          case '>': st.push(a > b ? 1 : 0); break;
          case '<=': st.push(a <= b ? 1 : 0); break;
          case '>=': st.push(a >= b ? 1 : 0); break;
          case '=': st.push(a === b ? 1 : 0); break;
          case '<>': st.push(a !== b ? 1 : 0); break;
          default: throw new Error('Unknown operator ' + tk.v);
        }
        continue;
      }
      if (tk.t === 'call') {
        if (!(tk.v in FN_ARITY)) throw new Error('Unsupported function: ' + tk.v);
        const args = [];
        for (let i = 0; i < tk.n; i++) args.unshift(pop());
        st.push(applyFn(tk.v, args));
        continue;
      }
    }
    if (st.length !== 1) throw new Error('Formula is unbalanced');
    return st[0];
  }
  function compile(expr) {
    const rpn = toRPN(tokenize(String(expr || '')));
    return scope => runRPN(rpn, scope);
  }
  // Each column in order; a column can use the ones before it. Errors give 0 (v22 behaviour).
  function applyFormulas(fx, scope) {
    for (const col of fx || []) {
      try { const v = compile(col.expr)(scope); scope[col.key] = isFinite(v) ? v : 0; } catch { scope[col.key] = 0; }
    }
    return scope;
  }
  function keyFromName(name, taken) {
    let base = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'COL';
    if (/^[0-9]/.test(base)) base = 'C_' + base;
    const used = new Set(BASE_KEYS.concat(taken || []));
    let key = base, n = 2;
    while (used.has(key)) key = base + '_' + (n++);
    return key;
  }

  /* ---------- one call for a whole structure ---------- */
  // input: { basis: 'WAGES'|'CTC'|'NETTH', amount (monthly), state, cat, etype, pfApp, metro, pfBasis, da, fixed, bonusOpt, incent }
  // setup: { cfg, mw, rules, fx }
  function evaluate(input, setup) {
    const s = setup || {};
    const cfg = s.cfg ? makeCfg(s.cfg) : DEFAULT_CFG;
    const mwTable = s.mw ? s.mw : MW_SEED;
    const i = input || {};
    const mw = lookupMW(mwTable, i.state, i.cat, s.rules);
    const opts = { etype: i.etype, pfApp: i.pfApp, metro: i.metro, pfBasis: i.pfBasis, da: i.da, fixed: i.fixed, offered: num(i.amount), bonusOpt: i.bonusOpt, incent: i.incent };
    const amount = num(i.amount);
    const wages = i.basis === 'CTC' ? solveWages('CTC', amount, mw, opts, cfg, s.rules)
      : i.basis === 'NETTH' ? solveWages('TAKEHOME', amount, mw, opts, cfg, s.rules)
        : amount;
    const r = calc(wages, mw, opts, cfg, s.rules);
    r.AMOUNT = amount;
    applyFormulas(s.fx, r);
    r.warnings = [];
    if (!mw) r.warnings.push('no_minimum_wage');
    // v22 warns when Other allowance turns negative; wages under the minimum wage show up as a negative HRA too.
    if (r.OTHER < 0 || r.HRA < 0 || (mw && i.etype !== 'CONSULTING FEE' && wages < mw)) r.warnings.push('below_minimum_wage');
    return r;
  }

  // The salary statement, in v22's order: [kind, label, key]. kind: grp | row | tot.
  const SLIP = [
    ['grp', 'EARNINGS (Gross)'],
    ['row', 'Basic', 'BASIC'], ['row', 'Dearness Allowance', 'DA'], ['row', 'House Rent Allowance', 'HRA'],
    ['row', 'Other Fixed Heads', 'FIXED'], ['row', 'Other Allowance', 'OTHER'],
    ['row', 'Retainer / Consulting Fee', 'RETAINER'],
    ['tot', 'GROSS', 'GROSS'],
    ['grp', 'EMPLOYER STATUTORY COST'],
    ['row', 'Employer PF', 'ERPF'], ['row', 'Employer ESIC', 'ERESIC'],
    ['row', 'Statutory Bonus', 'BONUS'], ['row', 'Gratuity', 'GRATUITY'],
    ['tot', 'SOCIAL SECURITY', 'SOCSEC'],
    ['grp', 'COST TO COMPANY'],
    ['row', 'Cost to Company (CTC)', 'CTC'], ['row', 'Incentive (% of CTC)', 'INCENT'],
    ['tot', 'TOTAL TARGET COST (TTC)', 'TTC'],
    ['grp', 'EMPLOYEE DEDUCTIONS'],
    ['row', 'Employee PF', 'EEPF'], ['row', 'Employee ESIC', 'EEESIC'],
    ['tot', 'NET TAKE HOME', 'TAKEHOME']
  ];

  // v22's own sample (wages 24,347, minimum wage 13,585, metro, PF on 25K), with v22's actual results.
  const SELF_TEST = {
    input: [24347, 13585, { etype: 'REGULAR EMP', pfApp: 'Y', metro: 'Y', pfBasis: 'On 25K', da: 0, fixed: 0 }],
    want: { BASIC: 13585, ERPF: 1760, BONUS: 1132, HRA: 6793, OTHER: 1077, GROSS: 21455, GRATUITY: 654, SOCSEC: 3546, CTC: 25001, TOTALWAGES: 24347, TAKEHOME: 19695 }
  };
  function selfTest() {
    const g = calc.apply(null, SELF_TEST.input);
    return Object.keys(SELF_TEST.want).filter(k => g[k] !== SELF_TEST.want[k]).map(k => `${k} got ${g[k]} want ${SELF_TEST.want[k]}`);
  }

  const api = {
    VERSION: 'v22', MW_SEED, MW_REVISIONS, CATS, KNOWN_CODE_RULES, DEFAULT_CFG, CFG_META, PF_CEIL_BASIS, SLIP, BASE_KEYS, FN_ARITY,
    makeCfg, makeMW, normPfBasis, lookupMW, calc, solveWages, evaluate, compile, applyFormulas, keyFromName, selfTest
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.TCCTC = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
