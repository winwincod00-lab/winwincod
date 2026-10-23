import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
function load(path, imports = {}) {
  const fixture = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    module: fixture, exports: fixture.exports, URL, require(name) { if (!(name in imports)) throw Error('Blocked import '+name); return imports[name]; },
  }); return fixture.exports;
}
const input = load('src/lib/order-input.ts', { zod: { z } });
const allocation = load('src/lib/customer-allocation.ts', { zod: { z }, './order-input': input });
const policy = load('src/lib/order-policy.ts');
const client = (quantity, productId='p', codAmount=100) => ({ customerName: 'Synthetic Client', customerPhone: '0612345678', city: 'Agadir', address: 'Synthetic address', codAmount, allocations: [{ productId, quantity }] });
for (const [name, quantities] of [['A', [2,3]], ['B',[5]]]) test(`${name}: five PCS allocate to independent customer orders with independent COD`, () => {
  const orders = allocation.allocationOrders({ cart:[{productId:'p',quantity:5}], customers: quantities.map((quantity,i)=>client(quantity,'p',i===0?0:123.45)) });
  assert.equal(orders.length, quantities.length); policy.assertBatchUnits(orders);
  assert.equal(orders[0].codAmount,0); assert.equal(orders[0].quantity,quantities[0]);
});
test('C: four eligible PCS fail the batch threshold', () => assert.throws(()=>policy.assertBatchUnits([{quantity:4}])));
for (const [name, quantities] of [['D',[2,4]],['E',[2,2]]]) test(`${name}: per-SKU allocation must equal the cart exactly`, () => {
  assert.throws(()=>allocation.allocationOrders({cart:[{productId:'p',quantity:5}],customers:quantities.map(q=>client(q))}));
});
test('F: mixed SKUs are independently balanced, including duplicate cart rows for a SKU', () => {
  const cart = [{productId:'p',quantity:2},{productId:'p',quantity:1},{productId:'q',quantity:2}];
  const orders = allocation.allocationOrders({cart,customers:[client(3),client(2,'q')]});
  assert.equal(orders.length,2); assert.equal(orders[1].productId,'q'); policy.assertBatchUnits(orders);
  assert.throws(()=>allocation.allocationOrders({cart,customers:[client(2),client(3,'q')]}));
});
test('invalid quantities, incomplete clients, foreign SKUs and unsupported multi-SKU orders fail closed', () => {
  const cart=[{productId:'p',quantity:5}];
  for (const quantity of [0,-1,1.5,'',null,true]) assert.throws(()=>allocation.allocationOrders({cart,customers:[client(quantity)]}));
  assert.throws(()=>allocation.allocationOrders({cart,customers:[{...client(5),address:''}]}));
  assert.throws(()=>allocation.allocationOrders({cart,customers:[client(5,'foreign')]}));
  assert.throws(()=>allocation.allocationOrders({cart,customers:[{...client(5),allocations:[{productId:'p',quantity:2},{productId:'p',quantity:3}]}]}),/Un seul SKU/);
});
function fixture(quantities=[2,3]) {
  let state={orders:quantities.map((quantity,i)=>({id:'o'+i,sellerId:'s',status:'CONFIRMED',batchId:null,productId:'p',quantity})),batches:[],logs:{},ledger:[],history:[],balance:'1000',stock:10};
  let queue=Promise.resolve();
  const product={sellerPrice:50,stock:10};
  const matches=(order,where)=> (!where.sellerId||order.sellerId===where.sellerId)&&(!where.status||order.status===where.status)&&(!('batchId' in where)||order.batchId===where.batchId)&&(!where.id||typeof where.id==='string'&&order.id===where.id||where.id.in?.includes(order.id));
  const batchRead=(work,where)=>{const batch=work.batches.find(batch=>batch.id===where.id&&(!where.sellerId||batch.sellerId===where.sellerId));if(!batch)throw Error('Batch not found');return {...batch};};
  const db={log:{findUnique:async({where})=>state.logs[where.id]??null},orderbatch:{findUniqueOrThrow:async({where})=>batchRead(state,where)},$transaction(fn,options){
    assert.equal(options.isolationLevel,'Serializable');
    const promise=queue.then(async()=>{
      const work=structuredClone(state);
      const tx={
        log:{findUnique:async({where})=>work.logs[where.id]??null,create:async({data})=>{if(work.logs[data.id])throw Error('Unique log identity');work.logs[data.id]={...data};}},
        order:{findMany:async({where})=>work.orders.filter(order=>matches(order,where)).map(order=>({...order,product:{...product,stock:work.stock}})),updateMany:async({where,data})=>{const orders=work.orders.filter(order=>matches(order,where));orders.forEach(order=>Object.assign(order,data));return {count:orders.length};}},
        orderbatch:{create:async({data})=>{const batch={...data,id:'b'+work.batches.length,totalAmount:data.totalAmount.toString()};work.batches.push(batch);return {...batch};},findUniqueOrThrow:async({where})=>batchRead(work,where),updateMany:async({where,data})=>{const batch=work.batches.find(batch=>batch.id===where.id&&batch.sellerId===where.sellerId&&batch.isPaid===where.isPaid);if(!batch)return {count:0};Object.assign(batch,data);return {count:1};}},
        wallet:{findUniqueOrThrow:async()=>({id:'w',balance:new Prisma.Decimal(work.balance)}),updateMany:async({where,data})=>{const balance=new Prisma.Decimal(work.balance);if(balance.lt(where.balance.gte))return {count:0};work.balance=balance.minus(data.balance.decrement).toString();return {count:1};}},
        transaction:{create:async({data})=>{work.ledger.push({...data,amount:data.amount.toString()});}},
        orderStatusHistory:{createMany:async({data})=>{work.history.push(...data);}},
      };
      const result=await fn(tx);state=work;return result;
    });queue=promise.catch(()=>{});return promise;
  }};
  const service=load('src/services/orderService.ts',{'@/lib/prisma':db,'@prisma/client':{Prisma},'node:crypto':crypto,'@/lib/order-policy':policy,'./notificationService':{notifyWalletDeducted:async()=>{}}});
  return {service,state:()=>state,db};
}
test('G: concurrent batch submission/retry reuses one receipt, without any charge',async()=>{
  const f=fixture();const results=await Promise.all([f.service.createBatch('s',['o0','o1']),f.service.createBatch('s',['o1','o0'])]);
  assert.equal(results[0].id,results[1].id);assert.equal(f.state().batches.length,1);assert.equal(f.state().balance,'1000');assert.equal(f.state().ledger.length,0);
  assert.equal(f.state().orders[0].status,'WAITING_PAYMENT');
  await assert.rejects(f.service.createBatch('other',['o0','o1']));
});
test('H: Admin review is separate; approval does not pay, payment retries debit exactly once',async()=>{
  const f=fixture();const batch=await f.service.createBatch('s',['o0','o1']);
  await assert.rejects(f.service.payBatchFromWallet('s',batch.id),/Admin approval/);
  await f.service.reviewBatch('admin',batch.id,'APPROVE','Checked quantities');
  assert.equal(f.state().balance,'1000');assert.equal(f.state().batches[0].isPaid,false);assert.equal(f.state().orders[0].status,'WAITING_PAYMENT');
  await Promise.all([f.service.payBatchFromWallet('s',batch.id),f.service.payBatchFromWallet('s',batch.id)]);
  assert.equal(f.state().ledger.length,1);assert.equal(f.state().balance,'710');assert.equal(f.state().orders[0].status,'PROCESSING');
});
test('Admin rejection cancels the batch orders with history, never refunds or debits, and is retry safe',async()=>{
  const f=fixture();const batch=await f.service.createBatch('s',['o0','o1']);
  await f.service.reviewBatch('admin',batch.id,'REJECT','Not accepted');await f.service.reviewBatch('admin',batch.id,'REJECT','Retry');
  assert.equal(f.state().orders[0].status,'CANCELLED');assert.equal(f.state().balance,'1000');assert.equal(f.state().ledger.length,0);
  await assert.rejects(f.service.payBatchFromWallet('s',batch.id));await assert.rejects(f.service.reviewBatch('admin',batch.id,'APPROVE','Changed decision'));
});
test('canceled, unconfirmed, already-submitted and foreign orders cannot supply eligible units',async()=>{
  for (const patch of [{status:'CANCELLED'},{status:'DRAFT'},{status:'PENDING_CONFIRMATION'},{batchId:'existing'},{sellerId:'other'}]) {
    const f=fixture([5]);Object.assign(f.state().orders[0],patch);
    await assert.rejects(f.service.createBatch('s',['o0']));assert.equal(f.state().batches.length,0);
  }
});
test('stock is rechecked after review; insufficient funds/stock leave the batch unpaid in model',async()=>{
  for (const change of ['stock','balance']) {
    const f=fixture();const batch=await f.service.createBatch('s',['o0','o1']);await f.service.reviewBatch('admin',batch.id,'APPROVE','Checked');
    if(change==='stock') f.state().stock=4;else f.state().balance='1';
    await assert.rejects(f.service.payBatchFromWallet('s',batch.id));assert.equal(f.state().batches[0].isPaid,false);assert.equal(f.state().ledger.length,0);
  }
});
const api=(role='ADMIN')=>({'next/server':{NextResponse:{json:data=>({status:200,data})}},'@/lib/api-utils':{getSessionUser:async()=>({id:'actor',role}),errorResponse:(error,status)=>({error,status})}});
test('Admin API exposes pending review and confirmation, and rejects seller access',async()=>{
  const f=fixture();const batch=await f.service.createBatch('s',['o0','o1']);
  const db={order:{findMany:async({where,include})=>{assert.ok(['WAITING_PAYMENT','PENDING_CONFIRMATION'].includes(where.status));assert.equal(include.batch.select.isPaid,true);return f.state().orders.map(order=>({...order,batch:{isPaid:false}}));}},log:{findMany:async()=>[]}};
  const route=load('src/app/api/admin/orders/route.ts',{...api(),'@/lib/prisma':db});
  const response=await route.GET({url:'https://offline.invalid/api/admin/orders?status=WAITING_PAYMENT'});
  assert.equal(response.data.orders[0].batchId,batch.id);assert.equal(response.data.orders[0].reviewStatus,'PENDING_REVIEW');
  assert.equal((await route.GET({url:'https://offline.invalid/api/admin/orders?status=PENDING_CONFIRMATION'})).status,200);
  const denied=load('src/app/api/admin/orders/route.ts',{...api('SELLER'),'@/lib/prisma':{}});
  assert.equal((await denied.GET({url:'https://offline.invalid'})).status,401);
});
test('Admin review API requires current ADMIN role and explicit valid decision/reason',async()=>{
  let calls=0;
  const imports={...api('SELLER'),zod:{z},'@/services/orderService':{reviewBatch:async()=>{calls++;}}};
  let route=load('src/app/api/admin/batches/review/route.ts',imports);
  assert.equal((await route.POST({json:async()=>({batchId:'b',decision:'APPROVE',reason:'Checked'})})).status,401);
  route=load('src/app/api/admin/batches/review/route.ts',{...imports,...api()});
  assert.equal((await route.POST({json:async()=>({batchId:'b',decision:'APPROVE',reason:''})})).status,400);assert.equal(calls,0);
});

