import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as nodeCrypto from 'node:crypto';
import { Prisma } from '@prisma/client';
// Execute the actual handlers/services with allowlisted mocks. No Prisma client,
// auth provider, environment file or network transport is ever imported.
function load(path, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, console, process: { env: {} }, require(name) {
    if (!(name in mocks)) throw new Error('Unmocked import blocked: ' + name);
    return mocks[name];
  } }, { filename: path });
  return fixtureModule.exports;
}
const policy = load('src/lib/order-policy.ts');
const input = load('src/lib/order-input.ts', { zod: { z } });
const allocation = load('src/lib/customer-allocation.ts', { zod: { z }, './order-input': input });
const seller = { id: 'seller-a', role: 'SELLER' };
const admin = { id: 'admin-a', role: 'ADMIN' };
const notices = { notifyWalletDeducted: async () => {}, notifyOrderStatusChanged: async () => {}, notifyProfitCredited: async () => {} };
function mocks(db, user = seller) {
  return { '@/lib/prisma': db, '@prisma/client': { Prisma }, 'node:crypto': nodeCrypto, '@/lib/customer-allocation': allocation, '@/lib/order-policy': policy, 'zod': { z }, '@/lib/order-input': input,
    '@/services/orderSubmissionService': load('src/services/orderSubmissionService.ts', { '@/lib/prisma': db, 'node:crypto': nodeCrypto }),
    '@/lib/api-utils': { getSessionUser: async () => user, errorResponse: (error, status = 400) => ({ status, error }) },
    'next/server': { NextResponse: { json: (data, options) => ({ status: options?.status ?? 200, data }) } },
    '@/services/notificationService': notices, './notificationService': notices,
  };
}
const req = data => ({ json: async () => data, headers: { get: () => '11111111-1111-4111-8111-111111111111' } });
const fail = () => assert.fail('Unexpected database write');

test('seller transitions reject all warehouse, financial and terminal jumps', () => {
  for (const state of ['DRAFT','PENDING_CONFIRMATION','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','RETURNED','CANCELLED']) {
    const allowed = policy.sellerTransitions(state);
    for (const target of ['PROCESSING','WAITING_PAYMENT','SHIPPED','DELIVERED','RETURNED']) assert.ok(!allowed.includes(target));
    assert.equal(policy.sellerTransitions(state, 'paid-batch').length, 0);
  }
  assert.ok(policy.sellerTransitions('DRAFT').includes('PENDING_CONFIRMATION'));
  assert.ok(policy.sellerTransitions('PENDING_CONFIRMATION').includes('CONFIRMED'));
});
test('minimum is five eligible units; ID uniqueness is independent of count', () => {
  for (const ids of [null, [], ['a','a'], [null]]) assert.throws(() => policy.assertBatchIds(ids));
  policy.assertBatchIds(['a']); policy.assertBatchIds(['a','b']);
  policy.assertBatchUnits([{quantity:2},{quantity:3}]); policy.assertBatchUnits([{quantity:5}]);
  for (const quantities of [[4],[2,2],[0,5],[-1,6],[1.5,4]]) assert.throws(() => policy.assertBatchUnits(quantities.map(quantity=>({quantity}))));
});

