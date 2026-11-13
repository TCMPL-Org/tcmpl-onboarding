
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>{const v=Math.round(n);return '₹'+(v===0?0:v).toLocaleString('en-IN');};
const DAY=86400000;
const fmtD=d=>d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
const fmtShort=d=>d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});

/* ---------- Tax and pay rules (soft-coded; update each year from public sources) ---------- */
const RULES={
  taxYear:'2026-27', regime:'New tax regime (default)', checked:'24 Oct 2026',
  stdDeduction:75000,
  slabs:[[400000,0],[800000,.05],[1200000,.10],[1600000,.15],[2000000,.20],[2400000,.25],[Infinity,.30]],
  rebate:{incomeLimit:1200000,max:60000,marginalRelief:true},
  surcharge:[[5000000,.10],[10000000,.15],[20000000,.25]],
  cess:.04,
  employerNpsDeductionPctOfBasic:.14,
  pf:{rate:.12,ceilingMonthly:15000},
  esic:{grossCeilingMonthly:21000,employee:.0075,employer:.0325},
  gratuityPctOfBasic:.0481,
  labourCodeWagesMin:.5,
  pt:{ 'Haryana':0,'Delhi':0,'Uttar Pradesh':0,'Rajasthan':0,'Karnataka':2400,'Maharashtra':2500,'Tamil Nadu':2500,'Telangana':2400,'West Bengal':2400,'Gujarat':2400 },
  sources:'Slabs, ₹75,000 standard deduction, rebate up to ₹12 lakh and 4% cess as published for tax year 2026-27 (retained in Budget 2026). Professional tax shown at simplified annual state amounts.'
};
function slabTax(ti){let t=0,prev=0;for(const [cap,r] of RULES.slabs){if(ti>prev)t+=(Math.min(ti,cap)-prev)*r;prev=cap;}return t;}
function incomeTax(ti){
  ti=Math.max(0,ti); let t=slabTax(ti), relief='';
  if(ti<=RULES.rebate.incomeLimit){ if(t>0) relief='Rebate brings tax to nil (taxable income up to ₹12 lakh)'; t=Math.max(0,t-RULES.rebate.max); }
  else if(RULES.rebate.marginalRelief && t>ti-RULES.rebate.incomeLimit){ t=ti-RULES.rebate.incomeLimit; relief='Marginal relief applied just above ₹12 lakh'; }
  let s=0;
  for(let i=RULES.surcharge.length-1;i>=0;i--){const [th,r]=RULES.surcharge[i]; if(ti>th){ s=t*r; const pr=i>0?RULES.surcharge[i-1][1]:0; const atTh=slabTax(th)*(1+pr); if(t+s>atTh+(ti-th)) s=Math.max(0,atTh+(ti-th)-t); break; }}
  const cess=(t+s)*RULES.cess;
  return {slab:slabTax(ti),tax:t,surcharge:s,cess,total:Math.round(t+s+cess),relief};
}
function buildOffer(o){
  const variable=o.ctc*o.varPct/100, fixed=o.ctc-variable, bp=o.basicPct/100, np=o.npsPct/100;
  let G=fixed/1.15, basic=0,pfWage=0,erPF=0,nps=0,grat=0,erESI=0,esic=false;
  for(let i=0;i<40;i++){
    basic=G*bp; pfWage=o.pf==='capped'?Math.min(basic,RULES.pf.ceilingMonthly*12):basic;
    erPF=RULES.pf.rate*pfWage; nps=np*basic; grat=o.grat?RULES.gratuityPctOfBasic*basic:0;
    esic=G/12<=RULES.esic.grossCeilingMonthly; erESI=esic?RULES.esic.employer*G:0;
    G=fixed-erPF-nps-grat-erESI;
  }
  basic=G*bp; const hra=basic*(o.metro?.5:.4), special=G-basic-hra;
  const eePF=RULES.pf.rate*pfWage, eeESI=esic?RULES.esic.employee*G:0, pt=RULES.pt[o.state]??0;
  const npsDed=Math.min(nps,RULES.employerNpsDeductionPctOfBasic*basic);
  const taxable=Math.max(0,G+nps-npsDed-RULES.stdDeduction);
  const tax=incomeTax(taxable);
  const takeHomeAnnual=G-eePF-eeESI-pt-tax.total;
  return {variable,fixed,G,basic,hra,special,erPF,nps,grat,erESI,esic,eePF,eeESI,pt,taxable,tax,takeHomeAnnual,monthly:takeHomeAnnual/12,wageShare:basic/G};
}
window.__tcmpl={incomeTax,buildOffer,RULES};

/* ---------- TCMPL default and client overrides ---------- */
const DEFAULT={
  company:'Your Company Pvt. Ltd.', short:'Your Company', agentName:'Onboarding Assistant', initials:'YC',
  languages:'English, Hindi', tone:'Warm and professional', voice:'Plivo calling · Sarvam Indian-language voice',
  offerMode:'both', autoStart:'Yes, immediately after offer release', approvals:'Single approver (hiring manager)',
  docs:'Signed offer letter; Aadhaar (masked); PAN; Bank proof; Last 3 payslips; Resignation acceptance or relieving letter; Education certificates; Passport photo; UAN (if any)',
  kycTool:'Client HRMS document vault', kycMode:'WhatsApp photo or secure upload link',
  surveys:'TCMPL micro-pulse: 2 questions on Day 1, 15, 30, 45, 60, 75 and 90',
  mapLink:'', sv_d1:'How was your first day?', sv_d15:'Is your role turning out as you expected?', sv_d45:'How well are you settling in with your team?', sv_d60:'Do you get enough time with your manager?', sv_d75:'Would you recommend joining us to a friend?',
  recruiter:'Recruiter (client)', itSpoc:'IT SPOC', adminSpoc:'Admin SPOC', securitySpoc:'Security SPOC', payrollSpoc:'Talent Carriage Payroll CoE',
  address:'Head office reception', mapQuery:'', reportTime:'9:30 AM', meet:'HR Executive at reception', dress:'Business casual', bring:'Original photo ID, PAN card, two passport photos, bank proof',
  salaryDate:'Last working day of the month', probation:'6 months', leave:'Shared on Day 1 as per company policy', canteen:'Details shared on Day 1', parking:'Details shared on Day 1',
  about:'Your Company is a growing Indian enterprise. Client-specific history, values and leadership messages are added during setup.',
  managerName:'Your manager', buddy:'Assigned by your manager before Day 1',
  companyAddress:'Registered office address', location:'', workWeek:'Monday to Friday', holidays:'10', noticeProbation:"one month's", noticeConfirmed:"three months'", retirementAge:'58', jurisdiction:'the city of the registered office', signatory:'Authorised signatory',
  callbackSla:'Call within 4 working hours; reminder at 4 h; escalate to client HR head at 24 h',
  faq:[
    ['Tax regime choice','regime|old tax|new tax|which tax','The new tax regime is the default. You tell us your choice for this year so the right tax is deducted from your salary each month. As a salaried employee you can still choose old or new each year when you file your income-tax return. The new regime has lower rates but few deductions; the old one allows deductions such as 80C and HRA.'],
    ['PF nomination','nominat|nominee|form 2','PF nomination (Form 2) tells EPFO who receives your PF and pension if something happens to you. If you have a family, PF rules require you to nominate family members, such as your spouse, children or dependent parents. You can split the share in percentages and change it later on the EPFO member portal using your UAN.'],
    ['Gratuity nomination','gratuity|form f','Gratuity nomination (Form F) names who receives your gratuity. You can nominate one or more family members and give each a share. It is filled once at joining and can be updated later through HR.'],
    ['PF declaration and UAN','uan|form 11|previous pf|pf transfer|old pf','Form 11 asks whether you had a PF account before. If yes, share your UAN so the same account continues; your old balance can be transferred online later. If this is your first job, leave it blank and a new UAN is created for you.'],
    ['Income from previous employer','previous employer|form 12b|earlier salary|last company','If you worked earlier this financial year, share the salary paid and tax deducted by your previous employer (often called Form 12B). Payroll then deducts the right tax for the full year, so there is no surprise at year end.'],
    ['ESI family details','esi|esic|dispensary','If your gross salary is ₹21,000 a month or less, you are covered under ESI. Add the family members you want covered for medical care; they can then use ESI dispensaries and hospitals.'],
    ['Bank account','bank|ifsc|account number|cheque|passbook','Salary is paid into a savings account in your own name. Share a cancelled cheque or the first page of your passbook showing your name, account number and IFSC.']
  ],
  cadence:{offer:'O+0',docs:'O+1',forms:'O+2',confirm:'O+3',resign:'O+4',story:'D-21',checkin:'D-14',manager_intro:'D-10',induct:'D-7',day1kit:'D-3',call:'D-1',welcome:'D+0',survey_d1:'D+1',week1:'D+7',pulse15:'D+15',pulse30:'D+30',pulse45:'D+45',pulse60:'D+60',pulse75:'D+75',final90:'D+90',m_prep:'D-7',m_prep2:'D-2',m_1on1:'D+14',m_goals:'D+30',m_prob:'D+75',it_15:'D-15',it_7:'D-7',it_2:'D-2',ann:'D-1',stat:'D+0'},
  off:[],
  slides:[
    ['Welcome','Welcome to Your Company','This short induction is set up for each client: history, leadership message, values and what your first weeks look like.'],
    ['Our story','Where we come from','The client adds its founding story, milestones and the customers it serves.'],
    ['Values','How we work','The client lists its values with one real example of each.'],
    ['Your first 90 days','What to expect','Day 1 induction, week-1 buddy, goals agreed by Day 30, probation review before Day 180.'],
    ['Help','Who to ask','HR questions on this WhatsApp number at any time. Payroll queries go to the Talent Carriage helpdesk.']
  ],
  quiz:[
    ['How long is the probation period?',['3 months','6 months','12 months'],1],
    ['Where do you send HR questions after joining?',['Only by email to HR','This WhatsApp number','Your manager only'],1],
    ['By when are your first goals agreed?',['Day 7','Day 30','Day 90'],1],
    ['What should you bring on Day 1?',['Nothing','Original photo ID, PAN and bank proof','Your previous laptop'],1],
    ['Who is your first contact on Day 1?',['The CEO','HR Executive at reception','Security guard'],1]
  ]
};
const CLIENTS=[
  {id:'default',label:'TCMPL default template',ov:{}},
  {id:'northpeak',label:'Northpeak Logistics (demo)',ov:{
    company:'Northpeak Logistics Pvt. Ltd.', short:'Northpeak', agentName:'Northpeak HR', initials:'NP', languages:'English, Hindi',
    offerMode:'make', kycTool:'HROne document module', recruiter:'Neha Kapoor, Talent Acquisition', itSpoc:'Rohit Verma, IT', adminSpoc:'Sunil Yadav, Admin', securitySpoc:'Front-desk security',
    address:'Northpeak Logistics, Tower B reception, Sector 44, Gurugram', mapQuery:'Sector 44 Gurugram', mapLink:'https://www.google.com/maps/search/?api=1&query=Sector+44+Gurugram', integration:{mode:'api',hrms:'HROne'}, reportTime:'9:30 AM', meet:'Priya Malhotra, HR Business Partner', dress:'Business casual. Safety shoes are issued for warehouse visits.',
    canteen:'Subsidised cafeteria on the ground floor, 12:30 to 2:30 PM', parking:'Two-wheeler and car parking in basement B1; register your vehicle on Day 1',
    about:'Northpeak Logistics was founded in 2009 in Gurugram and runs 14 warehouses across North India for e-commerce and FMCG customers.',
    managerName:'Arjun Mehta, Finance Controller', companyAddress:'Tower B, Sector 44, Gurugram, Haryana 122003', location:'Gurugram', jurisdiction:'Gurugram', signatory:'Priya Malhotra, HR Business Partner',
    cadence:{story:'D-18', call:'D-1'},
    slides:[
      ['Welcome','Welcome to Northpeak','A two-minute introduction from our founder and what we expect you to feel on Day 1: welcomed, ready and clear about your role.'],
      ['Our story','From one warehouse to fourteen','Started in 2009 with a single 40,000 sq ft warehouse in Manesar. Today we run 14 sites across North India.'],
      ['Values','Safety first, own the outcome, customer obsessed, be straight','Safety comes first in every warehouse and every meeting. We own outcomes, not tasks.'],
      ['Your first 90 days','What to expect','Day 1 induction and site tour, a buddy for your first month, goals agreed by Day 30, probation review at 6 months.'],
      ['Help','Who to ask','HR questions on this WhatsApp number. Payroll queries go to the Talent Carriage helpdesk, which runs our payroll.']
    ],
    quiz:[
      ['When was Northpeak founded?',['2001','2009','2016'],1],
      ['How many warehouses does Northpeak run?',['6','14','30'],1],
      ['Which value comes first at Northpeak?',['Customer obsessed','Safety first','Be straight'],1],
      ['Who runs Northpeak payroll queries?',['Your manager','Talent Carriage helpdesk','The bank'],1],
      ['How long is probation?',['3 months','6 months','12 months'],1]
    ]
  }},
  {id:'lotus',label:'Lotus Valley Hospitals (demo)',ov:{
    company:'Lotus Valley Hospitals Pvt. Ltd.', short:'Lotus Valley', agentName:'Lotus Valley HR', initials:'LV', languages:'English, Kannada, Hindi', tone:'Caring and simple',
    offerMode:'upload', kycTool:'Adrenalin HRMS (daily file upload)', recruiter:'Kavya Rao, HR Recruitment', itSpoc:'HIS access team', adminSpoc:'Uniform and locker desk', securitySpoc:'Badge office',
    docs:'Signed offer letter; Aadhaar (masked); PAN; Bank proof; Nursing council registration; Last 3 payslips; Relieving letter; Education certificates; Vaccination record (Hepatitis B); Passport photo',
    address:'Lotus Valley Hospitals, Block B ground floor HR office, Whitefield, Bengaluru', mapQuery:'Whitefield Bengaluru', mapLink:'https://www.google.com/maps/search/?api=1&query=Whitefield+Bengaluru', integration:{mode:'file',hrms:'Adrenalin'}, reportTime:'8:30 AM', meet:'Shalini Rao, HR Executive', dress:'Formal for Day 1. Uniform and ID badge are issued on Day 1 for clinical staff.',
    canteen:'Staff canteen open round the clock; meals subsidised for night shifts', parking:'Staff parking at Gate 3', probation:'6 months',
    about:'Lotus Valley Hospitals was founded in 1998 in Bengaluru and runs three hospitals with 620 beds.',
    managerName:'Sr. Mary Joseph, Nursing Superintendent', companyAddress:'Whitefield Main Road, Bengaluru, Karnataka 560066', location:'Bengaluru', workWeek:'six days a week on rotational shifts', jurisdiction:'Bengaluru', signatory:'Shalini Rao, HR Executive', buddy:'A senior nurse from your ward for your first 4 months',
    cadence:{story:'D-14', checkin:'D-10'},
    slides:[
      ['Welcome','Welcome to Lotus Valley','A message from our Medical Director on why every new colleague matters to our patients.'],
      ['Our story','Since 1998','Founded in Bengaluru in 1998. Three hospitals, 620 beds, and a nursing school that trains 120 nurses a year.'],
      ['Values','Compassion, safety, integrity, learning','Patient safety is everyone\'s job. Hand hygiene is checked on every ward, every shift.'],
      ['Your first 90 days','What to expect','Classroom induction for 3 days, then 10 weeks on your ward with a buddy nurse. Competency sign-off before independent duty.'],
      ['Help','Who to ask','HR questions on this WhatsApp number in English, Kannada or Hindi.']
    ],
    quiz:[
      ['When was Lotus Valley founded?',['1998','2008','2015'],0],
      ['How many beds across our hospitals?',['220','620','1,200'],1],
      ['Who is responsible for patient safety?',['Only doctors','Everyone','Quality team only'],1],
      ['How long is ward training with a buddy?',['2 weeks','10 weeks','6 months'],1],
      ['When is your uniform issued?',['Before joining','On Day 1','After probation'],1]
    ]
  }}
];
const DEMO_CAND={
  default:{name:'Ritika Sharma',mobile:'+91 98100 00000',email:'ritika.sharma@example.com',role:'Senior Executive, Finance',grade:'JG03',state:'Haryana',mgr:'Your manager',ctc:960000,struct:'std-50'},
  northpeak:{name:'Ritika Sharma',mobile:'+91 98100 00000',email:'ritika.sharma@example.com',role:'Senior Executive, Finance',grade:'JG03',state:'Haryana',mgr:'Arjun Mehta',ctc:960000,struct:'std-50'},
  lotus:{name:'Anjali Gowda',mobile:'+91 99000 00000',email:'anjali.gowda@example.com',role:'Staff Nurse, ICU',grade:'JG02',state:'Karnataka',mgr:'Sr. Mary Joseph',ctc:240000,struct:'std-esic'}
};
let client=CLIENTS[1];
const cv=k=>{ const o=client.ov; if(k==='cadence') return Object.assign({},DEFAULT.cadence,o.cadence||{}); if(k==='docs'&&o.docList) return o.docList.filter(d=>!d.off&&d.text).map(d=>d.text).join('; '); if((o.hidden||[]).includes(k)) return ''; return o[k]!==undefined?o[k]:DEFAULT[k]; };

/* ---------- Tabs ---------- */
function showTab(t){ $$('nav.tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===t)); $$('section.tab').forEach(s=>s.hidden=s.id!=='tab-'+t); if(t==='hr')renderHR(); if(t==='ready')renderReady(); if(t==='config'){renderConfig();renderLib();} if(t==='forms'){ renderForms(); updateExportLabel(); } }
$$('nav.tabs button').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));

