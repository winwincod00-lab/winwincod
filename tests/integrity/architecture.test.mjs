import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, imports={}) {
 const fixture={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:fixture,exports:fixture.exports,require(name){if(!(name in imports))throw Error('Unmocked import '+name);return imports[name];}});
 return fixture.exports;
}
const domain=load('src/integrity-v1/domain.ts');
const policy=load('src/lib/order-policy.ts');
const contract=load('src/integrity-v1/payment-contract.ts',{'../lib/order-policy':policy,'./domain':domain});
const known=domain.snapshot({sellerUnitCost:'10.10',supplierUnitCost:'5.05',source:'AT_CREATION',evidence:null});
test('exact money preserves all 65 digits and rejects rounding, binary floats and overflow',()=>{
 const maximal='9'.repeat(35)+'.'+'9'.repeat(30);
 assert.equal(domain.decimal(domain.money(maximal)),maximal);
 assert.equal(domain.decimal(domain.money('0.1')+domain.money('0.2')),'0.3');
 for(const invalid of [0.1,'NaN','Infinity','1e3','0.'+'1'.repeat(31),'1'.repeat(36),'',' 1'])assert.throws(()=>domain.money(invalid));
 assert.throws(()=>domain.decimal(domain.money(maximal)+domain.money('0.000000000000000000000000000001')));
});
test('snapshots are frozen, survive product repricing and keep old missing costs unknown',()=>{
 const product={seller:'10.10',supplier:'5.05'};
 const captured=domain.snapshot({sellerUnitCost:product.seller,supplierUnitCost:product.supplier,source:'AT_CREATION',evidence:null});
 product.seller='99';product.supplier='88';assert.equal(captured.sellerUnitCost,'10.10');assert.equal(Object.isFrozen(captured),true);
 assert.throws(()=>{captured.sellerUnitCost='999';});
 const unknown=domain.snapshot({sellerUnitCost:null,supplierUnitCost:null,source:'UNKNOWN',evidence:null});
 assert.equal(domain.margin(unknown,2,'200','20','DELIVERY_RECORDED').sellerMargin,null);
 assert.throws(()=>domain.snapshot({...unknown,sellerUnitCost:'0'}));
 assert.throws(()=>domain.snapshot({...unknown,source:'AT_CREATION'}));
});
test('partial quantities and sellable returns reverse only recognized COGS; damaged/pending units do not invent a refund',()=>{
 let recognized=domain.recognitionUnits(5,0,5);recognized=domain.recognitionUnits(5,recognized,-2);assert.equal(recognized,3);
 assert.equal(domain.margin(known,recognized,'100','20','SETTLEMENT_VERIFIED').sellerMargin,'49.7');
 assert.throws(()=>domain.recognitionUnits(5,recognized,-4));assert.throws(()=>domain.recognitionUnits(5,recognized,3));
 assert.equal(domain.margin(known,0,'0','20','DELIVERY_RECORDED').sellerMargin,'-20');
 assert.equal(domain.margin(known,3,'100','20','PROJECTED').basis,'PROJECTED');
});
test('evidence-based partial historical knowledge remains partial, without a zero supplier/seller fallback',()=>{
 const partial=domain.snapshot({sellerUnitCost:null,supplierUnitCost:'5',source:'EVIDENCE_REVIEW',evidence:'reviewed-document-hash'});
 const result=domain.margin(partial,2,'100','20','DELIVERY_RECORDED');assert.equal(result.sellerMargin,null);assert.equal(result.supplierMargin,'70');
 assert.throws(()=>domain.snapshot({...partial,evidence:null}));
});
test('withdrawal hold reduces available funds, blocks other spending and consumes once without changing available twice',()=>{
 const held=domain.walletTransition({balance:'100',held:'0'},'HOLD','60');assert.equal(held.available,'40');
 assert.throws(()=>domain.walletTransition(held,'DEBIT','50'));
 const paid=domain.walletTransition(held,'CONSUME','60','60');assert.equal(paid.balance,'40');assert.equal(paid.held,'0');assert.equal(paid.available,'40');
 assert.throws(()=>domain.walletTransition(paid,'CONSUME','60','60'));
});
test('hold rejection releases funds, whole-hold checks prevent silently introducing partial payouts',()=>{
 const state={balance:'100',held:'60'};
 assert.equal(domain.walletTransition(state,'RELEASE','60','60').available,'100');
 assert.throws(()=>domain.walletTransition(state,'CONSUME','20','60'));
 assert.throws(()=>domain.walletTransition({balance:'10',held:'20'},'CREDIT','50'));
});
test('available stock is consumed by reservation, not by an unchecked promise; restocking requires unused inspected quantities',()=>{
 let stock={AVAILABLE:5,RESERVED:0,IN_TRANSIT:0,RETURNED_PENDING_INSPECTION:0,DAMAGED:0};
 stock=domain.stockTransition(stock,'RESERVE',2);stock=domain.stockTransition(stock,'RESERVE',3);assert.equal(stock.AVAILABLE,0);
 assert.throws(()=>domain.stockTransition(stock,'RESERVE',1));
 stock=domain.stockTransition(stock,'DISPATCH',5);assert.equal(stock.IN_TRANSIT,5);assert.equal(stock.AVAILABLE,0);
 stock=domain.stockTransition(stock,'RECEIVE_RETURN',2);assert.equal(stock.RETURNED_PENDING_INSPECTION,2);assert.equal(stock.AVAILABLE,0);
 assert.throws(()=>domain.stockTransition(stock,'RESTOCK',2));
 stock=domain.stockTransition(stock,'RESTOCK',1,{disposition:'SELLABLE',remaining:2});assert.equal(stock.AVAILABLE,1);
 assert.throws(()=>domain.stockTransition(stock,'RESTOCK',2,{disposition:'SELLABLE',remaining:1}));
 stock=domain.stockTransition(stock,'DISPOSE_DAMAGED',1,{disposition:'DAMAGED',remaining:1});assert.equal(stock.DAMAGED,1);assert.equal(stock.AVAILABLE,1);
 stock=domain.stockTransition(stock,'DELIVER',3);assert.equal(stock.IN_TRANSIT,0);
});
test('reservation release does not restock already dispatched units and rejects fractional quantities',()=>{
 let stock={AVAILABLE:0,RESERVED:5,IN_TRANSIT:0,RETURNED_PENDING_INSPECTION:0,DAMAGED:0};
 stock=domain.stockTransition(stock,'RELEASE',2);stock=domain.stockTransition(stock,'DISPATCH',3);
 assert.throws(()=>domain.stockTransition(stock,'RELEASE',1));assert.throws(()=>domain.stockTransition(stock,'RESERVE',0.5));
});
const expected=(ref='shipment')=>({shipmentId:'local',sellerId:'s',carrierAccountId:'carrier-a',externalRef:ref,expectedCod:'100',currency:'MAD'});
const observed=(ref='shipment')=>({rowId:'row',carrierAccountId:'carrier-a',externalRef:ref,gross:'100',fee:'20',adjustment:'-5',net:'75',currency:'MAD'});
test('settlement reconciliation detects missing, unmatched, mismatched amounts/currencies and unknown expectations',()=>{
 assert.equal(domain.reconcile([expected()],[])[0].status,'MISSING');
 assert.equal(domain.reconcile([],[observed()])[0].status,'UNMATCHED');
 assert.equal(domain.reconcile([expected()],[observed()])[0].status,'MATCH');
 assert.equal(domain.reconcile([expected()],[{...observed(),net:'76'}])[0].status,'MISMATCH');
 assert.equal(domain.reconcile([{...expected(),expectedCod:null}],[observed()])[0].status,'UNKNOWN_EXPECTATION');
 assert.equal(domain.reconcile([expected()],[{...observed(),currency:'EUR'}])[0].status,'MISMATCH');
});
test('duplicate/partial settlement references and missing identifiers always require review, never automatic credit',()=>{
 assert.equal(domain.reconcile([expected()],[observed(),{...observed(),rowId:'another'}])[0].status,'AMBIGUOUS');
 assert.equal(domain.reconcile([expected(null)],[observed(null)])[0].status,'AMBIGUOUS');
 assert.equal(domain.reconcile([expected(),{...expected(),shipmentId:'other-seller',sellerId:'other'}],[observed()])[0].status,'AMBIGUOUS');
});
test('same external reference on different carrier accounts cannot cross-match or be incorrectly deduplicated',()=>{
 const result=domain.reconcile([expected(),{...expected(),carrierAccountId:'carrier-b',shipmentId:'b'}],[observed(),{...observed(),carrierAccountId:'carrier-b'}]);
 assert.equal(result.length,2);assert.ok(result.every(item=>item.status==='MATCH'));
});
function paymentFixture({quantities=[2,3],held='0',balance='1000',stock=5,paid=false,review='APPROVED',fail='',unknown=false,mixed=false}={}){
 const lines=quantities.map((quantity,i)=>({id:'line-'+i,sellerId:'s',productId:mixed&&i?'q':'p',quantity,status:'WAITING_PAYMENT',snapshotId:'cost-'+i,cost:unknown?{sellerUnitCost:null,supplierUnitCost:null,source:'UNKNOWN',evidence:null}:known}));
 const total=domain.decimal(quantities.reduce((sum,q)=>sum+domain.money('10.10')*BigInt(q)+domain.money('20'),BigInt(0)));
 let state={balance,held,stock:{p:stock,q:stock},batch:{id:'batch',sellerId:'s',paid,review,total,lines},receipt:null,debits:0,reservations:[],charges:0,history:0};
 let queue=Promise.resolve();const calls=[];
 const db={serializable(fn){const promise=queue.then(async()=>{const working=structuredClone(state);const tx={
  assertCurrentSeller:async(actor,seller)=>{assert.equal(actor,'s');assert.equal(seller,'s');},requireOwnerPolicy:async ref=>{if(ref!=='approved-policy')throw Error('Policy not approved');},
  claimOperation:async()=>({operationId:'operation',replay:working.receipt}),
  readBatchForLockPlan:async()=>structuredClone(working.batch),
  lockWallet:async()=>{calls.push('wallet');return{balance:working.balance,held:working.held};},
  lockStockProducts:async products=>{calls.push('stock');assert.equal(products.join(','),mixed?'p,q':'p');},
  lockBatchAndLines:async()=>{calls.push('batch');return structuredClone(working.batch);},
  claimUnpaidBatchAndProcessingOrders:async()=>{if(working.batch.paid)throw Error('claim lost');working.batch.paid=true;},
  appendImmutableLineCharges:async()=>{working.charges++;},
  reserveLine:async line=>{if(working.stock[line.productId]<line.quantity)throw Error('stock exhausted');working.stock[line.productId]-=line.quantity;working.reservations.push(line.id);if(fail==='reservation')throw Error('reservation failed');return 'reservation:'+line.id;},
  debitAndPostBalancedJournal:async(op,seller,amount)=>{const next=domain.walletTransition(working,'DEBIT',amount);working.balance=next.balance;working.debits++;return 'event';},
  appendHistoryAndAudit:async()=>{working.history++;if(fail==='audit')throw Error('audit failed');},
  completeOperation:async(op,result)=>{working.receipt=structuredClone(result);},
 };const result=await fn(tx);state=working;return result;});queue=promise.catch(()=>{});return promise;}};
 const input={actorId:'s',sellerId:'s',batchId:'batch',requestKey:'request',payloadHash:'a'.repeat(64),policyApprovalRef:'approved-policy'};
 return{run:()=>contract.proposedPayBatch(db,input),state:()=>state,calls,input};
}
test('proposed payment contract atomically debits/reserves 2+3 PCS and replays one result in a serialized model',async()=>{
 const f=paymentFixture();const result=await Promise.all([f.run(),f.run()]);assert.equal(result[0].walletEventId,result[1].walletEventId);assert.equal(f.state().debits,1);assert.equal(f.state().stock.p,0);assert.equal(f.state().charges,1);assert.equal(f.state().balance,'909.5');assert.equal(f.calls.join(','),'wallet,stock,batch');
});
test('proposed payment accepts one order x5 and balances mixed SKUs separately',async()=>{
 const one=paymentFixture({quantities:[5]});await one.run();assert.equal(one.state().balance,'929.5');
 const mixed=paymentFixture({quantities:[2,3],mixed:true,stock:3});await mixed.run();assert.equal(mixed.state().stock.p,1);assert.equal(mixed.state().stock.q,0);
});
for(const [name,options] of [['four units',{quantities:[4]}],['pending review',{review:'PENDING'}],['paid legacy without receipt',{paid:true}],['unknown historical cost',{unknown:true}],['held funds',{balance:'100',held:'20'}],['stock shortage',{stock:4}],['reservation failure',{fail:'reservation'}],['audit failure',{fail:'audit'}]])test('proposed payment rejects and rolls back model state: '+name,async()=>{
 const f=paymentFixture(options);const before=structuredClone(f.state());await assert.rejects(f.run());assert.equal(JSON.stringify(f.state()),JSON.stringify(before));
});
test('owner approval and tenant identity are mandatory before any proposed payment effect',async()=>{
 const f=paymentFixture();f.input.policyApprovalRef='not-approved';await assert.rejects(f.run());assert.equal(f.state().debits,0);
 const other=paymentFixture();other.input.actorId='other';await assert.rejects(other.run());assert.equal(other.state().debits,0);
});