test('seller status endpoint scopes lookup and rejects another seller order', async () => {
  const db = { order: { findFirst: async ({ where }) => { assert.equal(where.sellerId, seller.id); return null; } }, $transaction: fail };
  const route = load('src/app/api/seller/orders/[id]/status/route.ts', mocks(db));
  assert.equal((await route.PATCH(req({status:'CONFIRMED'}), {params:Promise.resolve({id:'foreign'})})).status,404);
});
test('seller cannot mark a draft as delivered', async () => {
  const route = load('src/app/api/seller/orders/[id]/status/route.ts', mocks({ order: { findFirst: async () => ({ status:'DRAFT', batchId:null }) }, $transaction: fail }));
  assert.equal((await route.PATCH(req({status:'DELIVERED'}), {params:Promise.resolve({id:'a'})})).status,409);
});
test('confirmation has a compare-and-set and history in one transaction', async () => {
  let history = 0;
  const tx = { order: { updateMany: async ({where, data}) => { assert.equal(where.sellerId,seller.id); assert.equal(where.status,'PENDING_CONFIRMATION'); assert.equal(where.batchId,null); assert.equal(data.status,'CONFIRMED'); return {count:1}; } }, orderStatusHistory: {create:async ({data})=>{assert.equal(data.userId,seller.id); history++;}} };
  const route = load('src/app/api/seller/orders/[id]/status/route.ts', mocks({order:{findFirst:async()=>({status:'PENDING_CONFIRMATION',batchId:null})},$transaction:fn=>fn(tx)}));
  assert.equal((await route.PATCH(req({status:'CONFIRMED'}), {params:Promise.resolve({id:'a'})})).status,200); assert.equal(history,1);
});
test('legacy shipping cannot debit a wallet or bypass confirmation', async () => {
  const route = load('src/app/api/seller/orders/ship-all/route.ts', mocks({}));
  assert.equal((await route.POST(req({orderIds:['a']}))).status,409);
});
function batchFixture({ stock = 100, quantities = [2,3], claim = 1, approved = true, debit = 1 } = {}) {
  let debits=0, ledger=0, submitted=0;
  const orders = quantities.map((quantity,i)=>({id:String(i),status:'WAITING_PAYMENT',productId:'p',quantity,product:{sellerPrice:50,stock}}));
  const tx={ log: { findUnique: async()=>approved ? {action:'BATCH_APPROVE'} : null, create:async()=>{submitted++;} },
    order: {findMany:async({where})=>{assert.equal(where.sellerId,seller.id);return orders;},updateMany:async({where,data})=>{assert.equal(where.sellerId,seller.id);return {count:data.status==='PROCESSING'?orders.length:claim};}},
    wallet:{findUniqueOrThrow:async()=>({id:'wallet',balance:1000}),updateMany:async()=>{debits++;return {count:debit};}},
    orderbatch:{findUniqueOrThrow:async()=>({id:'batch',isPaid:false,totalAmount:new Prisma.Decimal(quantities.reduce((sum,q)=>sum+q*50+20,0))}), updateMany:async()=>({count:1}), create:async({data})=>{assert.equal(new Prisma.Decimal(data.totalAmount).toString(),String(quantities.reduce((sum,q)=>sum+q*50+20,0)));assert.equal(data.isPaid,false);return{id:'batch'};}},
    transaction:{create:async()=>{ledger++;}},orderStatusHistory:{createMany:async()=>{}} };
  const db={log:{findUnique:async()=>null},$transaction:async(fn, options)=>{assert.equal(options.isolationLevel,'Serializable');return fn(tx);}};
  return { service:load('src/services/orderService.ts',mocks(db)), counts:()=>({debits,ledger,submitted}) };
}