/* ---------- Shared library, saving, currency, font size, files ---------- */
const FX_SEED={date:'2026-10-23',source:'Public reference rates (currency-api)',rates:{USD:0.010550507,AED:0.038746735,SAR:0.0395644,QAR:0.038403844,OMR:0.0040590663,KWD:0.003276718,BHD:0.0039669905,EUR:0.0094086517,GBP:0.0078766668,SGD:0.013479868,AUD:0.01504137,CAD:0.014778884,JPY:1.65584287,MYR:0.043085685,CHF:0.0086640057}};
const CUR_NAMES={INR:'Indian rupee',USD:'US dollar',AED:'UAE dirham',SAR:'Saudi riyal',QAR:'Qatari riyal',OMR:'Omani rial',KWD:'Kuwaiti dinar',BHD:'Bahraini dinar',EUR:'Euro',GBP:'British pound',SGD:'Singapore dollar',AUD:'Australian dollar',CAD:'Canadian dollar',JPY:'Japanese yen',MYR:'Malaysian ringgit',CHF:'Swiss franc'};
const store={structures:[],templates:[],plans:{},offers:[],clients:{},master:{},employees:[],fx:null};
let db=null, dlcap=null, cur='INR';
function fxData(){ return store.fx&&store.fx.rates?store.fx:FX_SEED; }
function fxAmt(n,c){ c=c||cur; if(c==='INR') return null; const r=fxData().rates[c]; return r?n*r:null; }
function fxStr(n,c){ const v=fxAmt(n,c); if(v===null) return ''; const c2=c||cur; const d=Math.abs(v)>=100?0:2; return c2+' '+v.toLocaleString('en-IN',{maximumFractionDigits:d,minimumFractionDigits:d}); }
function money(n){ const f=fxStr(n); return inr(n)+(f?`<span class="fxv">${f}</span>`:''); }
function toast(t){ let el=$('#toast'); if(!el){ el=document.createElement('div'); el.id='toast'; el.setAttribute('role','status'); document.body.append(el);} el.textContent=t; el.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('on'),2600); }
function uid(p){ return p+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
/* saving */
async function saveRec(col,id,data){
  if(db){ try{ await db.collection(col).doc(id).set(data); toast('Saved. Everyone signed in can see it.'); return true; }
    catch(e){ toast(e&&(e.code==='permission_denied'||e.code==='not_granted')?'You can view but not save. Ask the owner for edit access.':'Could not save just now. Please try again.'); return false; } }
  const list=(col==='plans'||col==='clients'||col==='master')?null:store[col];
  if(col==='plans'||col==='clients'||col==='master') store[col][id]=Object.assign({id},data); else { const i=list.findIndex(x=>x.id===id); const rec=Object.assign({id},data); if(i>=0) list[i]=rec; else list.push(rec); }
  onStore(col); toast('Saved for this session. Shared saving turns on once the database is connected.'); return true;
}
async function delRec(col,id){
  if(db){ try{ await db.collection(col).doc(id).delete(); toast('Deleted.'); }catch(e){ toast('Could not delete.'); } return; }
  store[col]=store[col].filter(x=>x.id!==id); onStore(col); toast('Deleted for this session.');
}
const STORE_HOOKS=[];
function onStore(kind){ STORE_HOOKS.forEach(f=>{ try{ f(kind); }catch(e){ console.warn(e); } }); }
async function initCaps(){
  if(!(window.claude&&claude.use)) { updateSaveNotes(); return; }
  try{ dlcap=await claude.use('downloads'); }catch(e){ dlcap=null; }
  try{ db=await claude.use('db'); }catch(e){ db=null; }
  if(db){
    const sub=(col)=>db.collection(col).onSnapshot(s=>{ const arr=s.docs.map(d=>Object.assign({id:d.id},d.data())); if(col==='plans'||col==='clients'||col==='master'){ store[col]={}; arr.forEach(p=>store[col][p.id]=p); } else store[col]=arr; onStore(col); },()=>{});
    try{ ['structures','templates','plans','offers','clients','master','employees'].forEach(sub); db.doc('fx/latest').onSnapshot(s=>{ if(s.exists){ store.fx=s.data(); onStore('fx'); } },()=>{}); }catch(e){ db=null; }
  }
  updateSaveNotes();
}
function updateSaveNotes(){ const t=db?'Shared saving is on: saved items are visible to everyone signed in.':'Saved items last while this page is open. Shared saving turns on once the database is connected.'; $$('.savenote').forEach(e=>e.textContent=t); const o=$('#offSaveNote'); if(o) o.textContent=db?'Shared with everyone signed in':'This session only'; }
/* files */
async function saveFile(filename,data,mime){
  const blob=data instanceof Blob?data:new Blob([data],{type:mime||'application/octet-stream'});
  if(dlcap){ try{ await dlcap.save({filename,data:blob}); return; }catch(e){ if(e&&(e.code==='cancelled'||e.code==='declined')) return; } }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
}
function csvOf(rows){ return rows.map(r=>r.map(v=>{ v=String(v??''); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }).join(',')).join('\r\n'); }
function parseCsv(txt){ const out=[]; let row=[],f='',q=false; for(let i=0;i<txt.length;i++){ const ch=txt[i]; if(q){ if(ch==='"'&&txt[i+1]==='"'){f+='"';i++;} else if(ch==='"') q=false; else f+=ch; } else if(ch==='"') q=true; else if(ch===','){row.push(f);f='';} else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&txt[i+1]==='\n') i++; row.push(f); out.push(row); row=[]; f=''; } else f+=ch; } if(f!==''||row.length){row.push(f);out.push(row);} return out.filter(r=>r.some(x=>x.trim()!=='')); }
const ascii=s=>String(s??'').replace(/₹/g,'Rs. ').replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[·•]/g,'-').replace(/…/g,'...').replace(/✓/g,'(confirmed)').replace(/[^\x00-\x7E]/g,'');
function makePdf(title,blocks,footer,password){
  const J=window.jspdf&&window.jspdf.jsPDF; if(!J){ toast('PDF tool is still loading. Try again in a moment.'); return null; }
  // password: the PDF opens only with it (the offer letter uses the joining date as MMDDYYYY).
  const doc=new J(Object.assign({unit:'pt',format:'a4'},password?{encryption:{userPassword:String(password),ownerPassword:String(password)+'-tcmpl-owner',userPermissions:['print','copy']}}:{})); const W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight(), M=50; let y=M;
  const need=h=>{ if(y+h>H-M){ doc.addPage(); y=M; } };
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.splitTextToSize(ascii(title),W-2*M).forEach(l=>{need(18);doc.text(l,M,y);y+=18;}); y+=6;
  blocks.forEach(b=>{
    if(b.t==='h'){ y+=6; doc.setFont('helvetica','bold'); doc.setFontSize(11); need(16); doc.text(ascii(b.text),M,y); y+=15; }
    else if(b.t==='p'){ doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.splitTextToSize(ascii(b.text),W-2*M).forEach(l=>{need(13);doc.text(l,M,y);y+=13;}); y+=5; }
    else if(b.t==='kv'){ doc.setFontSize(10); const lw=(W-2*M)*0.45; const lab=doc.splitTextToSize(ascii(b.k),lw-8), val=doc.splitTextToSize(ascii(b.v),(W-2*M)-lw); const h=Math.max(lab.length,val.length)*13+6; need(h); doc.setDrawColor(200); doc.rect(M,y-10,W-2*M,h); doc.setFont('helvetica','normal'); doc.text(lab,M+4,y); doc.setFont('helvetica','bold'); doc.text(val,M+lw,y); y+=h; }
    else if(b.t==='table'){ const cols=b.rows[0].length, cw=(W-2*M)/cols; doc.setFontSize(9); b.rows.forEach((r,ri)=>{ const cells=r.map(c=>doc.splitTextToSize(ascii(c),cw-6)); const h=Math.max(...cells.map(c=>c.length))*11+6; need(h); doc.setDrawColor(190); cells.forEach((c,ci)=>{ doc.rect(M+ci*cw,y-9,cw,h); doc.setFont('helvetica',ri===0?'bold':'normal'); doc.text(c,M+ci*cw+3,y); }); y+=h; }); y+=8; }
  });
  if(footer){ doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.splitTextToSize(ascii(footer),W-2*M).forEach(l=>{need(11);doc.text(l,M,y+6);y+=11;}); }
  return doc.output('blob');
}
function icsFor(events){
  const p=n=>String(n).padStart(2,'0'); const stamp=d=>`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Talent Carriage//Onboarding Agent//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  events.forEach((e,i)=>{ const end=new Date(e.start.getTime()+e.mins*60000); L.push('BEGIN:VEVENT','UID:'+uid('ev')+i+'@talentcarriage.com','DTSTAMP:'+stamp(new Date()),'DTSTART:'+stamp(e.start),'DTEND:'+stamp(end),'SUMMARY:'+e.title.replace(/[,;]/g,' '),'DESCRIPTION:'+(e.desc||'').replace(/\n/g,'\\n').replace(/[,;]/g,' '),'LOCATION:'+(e.loc||'').replace(/[,;]/g,' '),'END:VEVENT'); });
  L.push('END:VCALENDAR'); return L.join('\r\n');
}
/* font size */
const FS_KEY='tcmpl-onb-fs'; let fsz=15; try{ fsz=+localStorage.getItem(FS_KEY)||15; }catch(e){}
function setFs(v){ fsz=Math.max(12,Math.min(22,v)); document.documentElement.style.setProperty('--fs',fsz+'px'); try{ localStorage.setItem(FS_KEY,String(fsz)); }catch(e){} }
setFs(fsz);
$('#fsDown').onclick=()=>setFs(fsz-1); $('#fsUp').onclick=()=>setFs(fsz+1); $('#fsReset').onclick=()=>setFs(15);
/* currency */
Object.keys(CUR_NAMES).forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c==='INR'?'₹ INR':c; o.title=CUR_NAMES[c]; $('#curSel').append(o); });
$('#curSel').onchange=()=>{ cur=$('#curSel').value; onStore('cur'); };
STORE_HOOKS.push(k=>{ if(k==='fx'||k==='cur'){ const f=fxData(); const d=new Date(f.date+'T00:00:00'); $('#fxNote').textContent=cur==='INR'?'':`1 INR = ${f.rates[cur]} ${cur} · rates as of ${fmtD(d)}`; } });

/* ---------- Built-in salary structures and offer templates (TCMPL standard) ---------- */
const STD_STRUCTS=[
  {id:'std-50',name:'TCMPL standard: Basic 50% of gross',desc:'Basic 50% of gross, HRA 40% of Basic, balance as special allowance. PF on full Basic.',kind:'struct',basicPct:50,hraPct:40,extras:[],pf:'full',nps:0,grat:false,varPct:10,builtin:true},
  {id:'std-esic',name:'Shop-floor and ESIC category',desc:'Basic 50% of gross, HRA 40% of Basic. PF on the ₹15,000 wage ceiling; ESIC applies up to ₹21,000 gross a month.',kind:'struct',basicPct:50,hraPct:40,extras:[],pf:'capped',nps:0,grat:false,varPct:0,builtin:true},
  {id:'std-senior',name:'Senior leadership with NPS',desc:'Basic 50% of gross, HRA 50% of Basic, LTA one month Basic, employer NPS 10% of Basic, gratuity inside CTC.',kind:'struct',basicPct:50,hraPct:50,extras:[{name:'Leave travel allowance',type:'pctBasic',value:8.33}],pf:'capped',nps:10,grat:true,varPct:20,builtin:true}
];
const STD_OFFER=`{{company}}
{{company_address}}

Date: {{date}}
Ref: {{ref}}

{{candidate_name}}
{{candidate_city}}

Dear {{candidate_first}},

With reference to your application and the subsequent interview, we have pleasure in offering you an appointment as {{designation}} in {{company}}. The terms and conditions of your appointment are as follows:

## Appointment and reporting
You are required to join us on {{doj}}. The terms and conditions of your appointment shall be effective from your date of joining.
This offer is valid for {{validity_days}} calendar days from the date of offer. Please indicate your acceptance of this offer of employment and its terms and conditions by signing and returning the duplicate copy of this letter.
You will initially report to {{manager}}; however, your reporting is liable to change at the sole discretion of the company.
Your appointment is subject to your being found medically fit. This offer is also subject to the truthfulness of the representations you have made during the recruitment process. The company may initiate background verification after you accept this offer. If any particulars furnished by you are found to be false or incorrect, or material information has been suppressed, this appointment will be liable to be terminated without notice.

## Initial posting and transfer
Your initial place of posting will be {{location}}. At the sole discretion of the management, you may be transferred or deputed anywhere in India or abroad, from one department to another, or to any of the company's affiliates or group companies.

## Probation period
You shall be on probation for {{probation_months}} months from the date of joining. The probation may be extended, or the contract of employment terminated, if the management deems it necessary. On completion of probation, based on performance, you will be considered confirmed.

## Emoluments and taxes
Your total Cost to Company (CTC) will be Rs. {{ctc}} per annum. Details of your remuneration are in Annexure 1.
You shall be solely responsible for any taxes that may result from your remuneration. The company shall deduct income tax and other levies which it is liable to deduct at source.

## Benefits
You will be eligible for medical and life insurance as per company rules, or ESI benefits if you are eligible under the Employees' State Insurance Act. You will be eligible for Provident Fund and Gratuity as per the law in force from time to time.
Your work week will be {{work_week}}. The company has {{holidays}} declared holidays in a calendar year. Leave is as per company rules and is credited on a pro-rated basis from your date of joining.

## Termination
During probation, either party may end this employment by giving {{notice_probation}} notice. After confirmation, either party may end this employment by giving {{notice_confirmed}} written notice. The company may pay or recover salary in lieu of notice.
You shall retire from the services of the company on attaining {{retirement_age}} years of age.

## General obligations
You shall devote your whole time and attention to the company's business and shall not take up any other occupation or employment. You shall follow the company's service rules and Code of Conduct as amended from time to time. You shall keep all confidential information of the company and its customers strictly confidential during and after your employment, and shall not solicit company employees for three months after leaving.

## Governing law and jurisdiction
This offer of employment is governed by the laws of India. Any dispute shall be subject to the exclusive jurisdiction of the courts of {{jurisdiction}}.

If this offer is acceptable to you, please sign the duplicate copy of this letter and return it to us as a token of your acceptance.

For {{company}}
{{signatory}}

I have read and understood the terms and conditions of appointment above, and I accept this offer of employment.
Signature: ____________________    Date: ____________
{{candidate_name}}

## Annexure 1: Compensation details (strictly personal and confidential)
{{salary_table}}`;
const STD_INTERN=`{{company}}
{{company_address}}

Date: {{date}}
Ref: {{ref}}

{{candidate_name}}
{{candidate_city}}

Dear {{candidate_first}},

We extend you a warm welcome to our team as an intern for a period of {{internship_months}} months effective from {{doj}}. Please note the following terms and conditions of your internship.

## Terms of internship
This offer is subject to the truthfulness of the representations you made during the selection process. If any particulars are found to be false or incorrect, or material information has been suppressed, your internship will be liable to be terminated without notice.
Please write back to us if you need any clarification, and confirm your date of joining.
Your stipend will be Rs. {{stipend}} per month. The company may pay additional remuneration on achieving pre-agreed milestones, at its sole discretion.
You shall be solely responsible for any taxes that may result from your stipend. You will not be entitled to company benefits during your internship.
Working hours will be agreed between you and the company; you will be responsible for delivering on your commitments.
Your internship will end automatically on completion of the internship period unless extended in writing by the company.

## Termination
The company may end this internship if you are guilty of serious misconduct, neglect your responsibilities, remain absent without leave, breach your confidentiality obligations, or do not follow the company's instructions or terms of this internship.

## Confidentiality
You shall keep all confidential information of the company and its customers strictly confidential during and after your internship, and return all company property and documents when your internship ends.

For {{company}}
{{signatory}}

I accept this internship on the terms above.
Signature: ____________________    Date: ____________
{{candidate_name}}`;
const STD_TPLS=[
  {id:'std-offer',name:'Offer-cum-appointment letter (TCMPL standard, SoP Rev1.0)',body:STD_OFFER,builtin:true},
  {id:'std-intern',name:'Internship letter (TCMPL standard, SoP Rev1.0)',body:STD_INTERN,builtin:true}
];
const MERGE_FIELDS=['company','company_address','date','ref','candidate_name','candidate_first','candidate_city','designation','department','doj','manager','location','probation_months','validity_days','ctc','monthly_gross','annual_gross','monthly_ctc','work_week','holidays','notice_probation','notice_confirmed','retirement_age','jurisdiction','signatory','internship_months','stipend','salary_table'];
const allStructs=()=>STD_STRUCTS.concat(store.structures.filter(s=>!s.client||s.client===client.id));
const allTpls=()=>STD_TPLS.concat(store.templates.filter(t=>!t.client||t.client===client.id));

/* ---------- Candidate personal data (sample) and team details ---------- */
const PDATA={
  'Ritika Sharma':{father:'Rajesh Sharma',spouse:'Karan Sharma',relName:'Spouse: Karan Sharma',dob:'14 Aug 1996',gender:'Female',marital:'Married',email:'ritika.sharma@example.com',addrPerm:'H.No. 214, Sector 15, Faridabad, Haryana 121007',addrPres:'Flat 1102, Tower C, Sector 50, Gurugram, Haryana 122018',aadhaar:'XXXX XXXX 4821',pan:'ABCPS••••K',bank:'HDFC Bank, a/c ••••6702, IFSC HDFC000••••',uan:'1009••••3381',prevEpf:'Yes',prevEps:'Yes',prevPf:'HR/GGN/00•••••/000/00•••••',exitDate:'31 Oct 2026',intl:'No',religion:'',family:[['Karan Sharma','Spouse','12 Jan 1994','Yes'],['Sunita Sharma','Mother','05 May 1969','No (Faridabad, Haryana)']],nominees:[['Karan Sharma','Flat 1102, Tower C, Sector 50, Gurugram','Spouse','12 Jan 1994','100%','']]},
  'Anjali Gowda':{father:'Ramesh Gowda',spouse:'',relName:'Father: Ramesh Gowda',dob:'03 Mar 1999',gender:'Female',marital:'Unmarried',email:'anjali.gowda@example.com',addrPerm:'#45, 2nd Cross, Hoskote, Bengaluru Rural, Karnataka 562114',addrPres:'PG accommodation, Whitefield, Bengaluru, Karnataka 560066',aadhaar:'XXXX XXXX 7310',pan:'BKGPG••••M',bank:'Canara Bank, a/c ••••2290, IFSC CNRB000••••',uan:'',prevEpf:'No',prevEps:'No',prevPf:'',exitDate:'',intl:'No',religion:'',family:[['Ramesh Gowda','Father','10 Jun 1966','No (Hoskote, Karnataka)'],['Lakshmi Gowda','Mother','22 Sep 1971','No (Hoskote, Karnataka)']],nominees:[['Lakshmi Gowda','#45, 2nd Cross, Hoskote, Bengaluru Rural','Mother','22 Sep 1971','100%','']]}
};
function pdataFor(c){ const p=PDATA[c.name]; if(p) return JSON.parse(JSON.stringify(p));
  return {father:'',spouse:'',relName:'',dob:'',gender:'',marital:'',email:c.email||'',addrPerm:'',addrPres:'',aadhaar:'',pan:'',bank:'',uan:'',prevEpf:'',prevEps:'',prevPf:'',exitDate:'',intl:'No',religion:'',family:[],nominees:[]}; }
const TEAMS={
  default:{on:true,dept:'Finance',members:[['Team member 1','Senior Analyst'],['Team member 2','Executive']],reports:[['Report 1','Associate'],['Report 2','Associate']]},
  northpeak:{on:true,dept:'Finance and Accounts',members:[['Deepak Arora','Assistant Manager, Accounts'],['Sneha Iyer','Executive, Payables'],['Mohit Bansal','Executive, Receivables']],reports:[['Pooja Rawat','Accounts Associate'],['Imran Ali','Accounts Associate']]},
  lotus:{on:true,dept:'ICU Nursing',members:[['Sr. Leela Thomas','Charge Nurse, ICU'],['Bindu Raj','Staff Nurse'],['Faizal K','Staff Nurse']],reports:[['Ward assistant 1','Ward Assistant'],['Ward assistant 2','Ward Assistant']]}
};
const team=()=>{ const t=TEAMS[client.id]; const m=(typeof master==='function')?master():null; if(!m) return t; const mg=m.find(r=>/manager/i.test(r[7])); const dept=mg?mg[3]:t.dept; return {on:t.on,dept,members:m.filter(r=>r[3]===dept&&!/manager|direct report/i.test(r[7])).map(r=>[r[1],r[2]]),reports:m.filter(r=>/direct report/i.test(r[7])).map(r=>[r[1],r[2]])}; };


/* ---------- Offer desk ---------- */
const OFFER_DATE=new Date(2026,10,2);
Object.keys(RULES.pt).forEach(s=>{const o=document.createElement('option');o.textContent=s;$('#oState').append(o);});
const CITY={Haryana:'Gurugram',Delhi:'New Delhi','Uttar Pradesh':'Noida',Rajasthan:'Jaipur',Karnataka:'Bengaluru',Maharashtra:'Mumbai','Tamil Nadu':'Chennai',Telangana:'Hyderabad','West Bengal':'Kolkata',Gujarat:'Ahmedabad'};
let salMode='struct', manRows=[], anchor={k:'AC',v:960000}, lastOffer=null, tplSel='std-offer';
function fillOffer(){ const c=DEMO_CAND[client.id]; $('#oName').value=c.name; $('#oMobile').value=c.mobile; $('#oEmail').value=c.email; $('#oRole').value=c.role; $('#oDept').value=team().dept; $('#oGrade').value=c.grade; $('#oState').value=c.state; $('#oMgr').value=c.mgr; $('#oDoj').value='2026-12-01'; $('#oIsMgr').checked=false;
  salMode='struct'; setSalMode('struct'); refreshStructSel(c.struct); applyStructDefaults(); anchor={k:'AC',v:c.ctc}; refreshTplSel('std-offer'); }
function refreshStructSel(keep){ const sel=$('#oStruct'); const v=keep||sel.value; sel.innerHTML=allStructs().map(s=>`<option value="${esc(s.id)}">${esc(s.name)}${s.builtin?'':' (saved)'}</option>`).join(''); if(allStructs().some(s=>s.id===v)) sel.value=v; }
function refreshTplSel(keep){ const sel=$('#oTpl'); const v=keep||sel.value||tplSel; sel.innerHTML=allTpls().map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''); sel.value=allTpls().some(t=>t.id===v)?v:'std-offer'; }
const curStruct=()=>allStructs().find(s=>s.id===$('#oStruct').value)||STD_STRUCTS[0];
function applyStructDefaults(){ const s=curStruct(); $('#oVar').value=s.varPct??0; $('#oPf').value=s.pf||'full'; $('#oNps').value=s.nps||0; $('#oGrat').checked=!!s.grat; $('#structDesc').textContent=s.desc||''; if(s.kind==='manual'){ manRows=(s.rows||[]).map(r=>({name:r.name,amt:0,pct:r.pctGross,isBasic:!!r.isBasic})); } }
function setSalMode(m){ salMode=m; $('#smStruct').setAttribute('aria-pressed',m==='struct'); $('#smManual').setAttribute('aria-pressed',m==='manual'); $('#structPane').hidden=m!=='struct'; $('#manualPane').hidden=m!=='manual'; $('#toManual').hidden=m!=='struct'; ['fMG','fAG','fMC','fAC'].forEach(id=>{ $('#'+id).readOnly=m==='manual'; }); $('#fourBox').classList.toggle('ro',m==='manual'); }
function settings(){ return {varPct:Math.min(40,Math.max(0,+$('#oVar').value||0)),pf:$('#oPf').value,npsPct:Math.min(14,Math.max(0,+$('#oNps').value||0)),grat:$('#oGrat').checked,state:$('#oState').value,metro:['Delhi','Maharashtra','Tamil Nadu','West Bengal'].includes($('#oState').value)}; }
/* forward calculation from annual gross */
function fwd(G,st,set){
  let earn=[], basic;
  if(salMode==='manual'){ earn=manRows.map(r=>({name:r.name||'Component',annual:(+r.amt||0)*12})); G=earn.reduce((a,b)=>a+b.annual,0); const b=manRows.findIndex(r=>r.isBasic); basic=b>=0?earn[b].annual:(earn[0]?earn[0].annual:0); }
  else if(st.kind==='manual'){ earn=(st.rows||[]).map(r=>({name:r.name,annual:G*r.pctGross/100})); const b=(st.rows||[]).findIndex(r=>r.isBasic); basic=b>=0?earn[b].annual:(earn[0]?earn[0].annual:0); }
  else { basic=G*st.basicPct/100; const hra=basic*st.hraPct/100; const ex=(st.extras||[]).map(e=>({name:e.name,annual:e.type==='fixed'?e.value*12:basic*e.value/100})); const used=basic+hra+ex.reduce((a,b)=>a+b.annual,0); earn=[{name:'Basic',annual:basic},{name:'House rent allowance',annual:hra},...ex,{name:'Special allowance',annual:G-used}]; }
  const pfWage=set.pf==='none'?0:set.pf==='capped'?Math.min(basic,RULES.pf.ceilingMonthly*12):basic;
  const erPF=RULES.pf.rate*pfWage, nps=set.npsPct/100*basic, grat=set.grat?RULES.gratuityPctOfBasic*basic:0, esic=G>0&&G/12<=RULES.esic.grossCeilingMonthly, erESI=esic?RULES.esic.employer*G:0;
  const fixed=G+erPF+nps+grat+erESI, ctc=fixed/(1-set.varPct/100), variable=ctc-fixed;
  const eePF=RULES.pf.rate*pfWage, eeESI=esic?RULES.esic.employee*G:0, pt=G>0?(RULES.pt[set.state]??0):0;
  const npsDed=Math.min(nps,RULES.employerNpsDeductionPctOfBasic*basic), taxable=Math.max(0,G+nps-npsDed-RULES.stdDeduction), tax=incomeTax(taxable);
  const takeHomeAnnual=G-eePF-eeESI-pt-tax.total;
  return {G,basic,earn,erPF,nps,grat,erESI,esic,fixed,ctc,variable,eePF,eeESI,pt,npsDed,taxable,tax,takeHomeAnnual,monthly:takeHomeAnnual/12,wageShare:G?basic/G:0,neg:earn.some(e=>e.annual<-0.5)};
}
function solve(){
  const st=curStruct(), set=settings();
  if(salMode==='manual') return fwd(0,st,set);
  const k=anchor.k, v=Math.max(0,+anchor.v||0);
  if(k==='AG') return fwd(v,st,set); if(k==='MG') return fwd(v*12,st,set);
  const target=k==='MC'?v*12:v; let lo=0,hi=target; for(let i=0;i<60;i++){ const mid=(lo+hi)/2; if(fwd(mid,st,set).ctc>target) hi=mid; else lo=mid; } return fwd(lo,st,set);
}
function readCand(){ return {name:$('#oName').value.trim()||'Candidate',mobile:$('#oMobile').value,email:$('#oEmail').value.trim(),role:$('#oRole').value.trim()||'Role',dept:$('#oDept').value.trim(),grade:$('#oGrade').value,state:$('#oState').value,mgr:$('#oMgr').value.trim()||cv('managerName'),doj:$('#oDoj').value||'2026-12-01',isMgr:$('#oIsMgr').checked}; }
function renderMan(){ const tot=manRows.reduce((a,r)=>a+(+r.amt||0),0);
  $('#manTbl').innerHTML='<tr><th>Component</th><th class="num">Monthly (₹)</th><th>Basic for PF</th><th></th></tr>'+manRows.map((r,i)=>`<tr><td><input type="text" data-mn="${i}" value="${esc(r.name)}" aria-label="Component name"></td><td class="num"><input type="number" data-ma="${i}" value="${Math.round(+r.amt||0)}" step="100" style="width:120px;text-align:right" aria-label="Monthly amount"></td><td><input type="radio" name="manBasic" data-mb="${i}" ${r.isBasic?'checked':''} aria-label="Basic for PF"></td><td><button class="btn small" data-mx="${i}" aria-label="Remove">Remove</button></td></tr>`).join('')+`<tr style="font-weight:600"><td>Monthly gross</td><td class="num">${inr(tot)}</td><td></td><td></td></tr>`;
  $$('#manTbl [data-mn]').forEach(e=>e.oninput=()=>{manRows[+e.dataset.mn].name=e.value;renderOffer(true);});
  $$('#manTbl [data-ma]').forEach(e=>e.oninput=()=>{manRows[+e.dataset.ma].amt=+e.value||0;renderOffer(true);});
  $$('#manTbl [data-mb]').forEach(e=>e.onchange=()=>{manRows.forEach((r,i)=>r.isBasic=i===+e.dataset.mb);renderOffer();});
  $$('#manTbl [data-mx]').forEach(e=>e.onclick=()=>{manRows.splice(+e.dataset.mx,1);renderOffer();});
}
function renderOffer(skipMan){
  if(salMode==='manual'&&!skipMan) renderMan();
  if(salMode==='manual'&&skipMan){ const tot=manRows.reduce((a,r)=>a+(+r.amt||0),0); const last=$('#manTbl tr:last-child td.num'); if(last) last.textContent=inr(tot); }
  const r=solve(), c=readCand(); lastOffer={c,r,set:settings(),struct:curStruct(),mode:salMode,tpl:$('#oTpl').value};
  const figs={MG:r.G/12,AG:r.G,MC:r.ctc/12,AC:r.ctc};
  ['MG','AG','MC','AC'].forEach(k=>{ const el=$('#f'+k); if(document.activeElement!==el||salMode==='manual') el.value=Math.round(figs[k]); el.classList.toggle('anchor',salMode==='struct'&&anchor.k===k); });
  $('#takeHome').textContent=inr(r.monthly); $('#takeHomeFx').textContent=fxStr(r.monthly);
  $('#takeHomeSub').textContent=`per month after${r.eePF?' PF':''}${r.esic?', ESIC':''}${r.pt?', professional tax':''} and income tax · tax year ${RULES.taxYear}, new regime`;
  const ok=r.wageShare>=RULES.labourCodeWagesMin-1e-9;
  $('#wageCheck').innerHTML=(r.neg?'<span class="chip bad"><span class="dot"></span>Components exceed gross: adjust the structure</span>':ok?'<span class="chip ok"><span class="dot"></span>Basic is at least 50% of gross</span>':`<span class="chip warn"><span class="dot"></span>Basic ${Math.round(r.wageShare*100)}% of gross: check Labour Code wage rule</span>`);
  $('#figTiles').innerHTML=[['Monthly gross',figs.MG],['Annual gross',figs.AG],['Monthly CTC',figs.MC],['Annual CTC',figs.AC]].map(([k,v])=>`<div class="fig"><div class="k">${k}</div><div class="v">${inr(v)}</div>${fxStr(v)?`<div class="fxv">${fxStr(v)}</div>`:''}</div>`).join('');
  const rows=[...r.earn.map(e=>[esc(e.name),e.annual]),['<b>Gross salary</b>',r.G,1],
    ...(r.erPF?[['Employer PF',r.erPF]]:[]),...(r.erESI?[['Employer ESIC',r.erESI]]:[]),...(r.nps?[['Employer NPS',r.nps]]:[]),...(r.grat?[['Gratuity (in CTC)',r.grat]]:[]),
    ['<b>Fixed CTC</b>',r.fixed,1],...(r.variable>0.5?[['Target variable pay',r.variable]]:[]),['<b>Total CTC</b>',r.ctc,1],
    ...(r.eePF?[['Less: employee PF',-r.eePF]]:[]),...(r.eeESI?[['Less: employee ESIC',-r.eeESI]]:[]),...(r.pt?[['Less: professional tax',-r.pt]]:[]),['Less: income tax (indicative)',-r.tax.total],['<b>Take-home (fixed pay)</b>',r.takeHomeAnnual,1]];
  const fxCol=cur!=='INR';
  $('#breakup').innerHTML=`<tr><th>Component</th><th class="num">Annual</th><th class="num">Monthly</th>${fxCol?`<th class="num">Monthly (${cur})</th>`:''}</tr>`+rows.map(([k,v,b])=>{ const neg=v<0||k.startsWith('Less'); const a=Math.abs(v); return `<tr${b?' style="font-weight:600"':''}><td>${k}</td><td class="num">${neg?'− ':''}${inr(a)}</td><td class="num">${neg?'− ':''}${inr(a/12)}</td>${fxCol?`<td class="num">${neg?'− ':''}${fxStr(a/12).replace(cur+' ','')}</td>`:''}</tr>`; }).join('');
  const t=r.tax;
  $('#taxDetail').innerHTML=`Gross ${inr(r.G)}${r.nps?` + employer NPS ${inr(r.nps)} − NPS deduction ${inr(r.npsDed)}`:''} − standard deduction ${inr(RULES.stdDeduction)} = taxable ${inr(r.taxable)}.<br>Slab tax ${inr(t.slab)}${t.relief?` → ${esc(t.relief)}`:''} → tax ${inr(t.tax)}${t.surcharge?` + surcharge ${inr(t.surcharge)}`:''} + 4% cess ${inr(t.cess)} = <b>${inr(t.total)}</b> a year.${r.variable>0.5?' Variable pay is taxed when paid and is not in the monthly figure.':''}`;
  $('#rulesNote').textContent=`Rules: ${RULES.sources} Last checked ${RULES.checked}. Currency conversions use public reference rates and are for information only; the offer is made in INR.`;
  renderLetter();
}
/* letter */
function mergeVals(){ const mv=mergeVals0(); custom('letter').forEach(x=>{ mv[slug(x.label)]=x.value; }); return mv; }
function mergeVals0(){ const {c,r}=lastOffer; const d=new Date(c.doj+'T00:00:00'); const p=(cv('probation').match(/\d+/)||['6'])[0];
  return {company:cv('company'),company_address:cv('companyAddress'),date:fmtD(OFFER_DATE),ref:`${cv('initials')}/2026/${String(1000+(c.name.length*37)%900)}`,candidate_name:c.name,candidate_first:c.name.split(' ')[0],candidate_city:`${CITY[c.state]||''}, ${c.state}`,designation:c.role,department:c.dept,doj:fmtD(d),manager:c.mgr,location:cv('location')||CITY[c.state]||c.state,probation_months:p,validity_days:'7',ctc:Math.round(r.ctc).toLocaleString('en-IN'),monthly_gross:Math.round(r.G/12).toLocaleString('en-IN'),annual_gross:Math.round(r.G).toLocaleString('en-IN'),monthly_ctc:Math.round(r.ctc/12).toLocaleString('en-IN'),work_week:cv('workWeek'),holidays:cv('holidays'),notice_probation:cv('noticeProbation'),notice_confirmed:cv('noticeConfirmed'),retirement_age:cv('retirementAge'),jurisdiction:cv('jurisdiction'),signatory:cv('signatory'),internship_months:'6',stipend:Math.round(r.G/12).toLocaleString('en-IN')}; }
function salaryRows(){ const r=lastOffer.r; return [['Component','Monthly (Rs.)','Annual (Rs.)'],...r.earn.map(e=>[e.name,Math.round(e.annual/12).toLocaleString('en-IN'),Math.round(e.annual).toLocaleString('en-IN')]),['Gross salary',Math.round(r.G/12).toLocaleString('en-IN'),Math.round(r.G).toLocaleString('en-IN')],...(r.erPF?[['Employer contribution to PF',Math.round(r.erPF/12).toLocaleString('en-IN'),Math.round(r.erPF).toLocaleString('en-IN')]]:[]),...(r.erESI?[['Employer contribution to ESIC',Math.round(r.erESI/12).toLocaleString('en-IN'),Math.round(r.erESI).toLocaleString('en-IN')]]:[]),...(r.nps?[['Employer contribution to NPS',Math.round(r.nps/12).toLocaleString('en-IN'),Math.round(r.nps).toLocaleString('en-IN')]]:[]),...(r.grat?[['Gratuity',Math.round(r.grat/12).toLocaleString('en-IN'),Math.round(r.grat).toLocaleString('en-IN')]]:[]),['Fixed CTC',Math.round(r.fixed/12).toLocaleString('en-IN'),Math.round(r.fixed).toLocaleString('en-IN')],...(r.variable>0.5?[['Target variable pay (as per plan)','-',Math.round(r.variable).toLocaleString('en-IN')]]:[]),['Total CTC',Math.round(r.ctc/12).toLocaleString('en-IN'),Math.round(r.ctc).toLocaleString('en-IN')]]; }
function letterBlocks(){ const tpl=allTpls().find(t=>t.id===$('#oTpl').value)||STD_TPLS[0]; const v=mergeVals(); const fill=s=>s.replace(/\{\{(\w+)\}\}/g,(m,k)=>v[k]!==undefined?v[k]:m);
  const out=[]; tpl.body.split(/\n/).forEach(line=>{ const L=line.trim(); if(!L){ out.push({t:'gap'}); return; } if(L==='{{salary_table}}'){ out.push({t:'table',rows:salaryRows()}); return; } if(L.startsWith('## ')) out.push({t:'h',text:fill(L.slice(3))}); else out.push({t:'p',text:fill(L)}); });
  return {tpl,blocks:out}; }
function renderLetter(){ if(!lastOffer) return; const {blocks}=letterBlocks();
  $('#letterPrev').innerHTML=blocks.map(b=>b.t==='h'?`<h4>${esc(b.text)}</h4>`:b.t==='p'?`<p>${esc(b.text)}</p>`:b.t==='table'?`<table class="lt">${b.rows.map((r,i)=>`<tr>${r.map(x=>i===0?`<th>${esc(x)}</th>`:`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`:'<div class="gap"></div>').join(''); }
function letterFile(){ return `Offer_Letter_${lastOffer.c.name.replace(/\W+/g,'_')}`; }
function letterPdfBlob(password){ const {blocks,tpl}=letterBlocks(); return makePdf(tpl.id==='std-intern'?'Internship letter':'Offer-cum-appointment letter',blocks.filter(b=>b.t!=='gap'),'Generated by the AI Onboarding Agent (demo). Sample data.',password); }
// Offer letters on WhatsApp are password-protected with the joining date as MMDDYYYY (e.g. 1 Dec 2026 -> 12012026), unless switched off for the client.
function letterPassword(){ if(cv('letterUnprotected')===true) return ''; const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(readCand().doj||'')); return m?m[2]+m[3]+m[1]:''; }
async function downloadLetterPdf(){ const b=letterPdfBlob(); if(b) await saveFile(letterFile()+'.pdf',b,'application/pdf'); }
$('#dlPdf').onclick=downloadLetterPdf;
$('#dlWord').onclick=()=>{ const {blocks}=letterBlocks(); const body=blocks.map(b=>b.t==='h'?`<h3 style="font-family:Calibri;font-size:12pt">${esc(b.text)}</h3>`:b.t==='p'?`<p style="font-family:Calibri;font-size:11pt">${esc(b.text)}</p>`:b.t==='table'?`<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Calibri;font-size:10pt">${b.rows.map((r,i)=>`<tr>${r.map(x=>`<${i?'td':'th'}>${esc(x)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table>`:'').join('');
  saveFile(letterFile()+'.doc',`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Offer letter</title></head><body>${body}</body></html>`,'application/msword'); };
/* events */
['MG','AG','MC','AC'].forEach(k=>$('#f'+k).addEventListener('input',e=>{ if(salMode!=='struct') return; anchor={k,v:+e.target.value||0}; renderOffer(); }));
['#oName','#oRole','#oDept','#oVar','#oPf','#oNps','#oGrat','#oState','#oDoj','#oMgr','#oGrade','#oEmail','#oIsMgr','#oTpl'].forEach(s=>$(s).addEventListener('input',()=>renderOffer()));
$('#oStruct').onchange=()=>{ applyStructDefaults(); renderOffer(); };
$('#smStruct').onclick=()=>{ setSalMode('struct'); renderOffer(); };
$('#smManual').onclick=()=>{ if(!manRows.length) toManualRows(); setSalMode('manual'); renderOffer(); };
function toManualRows(){ const r=solve(); manRows=r.earn.map((e,i)=>({name:e.name,amt:Math.round(e.annual/12),isBasic:/basic/i.test(e.name)||(i===0&&!r.earn.some(x=>/basic/i.test(x.name)))})); }
$('#toManual').onclick=()=>{ toManualRows(); setSalMode('manual'); renderOffer(); toast('Components copied. Edit any amount; employer contributions update automatically.'); };
$('#manAdd').onclick=()=>{ manRows.push({name:'New component',amt:0,isBasic:false}); renderOffer(); };
$('#saveStruct').onclick=async()=>{ const nm=$('#structName')?$('#structName').value:''; const r=solve(), set=settings(); const name=(salMode==='manual'?'Custom mix':'Custom')+` – ${readCand().role} (${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'})})`;
  let rec; if(salMode==='manual'){ rec={name,kind:'manual',desc:'Saved from manual components; amounts kept as a share of gross.',rows:manRows.map(m=>({name:m.name,pctGross:r.G?(+m.amt*12)/r.G*100:0,isBasic:!!m.isBasic})),pf:set.pf,nps:set.npsPct,grat:set.grat,varPct:set.varPct,client:client.id,created:new Date().toISOString()}; }
  else { const s=curStruct(); rec={name,kind:'struct',desc:`Based on ${s.name}`,basicPct:s.basicPct,hraPct:s.hraPct,extras:s.extras||[],pf:set.pf,nps:set.npsPct,grat:set.grat,varPct:set.varPct,client:client.id,created:new Date().toISOString()}; }
  const id=uid('st'); if(await saveRec('structures',id,rec)){ setTimeout(()=>{ refreshStructSel(id); if(salMode==='manual'){ setSalMode('struct'); } applyStructDefaults(); renderOffer(); },400); } };
$('#modeMake').onclick=()=>setMode('make'); $('#modeUpload').onclick=()=>setMode('upload');
function setMode(m){ $('#modeMake').setAttribute('aria-pressed',m==='make'); $('#modeUpload').setAttribute('aria-pressed',m==='upload'); $('#makePane').hidden=m!=='make'; $('#uploadPane').hidden=m!=='upload'; }
$('#releaseOffer').onclick=async()=>{ renderOffer(); const c=fromOffer(); startCandidate(c); showTab('journey');
  const offerId=uid('of'); publishFacts(); if(window.tcmplWA){ try{ window.tcmplWA.start({offerId,profile:Object.assign({},c,{doj:readCand().doj,client:client.id}),name:c.name,first:c.first,mobile:c.mobile,email:c.email,role:c.role,client:client.id,clientLabel:client.label,company:cv('company'),agentName:cv('agentName'),recruiter:cv('recruiter'),doj:readCand().doj,facts:kbText(),faq:cv('faq').map(f=>f[0]+': '+f[2]).join('\n'),letterPdf:(()=>{ try{ return letterPdfBlob(letterPassword()); }catch(e){ return null; } })(),letterProtected:!!letterPassword(),letterFile:letterFile()+'.pdf'}); }catch(e){ console.warn(e); } }
  const {r}=lastOffer; saveRec('offers',offerId,{name:c.name,role:c.role,client:client.id,clientLabel:client.label,ctc:Math.round(r.ctc),monthlyGross:Math.round(r.G/12),takeHome:Math.round(r.monthly),template:($('#oTpl').selectedOptions[0]||{}).textContent||'',structure:salMode==='manual'?'Manual components':curStruct().name,doj:readCand().doj,status:'Released',released:new Date().toISOString()}); };
function fromOffer(){ const {c,r}=lastOffer; return {name:c.name,first:c.name.split(' ')[0],mobile:c.mobile,email:c.email,role:c.role,dept:c.dept,isMgr:c.isMgr,grade:c.grade,state:c.state,doj:new Date(c.doj+'T00:00:00'),mgr:c.mgr,ctc:Math.round(r.ctc),monthly:r.monthly,gross:r.G,esic:r.esic,offerSource:'Client Hub offer desk',hasOffer:true}; }
const CSV_SAMPLE=`name,mobile,email,designation,location,doj,ctc,manager,offer_letter_ref
Anjali Gowda,+91 99000 00000,anjali.gowda@example.com,Staff Nurse ICU,Bengaluru,2026-12-01,240000,Sr. Mary Joseph,ADR-OL-2231
Mohammed Irfan,+91 99000 00001,irfan.m@example.com,Pharmacist,Bengaluru,2026-12-08,380000,Dr. K. Nair,ADR-OL-2232
Deepa S,,deepa.s@example.com,Lab Technician,Bengaluru,2026-12-15,300000,Ravi Kumar,ADR-OL-2233`;
$('#csvTplDl').onclick=()=>saveFile('Candidate_upload_template.csv',CSV_SAMPLE.split('\n')[0]+'\r\n','text/csv');
$('#csvFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ $('#csvIn').value=String(rd.result).trim(); $('#validateCsv').click(); toast(`Loaded ${f.name}`); }; rd.readAsText(f); e.target.value=''; };
function uploadedCand(r){ return {name:r.name,first:r.name.split(' ')[0],mobile:r.mobile,email:r.email,role:r.designation,dept:team().dept,grade:'',state:'Karnataka',doj:new Date(r.doj+'T00:00:00'),mgr:r.manager||cv('managerName'),ctc:+r.ctc||0,monthly:null,gross:(+r.ctc||0)*0.9,esic:((+r.ctc||0)*0.9)/12<=RULES.esic.grossCeilingMonthly,offerSource:'Uploaded from client tool ('+(r.offer_letter_ref||'ref')+')',hasOffer:false}; }
$('#validateCsv').onclick=()=>{
  const rowsA=parseCsv($('#csvIn').value.trim()); if(!rowsA.length) return; const hdr=rowsA.shift().map(s=>s.trim().toLowerCase());
  const need=['name','mobile','designation','doj'];
  const rows=rowsA.map(v=>{const o={};hdr.forEach((h,i)=>o[h]=(v[i]||'').trim());return o;});
  let html='<tr><th>Candidate</th><th>Check</th><th>Agent</th></tr>';
  rows.forEach((r,i)=>{ const miss=need.filter(k=>!r[k]); const badDate=r.doj&&isNaN(new Date(r.doj)); const ok=!miss.length&&!badDate;
    html+=`<tr><td><b>${esc(r.name||'(no name)')}</b><br><span class="note">${esc(r.designation)} · joins ${esc(r.doj)}</span></td><td>${ok?'<span class="chip ok">Ready</span>':`<span class="chip bad">Missing ${esc(miss.join(', ')||'valid date')}</span><br><span class="note">Agent emails the recruiter to complete this row</span>`}</td><td>${ok?`<button class="btn small teal" data-csv="${i}">Engagement started · open</button>`:'<span class="note">Waiting</span>'}</td></tr>`; });
  $('#csvOut').innerHTML=html;
  $$('#csvOut [data-csv]').forEach(b=>b.onclick=()=>{ startCandidate(uploadedCand(rows[+b.dataset.csv])); showTab('journey'); });
};
STORE_HOOKS.push(k=>{ if(k==='structures'){ refreshStructSel(); } if(k==='templates'){ refreshTplSel(); } if(k==='structures'||k==='templates'||k==='cur'||k==='fx'){ if(lastOffer) renderOffer(); } });

/* ---------- Journey engine ---------- */
const TP={
  offer:{t:'Offer and take-home',k:'c'}, docs:{t:'Documents and KYC',k:'c'}, forms:{t:'Joining forms help: nominations, tax regime',k:'c'}, confirm:{t:'Confirm pre-filled details',k:'c'}, resign:{t:'Resignation check',k:'c'},
  story:{t:'Company story',k:'c'}, checkin:{t:'Pre-joining check-in',k:'c'}, manager_intro:{t:'Meet your manager',k:'c'}, induct:{t:'Induction and quiz',k:'c'},
  day1kit:{t:'Day-1 kit: map, time, dress code',k:'c'}, call:{t:'Confirmation call (voice)',k:'c'}, welcome:{t:'Day-1 welcome',k:'c'}, survey_d1:{t:'Day-1 experience pulse',k:'c'},
  week1:{t:'Week-1 settling-in check',k:'c'}, pulse15:{t:'Day-15 pulse',k:'c'}, pulse30:{t:'Day-30 pulse and goals',k:'c'}, pulse45:{t:'Day-45 pulse',k:'c'}, pulse60:{t:'Day-60 pulse',k:'c'}, pulse75:{t:'Day-75 pulse',k:'c'}, final90:{t:'Day-90 review',k:'c'},
  m_prep:{t:'Manager: prepare Day 1',k:'m'}, m_prep2:{t:'Manager: final Day-1 check',k:'m'}, m_1on1:{t:'Manager: first 1:1 reminder',k:'m'}, m_goals:{t:'Manager: agree goals',k:'m'}, m_prob:{t:'Manager: probation heads-up',k:'m'},
  it_15:{t:'IT, Admin, Security: request',k:'s'}, it_7:{t:'IT, Admin, Security: reminder',k:'s'}, it_2:{t:'Readiness check and escalation',k:'s'}, ann:{t:'Joining announcement draft',k:'s'}, stat:{t:'PF, ESI and insurance enrolment',k:'s'}
};
let S=null; window.tcmplCurrent=()=>S&&S.c; window.tcmplTouchpoint=()=>S&&S.plan&&S.plan[S.idx]?tpInfo(S.plan[S.idx].key).t:''; window.tcmplLetterPdf=()=>{ try{ return lastOffer?{blob:letterPdfBlob(letterPassword()),name:letterFile()+'.pdf',protected:!!letterPassword()}:null; }catch(e){ return null; } };
/* ---- Live journey support: build any touchpoint's standard message for a real candidate, without disturbing the demo ---- */
function tcmplProfileToC(p){ p=p||{}; const doj=/^\d{4}-\d{2}-\d{2}$/.test(p.doj||'')?new Date(p.doj+'T00:00:00'):new Date(OFFER_DATE.getTime()+28*DAY);
  const name=p.name||'Candidate'; return {name,first:p.first||name.split(' ')[0],mobile:p.mobile||'',email:p.email||'',role:p.role||'',dept:p.dept||'',isMgr:!!p.isMgr,grade:p.grade||'',state:p.state||'',doj,mgr:p.mgr||'',ctc:+p.ctc||0,monthly:+p.monthly||0,gross:+p.gross||0,esic:!!p.esic,offerSource:'Client Hub offer desk',hasOffer:true}; }
function tcmplSandbox(profile,fn){
  const box=$('#msgs'), logs=['#actLog','#hoLog','#cbList'].map(q=>$(q)).filter(Boolean);
  const keepS=S, keepClient=client, keepKids=[...box.childNodes], keepLogs=logs.map(el=>[...el.childNodes]);
  const stubs={saveRec,saveFile,toast,showTab}; saveRec=async()=>true; saveFile=async()=>{}; toast=()=>{}; showTab=()=>{};
  try{
    const cl=CLIENTS.find(x=>x.id===(profile&&profile.client)); if(cl) client=cl;
    const c=tcmplProfileToC(profile);
    S={c,idx:-1,day:0,accepted:!!(profile&&profile.accepted),docs:0,docsTotal:cv('docs').split(';').length,confirmed:false,resigned:'Not asked yet',quiz:null,pulses:[],risk:[],handovers:[],actions:[],chat:[],callbacks:[],forms:false,call:false,pd:pdataFor(c),formState:{},formVals:{},editing:null,awaitFix:null,kyc:false,quiet:false,lastDay:-1,ready:readyTemplate()};
    buildPlan(); box.replaceChildren(); return fn();
  } finally {
    saveRec=stubs.saveRec; saveFile=stubs.saveFile; toast=stubs.toast; showTab=stubs.showTab;
    S=keepS; client=keepClient; box.replaceChildren(...keepKids); logs.forEach((el,i)=>el.replaceChildren(...keepLogs[i]));
    if(S){ try{ renderBrain(); }catch(e){ /* ignore */ } }
  }
}
// Joining forms for a real candidate: definitions filled from their data, and the PDF of one form.
window.tcmplFormDefs=(profile,pd)=>tcmplSandbox(profile,()=>{ S.pd=pd; return JSON.parse(JSON.stringify(formDefs())); });
window.tcmplFormPdf=(profile,pd,fid,vals,states,footer)=>tcmplSandbox(profile,()=>{ S.pd=pd; S.formVals=vals||{}; S.formState=states||{}; return formPdf(fid,footer); });
window.tcmplFormNote=()=>FORM_NOTE;
// Induction: the selected client and its default plan and quiz (used until HR saves its own).
window.tcmplClientId=()=>client.id;
window.tcmplReadyFor=(profile)=>tcmplSandbox(profile,()=>readyTemplate().map(r=>({k:r.k,task:r.task,owner:r.own(),due:r.due})));
window.tcmplShortName=()=>cv('short')||client.label;
window.tcmplClientLabel=()=>client.label;
// Candidates belong to the client they were released under; lists show only the selected client's candidates.
window.tcmplOfClient=(c,all)=>all||((c&&c.profile&&c.profile.client)||'default')===client.id;
window.tcmplClientFacts=()=>({address:cv('address')||'',reportTime:cv('reportTime')||'',poc:cv('meet')||'',dress:cv('dress')||'',bring:cv('bring')||'',mapUrl:cv('mapLink')||'',company:cv('short')||client.label});
window.tcmplInductionDefaults=()=>({items:JSON.parse(JSON.stringify(client.ov.plan||DEFAULT_PLAN)),quiz:JSON.parse(JSON.stringify(cv('quiz')||[]))});
window.tcmplPlanFor=(profile)=>tcmplSandbox(profile,()=>S.plan.map(tp=>{ const inf=tpInfo(tp.key); const d=new Date(S.c.doj.getTime()+(tp.abs-S.gap)*DAY); return {key:tp.key,label:inf.t,track:inf.k,rel:relLabel(tp.abs),date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}; }));
window.tcmplRenderTouchpoint=(profile,key)=>tcmplSandbox(profile,()=>{ const tp=S.plan.find(x=>x.key===key)||{key,abs:0}; S.idx=Math.max(0,S.plan.indexOf(tp)); (RUN[key]||runCustom)(tp); return [...$('#msgs').children].map(n=>n.cloneNode(true)); });
function parseOff(code,gap){ const m=/^([OD])([+-]\d+)$/.exec(code||''); if(!m) return null; const n=+m[2]; return m[1]==='O'?n:gap+n; }
function buildPlan(){
  const gap=Math.max(3,Math.round((S.c.doj-OFFER_DATE)/DAY)); S.gap=gap;
  const cad=cv('cadence'), off=cv('off');
  const svOff=Object.entries(SV_TP).filter(([sk])=>!cv(sk)).map(([,tk])=>tk);
  let items=Object.keys(TP).filter(k=>!off.includes(k)&&!svOff.includes(k)).map(k=>({key:k,code:cad[k],abs:parseOff(cad[k],gap)}));
  (client.ov.customTps||[]).forEach(t=>items.push({key:'cx:'+t.id,code:t.when,abs:parseOff(t.when,gap)}));
  custom('survey').forEach(x=>items.push({key:'sv:'+x.id,code:x.label,abs:parseOff(x.label,gap)}));
  items=items.filter(x=>x.abs!==null);
  items.forEach(x=>{ if(x.key==='offer') x.abs=0; else if(x.abs<1 && !x.code.startsWith('O')) x.abs=Math.max(1,x.abs); });
  const order=Object.keys(TP); items.sort((a,b)=>a.abs-b.abs||(order.indexOf(a.key)+1||99)-(order.indexOf(b.key)+1||99)); if(0) items.sort((a,b)=>a.abs-b.abs||order.indexOf(a.key)-order.indexOf(b.key));
  S.plan=items;
}
function relLabel(abs){ const d=abs-S.gap; return d===0?'D-day':(d<0?'D'+d:'D+'+d); }
function dateOf(abs){ return new Date(OFFER_DATE.getTime()+abs*DAY); }
function startCandidate(c){
  stopAuto();
  S={c,idx:-1,day:0,accepted:false,docs:0,docsTotal:cv('docs').split(';').length,confirmed:false,resigned:'Not asked yet',quiz:null,pulses:[],risk:[],handovers:[],actions:[],chat:[],callbacks:[],forms:false,call:false,pd:pdataFor(c),formState:{},formVals:{},editing:null,awaitFix:null,kyc:false,quiet:false,lastDay:-1,
     ready:readyTemplate()};
  buildPlan(); $('#msgs').innerHTML=''; $('#actLog').innerHTML=''; $('#hoLog').innerHTML='<div><span class="d">—</span><span class="note">Nothing yet</span></div>';
  $('#pName').textContent=cv('agentName'); $('#pAvatar').textContent=cv('initials'); $('#pSub').textContent='WhatsApp Business · verified · '+cv('languages');
  act(`Engagement started for ${c.name}. Source: ${c.offerSource}.`);
  renderTimeline(); renderBrain(); updateClock();
  nextTouch();
}
function updateClock(){ const tp=S.plan[S.idx]; const abs=tp?tp.abs:0; $('#clock').textContent=`${fmtD(dateOf(abs))} · ${relLabel(abs)} · ${S.c.name}`; $('#nextTp').disabled=S.idx>=S.plan.length-1; }
function renderTimeline(){
  $('#timeline').innerHTML='<h3>Touchpoints</h3>'+S.plan.map((x,i)=>`<div class="tlitem ${i<S.idx?'done':''} ${i===S.idx?'now':''}" data-i="${i}"><div class="when">${relLabel(x.abs)}<br><span style="font-weight:500">${fmtShort(dateOf(x.abs))}</span></div><div><div class="trk ${tpInfo(x.key).k}">${{c:'Candidate',m:'Manager',s:'Stakeholders'}[tpInfo(x.key).k]}</div>${esc(tpInfo(x.key).t)}</div></div>`).join('');
  const now=$('#timeline .now'); if(now) now.scrollIntoView({block:'nearest'});
}
function nextTouch(){
  if(S.idx>=S.plan.length-1) return; $$('#msgs .qr button').forEach(b=>b.disabled=true);
  S.idx++; const tp=S.plan[S.idx];
  if(tp.abs!==S.lastDay){ sep(`${fmtShort(dateOf(tp.abs))} · ${relLabel(tp.abs)}`); S.lastDay=tp.abs; }
  updateClock(); renderTimeline(); ageCallbacks();
  window.tcmplTpStart=$('#msgs').children.length;
  (RUN[tp.key]||runCustom)(tp); renderBrain();
  if(window.tcmplWA&&window.tcmplWA.onTouchpoint){ try{ window.tcmplWA.onTouchpoint(tpInfo(tp.key).t); }catch(e){ console.warn(e); } }
}
/* chat primitives */
const msgs=$('#msgs');
function scroll(){ msgs.scrollTop=msgs.scrollHeight; }
function sep(t){ clk=540+Math.floor(Math.random()*240); const d=document.createElement('div'); d.className='daysep'; d.textContent=t; msgs.append(d); scroll(); }
let clk=600; function time(){ clk+=1+Math.floor(Math.random()*3); const h=Math.floor(clk/60)%24, m=clk%60; return `${h>12?h-12:h}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; }
function agent(html,opts={}){ const d=document.createElement('div'); d.className='b in'; d.innerHTML=html+`<span class="meta">${time()}</span>`; msgs.append(d); S.chat.push({role:'assistant',content:d.textContent.slice(0,600)}); if(opts.qr) quick(opts.qr); scroll(); return d; }
function me(text){ const d=document.createElement('div'); d.className='b out'; d.innerHTML=esc(text)+`<span class="meta">${time()} ✓✓</span>`; msgs.append(d); S.chat.push({role:'user',content:text}); scroll(); }
function quick(list){ const w=document.createElement('div'); w.className='qr'; list.forEach(q=>{ const b=document.createElement('button'); b.textContent=q.l; if(q.p)b.dataset.p='1'; if(q.r)b.dataset.r='1'; b.onclick=()=>{ [...w.children].forEach(x=>x.disabled=true); me(q.l); setTimeout(()=>{q.f();renderBrain();},450); }; w.append(b); }); msgs.append(w); scroll(); }
function callCard(title,lines){ const d=document.createElement('div'); d.className='callcard'; d.innerHTML=`<div class="ch"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>${esc(title)}</div>`+lines.map(([w,t,tr])=>`<div class="ln"><span class="who" style="color:${w==='Agent'?'var(--teal-ink)':'var(--blue)'}">${w}</span><br>${esc(t)}${tr?`<br><span class="note">${esc(tr)}</span>`:''}</div>`).join(''); msgs.append(d); scroll(); }
function docBubble(name,size,onOpen){ const b=document.createElement('button'); b.className='doc'; b.type='button'; b.innerHTML=`<span class="ic">PDF</span><span><span class="nm">${esc(name)}</span><br><span class="sz">${esc(size)} · tap to open</span></span>`; b.onclick=onOpen; msgs.append(b); scroll(); }
function teamHtml(){ const tm=team(); if(!tm.on) return ''; return `<div class="mini teamcard"><b>Your team: ${esc(S.c.dept||tm.dept)}</b><br>Manager: ${esc(S.c.mgr)}<br>${tm.members.map(m=>`${esc(m[0])} · ${esc(m[1])}`).join('<br>')}${S.c.isMgr?`<br><br><b>Your direct reports</b><br>${tm.reports.map(m=>`${esc(m[0])} · ${esc(m[1])}`).join('<br>')}`:''}</div>`; }
function act(t){ S.actions.push(t); const tp=S.plan&&S.plan[S.idx]; const d=document.createElement('div'); d.innerHTML=`<span class="d">${tp?relLabel(tp.abs):'O+0'}</span><span>${esc(t)}</span>`; $('#actLog').prepend(d); }
function handover(who,why){ S.handovers.push({who,why}); const tp=S.plan[S.idx]; if(S.handovers.length===1)$('#hoLog').innerHTML=''; const d=document.createElement('div'); d.innerHTML=`<span class="d">${relLabel(tp.abs)}</span><span><b>${esc(who)}</b>: ${esc(why)}</span>`; $('#hoLog').prepend(d); }
function risk(code,label,w){ if(S.risk.find(r=>r.code===code)) return; S.risk.push({code,label,w}); act('Risk signal noted: '+label); const sc=riskScore(); if(sc>=50 && !S.alerted){ S.alerted=true; handover(cv('recruiter'),'High drop-out risk. Call the candidate today.'); act('Recruiter alerted on WhatsApp and email: high drop-out risk.'); } }
function riskScore(){ return Math.min(100,S.risk.reduce((a,r)=>a+r.w,0)); }
const first=()=>esc(S.c.first);
const mapUrl=()=>cv('mapLink')||('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(cv('mapQuery')||cv('address')||cv('company')));
const mapLink=()=>`<a href="${esc(mapUrl())}" target="_blank" rel="noopener">Open in Google Maps</a>`;
const mapCard=()=>`<a class="mapcard" href="${esc(mapUrl())}" target="_blank" rel="noopener"><span class="mapart" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7z" fill="#D93025"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg></span><span class="mapcap"><b>${esc(cv('address')||cv('company'))}</b><span>Open in Google Maps</span></span></a>`;
function tpInfo(k){ if(TP[k]) return TP[k]; if(k.startsWith('cx:')){ const t=(client.ov.customTps||[]).find(x=>'cx:'+x.id===k); return t?{t:t.name,k:t.track}:{t:'Custom touchpoint',k:'c'}; } if(k.startsWith('sv:')){ const x=custom('survey').find(y=>'sv:'+y.id===k); return {t:'Survey: '+(x?x.value:'').slice(0,40),k:'c'}; } return {t:k,k:'c'}; }
function runCustom(tp){ const k=tp.key;
  if(k.startsWith('sv:')){ const x=custom('survey').find(y=>'sv:'+y.id===k); if(x) pulse(x.value||'How are things going?',['Good','Okay','Not good'],k); return; }
  const t=(client.ov.customTps||[]).find(x=>'cx:'+x.id===k); if(!t) return; const msg=(t.msg||'').replace(/\{first\}/g,S.c.first).replace(/\{company\}/g,cv('short')).replace(/\{doj\}/g,fmtD(S.c.doj)).replace(/\{manager\}/g,S.c.mgr);
  if(t.track==='c'){ if(t.channel==='Call'){ callCard('Voice call · '+(cv('languages').split(',')[0]||'English'),[['Agent',msg]]); agent('<p>Summary of our call: '+esc(msg)+'</p>'); } else if(t.channel==='WhatsApp') agent('<p>'+esc(msg)+'</p>',{qr:[{l:'Thanks!',p:1,f:()=>agent('<p>You are welcome!</p>')},{l:'I have a question',f:()=>agent('<p>Sure, type it here and I\'ll help.</p>')}]}); else act(`${t.channel} to candidate: ${msg}`); act(`${t.name} (${t.channel}) sent to candidate.`); }
  else act(`${t.name}: ${t.channel} to ${t.track==='m'?'manager '+S.c.mgr:'stakeholders'}: ${msg}`); }

const RUN={
  offer(){
    const c=S.c;
    if(c.hasOffer){
      if(lastOffer&&lastOffer.c.name===c.name) docBubble(letterFile()+'.pdf','3 pages',downloadLetterPdf);
      agent(`<p>Hi ${first()}, congratulations! ${esc(cv('short'))} is delighted to offer you the role of <b>${esc(c.role)}</b>.</p>
      <div class="mini"><table><tr><td>Joining date</td><td><b>${fmtD(c.doj)}</b></td></tr><tr><td>Annual CTC</td><td><b>${inr(c.ctc)}</b></td></tr><tr><td>Est. monthly take-home</td><td><b>${inr(c.monthly)}</b></td></tr><tr><td>Reporting to</td><td>${esc(c.mgr)}</td></tr></table></div>
      <p>Your offer letter is ready: <u>secure link</u>. I am ${esc(cv('agentName'))}, and I'll help you right up to your first 90 days.</p>`,{qr:[{l:'Accept offer',p:1,f:()=>accept()},{l:'I have a question',f:()=>agent('<p>Of course. Type your question here, in English, Hindi or Hinglish. I\'ll answer what I can and pass anything else to the hiring team.</p>')},{l:'Need a little time',r:1,f:()=>{agent('<p>No problem. I\'ll check back in two days. If anything is holding you back, you can tell me or ask for a call with the hiring team.</p>');risk('time','Asked for time to decide',15);}}]});
      act(`Offer letter PDF and take-home summary sent on WhatsApp; copy emailed to ${c.email||'candidate'}.`);
    } else {
      agent(`<p>Hi ${first()}, congratulations on your offer from ${esc(cv('short'))} for <b>${esc(c.role)}</b>, joining <b>${fmtD(c.doj)}</b>.</p><p>I am ${esc(cv('agentName'))}. I'll help you with documents, joining details and anything you need until your first 90 days. Have you received your offer letter by email?</p>`,{qr:[{l:'Yes, and I accept',p:1,f:()=>accept()},{l:'Not received yet',f:()=>{agent('<p>Thanks for telling me. I\'ve asked the recruitment team to resend it today.</p>');handover(cv('recruiter'),'Candidate has not received the offer letter.');}},{l:'Still deciding',r:1,f:()=>{agent('<p>Understood. Take your time. Would a call with the hiring team help?</p>');risk('time','Still deciding on the offer',15);}}]});
      act('Engagement opened from uploaded details; offer receipt confirmation requested.');
    }
  },
  docs(){
    if(!S.accepted){ agent(`<p>Hi ${first()}, just checking in on your offer. Is there anything I can clarify before you accept?</p>`,{qr:[{l:'Accept offer',p:1,f:()=>{accept(true);}},{l:'Talk to hiring team',r:1,f:()=>{agent('<p>I\'ve asked the recruiter to call you today.</p>');handover(cv('recruiter'),'Candidate wants to talk before accepting.');}}]}); return; }
    docsRequest();
  },
  forms(){
    const fl=formDefs().filter(f=>f.applies);
    agent(`<p>${first()}, I've pre-filled your joining forms from your documents and answers. Here they are as PDFs (also emailed to you):</p>`);
    fl.forEach(f=>docBubble(`${f.title.replace(/\W+/g,'_')}_prefilled.pdf`,'2 pages',()=>{ const b=formPdf(f.id); if(b) saveFile(`${f.title.replace(/\W+/g,'_')}_${S.c.name.replace(/\W+/g,'_')}.pdf`,b,'application/pdf'); }));
    agent(`<p>Let's check them together; it takes about two minutes. You can also ask me about any of them: nominations, tax regime or PF.</p>`,{qr:[{l:'Check my forms now',p:1,f:()=>formsChat(0)},...faqButtons(false)]});
    act('Pre-filled joining forms sent as PDF attachments on WhatsApp and email.');
  },
  confirm(){
    agent(`<p>${first()}, I've pre-filled your joining form from your documents. Please check:</p><div class="mini"><table><tr><td>Name (as per Aadhaar)</td><td><b>${esc(S.c.name)}</b></td></tr><tr><td>Date of birth</td><td><b>14 Aug 1996</b></td></tr><tr><td>Aadhaar</td><td><b>XXXX XXXX 4821</b></td></tr><tr><td>PAN</td><td><b>ABCPS••••K</b></td></tr><tr><td>Bank</td><td><b>HDFC Bank ••6702</b></td></tr><tr><td>UAN</td><td><b>1009••••3381</b></td></tr></table></div><p>Is everything correct?</p>`,{qr:[{l:'All correct',p:1,f:()=>{S.confirmed=true;agent('<p>Thank you! Your joining form is complete and has gone to HR.</p>');act('Candidate confirmed pre-filled details; form submitted to '+cv('kycTool')+'.');}},{l:'Bank details are wrong',f:()=>{agent('<p>Thanks. Please send a photo of a cancelled cheque or the first page of your passbook, and I\'ll update it.</p>');act('Correction requested: bank details.');}}]});
  },
  resign(){
    agent(`<p>Hi ${first()}, a quick one so we can plan your joining: have you resigned from your current job?</p>`,{qr:[{l:'Yes, resignation accepted',p:1,f:()=>{S.resigned='Resigned, accepted';agent('<p>Great, thank you! Please share the acceptance email or letter when you have it.</p>');act('Resignation confirmed.');}},{l:'Submitted, serving notice',f:()=>{S.resigned='Serving notice';agent('<p>Thanks. If your last working day changes, just tell me and I\'ll update HR.</p>');}},{l:'Not yet',r:1,f:()=>{S.resigned='Not resigned';agent('<p>Thanks for being open. Is anything holding you back? You can also ask for a call with the hiring team.</p>');risk('noresign','Has not resigned yet',25);}}]});
  },
  story(){ agent(`<p>${first()}, here's a short look at the place you're joining.</p><p>${esc(cv('about'))}</p><div class="mini"><b>2-minute welcome video</b><br><span class="note">Plays from a secure link · completion is tracked</span></div>`,{qr:[{l:'Watched it',p:1,f:()=>{agent('<p>Glad you watched it! Any questions about the company, just ask.</p>');act('Company story video watched.');}},{l:'Later',f:()=>agent('<p>Sure, the link stays active.</p>')}]}); act('Company story sent.'); },
  checkin(){
    agent(`<p>Hi ${first()}, about two weeks to go! How are you feeling about joining?</p>`,{qr:[{l:'Excited, all set',p:1,f:()=>agent('<p>Lovely to hear. We\'re looking forward to having you.</p>')},{l:'My company made a counter-offer',r:1,f:()=>{agent('<p>Thanks for telling me honestly. I\'ve asked the hiring team to call you today so you can talk it through.</p>');risk('counter','Counter-offer from current employer',40);handover(cv('recruiter'),'Counter-offer mentioned by candidate.');}},{l:'Asking about notice buyout',r:1,f:()=>{agent('<p>I\'ll ask the hiring team to call you about this. They decide on buyouts.</p>');risk('buyout','Asked about notice-period buyout',15);handover(cv('recruiter'),'Candidate asked about notice-period buyout.');}},{l:'I need help with relocation',f:()=>{agent('<p>I\'ve passed this to HR, who will share relocation support details.</p>');handover('HR','Relocation help requested.');}}]});
    if(S.docs<S.docsTotal) risk('docs','Documents incomplete two weeks before joining',15);
  },
  manager_intro(){ agent(`<p>${first()}, meet your manager, <b>${esc(S.c.mgr)}</b>. They recorded a short welcome for you and will call you this week to say hello.</p><div class="mini"><b>▶ Voice note from ${esc(S.c.mgr.split(',')[0])} · 0:38</b><br><span class="note">"Looking forward to having you on the team. Here's what your first week looks like…"</span></div>${teamHtml()}<p>Your buddy: ${esc(buddyText())}.</p>`,{qr:[{l:'Thanks!',p:1,f:()=>act('Manager intro acknowledged.')},{l:'Haven\'t heard from them',f:()=>{agent('<p>I\'ll remind them today.</p>');act('Reminder sent to manager for pre-joining call.');}}]}); act('Manager intro sent; manager reminded to call candidate.'); },
  induct(){ agent(`<p>${first()}, before Day 1, here's a short induction (5 slides) and a 5-question quiz. It takes about 4 minutes.</p>`,{qr:[{l:'Start quiz here',p:1,f:()=>chatQuiz(0,0)},{l:'Open induction in Tab 4',f:()=>{showTab('induct');}}]}); act('Induction deck and quiz link sent.'); },
  day1kit(){ const rows=[['Where',cv('address')],['Report at',cv('reportTime')],['Ask for',cv('meet')],['Dress code',cv('dress')],['Bring',cv('bring')],['Parking',cv('parking')],['Canteen',cv('canteen')],...custom('day1').map(x=>[x.label,x.value])].filter(r=>r[1]);
    agent(`<p><b>Your Day 1, ${fmtD(S.c.doj)}</b></p><ul>${rows.map(([k,v])=>`<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>${mapCard()}<p>Anything else you'd like to know?</p>`,{qr:[{l:'All clear',p:1,f:()=>agent('<p>See you soon!</p>')},...(cv('parking')?[{l:'Where do I park?',f:()=>agent(`<p>${esc(cv('parking'))}</p>`)}]:[])]}); act('Day-1 kit sent with map card: location, timing, dress code, contact.'); },
  call(){
    act('Voice call placed (Plivo) with Sarvam '+(cv('languages').includes('Kannada')?'Kannada':'Hindi')+' voice.');
    if(cv('languages').includes('Kannada')) callCard('Voice call · Kannada · 1 min 05 s',[['Agent','ನಮಸ್ಕಾರ ಅಂಜಲಿ, ನಾಳೆ ನಿಮ್ಮ ಮೊದಲ ದಿನ. ಬೆಳಿಗ್ಗೆ 8:30ಕ್ಕೆ ಬ್ಲಾಕ್ B HR ಆಫೀಸ್‌ಗೆ ಬನ್ನಿ.','Hello Anjali, tomorrow is your first day. Please come to the Block B HR office at 8:30 AM.'],[S.c.first,'ಹೌದು, ನಾನು ಬರುತ್ತೇನೆ. ಯೂನಿಫಾರ್ಮ್ ನಾಳೆ ಕೊಡ್ತಾರಾ?','Yes, I will come. Will the uniform be given tomorrow?'],['Agent','ಹೌದು, ಯೂನಿಫಾರ್ಮ್ ಮತ್ತು ID ಬ್ಯಾಡ್ಜ್ ನಾಳೆ ಕೊಡಲಾಗುತ್ತದೆ. ಶುಭವಾಗಲಿ!','Yes, the uniform and ID badge are given tomorrow. All the best!']]);
    else callCard('Voice call · Hindi · 1 min 12 s',[['Agent',`नमस्ते ${S.c.first}, कल आपका पहला दिन है। आप ${cv('reportTime')} तक रिसेप्शन पर पहुँचिए और ${cv('meet').split(',')[0]} से मिलिए।`,`Hello ${S.c.first}, tomorrow is your first day. Please reach reception by ${cv('reportTime')} and meet ${cv('meet').split(',')[0]}.`],[S.c.first,'जी, मैं आ रही हूँ। पार्किंग कहाँ है?','Yes, I am coming. Where is the parking?'],['Agent',cv('parking')+'. कोई और सवाल?',cv('parking')+'. Any other question?'],[S.c.first,'नहीं, धन्यवाद।','No, thank you.']]);
    agent('<p>Summary of our call: you\'re confirmed for tomorrow. See you there!</p>');
  },
  welcome(){ agent(`<p>Good morning ${first()}, welcome to ${esc(cv('short'))}! Today: reach by ${esc(cv('reportTime'))} and ask for ${esc(cv('meet'))}. Your buddy: ${esc(buddyText())}.</p>${(()=>{ const t=(plan||curPlan()).filter(it=>+it.day===0); return t.length?`<div class="mini"><b>Today's plan</b><br>${t.map(it=>`${esc(it.time)} · ${esc(it.title)}`).join('<br>')}</div><p>Calendar invites are in your inbox.</p>`:''; })()}`); act('Day-1 welcome sent with today\'s induction plan; HR and manager notified of arrival time.'); },
  survey_d1(){ pulse(cv('sv_d1'),['Great','Okay','Not good'],'d1'); },
  week1(){ agent(`<p>${first()}, one week in! Do you have everything you need?</p>`,{qr:[{l:'Yes, all set',p:1,f:()=>agent('<p>Brilliant!</p>')},{l:'Laptop or access still pending',r:1,f:()=>{agent('<p>Sorry about that. I\'ve raised it with IT and your manager and will check back tomorrow.</p>');handover(cv('itSpoc'),'Laptop or system access still pending in week 1.');}},{l:'Haven\'t met my buddy',f:()=>{agent('<p>I\'ve reminded your manager to introduce your buddy.</p>');act('Buddy introduction reminder sent to manager.');}}]}); },
  pulse15(){ pulse(cv('sv_d15'),['Yes','Mostly','No'],'d15'); },
  pulse30(){ agent(`<p>${first()}, it's Day 30. Have you and ${esc(S.c.mgr)} agreed your goals?</p>`,{qr:[{l:'Yes, goals agreed',p:1,f:()=>{agent('<p>Great, they\'re now recorded.</p>');act('Goals confirmed by new joiner.');}},{l:'Not yet',r:1,f:()=>{agent('<p>I\'ll remind your manager and help you prepare.</p>');act('Goal-setting reminder escalated to manager.');}}]}); },
  pulse45(){ pulse(cv('sv_d45'),['Very well','Fine','Struggling'],'d45'); },
  pulse60(){ pulse(cv('sv_d60'),['Yes','Sometimes','No'],'d60'); },
  pulse75(){ pulse(cv('sv_d75'),['Yes','Maybe','No'],'d75'); },
  final90(){ agent(`<p>Congratulations on 90 days, ${first()}! Two last questions about your onboarding experience, then I'll hand you over to the regular HR help line on this same number.</p>`,{qr:[{l:'Rate it 9/10',p:1,f:()=>{S.pulses.push({k:'d90',v:'9/10'});agent('<p>Thank you! Your feedback goes to HR anonymously in the monthly report.</p>');act('Day-90 survey complete; onboarding closed and handed to run operations.');}},{l:'Rate it 5/10',r:1,f:()=>{S.pulses.push({k:'d90',v:'5/10'});agent('<p>Thank you for being honest. HR will follow up with you.</p>');handover('HR','Low Day-90 onboarding rating.');}}]}); },
  m_prep(){ act(`Email and Teams message to manager ${S.c.mgr}: prepare Day-1 plan, team introductions and buddy.`); setReady('welcome','Requested'); setReady('buddy','Requested'); },
  m_prep2(){ act('Manager confirmed Day-1 plan and buddy (yes/no reply captured).'); setReady('welcome','Confirmed'); setReady('buddy','Confirmed'); },
  m_1on1(){ act('Manager reminded of first structured 1:1; confirmation requested.'); },
  m_goals(){ act('Manager reminded to agree goals by Day 30.'); },
  m_prob(){ act('Manager alerted: probation review due; feedback form link shared.'); },
  it_15(){ act(`Requests sent to ${cv('itSpoc')}, ${cv('adminSpoc')} and ${cv('securitySpoc')}: laptop, email ID, seat, access card.`); ['laptop','seat','card','email'].forEach(k=>setReady(k,'Requested')); S.ready.filter(r=>r.k.startsWith('cp')).forEach(r=>r.st='Requested'); },
  it_7(){ act('Reminders sent; IT confirmed laptop and email ID, Admin confirmed seat.'); setReady('laptop','Confirmed'); setReady('email','Confirmed'); setReady('seat','Confirmed'); S.ready.filter(r=>r.k.startsWith('cp')).forEach(r=>r.st='Confirmed'); },
  it_2(){ act(`Access card still open. Escalated to ${cv('adminSpoc')}'s manager and client HR.`); setReady('card','Escalated'); handover('Client HR','Access card not ready two days before joining.'); },
  ann(){ act('Joining announcement drafted and sent to manager for approval.'); setReady('announce','Confirmed'); },
  stat(){ act('PF, ESI and group insurance enrolment file sent to '+cv('payrollSpoc')+'.'); setReady('statutory','Confirmed'); setReady('card','Confirmed'); }
};
function accept(late){ S.accepted=true; agent(`<p>Wonderful, welcome aboard ${first()}! I've told the hiring team.</p>`); act('Offer accepted; recruiter and hiring manager notified.'); if(!late && S.plan[S.idx+1] && S.plan[S.idx+1].key!=='docs') docsRequest(); else if(late) docsRequest(); }
function docsRequest(){
  const list=cv('docs').split(';').map(s=>s.trim());
  agent(`<p>Next, I need a few documents. You can upload them on this <u>secure link</u>, or simply send a photo here and I'll file it for you.</p><ul>${list.map(d=>`<li>${esc(d)}</li>`).join('')}</ul>`,{qr:[{l:'Send Aadhaar photo',p:1,f:()=>kyc(null)},{l:'I\'ll use the link',f:()=>{S.docs=Math.max(S.docs,list.length-2);agent(`<p>Thanks! I can see ${S.docs} of ${list.length} documents. Still needed: ${esc(list.slice(-2).join(', '))}.</p>`);act('Documents received via upload link; reminder scheduled for the rest.');}}]});
  act('Document checklist and upload link sent; WhatsApp photo capture enabled.');
}
function kyc(file){
  const d=document.createElement('div'); d.className='b out';
  const url=file?URL.createObjectURL(file):specimen();
  d.innerHTML=`<img src="${url}" alt="Document photo" style="border-radius:8px;filter:blur(3px);max-height:140px"><span class="meta">${time()} ✓✓</span>`; msgs.append(d); scroll();
  setTimeout(()=>{ S.kyc=true; S.docs=Math.max(S.docs,4); agent(`<p>Got it, thank you! I read your Aadhaar and masked it: <b>XXXX XXXX 4821</b>. Name matches your offer ✓</p><p>Filed to ${esc(cv('kycTool'))}. The photo has been deleted from this chat's records.</p><p class="note">Demo: document reading is simulated.</p>`); act(`Aadhaar captured on WhatsApp, masked, filed to ${cv('kycTool')}; chat copy purged.`); renderBrain(); },700);
}
function specimen(){ const c=document.createElement('canvas'); c.width=320;c.height=200; const g=c.getContext('2d'); g.fillStyle='#f5f2e8';g.fillRect(0,0,320,200); g.fillStyle='#1F57A6';g.fillRect(0,0,320,34); g.fillStyle='#fff';g.font='bold 16px sans-serif';g.fillText('SPECIMEN ID CARD',14,23); g.fillStyle='#999';g.fillRect(14,50,70,90); g.fillStyle='#333';g.font='14px sans-serif';g.fillText('Name: '+S.c.name,100,70);g.fillText('DOB: 14/08/1996',100,95);g.font='bold 18px monospace';g.fillText('XXXX XXXX 4821',100,160); return c.toDataURL(); }
function faqButtons(withDone){
  const b=cv('faq').slice(0,5).map(([t,,a],i)=>({l:t,p:i===0&&withDone,f:()=>faqAnswer(i)}));
  b.push({l:'Request a call from HR',f:()=>offerCallback('Help with joining forms')});
  if(withDone) b.push({l:'All clear, forms done',f:()=>{S.forms=true;agent('<p>Well done! Your forms are with HR now.</p>');act('Joining forms completed.');}});
  return b;
}
function faqAnswer(i){ const [t,,a]=cv('faq')[i]; agent(`<p><b>${esc(t)}</b></p><p>${esc(a)}</p>`,{qr:[{l:'That helps, thanks',p:1,f:()=>{agent('<p>Glad it helped. Ask me anything else, anytime, day or night.</p>');}},{l:'I still have a doubt',f:()=>offerCallback(t)}]}); act('Form-filling question answered: '+t+'.'); }
function offerCallback(reason){
  agent(`<p>Sure. I'll arrange a call from ${esc(cv('recruiter').split(',')[0])} about <b>${esc(reason)}</b>. When suits you?</p>`,{qr:[{l:'Today, 5 to 7 PM',p:1,f:()=>bookCallback(reason,'Today, 5 to 7 PM')},{l:'Tomorrow, 10 AM to 12',f:()=>bookCallback(reason,'Tomorrow, 10 AM to 12')},{l:'Any time',f:()=>bookCallback(reason,'Any time')}]});
}
function bookCallback(reason,slot){
  S.callbacks.push({reason,slot,st:'Requested',at:S.idx});
  agent(`<p>Done. You'll get a call <b>${esc(slot.toLowerCase())}</b>. I'll remind them, and I'll check with you afterwards that your question was answered.</p>`);
  act(`Call-back requested from ${cv('recruiter')} (${slot}) via Teams and email. Rule: ${cv('callbackSla')}.`);
  handover(cv('recruiter'),'Call-back: '+reason+' · '+slot); renderBrain();
}
function ageCallbacks(){
  S.callbacks.forEach(cb=>{ if(cb.st==='Done') return; const age=S.idx-cb.at;
    if(age===1&&cb.st==='Requested'){ cb.st='Reminder sent'; act('Call-back still open: reminder sent to '+cv('recruiter')+'.'); }
    else if(age>=2&&cb.st!=='Escalated'){ cb.st='Escalated'; act('Call-back overdue: escalated to client HR head.'); handover('Client HR head','Overdue call-back: '+cb.reason); } });
}
function pulse(q,opts,k){ agent(`<p>${first()}, one quick question: <b>${esc(q)}</b></p>`,{qr:opts.map((o,i)=>({l:o,p:i===0,r:i===2,f:()=>{S.pulses.push({k,v:o}); if(i===2){agent('<p>Thank you for telling me. Would you like HR to call you? I\'ve flagged it for them.</p>');handover('HR',`Negative pulse (${q} → ${o}).`);risk('pulse'+k,'Negative pulse response',20);} else agent('<p>Thanks, noted!</p>'); act(`Pulse recorded: ${q} → ${o}`);}}))}); }
function chatQuiz(i,score){ const qz=cv('quiz'); if(i>=qz.length){ S.quiz=`${score}/${qz.length}`; agent(`<p>You scored <b>${score}/${qz.length}</b>. ${score>=4?'Well done, your induction certificate is on its way!':'Thanks! HR will cover these points in your Day-1 induction.'}</p>`); act(`Induction quiz completed: ${score}/${qz.length}.`); renderBrain(); return; }
  const [q,o,a]=qz[i]; agent(`<p><b>Q${i+1}.</b> ${esc(q)}</p>`,{qr:o.map((x,j)=>({l:x,p:j===a,f:()=>{ agent(j===a?'<p>Correct ✓</p>':`<p>The answer is: ${esc(o[a])}</p>`); chatQuiz(i+1,score+(j===a?1:0)); }}))}); }

/* free text */
let sample=null;
(async()=>{ try{ if(window.claude&&claude.use){ sample=await claude.use('sample'); if(sample){ $('#aiChip').textContent='Live AI replies'; $('#aiChip').className='chip teal'; } } }catch(e){ sample=null; } })();
// Company facts for the agent without the candidate's own offer line (kept up to date on the server from Client setup).
function kbClient(){ return kbText().split('\n').filter(l=>!/^offer:/.test(l)).join('\n'); }
function faqText(){ return cv('faq').map(f=>f[0]+': '+f[2]).join('\n'); }
function publishFacts(){ if(!db) return; try{ db.collection('facts').doc(client.id).set({facts:kbClient(),faq:faqText()}); }catch(e){ /* not critical */ } }
function kbText(){ return [...SECTIONS.filter(x=>!x.fixed&&!x.survey).flatMap(x=>x.keys.map(r=>r[0])),'company','about','docs','salaryDate'].filter(k=>cv(k)).map(k=>`${k}: ${cv(k)}`).join('\n')+'\n'+['day1','policy','people','callback','letter'].flatMap(sec=>custom(sec).map(x=>`${x.label}: ${x.value}`)).join('\n')+`\nbuddy: ${buddyText()}`+''+(S?`\noffer: role ${S.c.role}; joining ${fmtD(S.c.doj)}; CTC ${S.c.ctc?inr(S.c.ctc):'as per offer letter'}; est. monthly take-home ${S.c.monthly?inr(S.c.monthly):'see offer letter'}; manager ${S.c.mgr}`:''); }
async function onFree(text){
  if(!text.trim()||!S) return;
  if(S.awaitFix){ const fid=S.awaitFix; S.awaitFix=null; me(text); const f=formDefs().find(x=>x.id===fid); const flds=f.sections.flatMap(x=>x.fields||[]); const low=text.toLowerCase();
    const tgt=flds.find(fl=>low.includes(fl.label.toLowerCase().split(/[ /(]/)[0].replace(/'s$/,'')))||flds[0];
    const nv=(text.replace(/^.*?\b(is spelt|spelt|should be|is)\b\s*/i,'').replace(/["']/g,'').trim())||text;
    S.formVals[fkey(fid,tgt.k)]=nv; S.formState[fkey(fid,tgt.k)]='corrected'; formItems(f).forEach(k=>{ if(fstate(fid,k)==='pending') S.formState[fkey(fid,k)]='confirmed'; });
    agent(`<p>Updated <b>${esc(tgt.label)}</b> to "${esc(nv)}" and confirmed the rest of ${esc(f.title)}. HR can see the change.</p>`); act(`${f.title}: candidate corrected ${tgt.label}.`);
    const idx=formDefs().filter(x=>x.applies).findIndex(x=>x.id===fid); setTimeout(()=>formsChat(idx+1),500); renderBrain(); return; }
  me(text); const t=document.createElement('div'); t.className='typing'; t.textContent=cv('agentName')+' is typing…'; msgs.append(t); scroll();
  let res=null;
  if(sample){ try{
    const prompt=`You are "${cv('agentName')}", the WhatsApp onboarding assistant for ${cv('company')}, run by Talent Carriage for the HR team. You are talking to ${S.c.name}, a candidate who has an offer.
Rules: answer ONLY from FACTS. Under 60 words, warm, plain WhatsApp style, no headings. Reply in the language and script the candidate used (English, Hindi, Hinglish or Kannada).
Never negotiate or change salary, joining date, role, notice buyout or any term, and never promise anything. For those, for complaints, harassment, health matters, or anything not in FACTS: say you are passing it to the hiring team who will call within one working day, and set handover true.
If the candidate asks to talk to a person or be called back, set "callback" to a short topic in lower case, e.g. "your PF nomination question".
FACTS:
${kbText()}
JOINING-FORM HELP (approved answers; use them, in your own simple words):
${cv('faq').map(f=>f[0]+': '+f[2]).join('\n')}
RECENT CHAT:
${S.chat.slice(-8).map(m=>(m.role==='user'?'Candidate: ':'Agent: ')+m.content.slice(0,300)).join('\n')}
CANDIDATE'S NEW MESSAGE: "${text}"
Reply with only JSON: {"reply":"...","handover":true|false,"handoverReason":"...","callback":"" ,"riskSignals":["e.g. counter-offer mentioned"]}`;
    res=await sample.json(prompt,{modelTier:'quick',cache:false});
  }catch(e){ res=null; if(e&&(e.code==='not_granted'||e.code==='sampling_disabled')){ sample=null; $('#aiChip').textContent='Scripted replies'; $('#aiChip').className='chip'; } } }
  if(!res||typeof res.reply!=='string') res=scripted(text);
  t.remove(); agent(`<p>${esc(res.reply)}</p>`);
  if(res.handover){ handover(cv('recruiter'),res.handoverReason||'Question outside what the agent may answer.'); quick([{l:'Book a call-back',p:1,f:()=>offerCallback(res.handoverReason||text.slice(0,60))},{l:'No need',f:()=>agent('<p>Okay. The team will reply here on WhatsApp.</p>')}]); }
  if(res.callback) offerCallback(res.callback);
  (res.riskSignals||[]).forEach(s=>risk('ai:'+s,s,s.toLowerCase().includes('counter')?40:15));
  act('Answered free-text question'+(res.handover?' and handed over':'')+'.'); renderBrain();
}
function scripted(q){ const s=q.toLowerCase(); const H=r=>({reply:r,handover:false,riskSignals:[]});
  if(/counter|another offer|other offer|retain/.test(s)) return {reply:'Thanks for telling me. I\'m passing this to the hiring team, who will call you within one working day.',handover:true,handoverReason:'Candidate mentioned a counter or competing offer.',riskSignals:['Counter or competing offer mentioned']};
  if(/salary|ctc|hike|increase|negotiat|package|buyout|joining date|postpone|prepone|extend/.test(s)) return {reply:'That\'s for the hiring team to decide, so I\'ve passed your question to them. They\'ll call you within one working day.',handover:true,handoverReason:'Offer terms question: '+q.slice(0,80),riskSignals:/buyout|postpone|extend/.test(s)?['Asked to change notice or joining date']:[]};
  if(/harass|complain|posh|unsafe|abuse/.test(s)) return {reply:'I\'m sorry to hear this. I\'m passing it straight to a senior HR person, who will contact you confidentially today.',handover:true,handoverReason:'Sensitive matter, routed to senior HR.',riskSignals:[]};
  if(/call me|callback|call back|talk to (someone|a person|hr)|speak to/.test(s)) return {reply:'Of course. Let me book a call for you.',handover:false,callback:'your question',riskSignals:[]};
  const fq=cv('faq').find(([,kw])=>new RegExp(kw,'i').test(s)); if(fq) return {reply:fq[2],handover:false,riskSignals:[],faq:fq[0]};
  for(const sec of ['day1','policy','callback']){ for(const x of custom(sec)){ const ws=(x.label||'').toLowerCase().split(/\W+/).filter(w=>w.length>=4); if(ws.some(w=>s.includes(w))) return H(`${x.label}: ${x.value}`); } }
  if(/map|direction|route|google/.test(s)) return H(`Here is the location: ${cv('address')}. Map: ${mapUrl()}`);
  if(/dress|wear|kapde|uniform/.test(s)) return H(cv('dress'));
  if(/time|kab|kitne baje|report|when/.test(s)) return H(`Please report at ${cv('reportTime')} on ${fmtD(S.c.doj)} and ask for ${cv('meet')}.`);
  if(/where|address|location|kahan|map|office/.test(s)) return H(`${cv('address')}. I'll send the map link on Day-1 kit day too.`);
  if(/park/.test(s)) return H(cv('parking'));
  if(/canteen|food|lunch|khana/.test(s)) return H(cv('canteen'));
  if(/salary date|paid|payday|credit/.test(s)) return H(`Salary is credited on the ${cv('salaryDate').toLowerCase()}.`);
  if(/probation/.test(s)) return H(`Probation is ${cv('probation')}.`);
  if(/leave|chutti|holiday/.test(s)) return H(cv('leave'));
  if(/document|bring|kya lana/.test(s)) return H(`Please bring: ${cv('bring')}.`);
  if(/take.?home|in.?hand|deduction|tax|pf/.test(s)) return H(S.c.monthly?`Your estimated monthly take-home is ${inr(S.c.monthly)} after PF, professional tax and income tax under the new regime. Your first payslip will show the exact figure.`:'Your offer letter shows the salary details; your first payslip will show exact deductions.');
  if(/hi|hello|namaste|thanks|thank you|dhanyavad/.test(s)) return H(`Happy to help, ${S.c.first}! Ask me anything about joining.`);
  return {reply:'Good question. I don\'t have that information yet, so I\'ve passed it to the hiring team. They\'ll get back to you within one working day.',handover:true,handoverReason:'Unanswered question: '+q.slice(0,80),riskSignals:[]};
}
$('#sendBtn').onclick=()=>{ const v=$('#chatIn').value; $('#chatIn').value=''; onFree(v); };
$('#chatIn').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#sendBtn').click(); }});
$('#camBtn').onclick=()=>$('#kycFile').click();
$('#helpBtn').onclick=()=>{ if(!S)return; me('Help'); setTimeout(()=>{ agent(`<p>I'm here 24×7, ${first()}. What do you need?</p>`,{qr:[
  {l:'Joining forms help',p:1,f:()=>agent('<p>Which part?</p>',{qr:faqButtons(false)})},
  {l:'My Day-1 details',f:()=>agent(`<p>${fmtD(S.c.doj)} · ${esc(cv('reportTime'))} · ${esc(cv('address'))}. Ask for ${esc(cv('meet'))}. ${mapLink()}</p>`)},
  {l:'My offer summary',f:()=>agent(`<p>${esc(S.c.role)} · CTC ${S.c.ctc?inr(S.c.ctc):'as per offer letter'}${S.c.monthly?` · est. take-home ${inr(S.c.monthly)} a month`:''} · reporting to ${esc(S.c.mgr)}.</p>`)},
  ...(team().on?[{l:'My team',f:()=>agent(teamHtml()||'<p>Team details will be shared by your manager.</p>')}]:[]),
  {l:'Talk to a person',f:()=>offerCallback('General question')}]}); },350); };
$('#kycFile').onchange=e=>{ const f=e.target.files[0]; if(f&&S) kyc(f); e.target.value=''; };
$('#nextTp').onclick=()=>nextTouch();
$('#resetJ').onclick=()=>startCandidate(S.c);
$('#goQuiet').onclick=()=>{ if(!S)return; $$('#msgs .qr button').forEach(b=>b.disabled=true); agent(`<p>Hi ${first()}, just making sure you saw my last message. 🙂</p>`); act('No reply in 48 hours: WhatsApp nudge sent.'); risk('quiet','No reply for 48 hours',20);
  setTimeout(()=>{ callCard('Voice call · no answer',[['Agent','Call attempted at 6:15 PM (after work hours). No answer; voicemail left.']]); act('Follow-up call attempted; recruiter informed.'); handover(cv('recruiter'),'Candidate silent for 48 hours after two attempts.'); renderBrain(); },900); };
let autoT=null;
function stopAuto(){ clearInterval(autoT); autoT=null; $('#autoPlay').setAttribute('aria-pressed','false'); $('#autoPlay').textContent='Auto-play'; }
$('#autoPlay').onclick=()=>{ if(autoT){stopAuto();return;} $('#autoPlay').setAttribute('aria-pressed','true'); $('#autoPlay').textContent='Pause'; autoT=setInterval(autoStep,1600); };
function autoStep(){ if(!S){stopAuto();return;} const qrs=[...$$('#msgs .qr')].pop(); const open=qrs&&[...qrs.children].filter(b=>!b.disabled);
  if(open&&open.length){ const want=$('#scenario').value==='risk'?open.find(b=>b.dataset.r):null; (want||open.find(b=>b.dataset.p)||open[0]).click(); return; }
  if(S.idx>=S.plan.length-1){stopAuto();return;} nextTouch(); }
$('#scenario').onchange=()=>startCandidate(S.c);

function renderBrain(){
  if(!S) return; const c=S.c, sc=riskScore(), lvl=sc>=50?'High':sc>=25?'Medium':'Low';
  $('#facts').innerHTML=[['Candidate',`${esc(c.name)} · ${esc(c.role)}`],['Offer',S.accepted?'<span class="chip ok">Accepted</span>':'<span class="chip warn">Awaiting acceptance</span>'],['Joining',fmtD(c.doj)],['Documents',`${S.docs} of ${S.docsTotal}${S.kyc?' · Aadhaar masked':''}`],['Details confirmed',S.confirmed?'Yes':'Not yet'],['Resignation',esc(S.resigned)],['Quiz',S.quiz||'Not taken'],['Joining forms',(()=>{ const fs=formDefs().filter(f=>f.applies); const p=fs.reduce((a,f)=>{ const x=formProgress(f); return [a[0]+x.done,a[1]+x.total]; },[0,0]); return `${p[0]} of ${p[1]} fields confirmed`; })()],['Pulses',S.pulses.length?S.pulses.map(p=>esc(p.v)).join(', '):'None yet'],['Channel',esc(cv('languages'))+' · WhatsApp + voice']].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#riskChip').textContent=lvl; $('#riskChip').className='chip '+(lvl==='High'?'bad':lvl==='Medium'?'warn':'ok');
  $('#riskBar').style.width=Math.max(5,sc)+'%'; $('#riskBar').style.background=lvl==='High'?'var(--bad)':lvl==='Medium'?'var(--warn)':'var(--ok)';
  $('#riskList').innerHTML=S.risk.length?S.risk.map(r=>`<li>${esc(r.label)}</li>`).join(''):'<li>No warning signs yet</li>';
  const CBC={'Requested':'info','Reminder sent':'warn','Escalated':'bad','Done':'ok'};
  $('#cbList').innerHTML=S.callbacks.length?S.callbacks.map((cb,i)=>`<div><span class="d"><span class="chip ${CBC[cb.st]}" style="padding:2px 6px">${cb.st==='Reminder sent'?'Reminded':cb.st}</span></span><span>${esc(cb.reason)} · ${esc(cb.slot)}${cb.st!=='Done'?` <button class="btn small" data-cb="${i}">Mark called</button>`:''}</span></div>`).join(''):'<div><span class="d">—</span><span class="note">None yet</span></div>';
  $$('#cbList [data-cb]').forEach(b=>b.onclick=()=>{ const cb=S.callbacks[+b.dataset.cb]; cb.st='Done'; act('Call-back completed; agent will confirm with candidate.'); agent(`<p>Hi ${first()}, did the HR team's call answer your question about ${esc(cb.reason.toLowerCase())}?</p>`,{qr:[{l:'Yes, all sorted',p:1,f:()=>agent('<p>Great! I\'m here if anything else comes up.</p>')},{l:'Not fully',f:()=>offerCallback(cb.reason)}]}); renderBrain(); });
  $('#alertBox').innerHTML=S.alerted?`<div class="alert"><b>Recruiter alert sent.</b> ${esc(c.first)} shows high drop-out risk. ${esc(cv('recruiter'))} has been asked to call today.</div>`:'';
}

/* ---------- Day-1 readiness ---------- */
function readyTemplate(){ return [
  {k:'laptop',task:'Laptop and system access',own:()=>personFor('itSpoc','IT'),due:'D-7',st:'Not started'},
  {k:'email',task:'Email ID and HRMS login',own:()=>personFor('itSpoc','IT'),due:'D-7',st:'Not started'},
  {k:'seat',task:'Seat or workstation',own:()=>personFor('adminSpoc','Admin'),due:'D-7',st:'Not started'},
  {k:'card',task:'Access card or ID badge',own:()=>personFor('securitySpoc','Security'),due:'D-2',st:'Not started'},
  {k:'welcome',task:'Day-1 plan and team introductions',own:()=>'Manager: '+(S?S.c.mgr:cv('managerName')),due:'D-2',st:'Not started'},
  {k:'buddy',task:'Buddy assigned',own:()=>'Manager: '+(S?S.c.mgr:cv('managerName')),due:'D-2',st:'Not started'},
  {k:'announce',task:'Joining announcement approved',own:()=>'Manager and client HR',due:'D-1',st:'Not started'},
  {k:'statutory',task:'PF, ESI and group insurance enrolment',own:()=>cv('payrollSpoc'),due:'D+0',st:'Not started'},
  ...custom('people').map(p=>({k:'cp'+p.id,task:`Day-1 preparation: ${p.label||'contact'}`,own:()=>p.value||p.label,due:'D-2',st:'Not started'}))
].filter(r=>r.own());}
function setReady(k,st){ const r=S.ready.find(x=>x.k===k); if(r) r.st=st; }
const STC={'Not started':'','Requested':'info','Confirmed':'ok','Escalated':'bad'};
function msgFor(r){ const c=S.c; return `To: ${r.own()}\nCc: Client HR, ${c.mgr}\nSubject: ${r.st==='Escalated'?'ESCALATION – ':''}New colleague joining on ${fmtD(c.doj)}: ${r.task}\n\nHello,\n\n${c.name} joins ${cv('short')} as ${c.role} on ${fmtD(c.doj)}, reporting to ${c.mgr}.\n\nPlease ${r.task.toLowerCase()} by ${r.due} (${fmtD(dateOf(parseOff(r.due,S.gap)))}).\n\nReply DONE to this email or tap "Done" in Teams, and I'll update the readiness tracker.${r.st==='Escalated'?'\n\nThis item is still open two days before joining and has been escalated to you.':''}\n\n${cv('agentName')}\nOn behalf of ${cv('short')} HR · delivered by Talent Carriage`; }
function renderReady(){
  if(!S){ $('#readyTbl').innerHTML='<tr><td class="note">Start a candidate from the Offer desk first.</td></tr>'; return; }
  $('#readyTbl').innerHTML='<tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr>'+S.ready.map((r,i)=>`<tr><td>${esc(r.task)}</td><td>${esc(r.own())}</td><td>${r.due}</td><td><span class="chip ${STC[r.st]}">${r.st}</span></td><td class="row"><button class="btn small" data-v="${i}">View message</button>${r.st!=='Confirmed'?`<button class="btn small" data-d="${i}">Mark done</button>`:''}</td></tr>`).join('');
  $$('#readyTbl [data-v]').forEach(b=>b.onclick=()=>{ const r=S.ready[+b.dataset.v]; $('#drawerTitle').textContent='Message to '+r.own(); $('#drawer').textContent=msgFor(r); });
  $$('#readyTbl [data-d]').forEach(b=>b.onclick=()=>{ S.ready[+b.dataset.d].st='Confirmed'; renderReady(); });
  const pct=Math.round(100*S.ready.filter(r=>r.st==='Confirmed').length/S.ready.length);
  $('#ringArc').setAttribute('stroke-dashoffset',314-314*pct/100); $('#ringTxt').textContent=pct+'%';
}

/* ---------- Induction plan, deck and quiz ---------- */
const MODES=['Calendar invite','WhatsApp reminder','Email','Call'];
const DEFAULT_PLAN=[
  {day:0,time:'09:30',mins:60,title:'Welcome and HR induction',owner:'HR',modes:['Calendar invite','WhatsApp reminder'],material:'Company induction deck'},
  {day:0,time:'11:00',mins:45,title:'IT setup and system access',owner:'IT',modes:['Calendar invite'],material:''},
  {day:0,time:'14:00',mins:30,title:'Meet your manager: role and first-week plan',owner:'Manager',modes:['Calendar invite','WhatsApp reminder'],material:''},
  {day:1,time:'10:00',mins:60,title:'Policies, payroll and benefits walkthrough',owner:'HR',modes:['Calendar invite','Email'],material:'Policy handbook'},
  {day:2,time:'15:00',mins:30,title:'Buddy connect',owner:'Buddy',modes:['WhatsApp reminder'],material:''},
  {day:7,time:'16:00',mins:30,title:'Week-1 check-in with manager',owner:'Manager',modes:['Calendar invite','Call'],material:''},
  {day:14,time:'11:00',mins:45,title:'Know-your-company quiz and certificate',owner:'HR',modes:['WhatsApp reminder'],material:'Quiz link'},
  {day:30,time:'15:00',mins:45,title:'Goal-setting discussion',owner:'Manager',modes:['Calendar invite','WhatsApp reminder'],material:'Goal template'},
  {day:90,time:'15:00',mins:30,title:'Onboarding completion review',owner:'HR and manager',modes:['Calendar invite','Email'],material:'Day-90 survey'}
];
let plan=null, planDirty=false;
function curPlan(){ const saved=store.plans[client.id]; return (saved&&saved.items)?saved.items:(client.ov.plan||DEFAULT_PLAN); }
function loadPlan(){ plan=JSON.parse(JSON.stringify(curPlan())); planDirty=false; renderPlan(); }
function planDate(it){ const doj=S?S.c.doj:new Date(2026,11,1); const d=new Date(doj.getTime()+it.day*DAY); const [h,m]=(it.time||'10:00').split(':').map(Number); d.setHours(h||10,m||0,0,0); return d; }
function renderPlan(){ if(!plan) return;
  $('#ipTbl').innerHTML='<tr><th>Day</th><th>Time</th><th>Activity</th><th>Owner</th><th>Reminders</th><th>Material</th><th></th></tr>'+plan.map((it,i)=>`<tr>
    <td><input type="number" data-ip="${i}" data-f="day" value="${it.day}" style="width:64px" aria-label="Day after joining"><div class="note">${fmtShort(planDate(it))}</div></td>
    <td><input type="text" data-ip="${i}" data-f="time" value="${esc(it.time)}" style="width:70px" aria-label="Time"></td>
    <td><input type="text" data-ip="${i}" data-f="title" value="${esc(it.title)}" style="min-width:220px;width:100%" aria-label="Activity"></td>
    <td><input type="text" data-ip="${i}" data-f="owner" value="${esc(it.owner)}" style="width:110px" aria-label="Owner"></td>
    <td><div class="modes">${MODES.map(m=>`<label class="mchip ${it.modes.includes(m)?'on':''}"><input type="checkbox" data-ipm="${i}" value="${m}" ${it.modes.includes(m)?'checked':''}>${m}</label>`).join('')}</div></td>
    <td><div class="note">${esc(it.material||'None')}</div><label class="btn small filebtn">Upload<input type="file" data-ipf="${i}" hidden></label></td>
    <td class="row"><button class="btn small" data-ipi="${i}">Invite (.ics)</button><button class="btn small" data-ipx="${i}">Remove</button></td></tr>`).join('');
  $$('#ipTbl [data-ip]').forEach(e=>e.onchange=()=>{ const it=plan[+e.dataset.ip]; it[e.dataset.f]=e.dataset.f==='day'?(+e.value||0):e.value; planDirty=true; if(e.dataset.f==='day'){ plan.sort((a,b)=>a.day-b.day||String(a.time).localeCompare(b.time)); renderPlan(); } });
  $$('#ipTbl [data-ipm]').forEach(e=>e.onchange=()=>{ const it=plan[+e.dataset.ipm]; it.modes=e.checked?[...new Set([...it.modes,e.value])]:it.modes.filter(m=>m!==e.value); planDirty=true; renderPlan(); });
  $$('#ipTbl [data-ipf]').forEach(e=>e.onchange=()=>{ const f=e.files[0]; if(!f) return; plan[+e.dataset.ipf].material=`${f.name} (${Math.max(1,Math.round(f.size/1024))} KB)`; planDirty=true; renderPlan(); toast('Material attached to this milestone. In live use it is stored in the client\'s document library.'); });
  $$('#ipTbl [data-ipx]').forEach(e=>e.onclick=()=>{ plan.splice(+e.dataset.ipx,1); planDirty=true; renderPlan(); });
  $$('#ipTbl [data-ipi]').forEach(e=>e.onclick=()=>{ const it=plan[+e.dataset.ipi]; saveFile(`Invite_${it.title.replace(/\W+/g,'_').slice(0,40)}.ics`,icsFor([evOf(it)]),'text/calendar'); });
}
function evOf(it){ return {start:planDate(it),mins:+it.mins||30,title:`${it.title} – ${S?S.c.name:'New joiner'}`,desc:`Onboarding milestone for ${S?S.c.name:'new joiner'} (${cv('short')}). Owner: ${it.owner}. ${it.material?'Material: '+it.material:''}`,loc:cv('address')}; }
$('#ipAdd').onclick=()=>{ plan.push({day:3,time:'11:00',mins:30,title:'New activity',owner:'HR',modes:['WhatsApp reminder'],material:''}); plan.sort((a,b)=>a.day-b.day); planDirty=true; renderPlan(); };
$('#ipIcs').onclick=()=>saveFile(`Induction_plan_${(S?S.c.name:'new_joiner').replace(/\W+/g,'_')}.ics`,icsFor(plan.filter(it=>it.modes.includes('Calendar invite')).map(evOf)),'text/calendar');
$('#ipSave').onclick=async()=>{ if(await saveRec('plans',client.id,{items:plan,client:client.id,updated:new Date().toISOString()})) planDirty=false; };
STORE_HOOKS.push(k=>{ if(k==='plans'&&!planDirty) loadPlan(); });
let si=0, sTimer=null;
function renderSlide(){ const sl=cv('slides'); si=(si+sl.length)%sl.length; const [n,h,p]=sl[si]; $('#slide').innerHTML=`<div class="bars"></div><div class="num">${esc(cv('short'))} · ${si+1} of ${sl.length} · ${esc(n)}</div><h3>${esc(h)}</h3><p>${esc(p)}</p>`; $('#slideProg').innerHTML=sl.map((_,i)=>`<span class="${i<=si?'on':''}"></span>`).join(''); }
$('#prevS').onclick=()=>{si--;renderSlide();}; $('#nextS').onclick=()=>{si++;renderSlide();};
$('#playS').onclick=()=>{ if(sTimer){clearInterval(sTimer);sTimer=null;$('#playS').textContent='Play';return;} $('#playS').textContent='Pause'; sTimer=setInterval(()=>{si++;renderSlide();},3500); };
function renderQuiz(){ const qz=cv('quiz'); $('#quizRes').textContent=''; $('#quizForm').innerHTML=qz.map(([q,o],i)=>`<div class="quizq"><b>${i+1}. ${esc(q)}</b><div class="opts">${o.map((x,j)=>`<label><input type="radio" name="q${i}" value="${j}"> <span>${esc(x)}</span></label>`).join('')}</div></div>`).join(''); }
$('#quizSubmit').onclick=()=>{ const qz=cv('quiz'); let sc=0; qz.forEach(([q,o,a],i)=>{ const sel=$(`input[name=q${i}]:checked`); $$(`input[name=q${i}]`).forEach(inp=>{ const l=inp.parentElement; l.classList.remove('right','wrong'); if(+inp.value===a) l.classList.add('right'); else if(inp.checked) l.classList.add('wrong'); }); if(sel&&+sel.value===a) sc++; }); $('#quizRes').innerHTML=`Score <b>${sc}/${qz.length}</b>. ${sc>=4?'Certificate issued and recorded for HR.':'HR covers the missed points on Day 1.'}`; if(S){ S.quiz=`${sc}/${qz.length}`; renderBrain(); } };

/* ---------- Joining forms (pre-filled, candidate-confirmed) ---------- */
const FORM_NOTE='Layouts follow the published structure of the official EPFO, ESIC and Payment of Gratuity forms. Before live use, each layout is checked against the current official PDF, including any new formats under the Code on Social Security Rules (notified 8 May 2026).';
let fmSel='f11';
function formDefs(){
  if(!S) return []; const c=S.c, p=S.pd, emp=cv('company'), doj=fmtD(c.doj);
  const F=(k,num,label,val,src)=>({k,num,label,val,src});
  const forms=[
    {id:'f11',title:'Form 11',sub:'Composite Declaration Form (EPF)',org:'Employees\' Provident Fund Organisation',applies:true,sections:[
      {h:'Member details',fields:[F('name','1','Name of the member',c.name,'Aadhaar scan'),F('father','2',p.spouse?'Spouse\'s name':'Father\'s name',p.spouse||p.father,'Aadhaar scan'),F('dob','3','Date of birth',p.dob,'Aadhaar scan'),F('gender','4','Gender',p.gender,'Aadhaar scan'),F('marital','5','Marital status',p.marital,'Candidate (WhatsApp)'),F('email','6(a)','Email ID',p.email||c.email,'Offer'),F('mobile','6(b)','Mobile number',c.mobile,'Offer')]},
      {h:'Previous membership',fields:[F('prevEpf','7','Whether earlier a member of the Employees\' Provident Fund Scheme, 1952',p.prevEpf,'Candidate (WhatsApp)'),F('prevEps','8','Whether earlier a member of the Employees\' Pension Scheme, 1995',p.prevEps,'Candidate (WhatsApp)')]},
      {h:'Previous employment details (if yes to 7 and/or 8)',fields:[F('uan','9(a)','Universal Account Number (UAN)',p.uan||(p.prevEpf==='No'?'Not applicable: new UAN to be generated':''),'Previous UAN record'),F('prevPf','9(b)','Previous PF account number',p.prevPf||(p.prevEpf==='No'?'Not applicable':''),'Previous UAN record'),F('exit','9(c)','Date of exit from previous employment',p.exitDate||(p.prevEpf==='No'?'Not applicable':''),'Candidate (WhatsApp)'),F('scert','9(d)','Scheme certificate number (if issued)','Not issued','Candidate (WhatsApp)'),F('ppo','9(e)','Pension Payment Order (PPO) number (if issued)','Not issued','Candidate (WhatsApp)')]},
      {h:'International worker',fields:[F('intl','10(a)','International worker',p.intl||'No','Candidate (WhatsApp)'),F('country','10(b)','If yes, country of origin','Not applicable','Candidate (WhatsApp)'),F('passport','10(c)','Passport number and validity','Not applicable','Candidate (WhatsApp)')]},
      {h:'KYC details',fields:[F('bank','11(a)','Bank account number and IFSC',p.bank,'Bank proof scan'),F('aadhaar','11(b)','Aadhaar number',p.aadhaar,'Aadhaar scan'),F('pan','11(c)','Permanent Account Number (PAN), if available',p.pan,'PAN scan')]},
      {h:'Declaration by present employer',fields:[F('empdoj','A','Date of joining',doj,'Employer (client HR)'),F('empname','B','Establishment',emp,'Employer (client HR)')]}
    ]},
    {id:'f2a',title:'Form 2 (Revised), Part A',sub:'Nomination and declaration: Employees\' Provident Fund',org:'Employees\' Provident Fund Organisation',applies:true,sections:[
      {h:'Member details',fields:[F('name','1','Name (in block letters)',c.name.toUpperCase(),'Aadhaar scan'),F('father','2','Father\'s / husband\'s name',p.spouse||p.father,'Aadhaar scan'),F('dob','3','Date of birth',p.dob,'Aadhaar scan'),F('gender','4','Sex',p.gender,'Aadhaar scan'),F('marital','5','Marital status',p.marital,'Candidate (WhatsApp)'),F('acct','6','Account number',p.uan?'UAN '+p.uan:'Allotted after joining','Employer (client HR)'),F('addrPerm','7','Address: permanent',p.addrPerm,'Aadhaar scan'),F('addrPres','7','Address: temporary',p.addrPres,'Candidate (WhatsApp)')]},
      {h:'Nominee(s) for Provident Fund',table:{k:'nom',cols:['Name of nominee','Address','Relationship with member','Date of birth','Share of PF accumulation','If minor: guardian'],rows:p.nominees,src:'Candidate (WhatsApp)'}}
    ]},
    {id:'f2b',title:'Form 2 (Revised), Part B',sub:'Nomination and declaration: Employees\' Pension Scheme (para 18)',org:'Employees\' Provident Fund Organisation',applies:true,sections:[
      {h:'Family members eligible for widow or children pension',table:{k:'fam',cols:['Name of family member','Date of birth','Relationship with member','Address'],rows:p.family.filter(f=>/Spouse|Son|Daughter|Child/i.test(f[1])).map(f=>[f[0],f[2],f[1],p.addrPres]),src:'Candidate (WhatsApp)',empty:'No spouse or children declared'}},
      {h:'Nominee for monthly widow pension where there is no family',table:{k:'epsnom',cols:['Name and address of nominee','Date of birth','Relationship with member'],rows:p.family.some(f=>/Spouse|Son|Daughter|Child/i.test(f[1]))?[]:p.nominees.map(n=>[n[0]+', '+n[1],n[3],n[2]]),src:'Candidate (WhatsApp)',empty:'Not required: family members declared above'}}
    ]},
    {id:'esic',title:'ESIC Declaration Form (Form 1)',sub:'Employees\' State Insurance: declaration by insured person',org:'Employees\' State Insurance Corporation',applies:!!c.esic,why:'Not applicable: gross pay is above ₹21,000 a month',sections:[
      {h:'Insured person',fields:[F('ins','1','Insurance number','Allotted on registration','Employer (client HR)'),F('name','2','Name',c.name,'Aadhaar scan'),F('father','3','Father\'s / husband\'s name',p.spouse||p.father,'Aadhaar scan'),F('dob','4','Date of birth',p.dob,'Aadhaar scan'),F('marital','5','Marital status',p.marital,'Candidate (WhatsApp)'),F('gender','6','Sex',p.gender,'Aadhaar scan'),F('addrPres','7','Present address',p.addrPres,'Candidate (WhatsApp)'),F('addrPerm','8','Permanent address',p.addrPerm,'Aadhaar scan'),F('disp','9','Dispensary preferred','Nearest ESI dispensary to present address','Candidate (WhatsApp)')]},
      {h:'Employer',fields:[F('empcode','10','Employer\'s code number','Client ESIC code','Employer (client HR)'),F('empdoj','11','Date of appointment',doj,'Offer'),F('empname','12','Name and address of employer',emp+', '+cv('address'),'Employer (client HR)')]},
      {h:'Particulars of family members',table:{k:'esfam',cols:['Name','Date of birth','Relationship','Residing with insured person? If no, place'],rows:p.family.map(f=>[f[0],f[2],f[1],f[3]]),src:'Candidate (WhatsApp)'}},
      {h:'Nominee',fields:[F('esnom','13','Name, relationship and address of nominee',p.nominees[0]?`${p.nominees[0][0]} (${p.nominees[0][2]}), ${p.nominees[0][1]}`:'','Candidate (WhatsApp)')]}
    ]},
    {id:'gf',title:'Form F',sub:'Nomination for gratuity (Payment of Gratuity (Central) Rules, rule 6(1))',org:'Payment of Gratuity (Central) Rules, 1972',applies:true,sections:[
      {h:'Nominee(s)',table:{k:'gnom',cols:['Name in full with full address of nominee','Relationship with the employee','Age of nominee','Proportion in which gratuity will be shared'],rows:p.nominees.map(n=>[n[0]+', '+n[1],n[2],n[3],n[4]]),src:'Candidate (WhatsApp)'}},
      {h:'Statement of the employee',fields:[F('name','1','Name of employee in full',c.name,'Aadhaar scan'),F('gender','2','Sex',p.gender,'Aadhaar scan'),F('religion','3','Religion',p.religion,'Candidate to fill'),F('marital','4','Whether unmarried / married / widow / widower',p.marital,'Candidate (WhatsApp)'),F('dept','5','Department / branch / section where employed',c.dept||team().dept,'Offer'),F('post','6','Post held',c.role,'Offer'),F('empdoj','7','Date of appointment',doj,'Offer'),F('addrPerm','8','Permanent address',p.addrPerm,'Aadhaar scan')]}
    ]}
  ];
  (client.ov.formsOff||[]).forEach(id=>{ const f=forms.find(x=>x.id===id); if(f){ f.applies=false; f.why='Switched off for this client'; } });
  const auto=(l,v)=>{ const L=l.toLowerCase(); if(v) return v; if(/father|spouse/.test(L)) return p.spouse||p.father; if(/date of joining|joining date/.test(L)) return doj; if(/designation|role|post/.test(L)) return c.role; if(/department/.test(L)) return c.dept||team().dept; if(/mobile|phone/.test(L)) return c.mobile; if(/email/.test(L)) return p.email||c.email; if(/birth|dob/.test(L)) return p.dob; if(/address/.test(L)) return p.addrPres; if(/\bpan\b/.test(L)) return p.pan; if(/name/.test(L)) return c.name; return ''; };
  (client.ov.customForms||[]).forEach(cf=>forms.push({id:'cf'+cf.id,title:cf.name,sub:cf.desc||'Client form',org:cv('company'),applies:true,custom:true,sections:[{h:'Details',fields:cf.fields.map((x,i)=>F('c'+i,String(i+1),x.label,auto(x.label,x.value),x.src))}]}));
  return forms;
}
function fkey(f,k){ return f+':'+k; }
function fval(f,fld){ const o=S.formVals[fkey(f,fld.k)]; return o!==undefined?o:fld.val; }
function fstate(f,k){ return S.formState[fkey(f,k)]||'pending'; }
function formItems(form){ const it=[]; form.sections.forEach(s=>{ if(s.fields) s.fields.forEach(x=>it.push(x.k)); if(s.table) it.push(s.table.k); }); return it; }
function formProgress(form){ const it=formItems(form); const done=it.filter(k=>fstate(form.id,k)!=='pending').length; return {done,total:it.length}; }
const SRCC={'Aadhaar scan':'info','PAN scan':'info','Bank proof scan':'info','Offer':'teal','Employer (client HR)':'teal','Previous UAN record':'info','Candidate (WhatsApp)':'','Candidate to fill':'warn'};
function renderForms(){
  $('#fmNote').textContent=FORM_NOTE;
  if(!S){ $('#fmList').innerHTML='<p class="note">Start a candidate from the Offer desk first.</p>'; $('#fmView').innerHTML=''; return; }
  const forms=formDefs(); if(!forms.find(f=>f.id===fmSel&&f.applies)) fmSel='f11';
  $('#fmList').innerHTML=`<h3 style="margin-bottom:6px">${esc(S.c.name)}</h3><p class="note" style="margin:0 0 10px">${esc(S.c.role)} · joins ${fmtD(S.c.doj)}</p>`+forms.map(f=>{ const pr=formProgress(f); return `<button class="fmitem ${f.id===fmSel?'on':''}" data-fm="${f.id}" ${f.applies?'':'disabled'}><b>${esc(f.title)}</b><span class="note">${esc(f.applies?f.sub:f.why)}</span>${f.applies?`<span class="meter" style="margin-top:6px"><span style="width:${Math.round(100*pr.done/pr.total)}%;background:var(--teal)"></span></span><span class="note">${pr.done} of ${pr.total} confirmed</span>`:''}</button>`; }).join('');
  $$('#fmList [data-fm]').forEach(b=>b.onclick=()=>{ fmSel=b.dataset.fm; renderForms(); });
  const f=forms.find(x=>x.id===fmSel);
  let h=`<div class="gfhead"><div class="lbl">${esc(f.org)}</div><h3>${esc(f.title)}</h3><div>${esc(f.sub)}</div></div>`;
  f.sections.forEach(s=>{ h+=`<div class="gfsec">${esc(s.h)}</div>`;
    if(s.fields) s.fields.forEach(fl=>{ const st=fstate(f.id,fl.k), v=fval(f.id,fl); h+=`<div class="gfrow ${st}"><div class="gfn">${esc(fl.num)}</div><div class="gfl">${esc(fl.label)}</div><div class="gfv">${S.editing===fkey(f.id,fl.k)?`<input type="text" id="gfEdit" value="${esc(v)}" aria-label="${esc(fl.label)}"> <button class="btn small primary" data-gsave="${fl.k}">Save</button>`:(v?esc(v):'<span class="note">Awaiting candidate</span>')}<div class="gfm"><span class="chip ${SRCC[fl.src]||''}">${esc(fl.src)}</span>${st==='confirmed'?'<span class="chip ok">Confirmed by candidate</span>':st==='corrected'?'<span class="chip info">Corrected and confirmed</span>':''}</div></div><div class="gfa">${st==='pending'&&v?`<button class="btn small" data-gok="${fl.k}">Confirm</button>`:''}<button class="btn small" data-ged="${fl.k}">${v?'Correct':'Fill'}</button></div></div>`; });
    if(s.table){ const t=s.table, st=fstate(f.id,t.k); h+=`<div class="tscroll"><table class="gft"><tr>${t.cols.map(x=>`<th>${esc(x)}</th>`).join('')}</tr>${t.rows.length?t.rows.map(r=>`<tr>${t.cols.map((_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${t.cols.length}" class="note">${esc(t.empty||'Awaiting candidate')}</td></tr>`}</table></div><div class="row" style="margin:6px 0 10px"><span class="chip ${SRCC[t.src]||''}">${esc(t.src)}</span>${st!=='pending'?'<span class="chip ok">Confirmed by candidate</span>':`<button class="btn small" data-gok="${t.k}">Confirm table</button>`}</div>`; }
  });
  $('#fmView').innerHTML=h;
  $$('#fmView [data-gok]').forEach(b=>b.onclick=()=>{ S.formState[fkey(f.id,b.dataset.gok)]='confirmed'; renderForms(); renderBrain(); });
  $$('#fmView [data-ged]').forEach(b=>b.onclick=()=>{ S.editing=fkey(f.id,b.dataset.ged); renderForms(); const e=$('#gfEdit'); if(e){ e.focus(); e.select(); } });
  $$('#fmView [data-gsave]').forEach(b=>b.onclick=()=>{ const k=b.dataset.gsave; S.formVals[fkey(f.id,k)]=$('#gfEdit').value.trim(); S.formState[fkey(f.id,k)]='corrected'; S.editing=null; act(`Form field corrected: ${f.title}, ${k}.`); renderForms(); renderBrain(); });
}
function formPdf(fid,footer){ const f=formDefs().find(x=>x.id===fid); if(!f) return null; const blocks=[{t:'p',text:f.org},{t:'p',text:f.sub}];
  f.sections.forEach(s=>{ blocks.push({t:'h',text:s.h}); if(s.fields) s.fields.forEach(fl=>blocks.push({t:'kv',k:`${fl.num}. ${fl.label}`,v:(fval(f.id,fl)||'')+(fstate(f.id,fl.k)!=='pending'?'  [confirmed]':'')})); if(s.table) blocks.push({t:'table',rows:[s.table.cols,...(s.table.rows.length?s.table.rows:[[s.table.empty||'']])]}); });
  blocks.push({t:'h',text:'Signature or thumb impression of the member'},{t:'p',text:'____________________________     Date: ____________     Place: ____________'});
  return makePdf(f.title+' - '+S.c.name,blocks,footer||`Pre-filled by the AI Onboarding Agent from the offer, scanned documents and the candidate's WhatsApp answers. Fields marked [confirmed] were confirmed by the candidate. Demo: sample data. ${FORM_NOTE}`); }
$('#fmPdf').onclick=async()=>{ if(!S) return; const b=formPdf(fmSel); const f=formDefs().find(x=>x.id===fmSel); if(b) await saveFile(`${f.title.replace(/\W+/g,'_')}_${S.c.name.replace(/\W+/g,'_')}.pdf`,b,'application/pdf'); };
$('#fmAsk').onclick=()=>{ if(!S) return; showTab('journey'); formsChat(0); };
function formsChat(i){ const forms=formDefs().filter(f=>f.applies); if(i>=forms.length){ agent(`<p>All done, ${first()}! Every form is confirmed. I've filed them to ${esc(cv('kycTool'))} and HR will countersign.</p>`); act('All joining forms confirmed by candidate and filed.'); renderBrain(); return; }
  const f=forms[i]; const key=[]; f.sections.forEach(s=>{ (s.fields||[]).slice(0,4).forEach(fl=>{ if(key.length<5&&fval(f.id,fl)) key.push([fl.label,fval(f.id,fl)]); }); if(s.table&&s.table.rows.length&&key.length<6) key.push([s.h,s.table.rows.map(r=>r[0]).join(', ')]); });
  docBubble(`${f.title.replace(/\W+/g,'_')}_prefilled.pdf`,'2 pages',()=>{ const b=formPdf(f.id); if(b) saveFile(`${f.title.replace(/\W+/g,'_')}_${S.c.name.replace(/\W+/g,'_')}.pdf`,b,'application/pdf'); });
  agent(`<p><b>${esc(f.title)}</b> (${esc(f.sub)}). I've filled it from your documents. Please check:</p><div class="mini"><table>${key.map(([k,v])=>`<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table></div>`,{qr:[
    {l:'All correct',p:1,f:()=>{ formItems(f).forEach(k=>{ if(fstate(f.id,k)==='pending') S.formState[fkey(f.id,k)]='confirmed'; }); agent('<p>Thank you, confirmed ✓</p>'); act(`${f.title} confirmed by candidate on WhatsApp.`); formsChat(i+1); }},
    {l:'Something is wrong',f:()=>{ agent('<p>No problem. Tell me what to change, for example "my father\'s name is spelt Rajesh Kumar Sharma", or open the form link to edit it yourself.</p>'); S.awaitFix=f.id; }},
    {l:'What is this form?',f:()=>{ const fq=cv('faq').find(q=>new RegExp(q[1],'i').test(f.title+' '+f.sub+(f.id==='gf'?' gratuity':'')+(f.id.startsWith('f2')?' nominat':'')+(f.id==='f11'?' form 11':'')+(f.id==='esic'?' esi':''))); agent(`<p>${esc(fq?fq[2]:f.sub)}</p>`,{qr:[{l:'Got it, back to checking',p:1,f:()=>formsChat(i)}]}); }}]});
  renderBrain(); }

/* ---------- Config: sections, hide/restore, add/delete, saved per client ---------- */
const SECTIONS=[
  {id:'identity',title:'Agent identity',fixed:true,keys:[['agentName','Agent name shown on WhatsApp'],['languages','Languages'],['tone','Tone'],['voice','Voice calling']]},
  {id:'offer',title:'Offer',fixed:true,keys:[['offerMode','Offer source','sel',[['both','Offer desk and upload both on'],['make','Offer desk in Client Hub'],['upload','Upload from another tool']]],['autoStart','Start engagement'],['approvals','Approvals']]},
  {id:'day1',title:'Day-1 details',note:'Sent in the Day-1 kit and used to answer questions. Paste the location\'s Google Maps share link for the map card.',keys:[['address','Joining location'],['mapLink','Google Maps link'],['reportTime','Reporting time'],['meet','Who to meet'],['dress','Dress code'],['bring','What to bring'],['parking','Parking'],['canteen','Canteen']]},
  {id:'docs',title:'Documents',docs:true,note:'The checklist the agent sends and chases. Hide a standard document or add the client\'s own.',keys:[['kycMode','How documents are collected'],['kycTool','Where documents are filed']]},
  {id:'policy',title:'Policies the agent may explain',keys:[['salaryDate','Salary credit date'],['probation','Probation'],['leave','Leave'],['buddy','Buddy']]},
  {id:'people',title:'People the agent works with',note:'Added people also get a Day-1 readiness task and are kept informed.',keys:[['recruiter','Recruiter'],['itSpoc','IT contact'],['adminSpoc','Admin contact'],['securitySpoc','Security contact'],['payrollSpoc','Payroll contact']]},
  {id:'letter',title:'Offer letter details',note:'Added items become merge fields you can use in offer letter templates.',keys:[['companyAddress','Company address'],['location','Place of posting'],['workWeek','Work week'],['holidays','Declared holidays a year'],['noticeProbation','Notice during probation'],['noticeConfirmed','Notice after confirmation'],['retirementAge','Retirement age'],['jurisdiction','Courts with jurisdiction'],['signatory','Letter signatory']]},
  {id:'callback',title:'Call-backs',note:'Rules the agent follows when a candidate asks for a person.',keys:[['callbackSla','Call-back rule']]},
  {id:'survey',title:'Surveys',survey:true,note:'Each question is asked on WhatsApp at its touchpoint. For an added question, put its timing (for example D+20) in the first box.',keys:[['sv_d1','Day-1 pulse'],['sv_d15','Day-15 pulse'],['sv_d45','Day-45 pulse'],['sv_d60','Day-60 pulse'],['sv_d75','Day-75 pulse']]}
];
const SV_TP={sv_d1:'survey_d1',sv_d15:'pulse15',sv_d45:'pulse45',sv_d60:'pulse60',sv_d75:'pulse75'};
const isDefC=()=>client.id==='default';
const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,30)||'item';
function custom(sec){ return ((client.ov.custom||{})[sec]||[]).filter(x=>(x.label||'').trim()||(x.value||'').trim()); }
function ensure(k,v){ if(client.ov[k]===undefined) client.ov[k]=v; return client.ov[k]; }
function docListNow(){ if(client.ov.docList) return client.ov.docList; const std=DEFAULT.docs.split(';').map(s=>s.trim()); const cur=(client.ov.docs!==undefined?client.ov.docs:DEFAULT.docs).split(';').map(s=>s.trim()).filter(Boolean); const list=cur.map(t=>({id:uid('d'),text:t,std:std.includes(t)})); std.filter(t=>!cur.includes(t)).forEach(t=>list.push({id:uid('d'),text:t,std:true,off:true})); return list; }
let cfgTimer=null;
function cfgStatus(t){ const e=$('#cfgStatus'); if(e) e.textContent=t; }
function saveCfg(){ if(isDefC()) return; cfgStatus('Saving…'); clearTimeout(cfgTimer); cfgTimer=setTimeout(async()=>{ const data={ov:JSON.parse(JSON.stringify(client.ov)),client:client.id,label:client.label,updated:new Date().toISOString()};
  if(db){ try{ await db.collection('clients').doc(client.id).set(data); publishFacts(); cfgStatus('Saved · shared with everyone signed in'); }catch(e){ cfgStatus('Not saved: you may have view-only access'); } } else cfgStatus('Saved for this session'); },600); }
function cfgChanged(rebuildJourney){ saveCfg(); applyClient(false); if(rebuildJourney&&S){ buildPlan(); renderTimeline(); S.docsTotal=cv('docs').split(';').filter(x=>x.trim()).length; renderBrain(); } }
STORE_HOOKS.push(k=>{ if(k!=='clients') return; Object.values(store.clients||{}).forEach(d=>{ let c=CLIENTS.find(x=>x.id===d.id); if(!c&&d.label&&d.id){ c={id:d.id,label:d.label,ov:{}}; CLIENTS.push(c); addClientOption(c); } if(c&&d.label&&c.id!=='default') { c.label=d.label; const o=[...$('#clientSel').options].find(x=>x.value===c.id); if(o) o.textContent=d.label; } if(c&&c.id!=='default'){ const inact=d.active===false; const o=[...$('#clientSel').options].find(x=>x.value===c.id); c.inactive=inact; if(inact&&o){ const wasSel=$('#clientSel').value===c.id; o.remove(); if(wasSel){ $('#clientSel').value='default'; $('#clientSel').dispatchEvent(new Event('change')); } } else if(!inact&&!o) addClientOption(c); } if(c&&d.ov) c.ov=JSON.parse(JSON.stringify(d.ov)); }); const inCfg=document.activeElement&&$('#tab-config').contains(document.activeElement); if(!$('#tab-config').hidden&&!inCfg) renderConfig(); applyClient(false); if(S){ buildPlan(); renderTimeline(); } });
const HRMS=['HROne','Darwinbox','Keka','greytHR','Zoho People','Adrenalin','PeopleStrong','SAP SuccessFactors','Oracle HCM','Other'];
const INT_TXT={api:h=>`The agent reads candidate and employee data from ${h} and writes confirmed joining data back through its API. Where ${h} has no API for a task, it falls back to file exchange for that task.`,
  file:()=>'HR or TCMPL uploads CSV or Excel files (candidates, employee master) and downloads confirmed joining data as an import file for any HRMS. A daily exchange can be scheduled.',
  none:()=>'No HRMS needed. The agent keeps candidate and employee records in TCMPL\'s own secure database, and HR can download them any time as Excel or CSV.'};
const integ=()=>Object.assign({mode:'file',hrms:'Other'},client.ov.integration||{});
function renderInt(){ const it=integ(), dis=isDefC()?'disabled':'';
  $('#intCard').innerHTML=`<div class="row" style="justify-content:space-between"><h3>How we connect with the client's systems</h3><span class="chip teal">Works with any HRMS, or none</span></div>
  <div class="intopts">${[['api','Live HRMS connection'],['file','CSV or Excel file exchange'],['none','No HRMS: TCMPL database']].map(([v,l])=>`<label class="intopt ${it.mode===v?'on':''}"><input type="radio" name="intMode" value="${v}" ${it.mode===v?'checked':''} ${dis}><b>${l}</b><span class="note">${esc(INT_TXT[v](it.hrms))}</span></label>`).join('')}</div>
  <div class="row" style="margin-top:10px" ${it.mode==='none'?'hidden':''}><label class="lbl" for="intHrms">Client's HRMS</label><select id="intHrms" ${dis}>${HRMS.map(h=>`<option ${h===it.hrms?'selected':''}>${h}</option>`).join('')}</select></div>`;
  $$('#intCard [name=intMode]').forEach(r=>r.onchange=()=>{ client.ov.integration=Object.assign(integ(),{mode:r.value}); renderInt(); cfgChanged(); updateExportLabel(); });
  const hs=$('#intHrms'); if(hs) hs.onchange=()=>{ client.ov.integration=Object.assign(integ(),{hrms:hs.value}); renderInt(); cfgChanged(); updateExportLabel(); };
}
function rowStatus(k){ if((client.ov.hidden||[]).includes(k)) return 'hidden'; return client.ov[k]!==undefined?'over':'def'; }
function renderSections(){ const dis=isDefC()?'disabled':'';
  $('#cfgSections').innerHTML=SECTIONS.map(sec=>{
    let rows=sec.keys.map(r=>{ const [k,l,type,opts]=r; const st=rowStatus(k); const dv=type==='sel'?opts.find(o=>o[0]===DEFAULT[k])[1]:(DEFAULT[k]||'—');
      const val=client.ov[k]!==undefined?client.ov[k]:DEFAULT[k];
      const input=type==='sel'?`<select data-k="${k}" ${dis}>${opts.map(o=>`<option value="${o[0]}" ${val===o[0]?'selected':''}>${esc(o[1])}</option>`).join('')}</select>`:`<input type="text" data-k="${k}" value="${esc(val)}" ${dis||st==='hidden'?'disabled':''} aria-label="${esc(l)}" ${k==='mapLink'?'placeholder="https://maps.app.goo.gl/…"':''}>`;
      const acts=isDefC()?'<span class="chip teal">Default</span>':st==='hidden'?`<span class="chip warn">Hidden for this client</span><button class="btn small" data-show="${k}">Restore</button>`:`${st==='over'?`<span class="chip info">Client value</span><button class="btn small" data-reset="${k}">Use default</button>`:'<span class="chip">Follows default</span>'}${sec.fixed?'':`<button class="btn small" data-hide="${k}">Hide</button>`}${k==='mapLink'&&cv('mapLink')?`<a class="btn small" href="${esc(cv('mapLink'))}" target="_blank" rel="noopener">Test link</a>`:''}`;
      return `<tr class="${st==='hidden'?'off':''}"><td>${esc(l)}</td><td class="note">${esc(dv)}</td><td>${input}<div class="row" style="margin-top:4px">${acts}</div></td></tr>`; }).join('');
    if(sec.docs){ const dl=docListNow(); rows+=`<tr class="grp2"><td colspan="3">Document checklist</td></tr>`+dl.map(d=>`<tr class="${d.off?'off':''}"><td>${d.std?'Standard document':'Added for this client'}</td><td class="note">${d.std?'TCMPL default':''}</td><td><input type="text" data-doc="${d.id}" value="${esc(d.text)}" ${dis||d.off?'disabled':''} aria-label="Document"><div class="row" style="margin-top:4px">${isDefC()?'<span class="chip teal">Default</span>':d.std?(d.off?`<span class="chip warn">Hidden for this client</span><button class="btn small" data-docon="${d.id}">Restore</button>`:`<button class="btn small" data-docoff="${d.id}">Hide</button>`):`<span class="chip info">Added</span><button class="btn small" data-docdel="${d.id}">Delete</button>`}</div></td></tr>`).join(''); }
    if(!sec.fixed){ const cu=((client.ov.custom||{})[sec.id]||[]); rows+=cu.map(x=>`<tr class="cust"><td><input type="text" data-cl="${sec.id}|${x.id}" value="${esc(x.label)}" placeholder="${sec.survey?'Timing, e.g. D+20':'Item name'}" aria-label="Item name" ${dis}></td><td class="note">${sec.id==='letter'?`Merge field: {{${slug(x.label)}}}`:'Added for this client'}</td><td><input type="text" data-cv="${sec.id}|${x.id}" value="${esc(x.value)}" placeholder="${sec.survey?'Survey question':'Details'}" aria-label="Item details" ${dis}><div class="row" style="margin-top:4px"><span class="chip info">Added</span><button class="btn small" data-cdel="${sec.id}|${x.id}">Delete</button></div></td></tr>`).join(''); }
    const addBtn=sec.fixed||isDefC()?'':`<div class="row" style="margin-top:8px">${sec.docs?`<button class="btn small" data-docadd="1">Add document</button>`:''}<button class="btn small" data-cadd="${sec.id}">${sec.survey?'Add survey question':sec.docs?'Add other item':'Add item'}</button></div>`;
    return `<div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h3>${esc(sec.title)}</h3>${sec.note?`<span class="note">${esc(sec.note)}</span>`:''}</div><div class="tscroll"><table class="cfgt"><tr><th>Item</th><th>TCMPL default</th><th>${esc(client.label)}</th></tr>${rows}</table></div>${addBtn}</div>`; }).join('');
  const W=$('#cfgSections');
  $$('#cfgSections [data-k]').forEach(el=>el.addEventListener('change',()=>{ const k=el.dataset.k; if(el.value===DEFAULT[k]) delete client.ov[k]; else client.ov[k]=el.value; cfgChanged(true); renderSections(); }));
  $$('#cfgSections [data-reset]').forEach(b=>b.onclick=()=>{ delete client.ov[b.dataset.reset]; cfgChanged(true); renderConfig(); });
  $$('#cfgSections [data-hide]').forEach(b=>b.onclick=()=>{ const h=new Set(client.ov.hidden||[]); h.add(b.dataset.hide); client.ov.hidden=[...h]; cfgChanged(true); renderConfig(); });
  $$('#cfgSections [data-show]').forEach(b=>b.onclick=()=>{ client.ov.hidden=(client.ov.hidden||[]).filter(x=>x!==b.dataset.show); cfgChanged(true); renderConfig(); });
  const dl=()=>{ client.ov.docList=client.ov.docList||docListNow(); return client.ov.docList; };
  $$('#cfgSections [data-doc]').forEach(el=>el.addEventListener('change',()=>{ const d=dl().find(x=>x.id===el.dataset.doc); if(d) d.text=el.value.trim(); cfgChanged(true); }));
  $$('#cfgSections [data-docoff]').forEach(b=>b.onclick=()=>{ dl().find(x=>x.id===b.dataset.docoff).off=true; cfgChanged(true); renderConfig(); });
  $$('#cfgSections [data-docon]').forEach(b=>b.onclick=()=>{ dl().find(x=>x.id===b.dataset.docon).off=false; cfgChanged(true); renderConfig(); });
  $$('#cfgSections [data-docdel]').forEach(b=>b.onclick=()=>{ client.ov.docList=dl().filter(x=>x.id!==b.dataset.docdel); cfgChanged(true); renderConfig(); });
  $$('#cfgSections [data-docadd]').forEach(b=>b.onclick=()=>{ dl().push({id:uid('d'),text:'New document',std:false}); cfgChanged(true); renderConfig(); setTimeout(()=>{ const ins=$$('#cfgSections [data-doc]'); const e=ins[ins.length-1]; if(e){e.focus();e.select();} },50); });
  const cu=sec=>{ client.ov.custom=client.ov.custom||{}; client.ov.custom[sec]=client.ov.custom[sec]||[]; return client.ov.custom[sec]; };
  $$('#cfgSections [data-cadd]').forEach(b=>b.onclick=()=>{ const s=b.dataset.cadd; cu(s).push({id:uid('c'),label:s==='survey'?'D+20':'',value:''}); cfgChanged(true); renderConfig(); setTimeout(()=>{ const ins=$$(`#cfgSections [data-cl^="${s}|"]`); const e=ins[ins.length-1]; if(e) e.focus(); },50); });
  $$('#cfgSections [data-cl]').forEach(el=>el.addEventListener('change',()=>{ const [s,id]=el.dataset.cl.split('|'); const x=cu(s).find(y=>y.id===id); if(x){ x.label=el.value.trim(); if(s==='survey'){ const v=x.label.toUpperCase().replace(/^D0$/,'D+0'); if(!/^[OD][+-]\d+$/.test(v)){ toast('Use a timing like D+20 or O+3.'); } else x.label=v; } } cfgChanged(true); renderSections(); }));
  $$('#cfgSections [data-cv]').forEach(el=>el.addEventListener('change',()=>{ const [s,id]=el.dataset.cv.split('|'); const x=cu(s).find(y=>y.id===id); if(x) x.value=el.value.trim(); cfgChanged(true); }));
  $$('#cfgSections [data-cdel]').forEach(b=>b.onclick=()=>{ const [s,id]=b.dataset.cdel.split('|'); client.ov.custom[s]=cu(s).filter(y=>y.id!==id); cfgChanged(true); renderConfig(); });
}
function renderCadence(){ const dis=isDefC()?'disabled':''; const cad=cv('cadence'), off=cv('off'), co=client.ov.cadence||{};
  $('#cadGrid').innerHTML=Object.keys(TP).map(k=>`<div class="caditem ${off.includes(k)?'off':''}"><input type="checkbox" data-on="${k}" ${off.includes(k)?'':'checked'} ${dis} aria-label="Use ${esc(TP[k].t)}"><span class="nm"><span class="trk ${TP[k].k}" style="font-size:.65rem">${{c:'Candidate',m:'Manager',s:'Stakeholders'}[TP[k].k]}</span><br>${esc(TP[k].t)}</span><input type="text" data-cad="${k}" value="${esc(cad[k])}" ${dis} aria-label="Timing for ${esc(TP[k].t)}" style="${co[k]?'border-color:var(--blue)':''}"></div>`).join('');
  $$('#cadGrid [data-cad]').forEach(el=>el.addEventListener('change',()=>{ const k=el.dataset.cad, v=el.value.trim().toUpperCase().replace(/^D0$/,'D+0'); if(!/^[OD][+-]\d+$/.test(v)){ el.value=cv('cadence')[k]; toast('Use a timing like D-7, D+0 or O+2.'); return; } client.ov.cadence=client.ov.cadence||{}; if(v===DEFAULT.cadence[k]) delete client.ov.cadence[k]; else client.ov.cadence[k]=v; cfgChanged(true); renderCadence(); }));
  $$('#cadGrid [data-on]').forEach(el=>el.addEventListener('change',()=>{ const k=el.dataset.on; const o=new Set(client.ov.off||[]); el.checked?o.delete(k):o.add(k); client.ov.off=[...o]; cfgChanged(true); renderCadence(); }));
  const cx=client.ov.customTps||[];
  $('#cxTbl').innerHTML='<tr><th>Touchpoint</th><th>Timing</th><th>Who</th><th>Channel</th><th>Message (use {first} for the first name)</th><th></th></tr>'+(cx.length?cx.map(t=>`<tr><td><input type="text" data-cx="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Touchpoint name" ${dis}></td><td><input type="text" data-cx="${t.id}" data-f="when" value="${esc(t.when)}" style="width:72px" aria-label="Timing" ${dis}></td><td><select data-cx="${t.id}" data-f="track" ${dis}>${[['c','Candidate'],['m','Manager'],['s','Stakeholders']].map(([v,l])=>`<option value="${v}" ${t.track===v?'selected':''}>${l}</option>`).join('')}</select></td><td><select data-cx="${t.id}" data-f="channel" ${dis}>${['WhatsApp','Call','Email','Teams'].map(c=>`<option ${t.channel===c?'selected':''}>${c}</option>`).join('')}</select></td><td><textarea data-cx="${t.id}" data-f="msg" rows="2" style="font-family:var(--body);min-width:240px" aria-label="Message" ${dis}>${esc(t.msg)}</textarea></td><td><button class="btn small" data-cxdel="${t.id}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6" class="note">None yet.</td></tr>');
  $('#cxAdd').hidden=isDefC();
  $$('#cxTbl [data-cx]').forEach(el=>el.addEventListener('change',()=>{ const t=cx.find(x=>x.id===el.dataset.cx); let v=el.value; if(el.dataset.f==='when'){ v=v.trim().toUpperCase().replace(/^D0$/,'D+0'); if(!/^[OD][+-]\d+$/.test(v)){ toast('Use a timing like D+5 or O+2.'); el.value=t.when; return; } } t[el.dataset.f]=v; cfgChanged(true); }));
  $$('#cxTbl [data-cxdel]').forEach(b=>b.onclick=()=>{ client.ov.customTps=cx.filter(x=>x.id!==b.dataset.cxdel); cfgChanged(true); renderCadence(); });
}
$('#cxAdd').onclick=()=>{ ensure('customTps',[]).push({id:uid('t'),name:'Site safety briefing reminder',when:'D-2',track:'c',channel:'WhatsApp',msg:'Hi {first}, a reminder that on Day 1 you will attend a 30-minute safety briefing. Please wear closed shoes.'}); cfgChanged(true); renderCadence(); };
const STATUTORY=['f11','f2a','f2b','esic','gf'];
const CF_PRESETS={
  blank:{name:'New form',desc:'Client form',fields:[{label:'Full name',src:'Offer',value:''},{label:'Signature date',src:'Candidate (WhatsApp)',value:''}]},
  nda:{name:'Non-disclosure agreement acknowledgement',desc:'Candidate confirms they have read and accept the NDA',fields:[{label:'Full name',src:'Offer',value:''},{label:'Designation',src:'Offer',value:''},{label:'Date of joining',src:'Offer',value:''},{label:'I have read and accept the NDA',src:'Candidate (WhatsApp)',value:'Yes'}]},
  coi:{name:'Conflict of interest declaration',desc:'Declaration of outside interests, directorships and relatives with customers or suppliers',fields:[{label:'Full name',src:'Offer',value:''},{label:'Directorships or partnerships held',src:'Candidate (WhatsApp)',value:'None'},{label:'Shares above 5% in customers, suppliers or competitors',src:'Candidate (WhatsApp)',value:'None'},{label:'Relatives working with customers, suppliers or competitors',src:'Candidate (WhatsApp)',value:'None'}]},
  pdf:{name:'Personal data form',desc:'Contact, emergency and education details',fields:[{label:'Full name',src:'Offer',value:''},{label:'Date of birth',src:'Aadhaar scan',value:''},{label:'Present address',src:'Candidate (WhatsApp)',value:''},{label:'Emergency contact name and number',src:'Candidate (WhatsApp)',value:''},{label:'Blood group',src:'Candidate (WhatsApp)',value:''},{label:'Highest qualification',src:'Candidate (WhatsApp)',value:''}]}
};
const SRC_OPTS=['Offer','Aadhaar scan','PAN scan','Bank proof scan','Candidate (WhatsApp)','Employer (client HR)'];
let warnOff=null;
function renderFormsCfg(){ const dis=isDefC()?'disabled':''; const offl=client.ov.formsOff||[];
  const names={f11:'Form 11 (EPF composite declaration)',f2a:'Form 2 (Revised), Part A (EPF nomination)',f2b:'Form 2 (Revised), Part B (EPS)',esic:'ESIC Declaration Form (Form 1)',gf:'Form F (gratuity nomination)'};
  $('#fmCfg').innerHTML=STATUTORY.map(id=>`<div class="caditem ${offl.includes(id)?'off':''}" style="margin-bottom:6px"><span class="nm"><b>${names[id]}</b> <span class="chip">Statutory</span>${id==='esic'?' <span class="note">Shown only when gross is ₹21,000 a month or less</span>':''}</span>${isDefC()?'':offl.includes(id)?`<span class="chip warn">Switched off</span><button class="btn small" data-fon="${id}">Switch on</button>`:warnOff===id?`<span class="note" style="color:var(--warn)">Statutory form: switch off only if the establishment is exempt.</span><button class="btn small" data-foff2="${id}">Switch off anyway</button><button class="btn small" data-fcancel="1">Cancel</button>`:`<button class="btn small" data-foff="${id}">Switch off</button>`}</div>`).join('');
  const cf=client.ov.customForms||[];
  $('#cfList').innerHTML=cf.length?cf.map(f=>`<div class="cfbox"><div class="row"><input type="text" data-cfn="${f.id}" value="${esc(f.name)}" aria-label="Form name" style="flex:1;font-weight:600" ${dis}><button class="btn small" data-cfdel="${f.id}">Delete form</button></div><input type="text" data-cfd="${f.id}" value="${esc(f.desc)}" aria-label="Form description" style="width:100%;margin-top:6px" ${dis}>
    <table class="cfgt" style="margin-top:8px"><tr><th>Field</th><th>Pre-filled from</th><th>Default value (optional)</th><th></th></tr>${f.fields.map((x,i)=>`<tr><td><input type="text" data-cff="${f.id}|${i}|label" value="${esc(x.label)}" aria-label="Field label" ${dis}></td><td><select data-cff="${f.id}|${i}|src" ${dis}>${SRC_OPTS.map(o=>`<option ${o===x.src?'selected':''}>${o}</option>`).join('')}</select></td><td><input type="text" data-cff="${f.id}|${i}|value" value="${esc(x.value)}" aria-label="Default value" ${dis}></td><td><button class="btn small" data-cffdel="${f.id}|${i}">Remove</button></td></tr>`).join('')}</table>
    <button class="btn small" data-cffadd="${f.id}" style="margin-top:6px">Add field</button></div>`).join(''):'<p class="note">None yet.</p>';
  $$('[data-cfadd]').forEach(b=>{ b.hidden=isDefC(); b.onclick=()=>{ const p=JSON.parse(JSON.stringify(CF_PRESETS[b.dataset.cfadd])); ensure('customForms',[]).push(Object.assign({id:uid('f')},p)); cfgChanged(); renderFormsCfg(); toast('Form added. It now appears in Joining forms and in the WhatsApp confirmation.'); }; });
  $$('#fmCfg [data-foff]').forEach(b=>b.onclick=()=>{ warnOff=b.dataset.foff; renderFormsCfg(); });
  $$('#fmCfg [data-fcancel]').forEach(b=>b.onclick=()=>{ warnOff=null; renderFormsCfg(); });
  $$('#fmCfg [data-foff2]').forEach(b=>b.onclick=()=>{ ensure('formsOff',[]).push(b.dataset.foff2); warnOff=null; cfgChanged(); renderFormsCfg(); });
  $$('#fmCfg [data-fon]').forEach(b=>b.onclick=()=>{ client.ov.formsOff=offl.filter(x=>x!==b.dataset.fon); cfgChanged(); renderFormsCfg(); });
  const F=id=>cf.find(x=>x.id===id);
  $$('#cfList [data-cfn]').forEach(e=>e.onchange=()=>{ F(e.dataset.cfn).name=e.value.trim()||'Form'; cfgChanged(); });
  $$('#cfList [data-cfd]').forEach(e=>e.onchange=()=>{ F(e.dataset.cfd).desc=e.value.trim(); cfgChanged(); });
  $$('#cfList [data-cff]').forEach(e=>e.onchange=()=>{ const [id,i,f]=e.dataset.cff.split('|'); F(id).fields[+i][f]=e.value; cfgChanged(); });
  $$('#cfList [data-cffdel]').forEach(b=>b.onclick=()=>{ const [id,i]=b.dataset.cffdel.split('|'); F(id).fields.splice(+i,1); cfgChanged(); renderFormsCfg(); });
  $$('#cfList [data-cffadd]').forEach(b=>b.onclick=()=>{ F(b.dataset.cffadd).fields.push({label:'New field',src:'Candidate (WhatsApp)',value:''}); cfgChanged(); renderFormsCfg(); });
  $$('#cfList [data-cfdel]').forEach(b=>b.onclick=()=>{ client.ov.customForms=cf.filter(x=>x.id!==b.dataset.cfdel); cfgChanged(); renderFormsCfg(); });
}
function renderFaq(){ const dis=isDefC()?'disabled':''; const fq=cv('faq');
  $('#faqGrid').innerHTML=fq.map(([t,kw,a,own],i)=>`<div class="caditem" style="align-items:flex-start;flex-wrap:wrap"><div style="flex:1 1 220px;min-width:0"><input type="text" data-fqt="${i}" value="${esc(t)}" ${dis} aria-label="Topic" style="width:100%;font-weight:600"><input type="text" data-fqk="${i}" value="${esc(kw.split('|').join(', '))}" ${dis} aria-label="Words that trigger this answer" style="width:100%;margin-top:4px;font-size:.8rem"><div class="note">Words that trigger this answer</div></div><textarea data-fqa="${i}" rows="3" ${dis} aria-label="Answer for ${esc(t)}" style="flex:2 1 320px;font-family:var(--body);font-size:.88rem">${esc(a)}</textarea>${isDefC()?'':`<button class="btn small" data-fqd="${i}">${i<DEFAULT.faq.length&&!own?'Hide':'Delete'}</button>`}</div>`).join('');
  $('#faqAdd').hidden=isDefC();
  const arr=()=>cv('faq').map(x=>x.slice());
  const save=()=>{ const a=arr(); $$('#faqGrid [data-fqt]').forEach(el=>{a[+el.dataset.fqt][0]=el.value.trim()||a[+el.dataset.fqt][0];}); $$('#faqGrid [data-fqk]').forEach(el=>{a[+el.dataset.fqk][1]=el.value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).join('|')||'zzzz';}); $$('#faqGrid [data-fqa]').forEach(el=>{a[+el.dataset.fqa][2]=el.value.trim();}); client.ov.faq=a; cfgChanged(); };
  $$('#faqGrid input, #faqGrid textarea').forEach(el=>el.addEventListener('change',save));
  $$('#faqGrid [data-fqd]').forEach(b=>b.onclick=()=>{ const a=arr(); a.splice(+b.dataset.fqd,1); client.ov.faq=a; cfgChanged(); renderFaq(); });
  $('#faqAdd').onclick=()=>{ const a=arr(); a.push(['New question','new question','Write the approved answer here.',1]); client.ov.faq=a; cfgChanged(); renderFaq(); };
}
function renderConfig(){
  renderInt(); renderSections(); renderCadence(); renderFormsCfg(); renderMaster(); renderFaq();
  const o=client.ov; const n=Object.keys(o).filter(k=>!['slides','quiz','plan','custom','cadence','off','hidden','docList','customTps','customForms','formsOff','faq','integration'].includes(k)).length+(o.hidden||[]).length+Object.values(o.custom||{}).reduce((a,b)=>a+b.length,0)+(o.customTps||[]).length+(o.customForms||[]).length+(o.formsOff||[]).length+Object.keys(o.cadence||{}).length+(o.off||[]).length;
  $('#cfgCount').textContent=isDefC()?'TCMPL default: every client starts from this. Pick a client to change their setup.':`${n} change${n===1?'':'s'} from the TCMPL default`;
  if(isDefC()) cfgStatus('');
}

/* ---------- Library: salary structures, templates, team ---------- */
let tplEditId=null;
function structSummary(s){ if(s.kind==='manual') return (s.rows||[]).map(r=>`${r.name} ${Math.round(r.pctGross)}%`).join(', '); return `Basic ${s.basicPct}% of gross · HRA ${s.hraPct}% of Basic${(s.extras||[]).map(e=>` · ${e.name} ${e.type==='fixed'?'₹'+e.value+'/month':e.value+'% of Basic'}`).join('')}`; }
function renderLib(){
  $('#libStruct').innerHTML='<tr><th>Structure</th><th>Make-up</th><th>PF · NPS · gratuity · variable</th><th>Source</th><th></th></tr>'+allStructs().map(s=>`<tr><td><b>${esc(s.name)}</b><div class="note">${esc(s.desc||'')}</div></td><td class="note">${esc(structSummary(s))}</td><td class="note">${{full:'PF on full Basic',capped:'PF on ₹15,000 ceiling',none:'No PF'}[s.pf]||''} · NPS ${s.nps||0}% · ${s.grat?'gratuity in CTC':'gratuity outside CTC'} · variable ${s.varPct||0}%</td><td>${s.builtin?'<span class="chip teal">TCMPL standard</span>':'<span class="chip info">Saved by team</span>'}</td><td class="row"><button class="btn small" data-use="${esc(s.id)}">Use in offer</button>${s.builtin?'':`<button class="btn small" data-sdel="${esc(s.id)}">Delete</button>`}</td></tr>`).join('');
  $$('#libStruct [data-use]').forEach(b=>b.onclick=()=>{ showTab('offer'); setSalMode('struct'); refreshStructSel(b.dataset.use); applyStructDefaults(); renderOffer(); });
  $$('#libStruct [data-sdel]').forEach(b=>b.onclick=()=>delRec('structures',b.dataset.sdel));
  $('#tplFields').textContent=MERGE_FIELDS.concat(custom('letter').map(x=>slug(x.label))).map(f=>'{{'+f+'}}').join(' ');
  $('#libTpl').innerHTML='<tr><th>Template</th><th>Source</th><th></th></tr>'+allTpls().map(t=>`<tr><td><b>${esc(t.name)}</b></td><td>${t.builtin?'<span class="chip teal">TCMPL standard</span>':'<span class="chip info">Saved by team</span>'}</td><td class="row"><button class="btn small" data-tuse="${esc(t.id)}">Use in offer</button><button class="btn small" data-tcopy="${esc(t.id)}">${t.builtin?'Copy and edit':'Edit'}</button>${t.builtin?'':`<button class="btn small" data-tdel="${esc(t.id)}">Delete</button>`}</td></tr>`).join('');
  $$('#libTpl [data-tuse]').forEach(b=>b.onclick=()=>{ showTab('offer'); refreshTplSel(b.dataset.tuse); renderOffer(); });
  $$('#libTpl [data-tcopy]').forEach(b=>b.onclick=()=>openTpl(b.dataset.tcopy));
  $$('#libTpl [data-tdel]').forEach(b=>b.onclick=()=>delRec('templates',b.dataset.tdel));
  const tm=team(); $('#teamOn').checked=tm.on;
  $('#teamTbl').innerHTML=`<tr><th>Shown to candidates</th><th>Details</th></tr><tr><td>Department</td><td><input type="text" id="tmDept" value="${esc(tm.dept)}" aria-label="Department"></td></tr><tr><td>Reporting manager</td><td>${esc(cv('managerName'))}</td></tr><tr><td>Team members</td><td>${tm.members.map(m=>`${esc(m[0])} <span class="note">(${esc(m[1])})</span>`).join(', ')}</td></tr><tr><td>Direct reports (for people managers)</td><td>${tm.reports.map(m=>`${esc(m[0])} <span class="note">(${esc(m[1])})</span>`).join(', ')}</td></tr>`;
  $('#tmDept').onchange=e=>{ TEAMS[client.id].dept=e.target.value; };
}
$('#teamOn').onchange=e=>{ TEAMS[client.id].on=e.target.checked; };
function openTpl(id){ const t=allTpls().find(x=>x.id===id); tplEditId=t.builtin?null:t.id; $('#tplName').value=t.builtin?`${cv('short')} – ${t.name.replace(/ \(TCMPL standard.*\)/,'')}`:t.name; $('#tplBody').value=t.body; $('#tplEditor').hidden=false; $('#tplName').focus(); }
$('#tplNew').onclick=()=>openTpl('std-offer');
$('#tplCancel').onclick=()=>{ $('#tplEditor').hidden=true; };
$('#tplSave').onclick=async()=>{ const name=$('#tplName').value.trim()||'Untitled template'; const id=tplEditId||uid('tp'); if(await saveRec('templates',id,{name,body:$('#tplBody').value,client:client.id,updated:new Date().toISOString()})){ $('#tplEditor').hidden=true; setTimeout(()=>{ refreshTplSel(id); renderLib(); },400); } };
$('#libStructCsv').onclick=()=>saveFile('Salary_structures.csv',csvOf([['Name','Source','Make-up','PF','NPS %','Gratuity in CTC','Variable %'],...allStructs().map(s=>[s.name,s.builtin?'TCMPL standard':'Saved',structSummary(s),s.pf,s.nps||0,s.grat?'Yes':'No',s.varPct||0])]),'text/csv');
STORE_HOOKS.push(k=>{ if((k==='structures'||k==='templates')&&!$('#tab-config').hidden) renderLib(); });

/* ---------- HR view ---------- */
const SAMPLE_JOINERS=[
  ['Karan Bhatia','Warehouse Supervisor',5,'Docs & KYC','8/9','70%','Low','Pre-filled details sent'],
  ['Sneha Iyer','HR Executive',-12,'Settling in','9/9','100%','Low','Day-15 pulse: Yes'],
  ['Vikram Rathore','Fleet Coordinator',9,'Resignation check','5/9','40%','High','Counter-offer: recruiter calling'],
  ['Meenakshi Pillai','Accounts Assistant',2,'Day-1 kit','9/9','85%','Low','Confirmation call booked'],
  ['Amit Kumar','Inventory Analyst',18,'Offer accepted','2/9','0%','Medium','Quiet 48 h: call attempted'],
  ['Farah Khan','Customer Success Lead',-40,'Day-45 pulse','9/9','100%','Low','Goals agreed'],
  ['Harish Reddy','Shift Engineer',-3,'Week-1 check','9/9','90%','Medium','Access card pending']
];
let hrRows=[];
function renderHR(){
  const rows=SAMPLE_JOINERS.map(r=>({name:r[0],role:r[1],doj:new Date(OFFER_DATE.getTime()+(r[2]+30)*DAY),stage:r[3],docs:r[4],ready:r[5],risk:r[6],last:r[7],live:false}));
  if(S){ const tp=S.plan[S.idx]; const pct=Math.round(100*S.ready.filter(r=>r.st==='Confirmed').length/S.ready.length); const sc=riskScore(); rows.unshift({name:S.c.name,role:S.c.role,doj:S.c.doj,stage:tpInfo(tp.key).t,docs:`${S.docs}/${S.docsTotal}`,ready:pct+'%',risk:sc>=50?'High':sc>=25?'Medium':'Low',last:S.actions[S.actions.length-1]||'',live:true}); }
  hrRows=rows;
  const high=rows.filter(r=>r.risk==='High').length, ho=(S?S.handovers.length:0)+6;
  $('#tiles').innerHTML=[[rows.length,'Joiners in flight'],['92%','Offer-to-joining ratio (last 6 months, sample)'],['81%','Documents complete before Day 1 (sample)'],[high,'High drop-out risk now'],['8.6/10','Average onboarding pulse (sample)'],[ho,'Handed to people this month']].map(([v,k])=>`<div class="card tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  $('#hrTbl').innerHTML='<tr><th>Joiner</th><th>Joining</th><th>Stage</th><th>Docs</th><th>Day-1 ready</th><th>Risk</th><th>Latest agent action</th></tr>'+rows.map(r=>`<tr${r.live?' style="background:var(--teal-soft)"':''}><td><b>${esc(r.name)}</b>${r.live?' <span class="chip teal">Live demo</span>':''}<br><span class="note">${esc(r.role)}</span></td><td>${fmtD(r.doj)}</td><td>${esc(r.stage)}</td><td>${esc(r.docs)}</td><td>${esc(r.ready)}</td><td><span class="chip ${r.risk==='High'?'bad':r.risk==='Medium'?'warn':'ok'}">${r.risk}</span></td><td class="note">${esc(r.last)}</td></tr>`).join('');
  renderOffers();
}
function renderOffers(){ const list=[...store.offers].sort((a,b)=>String(b.released).localeCompare(String(a.released)));
  $('#offTbl').innerHTML='<tr><th>Candidate</th><th>Client</th><th class="num">Annual CTC</th><th>Template and structure</th><th>Status</th><th>Signed letter</th></tr>'+(list.length?list.map(o=>`<tr><td><b>${esc(o.name)}</b><div class="note">${esc(o.role)} · joins ${esc(o.doj)}</div></td><td>${esc(o.clientLabel||'')}</td><td class="num">${money(o.ctc||0)}</td><td class="note">${esc(o.template)}<br>${esc(o.structure)}</td><td><span class="chip ${o.signed?'ok':'info'}">${o.signed?'Signed copy received':esc(o.status)}</span></td><td>${o.signed?`<span class="note">${esc(o.signed.name)} · ${esc(o.signed.size)} · ${new Date(o.signed.at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>`:''}<label class="btn small filebtn">${o.signed?'Replace':'Upload signed copy'}<input type="file" data-sig="${esc(o.id)}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" hidden></label></td></tr>`).join(''):'<tr><td colspan="6" class="note">No offers released yet. Use "Approve and hand to agent" on the Offer desk.</td></tr>');
  $$('#offTbl [data-sig]').forEach(e=>e.onchange=()=>{ const f=e.files[0]; if(!f) return; const o=store.offers.find(x=>x.id===e.dataset.sig); const rec=Object.assign({},o); delete rec.id; rec.signed={name:f.name,size:Math.max(1,Math.round(f.size/1024))+' KB',at:new Date().toISOString()}; rec.status='Signed copy received'; saveRec('offers',o.id,rec); });
}
$('#offCsv').onclick=()=>saveFile('Released_offers.csv',csvOf([['Candidate','Role','Client','Annual CTC (INR)','Monthly gross (INR)','Take-home (INR)','Template','Structure','Joining date','Status','Signed file'],...store.offers.map(o=>[o.name,o.role,o.clientLabel,o.ctc,o.monthlyGross,o.takeHome,o.template,o.structure,o.doj,o.status,o.signed?o.signed.name:''])]),'text/csv');
$('#hrCsv').onclick=()=>saveFile('Joiners.csv',csvOf([['Joiner','Role','Joining date','Stage','Documents','Day-1 ready','Risk','Latest agent action'],...hrRows.map(r=>[r.name,r.role,fmtD(r.doj),r.stage,r.docs,r.ready,r.risk,r.last])]),'text/csv');
STORE_HOOKS.push(k=>{ if((k==='offers'||k==='cur'||k==='fx')&&!$('#tab-hr').hidden) renderOffers(); });

/* ---------- Excel and CSV exchange: works with any HRMS, or none ---------- */
const XL=()=>window.XLSX||null;
function xlsxBlob(sheets){ const X=XL(); if(!X){ toast('Excel tool is still loading. Try again in a moment.'); return null; } const wb=X.utils.book_new(); sheets.forEach(([name,rows])=>{ const ws=X.utils.aoa_to_sheet(rows); ws['!cols']=rows[0]?rows[0].map((_,i)=>({wch:Math.min(60,Math.max(10,...rows.map(r=>String(r[i]??'').length))+2)})):[]; X.utils.book_append_sheet(wb,ws,name.slice(0,31)); }); return new Blob([X.write(wb,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); }
async function saveXlsx(filename,sheets){ const b=xlsxBlob(sheets); if(b) await saveFile(filename,b,b.type); }
function readTable(file){ return new Promise((res,rej)=>{ const rd=new FileReader(); const isX=/\.xlsx?$/i.test(file.name);
  rd.onload=()=>{ try{ if(isX){ const X=XL(); if(!X) throw new Error('Excel tool not loaded'); const wb=X.read(new Uint8Array(rd.result),{type:'array'}); const out={}; wb.SheetNames.forEach(n=>{ out[n]=X.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:''}).filter(r=>r.some(c=>String(c).trim()!=='')); }); res(out); } else res({Sheet1:parseCsv(String(rd.result))}); }catch(e){ rej(e); } };
  rd.onerror=rej; isX?rd.readAsArrayBuffer(file):rd.readAsText(file); }); }
const norm=h=>String(h||'').toLowerCase().replace(/[^a-z0-9]/g,'');
/* candidates: Excel upload into the offer desk */
$('#csvFile').accept='.csv,.xlsx,.xls,text/csv';
$('#csvFile').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if(!f) return; try{ const t=await readTable(f); const rows=Object.values(t)[0]||[]; $('#csvIn').value=csvOf(rows); $('#validateCsv').click(); toast(`Loaded ${rows.length-1} candidate row${rows.length===2?'':'s'} from ${f.name}`); }catch(err){ toast('Could not read that file. Use the CSV or Excel template.'); } };
$('#csvTplDl').onclick=()=>saveXlsx('Candidate_upload_template.xlsx',[['Candidates',parseCsv(CSV_SAMPLE)]]);
$('#offXlsx').onclick=()=>saveXlsx('Released_offers.xlsx',[['Offers',[['Candidate','Role','Client','Annual CTC (INR)','Monthly gross (INR)','Take-home (INR)','Template','Structure','Joining date','Status','Signed file'],...store.offers.map(o=>[o.name,o.role,o.clientLabel,o.ctc,o.monthlyGross,o.takeHome,o.template,o.structure,o.doj,o.status,o.signed?o.signed.name:''])]]]);
$('#hrXlsx').onclick=()=>saveXlsx('Joiners.xlsx',[['Joiners',[['Joiner','Role','Joining date','Stage','Documents','Day-1 ready','Risk','Latest agent action'],...hrRows.map(r=>[r.name,r.role,fmtD(r.doj),r.stage,r.docs,r.ready,r.risk,r.last])]]]);
/* employee master */
const EM_COLS=['Employee code','Name','Designation','Department','Manager code','Email','Mobile','Role tag'];
const EM_SAMPLE={northpeak:[['NP1021','Arjun Mehta','Finance Controller','Finance and Accounts','NP1001','arjun.m@example.com','+91 98000 11021','Manager'],['NP1102','Deepak Arora','Assistant Manager, Accounts','Finance and Accounts','NP1021','deepak.a@example.com','+91 98000 11102','Buddy'],['NP1110','Sneha Iyer','Executive, Payables','Finance and Accounts','NP1021','sneha.i@example.com','+91 98000 11110',''],['NP1118','Mohit Bansal','Executive, Receivables','Finance and Accounts','NP1021','mohit.b@example.com','+91 98000 11118',''],['NP1131','Pooja Rawat','Accounts Associate','Finance and Accounts','NEW','pooja.r@example.com','+91 98000 11131','Direct report'],['NP0410','Rohit Verma','IT Lead','IT','NP0401','rohit.v@example.com','+91 98000 10410','IT'],['NP0520','Sunil Yadav','Admin Executive','Administration','NP0501','sunil.y@example.com','+91 98000 10520','Admin']],
  lotus:[['LV2001','Sr. Mary Joseph','Nursing Superintendent','ICU Nursing','LV1001','mary.j@example.com','+91 99000 22001','Manager'],['LV2040','Sr. Leela Thomas','Charge Nurse, ICU','ICU Nursing','LV2001','leela.t@example.com','+91 99000 22040','Buddy'],['LV2055','Bindu Raj','Staff Nurse','ICU Nursing','LV2001','bindu.r@example.com','+91 99000 22055',''],['LV2061','Faizal K','Staff Nurse','ICU Nursing','LV2001','faizal.k@example.com','+91 99000 22061',''],['LV3010','HIS access desk','IT Support','IT','LV3001','his.desk@example.com','+91 99000 23010','IT']],
  default:[['E1001','Team manager','Manager','Finance','E1000','manager@example.com','+91 90000 01001','Manager'],['E1002','Team member','Executive','Finance','E1001','member@example.com','+91 90000 01002','Buddy']]};
const master=()=>(store.master&&store.master[client.id]&&store.master[client.id].rows)||null;
function masterRow(tag){ const m=master(); return m&&m.find(r=>String(r[7]||'').toLowerCase()===tag.toLowerCase()); }
function personFor(key,tag){ const r=masterRow(tag); return r?`${r[1]}, ${r[2]}`:cv(key); }
function buddyText(){ const r=masterRow('Buddy'); return r?`${r[1]} (${r[2]}), your buddy for the first months`:cv('buddy'); }
function renderMaster(){ const m=master();
  $('#emTbl').innerHTML=m?`<tr>${EM_COLS.map(c=>`<th>${c}</th>`).join('')}</tr>`+m.map(r=>`<tr>${EM_COLS.map((_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join(''):`<tr><td class="note">No employee master uploaded for this client yet. The agent uses the sample team details until one is uploaded. Download the template to start.</td></tr>`; }
$('#emTpl').onclick=()=>saveXlsx(`Employee_master_template_${client.id}.xlsx`,[['Employee master',[EM_COLS,...(EM_SAMPLE[client.id]||EM_SAMPLE.default)]],['How to fill',[['Column','What to enter'],['Employee code','Unique code from payroll or HRMS'],['Manager code','Employee code of the reporting manager; NEW for people who will report to the new joiner'],['Role tag','Manager, Buddy, Direct report, IT, Admin, Security, HR or blank']]]]);
$('#emDl').onclick=()=>{ const m=master(); if(!m){ toast('Nothing uploaded yet for this client.'); return; } saveXlsx(`Employee_master_${client.id}.xlsx`,[['Employee master',[EM_COLS,...m]]]); };
$('#emUp').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if(!f) return; if(isDefC()){ toast('Pick a client first.'); return; }
  try{ const t=await readTable(f); const rows=Object.values(t)[0]||[]; const hdr=rows.shift().map(norm); const idx=EM_COLS.map(c=>hdr.indexOf(norm(c)));
    if(idx[1]<0){ toast('The file needs at least a Name column. Use the template.'); return; }
    const data=rows.map(r=>idx.map(i=>i>=0?String(r[i]??'').trim():'')).filter(r=>r[1]);
    await saveRec('master',client.id,{rows:data,client:client.id,file:f.name,updated:new Date().toISOString()}); setTimeout(()=>{ renderMaster(); if(S) renderBrain(); },400); toast(`Loaded ${data.length} employees from ${f.name}.`); }
  catch(err){ toast('Could not read that file. Use the CSV or Excel template.'); } };
STORE_HOOKS.push(k=>{ if(k==='master'&&!$('#tab-config').hidden) renderMaster(); });
/* HRMS import file from confirmed joining forms */
function joinRow(){ const c=S.c, p=S.pd; const g=(fid,k,dv)=>{ const f=formDefs().find(x=>x.id===fid); if(!f) return dv; const fl=f.sections.flatMap(s=>s.fields||[]).find(x=>x.k===k); return fl?fval(fid,fl):dv; };
  const fs=formDefs().filter(f=>f.applies); const pr=fs.reduce((a,f)=>{ const x=formProgress(f); return [a[0]+x.done,a[1]+x.total]; },[0,0]);
  const base=[['Employee name',c.name],['Father or spouse name',g('f11','father',p.spouse||p.father)],['Date of birth',g('f11','dob',p.dob)],['Gender',g('f11','gender',p.gender)],['Marital status',g('f11','marital',p.marital)],['Mobile',c.mobile],['Personal email',g('f11','email',p.email||c.email)],['Present address',g('f2a','addrPres',p.addrPres)],['Permanent address',g('f2a','addrPerm',p.addrPerm)],['Aadhaar (masked)',g('f11','aadhaar',p.aadhaar)],['PAN (masked)',g('f11','pan',p.pan)],['Bank account and IFSC',g('f11','bank',p.bank)],['UAN',g('f11','uan',p.uan)],['Previous PF account',g('f11','prevPf',p.prevPf)],['Date of joining',fmtD(c.doj)],['Designation',c.role],['Department',c.dept||team().dept],['Reporting manager',c.mgr],['Annual CTC (INR)',c.ctc||''],['Monthly gross (INR)',c.gross?Math.round(c.gross/12):''],['ESIC applicable',c.esic?'Yes':'No'],['PF nominee(s)',p.nominees.map(n=>`${n[0]} (${n[2]}, ${n[4]})`).join('; ')],['Fields confirmed by candidate',`${pr[0]} of ${pr[1]}`]];
  fs.filter(f=>f.custom).forEach(f=>f.sections.forEach(s=>(s.fields||[]).forEach(fl=>base.push([`${f.title}: ${fl.label}`,fval(f.id,fl)||''])))); return base; }
function updateExportLabel(){ const b=$('#fmExport'); if(!b) return; const it=integ(); b.textContent=it.mode==='api'?`Send to ${it.hrms} (API)`:it.mode==='none'?'Save to TCMPL employee database':'Download HRMS import file'; }
$('#fmExport').onclick=async()=>{ if(!S) return; const it=integ(), row=joinRow();
  if(it.mode==='api'){ act(`Confirmed joining data sent to ${it.hrms} through its API (simulated in this demo): ${row.length} fields.`); toast(`Sent to ${it.hrms}. In this demo the API call is simulated; use the download buttons for a copy.`); renderBrain(); return; }
  if(it.mode==='none'){ const ok=await saveRec('employees',uid('em'),Object.assign({client:client.id,clientLabel:client.label,saved:new Date().toISOString()},Object.fromEntries(row.map(([k,v])=>[slug(k),String(v??'')])))); if(ok) act('Confirmed joining data saved to TCMPL\'s employee database.'); renderBrain(); return; }
  await saveXlsx(`HRMS_import_${S.c.name.replace(/\W+/g,'_')}.xlsx`,[['Joiner',[row.map(r=>r[0]),row.map(r=>r[1])]]]); act('HRMS import file downloaded for '+(it.hrms||'the client HRMS')+'.'); };
$('#fmCsv').onclick=()=>{ if(!S) return; const row=joinRow(); saveFile(`HRMS_import_${S.c.name.replace(/\W+/g,'_')}.csv`,csvOf([row.map(r=>r[0]),row.map(r=>r[1])]),'text/csv'); };
$('#fmXlsx').onclick=()=>{ if(!S) return; const row=joinRow(); saveXlsx(`HRMS_import_${S.c.name.replace(/\W+/g,'_')}.xlsx`,[['Joiner',[row.map(r=>r[0]),row.map(r=>r[1])]]]); };
/* client setup workbook */
$('#cfgXlsx').onclick=()=>{ const o=client.ov; const S1=[['Section','Item key','Item','TCMPL default','This client','Status']];
  SECTIONS.forEach(sec=>{ sec.keys.forEach(([k,l])=>S1.push([sec.title,k,l,DEFAULT[k]??'',o[k]!==undefined?o[k]:'',(o.hidden||[]).includes(k)?'Hidden':o[k]!==undefined?'Client value':'Default'])); ((o.custom||{})[sec.id]||[]).forEach(x=>S1.push([sec.title,'',x.label,'',x.value,'Added'])); });
  const S2=[['Document','Standard','Status'],...docListNow().map(d=>[d.text,d.std?'Yes':'No',d.off?'Hidden':'In use'])];
  const cad=cv('cadence'), off=cv('off'); const S3=[['Touchpoint key','Touchpoint','Who','Timing','On','Channel','Message'],...Object.keys(TP).map(k=>[k,TP[k].t,{c:'Candidate',m:'Manager',s:'Stakeholders'}[TP[k].k],cad[k],off.includes(k)?'No':'Yes','','']),...(o.customTps||[]).map(t=>['',t.name,{c:'Candidate',m:'Manager',s:'Stakeholders'}[t.track],t.when,'Yes',t.channel,t.msg])];
  const S4=[['Form','Type','On','Field','Pre-filled from','Default value'],...STATUTORY.map(id=>[id,'Statutory',(o.formsOff||[]).includes(id)?'No':'Yes','','','']),...(o.customForms||[]).flatMap(f=>f.fields.map(x=>[f.name,'Client form','Yes',x.label,x.src,x.value]))];
  const S5=[['Topic','Trigger words','Answer'],...cv('faq').map(f=>[f[0],f[1].split('|').join(', '),f[2]])];
  const it=integ(); const S6=[['Setting','Value'],['Connection','api / file / none'],['Mode',it.mode],['HRMS',it.hrms]];
  saveXlsx(`Client_setup_${client.id}.xlsx`,[['Settings',S1],['Documents',S2],['Touchpoints',S3],['Forms',S4],['Form help',S5],['Connection',S6]]); };
$('#cfgUp').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if(!f) return; if(isDefC()){ toast('Pick a client first; the TCMPL default cannot be changed here.'); return; }
  try{ const t=await readTable(f); const o=client.ov; const secBy=Object.fromEntries(SECTIONS.map(s=>[s.title,s]));
    if(t.Settings){ const rows=t.Settings.slice(1); o.hidden=[]; o.custom={}; rows.forEach(r=>{ const [sect,k,label,,val,st]=r.map(x=>String(x??'').trim()); const sec=secBy[sect]; if(!sec) return;
      if(k){ if(/hidden/i.test(st)) o.hidden.push(k); else if(val!==''&&val!==DEFAULT[k]) o[k]=val; else delete o[k]; }
      else if(label||val){ (o.custom[sec.id]=o.custom[sec.id]||[]).push({id:uid('c'),label,value:val}); } }); }
    if(t.Documents){ const std=DEFAULT.docs.split(';').map(s=>s.trim()); o.docList=t.Documents.slice(1).filter(r=>r[0]).map(r=>({id:uid('d'),text:String(r[0]).trim(),std:std.includes(String(r[0]).trim())||/yes/i.test(r[1]),off:/hidden/i.test(r[2])})); }
    if(t.Touchpoints){ const rows=t.Touchpoints.slice(1); o.cadence={}; o.off=[]; o.customTps=[]; const trk={candidate:'c',manager:'m',stakeholders:'s'}; rows.forEach(r=>{ const [k,name,who,when,on,ch,msg]=r.map(x=>String(x??'').trim()); const w=when.toUpperCase().replace(/^D0$/,'D+0'); if(k&&TP[k]){ if(/^[OD][+-]\d+$/.test(w)&&w!==DEFAULT.cadence[k]) o.cadence[k]=w; if(/^no$/i.test(on)) o.off.push(k); } else if(name&&/^[OD][+-]\d+$/.test(w)) o.customTps.push({id:uid('t'),name,when:w,track:trk[who.toLowerCase()]||'c',channel:ch||'WhatsApp',msg}); }); }
    if(t.Forms){ const rows=t.Forms.slice(1); o.formsOff=rows.filter(r=>STATUTORY.includes(String(r[0]).trim())&&/^no$/i.test(String(r[2]))).map(r=>String(r[0]).trim()); const cf={}; rows.filter(r=>/client/i.test(String(r[1]))).forEach(r=>{ const nm=String(r[0]).trim(); cf[nm]=cf[nm]||{id:uid('f'),name:nm,desc:'Client form',fields:[]}; if(r[3]) cf[nm].fields.push({label:String(r[3]),src:SRC_OPTS.includes(String(r[4]))?String(r[4]):'Candidate (WhatsApp)',value:String(r[5]||'')}); }); o.customForms=Object.values(cf); }
    if(t['Form help']){ o.faq=t['Form help'].slice(1).filter(r=>r[0]&&r[2]).map(r=>[String(r[0]),String(r[1]).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).join('|')||'zzzz',String(r[2]),1]); }
    if(t.Connection){ const m={}; t.Connection.slice(1).forEach(r=>m[String(r[0]).trim()]=String(r[1]??'').trim()); if(['api','file','none'].includes(m.Mode)) o.integration={mode:m.Mode,hrms:HRMS.includes(m.HRMS)?m.HRMS:'Other'}; }
    cfgChanged(true); renderConfig(); toast(`Setup loaded from ${f.name} and saved.`); }
  catch(err){ console.warn(err); toast('Could not read that workbook. Start from "Download setup (Excel)".'); } };

/* ---------- Client switch ---------- */
function addClientOption(c){ const o=document.createElement('option'); o.value=c.id; o.textContent=c.label; $('#clientSel').append(o); }
CLIENTS.forEach(addClientOption);
// New client: starts on the TCMPL default with its own name; everything else is set on this tab.
async function addClient(given){
  const name=(typeof given==='string'&&given.trim())||(window.prompt('New client name (e.g. Acme Industries Pvt. Ltd.)')||'').trim(); if(!name) return null;
  let id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'client'; const base=id; let n=2; while(CLIENTS.some(c=>c.id===id)) id=base+'-'+(n++);
  const short=name.replace(/\s+(pvt\.?|private|ltd\.?|limited|llp|inc\.?)\b.*$/i,'').trim()||name;
  const c={id,label:name,ov:{company:name,short,agentName:short+' HR',initials:short.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()}};
  CLIENTS.push(c); addClientOption(c); $('#clientSel').value=id; $('#clientSel').dispatchEvent(new Event('change')); showTab('config');
  if(db){ try{ await db.collection('clients').doc(id).set({ov:c.ov,client:id,label:name,updated:new Date().toISOString()}); publishFacts(); toast(`${name} added on the TCMPL default. Fill in its setup on this tab, then Journey setup, Email settings, Joining forms, Day-1 readiness and Induction.`); }catch(e){ toast('Client added for this session only: saving needs edit access.'); } }
  else toast(`${name} added for this session (no database).`);
  return id;
}
// Admin panel (admin-live.js): the client list and adding a client by name.
window.tcmplClients=()=>CLIENTS.map(c=>({id:c.id,label:c.label,inactive:!!c.inactive}));
window.tcmplAddClient=name=>addClient(name);
function renameClient(){
  if(isDefC()){ toast('The TCMPL default template cannot be renamed.'); return; }
  const name=(window.prompt('Client name',client.label)||'').trim(); if(!name||name===client.label) return;
  client.label=name; const o=[...$('#clientSel').options].find(x=>x.value===client.id); if(o) o.textContent=name; saveCfg();
}
$('#hdrAddClient').onclick=addClient; $('#cfgRenameClient').onclick=renameClient;
$('#clientSel').value=client.id;
function applyClient(restart){
  const m=cv('offerMode'); $('#modeMake').hidden=m==='upload'; $('#modeUpload').hidden=m==='make'; setMode(m==='upload'?'upload':'make');
  si=0; renderSlide(); renderQuiz(); loadPlan(); updateExportLabel();
  if(restart){ fillOffer(); renderOffer(); $('#csvIn').value=CSV_SAMPLE; $('#csvOut').innerHTML='<tr><td class="note">Rows appear here after the check.</td></tr>';
    if(m==='upload'){ const rows=parseCsv(CSV_SAMPLE); const h=rows[0]; const o={}; h.forEach((k,i)=>o[k]=rows[1][i]); startCandidate(uploadedCand(o)); }
    else startCandidate(fromOffer()); }
  else if(S){ $('#pName').textContent=cv('agentName'); $('#pAvatar').textContent=cv('initials'); }
}
$('#clientSel').onchange=()=>{ client=CLIENTS.find(c=>c.id===$('#clientSel').value); applyClient(true); const cur=$$('nav.tabs button').find(b=>b.getAttribute('aria-selected')==='true').dataset.tab; showTab(cur); };
initCaps(); onStore('fx');
applyClient(true);
})();
