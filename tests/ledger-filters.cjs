const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('www/features.js','utf8');
const start=source.indexOf('  // Ledger filter helpers:');
const end=source.indexOf('  // End ledger filter helpers.')+'  // End ledger filter helpers.'.length;
const elements={allTransactions:{innerHTML:''},ndLedgerCount:{textContent:''}};
const ctx={window:{},today:()=> '2026-10-13',el:id=>elements[id],Date,Intl,
 creditCards:[{id:'card',name:'Pagbank',due_day:15}],cardPurchases:[{id:'purchase',description:'Compra',installments:9}],
 cardInstallments:[{id:'oct',card_id:'card',purchase_id:'purchase',invoice_month:'2026-09-01',amount:20,paid:false,installment_number:6},{id:'nov',card_id:'card',purchase_id:'purchase',invoice_month:'2026-10-01',amount:20,paid:false,installment_number:7}],invoicePayments:[],
 escapeHtml:s=>s,money:n=>String(n)};
vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
const h=ctx.window.ND_LEDGER_HELPERS;
const data=[{id:'overdue',due_date:'2026-10-12',paid:false},{id:'today',due_date:'2026-10-13',paid:false},{id:'day7',due_date:'2026-10-19',paid:false},{id:'day8',due_date:'2026-10-20',paid:false},{id:'future',due_date:'2029-05-13',paid:false},{id:'paid',due_date:'2026-09-01',date:'2026-10-05',paid:true}];
const matches=f=>data.filter(x=>h.matchesLedger(x,f,'2026-10','2026-10-12','2026-10-13','2026-10-13')).map(x=>x.id);
assert.deepEqual(matches('month'),['overdue','today','day7','day8','paid']);
assert.deepEqual(matches('overdue'),['overdue']);assert.deepEqual(matches('week'),['today','day7']);assert.deepEqual(matches('paid'),['paid']);assert.deepEqual(matches('period'),['overdue','today']);assert.equal(matches('all').length,6);
assert.equal(h.monthEnd('2028-02'),'2028-02-29');assert.equal(h.plusDays('2026-12-30',6),'2027-01-05');
assert.deepEqual([...data].reverse().sort(h.ledgerOrder).map(x=>x.id),['overdue','today','day7','day8','future','paid']);
assert.equal(h.matchesLedger({paid:true},'month','2026-10','','','2026-10-13'),false);
assert.equal(h.matchesLedger(data[0],'period','2026-10','2026-10-20','2026-10-01','2026-10-13'),false);
const render=source.slice(source.indexOf('  function renderInvoiceLedger()'),source.indexOf('  window.renderTransactions = function'));
vm.runInContext(render+'\nrenderInvoiceLedger();',ctx);
assert.equal(ctx.window.ND_LEDGER_VISIBLE_INVOICES.length,1);assert.equal(ctx.window.ND_LEDGER_VISIBLE_INVOICES[0].month,'2026-09');assert.ok(elements.allTransactions.innerHTML.includes('15/10/2026'));
vm.runInContext("ledgerFilter='all';renderInvoiceLedger();",ctx);assert.equal(ctx.window.ND_LEDGER_VISIBLE_INVOICES.length,2);
vm.runInContext("ledgerFilter='week';renderInvoiceLedger();",ctx);assert.equal(ctx.window.ND_LEDGER_VISIBLE_INVOICES.length,1);
console.log('PASS: all filters, inclusive period, 7-day boundary, leap year, ordering, invoice due month and reconciliation mapping');