test('competing Admin approve/reject decisions commit a single durable decision',async()=>{
  const f=fixture();const batch=await f.service.createBatch('s',['o0','o1']);
  const results=await Promise.allSettled([f.service.reviewBatch('admin',batch.id,'APPROVE','Checked'),f.service.reviewBatch('admin',batch.id,'REJECT','Declined')]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(f.state().logs['batch-review:'+batch.id].action,'BATCH_APPROVE');
  assert.equal(f.state().orders[0].status,'WAITING_PAYMENT');assert.equal(f.state().ledger.length,0);
});
test('seller batch list includes actual line quantities and separates review from payment',async()=>{
  const route=load('src/app/api/seller/batches/list/route.ts',{...api('SELLER'),'@/lib/prisma':{
    orderbatch:{findMany:async({where,include})=>{assert.equal(where.sellerId,'actor');assert.equal(include.orders.select.quantity,true);return [{id:'b',isPaid:false,orders:[{id:'a',quantity:2,status:'WAITING_PAYMENT'},{id:'b',quantity:3,status:'WAITING_PAYMENT'}]}];}},
    log:{findMany:async()=>[]},
  }});
  const result=await route.GET();assert.equal(result.data.batches[0].units,5);assert.equal(result.data.batches[0].reviewStatus,'PENDING_REVIEW');assert.equal(result.data.batches[0].isPaid,false);
});
