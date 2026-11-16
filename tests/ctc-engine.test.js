import test from 'node:test';
import assert from 'node:assert/strict';
await import('../src/ctc-engine.js');
const E = globalThis.TCCTC;

// Outputs of the original TC_CTC_Calculator_v22.html for these inputs (the client codes are v22's hardcoded rules).
const GOLD = [
  {"code":null,"input":{"basis":"WAGES","amount":24347,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":24347,"MW":13897,"BASIC":13897,"DA":0,"PFWAGE":14500,"ERPF":1740,"BONUS":1158,"HRA":6949,"FIXED":0,"OTHER":603,"RETAINER":0,"GROSS":21449,"ERESIC":0,"GRATUITY":669,"SOCSEC":3567,"CTC":25016,"INCENTPCT":0,"INCENT":0,"TTC":25016,"TOTALWAGES":24347,"EEPF":1740,"EEESIC":0,"TAKEHOME":19709}},
  {"code":null,"input":{"basis":"CTC","amount":30000,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":29295,"MW":13897,"BASIC":14648,"DA":0,"PFWAGE":18526,"ERPF":2224,"BONUS":1221,"HRA":7324,"FIXED":0,"OTHER":3878,"RETAINER":0,"GROSS":25850,"ERESIC":0,"GRATUITY":705,"SOCSEC":4150,"CTC":30000,"INCENTPCT":0,"INCENT":0,"TTC":30000,"TOTALWAGES":29295,"EEPF":2224,"EEESIC":0,"TAKEHOME":23626}},
  {"code":null,"input":{"basis":"NETTH","amount":18000,"state":"Delhi","cat":"SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"N","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":25612,"MW":23905,"BASIC":23905,"DA":0,"PFWAGE":23905,"ERPF":2869,"BONUS":1992,"HRA":-3154,"FIXED":0,"OTHER":0,"RETAINER":0,"GROSS":20751,"ERESIC":675,"GRATUITY":1150,"SOCSEC":6686,"CTC":27437,"INCENTPCT":0,"INCENT":0,"TTC":27437,"TOTALWAGES":25612,"EEPF":2869,"EEESIC":156,"TAKEHOME":17726}},
  {"code":null,"input":{"basis":"CTC","amount":85000,"state":"Karnataka Zone I","cat":"HIGHLY SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On Actual Basic","da":0,"fixed":0,"bonusOpt":"Y","incent":10},"want":{"WAGES":83002,"MW":19537,"BASIC":41501,"DA":0,"PFWAGE":25000,"ERPF":3000,"BONUS":3458,"HRA":20751,"FIXED":0,"OTHER":14292,"RETAINER":0,"GROSS":76544,"ERESIC":0,"GRATUITY":1997,"SOCSEC":8455,"CTC":84999,"INCENTPCT":10,"INCENT":8500,"TTC":93499,"TOTALWAGES":83002,"EEPF":3000,"EEESIC":0,"TAKEHOME":73544}},
  {"code":null,"input":{"basis":"WAGES","amount":15000,"state":"Maharashtra Zone-I","cat":"UNSKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"N","incent":0},"want":{"WAGES":15000,"MW":14155,"BASIC":14155,"DA":0,"PFWAGE":14155,"ERPF":1699,"BONUS":1180,"HRA":-2034,"FIXED":0,"OTHER":0,"RETAINER":0,"GROSS":12121,"ERESIC":394,"GRATUITY":681,"SOCSEC":3954,"CTC":16075,"INCENTPCT":0,"INCENT":0,"TTC":16075,"TOTALWAGES":15000,"EEPF":1699,"EEESIC":91,"TAKEHOME":10331}},
  {"code":null,"input":{"basis":"WAGES","amount":40000,"state":"Tamil Nadu Zone-A","cat":"SKILLED","etype":"CONSULTING FEE","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":40000,"MW":14193,"BASIC":0,"DA":0,"PFWAGE":0,"ERPF":0,"BONUS":0,"HRA":0,"FIXED":0,"OTHER":0,"RETAINER":40000,"GROSS":40000,"ERESIC":0,"GRATUITY":0,"SOCSEC":0,"CTC":40000,"INCENTPCT":0,"INCENT":0,"TTC":40000,"TOTALWAGES":40000,"EEPF":0,"EEESIC":0,"TAKEHOME":40000}},
  {"code":null,"input":{"basis":"WAGES","amount":30000,"state":"Bihar","cat":"SKILLED","etype":"RETAINER","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":1000,"fixed":1500,"bonusOpt":"Y","incent":0},"want":{"WAGES":30000,"MW":14066,"BASIC":15000,"DA":1000,"PFWAGE":16741,"ERPF":2009,"BONUS":1250,"HRA":7500,"FIXED":1500,"OTHER":1741,"RETAINER":30000,"GROSS":56741,"ERESIC":0,"GRATUITY":722,"SOCSEC":3981,"CTC":60722,"INCENTPCT":0,"INCENT":0,"TTC":60722,"TOTALWAGES":60000,"EEPF":2009,"EEESIC":0,"TAKEHOME":54732}},
  {"code":"C1008","input":{"basis":"CTC","amount":25000,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":25000,"MW":13897,"BASIC":13897,"DA":0,"PFWAGE":16116,"ERPF":1934,"BONUS":0,"HRA":6949,"FIXED":0,"OTHER":2219,"RETAINER":0,"GROSS":23065,"ERESIC":0,"GRATUITY":0,"SOCSEC":1934,"CTC":24999,"INCENTPCT":0,"INCENT":0,"TTC":24999,"TOTALWAGES":24999,"EEPF":1934,"EEESIC":0,"TAKEHOME":21131}},
  {"code":"C1020","input":{"basis":"CTC","amount":25000,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":24331,"MW":13897,"BASIC":13897,"DA":0,"PFWAGE":15519,"ERPF":1863,"BONUS":0,"HRA":6949,"FIXED":0,"OTHER":1622,"RETAINER":0,"GROSS":22468,"ERESIC":0,"GRATUITY":669,"SOCSEC":2532,"CTC":25000,"INCENTPCT":0,"INCENT":0,"TTC":25000,"TOTALWAGES":24331,"EEPF":1863,"EEESIC":0,"TAKEHOME":20605}},
  {"code":"C1017","input":{"basis":"CTC","amount":25000,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":23704,"MW":13897,"BASIC":13897,"DA":0,"PFWAGE":13897,"ERPF":1668,"BONUS":2780,"HRA":5359,"FIXED":0,"OTHER":0,"RETAINER":0,"GROSS":19256,"ERESIC":626,"GRATUITY":669,"SOCSEC":5743,"CTC":24999,"INCENTPCT":0,"INCENT":0,"TTC":24999,"TOTALWAGES":23704,"EEPF":1668,"EEESIC":145,"TAKEHOME":17443}},
  {"code":"C1021","input":{"basis":"WAGES","amount":22000,"state":"Gujarat-Zone I","cat":"SEMI-SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":22000,"MW":15100,"BASIC":15100,"DA":0,"PFWAGE":15100,"ERPF":1812,"BONUS":1258,"HRA":3830,"FIXED":0,"OTHER":0,"RETAINER":0,"GROSS":18930,"ERESIC":616,"GRATUITY":727,"SOCSEC":4413,"CTC":23343,"INCENTPCT":0,"INCENT":0,"TTC":23343,"TOTALWAGES":22000,"EEPF":1812,"EEESIC":142,"TAKEHOME":16976}},
  {"code":null,"input":{"basis":"CTC","amount":25000,"state":"Kerala","cat":"SKILLED","etype":"REGULAR EMP","pfApp":"Y","metro":"Y","pfBasis":"On 25K","da":0,"fixed":0,"bonusOpt":"Y","incent":0},"want":{"WAGES":24411,"MW":0,"BASIC":12206,"DA":0,"PFWAGE":15438,"ERPF":1853,"BONUS":1017,"HRA":6103,"FIXED":0,"OTHER":3232,"RETAINER":0,"GROSS":21541,"ERESIC":0,"GRATUITY":588,"SOCSEC":3458,"CTC":24999,"INCENTPCT":0,"INCENT":0,"TTC":24999,"TOTALWAGES":24411,"EEPF":1853,"EEESIC":0,"TAKEHOME":19688}}
];

test('CTC engine matches the v22 calculator exactly', () => {
  for (const g of GOLD) {
    const rules = (g.code && E.KNOWN_CODE_RULES[g.code]) || {};
    const r = E.evaluate(g.input, { rules });
    for (const k of Object.keys(g.want)) assert.equal(r[k] + 0, g.want[k], `${g.code || '-'} ${g.input.basis} ${g.input.amount} ${k}`);
  }
});

test('CTC engine: self-check, solvers, warnings', () => {
  assert.deepEqual(E.selfTest(), []);
  const ctc = E.evaluate({ basis: 'CTC', amount: 45000, state: 'Delhi', cat: 'SKILLED' }, {});
  assert.ok(Math.abs(ctc.CTC - 45000) <= 1);
  const th = E.evaluate({ basis: 'NETTH', amount: 30000, state: 'Delhi', cat: 'SKILLED' }, {});
  assert.ok(Math.abs(th.TAKEHOME - 30000) <= 1);
  assert.ok(E.evaluate({ basis: 'WAGES', amount: 20000, state: 'Kerala', cat: 'SKILLED' }, {}).warnings.includes('no_minimum_wage'));
  assert.ok(E.evaluate({ basis: 'WAGES', amount: 9000, state: 'Delhi', cat: 'SKILLED' }, {}).warnings.includes('below_minimum_wage'));
});

test('CTC engine: saved config, revisions, client minimum wage', () => {
  const cfg = E.makeCfg({ pfCap: 15000 });
  assert.equal(cfg.pfCap, 25000, 'an old 15,000 ceiling moves to 25,000 once');
  assert.equal(E.makeCfg({ pfCap: 15000, pfCapV: 2 }).pfCap, 15000, 'a deliberate later edit stays');
  const old = E.MW_SEED.map(r => r.slice()); old[13] = ['Gujarat-Zone I', '01-Apr-2025', 1, 2, 3, null];
  assert.deepEqual(E.makeMW(old)[13], ['Gujarat-Zone I', '01-Oct-2026', 13637, 13897, 14209, null]);
  assert.equal(E.lookupMW(E.MW_SEED, 'Delhi', 'SKILLED', { mwOverride: 15100 }), 15100);
  assert.equal(E.lookupMW(E.MW_SEED, 'Delhi', 'SKILLED', {}), 23905);
});

test('CTC engine: formula columns (no eval) and safe failures', () => {
  const r = E.evaluate({ basis: 'WAGES', amount: 24347, state: 'Gujarat-Zone I', cat: 'SEMI-SKILLED' }, {
    fx: [{ name: 'Annual CTC', key: 'ANNUAL_CTC', expr: '[CTC] * 12' }, { name: 'Share', key: 'SHARE', expr: 'ROUND([TAKEHOME] / [ANNUAL_CTC] * 1200, 1)' },
      { name: 'Bad', key: 'BAD', expr: 'alert(1)' }, { name: 'Cond', key: 'COND', expr: 'IF([BASIC] > 21000, 0, ROUND([BASIC] * 0.0833, 0))' }]
  });
  assert.equal(r.ANNUAL_CTC, r.CTC * 12);
  assert.equal(r.SHARE, Math.round(r.TAKEHOME / (r.CTC * 12) * 1200 * 10) / 10);
  assert.equal(r.BAD, 0, 'unknown functions give 0');
  assert.equal(r.COND, Math.round(r.BASIC * 0.0833));
  assert.throws(() => E.compile('[CTC] * (2'), /Unclosed/);
  assert.equal(E.keyFromName('Annual CTC', ['ANNUAL_CTC']), 'ANNUAL_CTC_2');
  assert.equal(E.keyFromName('CTC'), 'CTC_2');
});
