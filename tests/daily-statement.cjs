const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('www/features.js','utf8');
const helper=source.slice(source.indexOf('  // Daily statement helpers.'),source.indexOf('  // End daily statement helpers.'));
const accountRows=[{id:'a',initial_balance:1000.79},{id:'b',initial_balance:0}];
const tx=[
 {id:'old',type:'expense',paid:true,amount:396,date:'2026-10-14',account_id:'a'},
 {id:'income',type:'income',paid:true,amount:950,date:'2026-10-15',account_id:'a'},
 ...[45,559,920].map((amount,i)=>({id:'out'+i,type:'expense',paid:true,amount,date:'2026-10-15',account_id:'a'})),
 {id:'transfer-out',type:'expense',paid:true,amount:100,date:'2026-10-15',account_id:'a',transfer_id:'transfer'},
 {id:'transfer-in',type:'income',paid:true,amount:100,date:'2026-10-15',account_id:'b',transfer_id:'transfer'},
 {id:'pending',type:'expense',paid:false,amount:50,due_date:'2026-10-18'},
 {id:'future',type:'expense',paid:true,amount:20,date:'2026-10-25',account_id:'a'}
];
const goals=[{type:'deposit',amount:10,account_id:'b',date:'2026-10-16'},{type:'withdrawal',amount:5,account_id:'b',date:'2026-10-17'},{type:'deposit',amount:100,account_id:null,date:'2026-10-17'}];
const ctx={window:{},transactions:tx,accounts:accountRows,goalMovements:goals,today:()=> '2026-10-16',effectiveDate:x=>String((x.paid?x.date:x.due_date||x.date)||'').slice(0,10),escapeHtml:x=>x,moneyBR:n=>(n/100).toFixed(2),renderTransaction:x=>`<div class="transaction" data-id="${x.id}"><button>Pagar</button><button>Editar</button><button>Excluir</button></div>`,Intl,Date};
vm.createContext(ctx);vm.runInContext(helper,ctx);
const {dailyStatement,renderDailyStatement}=ctx.window.ND_DAILY_STATEMENT;
let result=dailyStatement(tx.filter(t=>t.id.startsWith('out')),tx,accountRows,goals);
assert.equal(result.length,1);assert.equal(result[0].items.length,3);assert.equal(result[0].paidCents,152400);assert.equal(result[0].balanceCents,3079);
const income=dailyStatement([tx[1]],tx,accountRows,goals);assert.equal(income[0].balanceCents,3079);
const days=dailyStatement([{type:'expense',paid:false,due_date:'2026-10-16',amount:30},{type:'expense',paid:false,due_date:'2026-10-18',amount:50}],tx,accountRows,goals);
assert.equal(days[0].balanceCents,2079);assert.equal(days[1].balanceCents,2579);assert.equal(days[1].pendingCents,5000);
const future=dailyStatement([tx.at(-1)],tx,accountRows,goals);assert.equal(future[0].balanceCents,579);
const cents=dailyStatement([{type:'expense',paid:true,date:'2026-10-01',account_id:'a',amount:0.1},{type:'expense',paid:true,date:'2026-10-01',account_id:'a',amount:0.2}],[{type:'expense',paid:true,date:'2026-10-01',account_id:'a',amount:0.1},{type:'expense',paid:true,date:'2026-10-01',account_id:'a',amount:0.2}],[{id:'a',initial_balance:0}],[]);assert.equal(cents[0].balanceCents,-30);
let html=renderDailyStatement(tx.filter(t=>t.id.startsWith('out')),'expense');assert.equal((html.match(/nd-statement-day/g)||[]).length,1);assert.ok(html.includes('Saldo do dia'));assert.ok(html.includes('30.79'));assert.equal((html.match(/>Editar</g)||[]).length,3);assert.ok(html.includes('sensitive-money'));
html=renderDailyStatement([tx.find(t=>t.id==='pending')],'expense');assert.ok(html.includes('previsto'));assert.ok(!html.includes('nd-day-closing'));
const empty=dailyStatement([{type:'expense',paid:false,amount:10}],[],[],[]);assert.equal(empty[0].balanceCents,null);
const backwards=dailyStatement([tx.at(-1),tx[1],tx[0]],tx,accountRows,goals);assert.deepEqual(Array.from(backwards,g=>g.day),['2026-10-14','2026-10-15','2026-10-25']);
const renderSelection=ctx.window.ND_DAILY_STATEMENT.renderLedgerSelection;
for(const filter of ['month','overdue','week','period','all'])assert.ok(!renderSelection([tx[0]],'expense',filter).includes('nd-statement-day'));
assert.ok(renderSelection([tx[0]],'expense','paid').includes('nd-statement-day'));
assert.ok(source.includes('#transactionsSection #allTransactions.nd-statement-list{background:transparent!important'));
assert.ok(source.includes('#transactionsSection #allTransactions{background:var(--surface2,#f0f5fb)!important'));
console.log('PASS: grouping, full historical closing balance across both tabs/accounts, transfer neutrality, Cofrinho, pending/future handling, cent precision, preserved actions and privacy');