test('two confirmed orders totaling five PCS submit unpaid for separate Admin review', async()=>{const f=batchFixture();await f.service.createBatch(seller.id,['0','1']);assert.deepEqual(f.counts(),{debits:0,ledger:0,submitted:1});});
test('one confirmed order with five PCS qualifies',async()=>{const f=batchFixture({quantities:[5]});await f.service.createBatch(seller.id,['0']);assert.equal(f.counts().submitted,1);});
test('four PCS cannot be submitted',async()=>{const f=batchFixture({quantities:[4]});await assert.rejects(f.service.createBatch(seller.id,['0']));assert.equal(f.counts().submitted,0);});
test('aggregate stock shortage rejects review submission',async()=>{const f=batchFixture({stock:4});await assert.rejects(f.service.createBatch(seller.id,['0','1']));assert.equal(f.counts().debits,0);});
test('missing, foreign or stale batch selection fails before submission',async()=>{const f=batchFixture();await assert.rejects(f.service.createBatch(seller.id,['0','1','missing']));assert.equal(f.counts().submitted,0);});
test('concurrent wallet depletion cannot create a payment ledger entry',async()=>{const f=batchFixture({debit:0});await assert.rejects(f.service.payBatchFromWallet(seller.id,'batch'));assert.equal(f.counts().ledger,0);});
test('payment requires explicit Admin approval',async()=>{const f=batchFixture({approved:false});await assert.rejects(f.service.payBatchFromWallet(seller.id,'batch'));assert.equal(f.counts().debits,0);});
test('approved five-PCS batch debits once with existing per-order fee',async()=>{const f=batchFixture();await f.service.payBatchFromWallet(seller.id,'batch');assert.equal(f.counts().debits,1);assert.equal(f.counts().ledger,1);});
test('concurrent order claim failure rejects without submitting or charging',async()=>{const f=batchFixture({claim:0});await assert.rejects(f.service.createBatch(seller.id,['0','1']));assert.equal(f.counts().submitted,0);assert.equal(f.counts().debits,0);});

