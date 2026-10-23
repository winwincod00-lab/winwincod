import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
function load(path, imports) {
  const fixture={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:fixture,exports:fixture.exports,console,require(name){if(!(name in imports))throw Error('Blocked import '+name);return imports[name];}});
  return fixture.exports;
}
const key='11111111-1111-4111-8111-111111111111';
function fixture(){
  let state={balance:'10',logs:{},ledger:[]},queue=Promise.resolve();const config={failLedger:false,loseResponse:false};
  function read(work){return{
    log:{findUnique:async({where})=>work.logs[where.id]??null},
    wallet:{findUniqueOrThrow:async()=>({id:'w',balance:new Prisma.Decimal(work.balance)})},
    transaction:{findMany:async({where})=>work.ledger.filter(entry=>entry.referenceId===where.referenceId&&entry.walletId===where.walletId&&entry.type===where.type)},
  };}
  const db={log:{findUnique:async args=>read(state).log.findUnique(args)},wallet:{findUniqueOrThrow:async args=>read(state).wallet.findUniqueOrThrow(args)},transaction:{findMany:async args=>read(state).transaction.findMany(args)},$transaction(fn,options){
    assert.equal(options.isolationLevel,'Serializable');const promise=queue.then(async()=>{
      const work=structuredClone(state),tx=read(work);
      tx.user={findUnique:async()=>({role:'SELLER'})};
      tx.log.create=async({data})=>{if(work.logs[data.id])throw Error('duplicate');work.logs[data.id]={...data};};
      tx.wallet.update=async({data})=>{work.balance=new Prisma.Decimal(work.balance).plus(data.balance.increment).toString();return{id:'w',balance:new Prisma.Decimal(work.balance)};};
      tx.transaction.create=async({data})=>{if(config.failLedger)throw Error('ledger failed');work.ledger.push({...data,amount:data.amount.toString()});};
      const result=await fn(tx);state=work;if(config.loseResponse){config.loseResponse=false;throw Error('response lost');}return result;
    });queue=promise.catch(()=>{});return promise;
  }};
  const service=load('src/services/manualTopupService.ts',{'@/lib/prisma':db,'@prisma/client':{Prisma},'node:crypto':crypto});
  return{call:(amount=0.1,note='Verified transfer')=>service.manualTopup('admin',key,'seller',amount,note),state:()=>state,config,service};
}
test('manual topup concurrent same operation and retry credit one exact Decimal amount with one audit/ledger',async()=>{
  const f=fixture();await Promise.all([f.call(),f.call()]);await f.call();
  assert.equal(f.state().balance,'10.1');assert.equal(f.state().ledger.length,1);assert.equal(Object.keys(f.state().logs).length,1);
});
test('manual topup rejects changed amount/note under same operation identity',async()=>{
  const f=fixture();await f.call();await assert.rejects(f.call(0.2),/different data/);await assert.rejects(f.call(0.1,'Changed'),/different data/);assert.equal(f.state().balance,'10.1');
});
test('manual topup ledger failure rolls back receipt and balance; retry can succeed in model',async()=>{
  const f=fixture();f.config.failLedger=true;await assert.rejects(f.call());assert.equal(f.state().balance,'10');assert.equal(Object.keys(f.state().logs).length,0);
  f.config.failLedger=false;await f.call();assert.equal(f.state().balance,'10.1');
});
test('manual topup recovers a lost commit response with read-only ledger receipt verification',async()=>{
  const f=fixture();f.config.loseResponse=true;assert.equal((await f.call()).replayed,true);assert.equal(f.state().ledger.length,1);
});
test('manual topup invalid key/money never starts an operation; missing replay ledger fails closed',async()=>{
  const f=fixture();await assert.rejects(f.service.manualTopup('admin',null,'seller',5,''));await assert.rejects(f.call(-1));assert.equal(f.state().balance,'10');
  await f.call();f.state().ledger.length=0;await assert.rejects(f.call(),/Ledger mismatch/);assert.equal(f.state().balance,'10.1');
});
test('wallet history includes manual credits once, without duplicating request deposit entries or linking credit to an order',async()=>{
  const service=load('src/services/walletService.ts',{
    '@prisma/client':{Prisma},'./walletApprovalService':{},'./notificationService':{},'@/lib/prisma':{
      wallet:{findUnique:async({where})=>{assert.equal(where.userId,'seller-a');return{id:'w'};}},
      depositrequest:{findMany:async({where})=>{assert.equal(where.sellerId,'seller-a');return[{id:'request',amount:5,status:'APPROVED',createdAt:new Date('2026-10-20')}];}},
      transaction:{findMany:async({where})=>{assert.equal(where.walletId,'w');assert.equal(where.type,undefined);return[
        {id:'bank',type:'DEPOSIT',amount:5,referenceId:'request',createdAt:new Date('2026-10-20')},
        {id:'manual',type:'DEPOSIT',amount:3,referenceId:'admin-topup:synthetic',createdAt:new Date('2026-10-21')},
      ];}},
    },
  });
  const result=await service.getWalletHistory('seller-a');assert.equal(result.total,2);assert.equal(result.items[0].id,'manual');assert.equal(result.items[0].type,'DEPOSIT');assert.equal(result.items[0].orderId,null);
});

test('wallet history does not hide a real legacy credit behind a PENDING or mismatched request',async()=>{
  const service=load('src/services/walletService.ts',{'@prisma/client':{Prisma},'./walletApprovalService':{},'./notificationService':{},'@/lib/prisma':{
    wallet:{findUnique:async()=>({id:'w'})},
    depositrequest:{findMany:async()=>[{id:'pending',amount:5,status:'PENDING',createdAt:new Date('2026-10-20')},{id:'mismatch',amount:5,status:'APPROVED',createdAt:new Date('2026-10-20')}]},
    transaction:{findMany:async()=>[{id:'effect-pending',type:'DEPOSIT',amount:5,referenceId:'pending',createdAt:new Date('2026-10-21')},{id:'effect-mismatch',type:'DEPOSIT',amount:7,referenceId:'mismatch',createdAt:new Date('2026-10-21')}]},
  }});
  const result=await service.getWalletHistory('s');assert.equal(result.total,4);assert.ok(result.items.some(item=>item.id==='effect-pending'));assert.ok(result.items.some(item=>item.id==='effect-mismatch'));
});

test('wallet history preserves duplicate legacy deposit effects for reconciliation instead of concealing them',async()=>{
  const date=new Date('2026-10-20');
  const service=load('src/services/walletService.ts',{'@prisma/client':{Prisma},'./walletApprovalService':{},'./notificationService':{},'@/lib/prisma':{
    wallet:{findUnique:async()=>({id:'w'})},depositrequest:{findMany:async()=>[{id:'request',amount:5,status:'APPROVED',createdAt:date}]},transaction:{findMany:async()=>[1,2].map(n=>({id:'effect'+n,type:'DEPOSIT',amount:5,referenceId:'request',createdAt:date}))},
  }});
  assert.equal((await service.getWalletHistory('s')).total,3);
});
