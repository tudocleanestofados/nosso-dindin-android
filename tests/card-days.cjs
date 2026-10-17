const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const source = fs.readFileSync('www/features.js','utf8');
const start = source.lastIndexOf('  function groupPurchaseDays(');
const end = source.indexOf('  const previous = window.renderCards;', start);
const context = {window:{}}; vm.createContext(context); vm.runInContext(source.slice(start,end),context);
const purchases = [
 {id:'a',purchase_date:'2026-10-17',total_amount:2.8},
 {id:'b',purchase_date:'2026-10-02',total_amount:0.1},
 {id:'c',purchase_date:'2026-10-02',total_amount:0.2},
 {id:'d',purchase_date:null,total_amount:10},
 {id:'e',purchase_date:'2026-10-17',total_amount:15.32}
];
const groups = context.window.ND_CARD_DAYS.groupPurchaseDays(purchases);
assert.deepEqual(Array.from(groups,g=>g.day),['2026-10-02','2026-10-17','']);
assert.equal(groups[0].totalCents,30); assert.equal(groups[1].totalCents,1812);
assert.deepEqual(Array.from(groups[1].purchases,p=>p.id),['a','e']);
assert.equal(purchases[0].id,'a');
assert.equal(context.window.ND_CARD_DAYS.groupPurchaseDays([]).length,0);
console.log('PASS: ascending purchase dates, day grouping, exact cent totals, missing dates last, unchanged source order');