test('manual dispatch permission is explicit and defaults off',()=>{const service=load('src/services/dispatchService.ts',mocks({}));assert.equal(service.canManuallyDispatch('admin-a'),false);assert.equal(service.canManuallyDispatch('admin-a','admin-ab'),false);assert.equal(service.canManuallyDispatch('admin-a','admin-b, admin-a'),true);});
function dispatchFixture({ paid = true, stock = 1, claim = 1, approved = true } = {}) {
  let audit=0, history=0, writes=0;
  const db={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');return fn({order:{findMany:async({where})=>{assert.equal(where.batch.isPaid,true);assert.equal(where.status,'PROCESSING');return paid?[{id:'o',productId:'p',quantity:2,sellerId:'s',batch:{id:'b',sellerId:'s'}}]:[];},updateMany:async()=>({count:claim})},product:{updateMany:async({where})=>{assert.equal(where.stock.gte,2);writes++;return{count:stock};}},orderStatusHistory:{createMany:async()=>{history++;}},log:{findUnique:async()=>approved?{action:'BATCH_APPROVE'}:null,create:async({data})=>{assert.equal(data.action,'MANUAL_WAREHOUSE_DISPATCH');assert.ok(data.details.includes('inspected'));audit++;}}});}};
  // Explicit synthetic permission, no environment file.
  const path='src/services/dispatchService.ts';
  const code=fs.readFileSync(path,'utf8').replace("process.env.MANUAL_DISPATCH_ADMIN_IDS ?? ''", "'admin-a'");
  const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const fixtureModule ={exports:{}};vm.runInNewContext(compiled,{module:fixtureModule,exports:fixtureModule.exports,require:()=>db});
  return {service:fixtureModule.exports,counts:()=>({audit,history,writes})};
}
test('unpaid dispatch is rejected without stock writes',async()=>{const f=dispatchFixture({paid:false});await assert.rejects(f.service.dispatchOrders('admin-a',['o'],'inspected'));assert.equal(f.counts().writes,0);});
test('paid dispatch still requires explicit Admin approval evidence',async()=>{const f=dispatchFixture({approved:false});await assert.rejects(f.service.dispatchOrders('admin-a',['o'],'inspected'));assert.equal(f.counts().writes,0);});

test('insufficient dispatch stock does not reach shipped state or audit',async()=>{const f=dispatchFixture({stock:0});await assert.rejects(f.service.dispatchOrders('admin-a',['o'],'inspected'));assert.equal(f.counts().audit,0);});
test('successful manual dispatch records history and reason',async()=>{const f=dispatchFixture();await f.service.dispatchOrders('admin-a',['o'],'inspected');assert.deepEqual(f.counts(),{audit:1,history:1,writes:1});});
test('duplicate dispatch claim fails and duplicate IDs are rejected',async()=>{const f=dispatchFixture({claim:0});await assert.rejects(f.service.dispatchOrders('admin-a',['o'],'inspected'));await assert.rejects(f.service.dispatchOrders('admin-a',['o','o'],'inspected'));assert.equal(f.counts().audit,0);});
test('return records inspection pending without restocking',async()=>{
  let audit=0;
  const tx={order:{updateMany:async({where})=>{assert.equal(where.status,'SHIPPED');return{count:1};}},orderStatusHistory:{create:async()=>{}},log:{create:async({data})=>{assert.equal(data.action,'RETURN_AWAITING_INSPECTION');audit++;}},product:{update:fail}};
  const route=load('src/app/api/admin/orders/return/route.ts',mocks({order:{findUnique:async()=>({status:'SHIPPED',sellerId:'s',productId:'p',quantity:1})},$transaction:fn=>fn(tx)},admin));
  assert.equal((await route.POST(req({orderId:'o'}))).status,200);assert.equal(audit,1);
});
test('delivery replay cannot credit wallet again',async()=>{
  const route=load('src/app/api/admin/orders/deliver/route.ts',mocks({order:{findUnique:async()=>({status:'SHIPPED',quantity:1,product:{sellerPrice:50}})},$transaction:fn=>fn({order:{updateMany:async()=>({count:0})},wallet:{upsert:fail}})},admin));
  assert.equal((await route.POST(req({orderId:'o',codReceived:100}))).status,409);
});
test('old return/refund endpoint is blocked',async()=>{const route=load('src/app/api/admin/logistics/update-delivery/route.ts',mocks({},admin));assert.equal((await route.POST()).status,409);});
test('public debug endpoint contains no environment fragments',async()=>{const route=load('src/app/api/debug-env/route.ts',mocks({}));const response=await route.GET();assert.equal(response.status,404);assert.equal(response.data.error,'Not found');assert.ok(!JSON.stringify(response).includes('DATABASE_URL'));});
for (const routePath of ['create','create-bulk','import']) test(routePath+' rejects invalid quantities before database access',async()=>{
  const route=load('src/app/api/seller/orders/'+routePath+'/route.ts',mocks({}));
  const base={productId:'p',productName:'p',customerName:'Name',customerPhone:'0612345678',address:'Address',city:'Agadir',codAmount:100};
  for(const quantity of [-1,0,1.5]) {
    const body=routePath==='import'?{productId:'p',orders:[{name:'Name',phone:'0612345678',address:'Address',city:'Agadir',quantity,price:100}]}:routePath==='create-bulk'?{orders:[{...base,quantity}]}:{...base,quantity};
    assert.equal((await route.POST(req(body))).status,400);
  }
});

test('deactivated users and stale role tokens cannot use API helpers', async () => {
  for (const current of [null, { isActive:false, role:'SELLER' }, { isActive:true, role:'ADMIN' }]) {
    const helper=load('src/lib/api-utils.ts',{
      'next-auth':{getServerSession:async()=>({user:seller})}, './auth':{authOptions:{}},
      './prisma':{user:{findUnique:async({where})=>{assert.equal(where.id,seller.id);return current;}}},
      'next/server':{NextResponse:{json:()=>{}}},
    });
    assert.equal(await helper.getSessionUser(),null);
  }
});
test('catalog query is tenant-scoped and does not disclose supplier cost',async()=>{
  const route=load('src/app/api/seller/catalog/route.ts',mocks({sellerProduct:{findMany:async({where,include})=>{assert.equal(where.sellerId,seller.id);assert.equal(include.product.select.costPrice,undefined);assert.equal(include.product.select.supplierId,undefined);assert.equal(include.product.select.sellerPrice,true);return[];}}}));
  assert.equal((await route.GET()).status,200);
});
test('eligible batch orders are confirmed, unbatched and tenant-scoped',async()=>{
  const route=load('src/app/api/seller/batches/eligible/route.ts',mocks({order:{findMany:async({where})=>{assert.equal(where.sellerId,seller.id);assert.equal(where.status,'CONFIRMED');assert.equal(where.batchId,null);return[{id:'o',quantity:2,product:null}];}}}));
  const result=await route.GET();assert.equal(result.data.orders[0].eligible,false);assert.equal(result.data.orders[0].cost,null);
});
test('call center cannot trigger dispatch or settlement through status changes',async()=>{
  const route=load('src/app/api/call-center/update-status/route.ts',mocks({order:{findUnique:async()=>({status:'PENDING_CONFIRMATION',batchId:null})},$transaction:fail},{id:'operator',role:'CALL_CENTER'}));
  for(const status of ['SHIPPED','DELIVERED','RETURNED','PROCESSING'])assert.equal((await route.POST(req({orderId:'o',status}))).status,409);
});
test('legacy unpaid batches cannot bypass Admin approval',async()=>{
  const service=load('src/services/orderService.ts',mocks({orderbatch:{findUniqueOrThrow:async()=>({isPaid:false,totalAmount:100})},$transaction:fn=>fn({order:{findMany:async()=>[{id:'o',status:'WAITING_PAYMENT'}]},orderbatch:{updateMany:fail}})}));
  await assert.rejects(service.payBatchFromWallet(seller.id,'batch'));
});
test('delivery keeps the existing 20 MAD commission and recorded profit formula',async()=>{
  let credited=0, recorded=0;
  const db={order:{findUnique:async()=>({status:'SHIPPED',quantity:2,sellerId:'s',product:{sellerPrice:50}})},$transaction:fn=>fn({
    order:{updateMany:async({data})=>{assert.equal(data.systemFee,20);assert.equal(data.netProfit,80);recorded++;return{count:1};}},
    orderStatusHistory:{create:async()=>{}},wallet:{upsert:async({update})=>{credited=update.balance.increment;return{id:'w'};}},transaction:{create:async()=>{}},
  })};
  const route=load('src/app/api/admin/orders/deliver/route.ts',mocks(db,admin));
  assert.equal((await route.POST(req({orderId:'o',codReceived:200}))).status,200);assert.equal(credited,80);assert.equal(recorded,1);
});
test('import route preserves explicit zero COD and binds the authenticated seller',async()=>{
  const allowed=mocks({});
  allowed['@/services/orderSubmissionService'].createDraftSubmission=async(sellerId,key,source,orders)=>{
    assert.equal(sellerId,seller.id);assert.equal(source,'import');assert.equal(orders[0].codAmount,0);assert.equal(orders[0].customerPhone,'0612345678');return{orderIds:['o'],replayed:false};
  };
  const route=load('src/app/api/seller/orders/import/route.ts',allowed);
  assert.equal((await route.POST(req({productId:'p',orders:[{name:'Name',phone:'0612345678',address:'Address',city:'Agadir',quantity:1,price:0}]}))).status,200);
});
test('operational queues are all-time and tenant-scoped independently of charts',async()=>{
  const db={order:{count:async()=>0,aggregate:async()=>({_count:{id:0},_sum:{netProfit:null}}),findMany:async()=>[],groupBy:async({where})=>{assert.equal(where.sellerId,seller.id);return where.createdAt?[]:[{status:'PENDING_CONFIRMATION',_count:{id:7}}];}}};
  // vm intentionally has no network; URL is the standard local parser only.
  // Inject it explicitly for the real handler.
  const source=fs.readFileSync('src/app/api/seller/analytics/route.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const fixtureModule ={exports:{}};const allowed=mocks(db);vm.runInNewContext(compiled,{module:fixtureModule,exports:fixtureModule.exports,URL,require:name=>{if(!(name in allowed))throw Error(name);return allowed[name];}});
  const result=await fixtureModule.exports.GET({url:'https://offline.invalid/api/seller/analytics?from=2026-01-01&to=2026-01-31'});
  assert.equal(result.data.queues.PENDING_CONFIRMATION,7);assert.equal(result.data.totalOrders,0);
});
