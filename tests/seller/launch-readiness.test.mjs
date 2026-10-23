import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { order_status } from '@prisma/client';
import * as jsxRuntime from 'react/jsx-runtime';
function load(path, imports = {}, globals = {}, expose = '') {
  const fixture = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText + expose, {
    module: fixture, exports: fixture.exports, URL, console, ...globals,
    require(name) { if (!(name in imports)) throw Error('Unmocked import blocked: '+name); return imports[name]; },
  }, { filename: path }); return fixture.exports;
}
const fail = () => assert.fail('Unexpected data access or mutation');
const deniedDb = { order: {findMany:fail,findFirst:fail,count:fail}, orderbatch: {findUnique:fail}, product: {findUnique:fail}, user: {findMany:fail}, wallet: {aggregate:fail} };
const input = load('src/lib/order-input.ts', {zod:{z}});
const policy = load('src/lib/order-policy.ts');
const allocation = load('src/lib/customer-allocation.ts',{zod:{z},'./order-input':input});
const next = { NextResponse: {json:(data,options)=>({status:options?.status??200,data})} };
const api = (user=null) => ({ getSessionUser:async()=>user,errorResponse:(error,status=400)=>({error,status}) });
const pages = [
  ['src/app/(dashboard)/seller/orders/page.tsx','SELLER'],
  ['src/app/(dashboard)/seller/orders/[id]/page.tsx','SELLER'],
  ['src/app/(dashboard)/seller/products/[id]/page.tsx','SELLER'],
  ['src/app/(dashboard)/admin/dashboard/page.tsx','ADMIN'],
  ['src/app/(dashboard)/admin/users/page.tsx','ADMIN'],
  ['src/app/(dashboard)/admin/logistics/manifest/[batchId]/page.tsx','ADMIN'],
];
for(const [path,role] of pages) test(`server page denies anonymous, wrong-role and revoked sessions before data: ${path}`, async()=>{
  for(const current of [null,{isActive:false,role},{isActive:true,role:role==='ADMIN'?'SELLER':'ADMIN'}]) {
    const helper=load('src/lib/api-utils.ts',{'./prisma':{user:{findUnique:async()=>current}},'next-auth':{getServerSession:async()=>({user:{id:'revoked',role}})},'./auth':{authOptions:{}},'next/server':next});
    const page=load(path,{
      '@/lib/api-utils':helper,'@/lib/prisma':deniedDb,'next/navigation':{redirect:target=>{throw Error('redirect:'+target);},notFound:fail},
      '@prisma/client':{order_status},'react/jsx-runtime':jsxRuntime,react:{Suspense:'section'},'next/headers':{cookies:fail},
      '@/components/ui/DateDropdown':{PERIOD_LABELS:{}},'./SellerOrdersClient':{},'./ActivityTable':{},'./DateFilter':{},
      '@/components/ui/PrintButton':{},'next/link':'a','./AddToCatalogButton':{},'@/lib/product-images':{productImages:()=>[]},'@/lib/order-reference':{orderReference:id=>id},
      'lucide-react':{},'@/messages/ar.json':{},'@/messages/fr.json':{},
    }).default;
    await assert.rejects(page({searchParams:Promise.resolve({}),params:Promise.resolve({id:'foreign',batchId:'foreign'})}),/redirect:\/login/);
  }
});
test('seller cannot retrieve another seller order detail even with a valid active session', async()=>{
  let queries=0;
  const Page=load('src/app/(dashboard)/seller/orders/[id]/page.tsx',{
    '@/lib/api-utils':api({id:'seller-a',role:'SELLER'}),'@/lib/prisma':{order:{findFirst:async({where})=>{queries++;assert.equal(where.id,'seller-b-order');assert.equal(where.sellerId,'seller-a');return null;}}},
    'next/navigation':{redirect:fail,notFound:()=>{throw Error('not found');}},'next/link':'a','react/jsx-runtime':jsxRuntime,'@/lib/order-reference':{orderReference:id=>id},
  }).default;
  await assert.rejects(Page({params:Promise.resolve({id:'seller-b-order'})}),/not found/);assert.equal(queries,1);
});
test('order details describe pending Admin review without presenting it as payment approval', async()=>{
  const {renderToStaticMarkup}=await import('react-dom/server');
  const Page=load('src/app/(dashboard)/seller/orders/[id]/page.tsx',{
    '@/lib/api-utils':api({id:'s',role:'SELLER'}),'@/lib/prisma':{order:{findFirst:async()=>({id:'o',customerName:'Synthetic',status:'WAITING_PAYMENT',quantity:5,codAmount:100,codReceived:null,batch:{id:'b',isPaid:false},statusHistory:[]})},log:{findUnique:async()=>null}},
    'next/navigation':{redirect:fail,notFound:fail},'next/link':'a','react/jsx-runtime':jsxRuntime,'@/lib/order-reference':{orderReference:id=>id},
  }).default;
  const markup=renderToStaticMarkup(await Page({params:Promise.resolve({id:'o'})}));
  assert.ok(markup.includes('En attente de revue Admin'));assert.ok(!markup.includes('Approuvé — à payer'));
});
test('onboarding rejects malformed types before updating and saves only authenticated seller profile',async()=>{
  const writes=[];
  const route=load('src/app/api/seller/onboarding/route.ts',{'@/lib/api-utils':api({id:'s',role:'SELLER'}),'@/lib/prisma':{user:{update:async args=>{writes.push(args);}}},'next/server':next,zod:{z},'@/lib/order-input':input});
  const valid={name:' Seller ',phone:'+212 612-345-678',city:'Agadir',storeName:'Shop'};
  for(const body of [null,{...valid,name:17},{...valid,storeDescription:{}},{...valid,phone:true},{...valid,city:''}]) assert.equal((await route.POST({json:async()=>body})).status,400);
  assert.equal(writes.length,0);
  assert.equal((await route.POST({json:async()=>({...valid,id:'victim',role:'ADMIN',isActive:false})})).status,200);
  assert.equal(writes[0].where.id,'s');assert.equal(writes[0].data.phone,'0612345678');assert.equal(writes[0].data.hasCompletedOnboarding,true);assert.equal(writes[0].data.role,undefined);
});
test('login recovers from a rejected transport and suppresses duplicate calls',async()=>{
  const states=[],refs=[];let si=0,ri=0,calls=0;
  let reject; const network=new Promise((_,rejectPromise)=>{reject=rejectPromise;});
  const Page=load('src/app/login/page.tsx',{
    react:{useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=value;}];},useRef:initial=>refs[ri++]??=( {current:initial}),useEffect:()=>{}},
    'next-auth/react':{signIn:async()=>{calls++;return network;},getSession:fail},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'next/link':'a','lucide-react':{},
  },{window:{location:{href:''}}}).default;
  function find(node,type){if(Array.isArray(node))return node.map(child=>find(child,type)).find(Boolean);if(!node||typeof node!=='object')return null;return node.type===type?node:find(node.props?.children,type);}
  const render=()=>{si=0;ri=0;return Page();};
  const form=find(render(),'form');const event={preventDefault(){}};
  const first=form.props.onSubmit(event);const second=form.props.onSubmit(event);assert.equal(calls,1);
  reject(Error('offline'));await Promise.all([first,second]);assert.equal(states[3],false);assert.match(states[2],/تعذر الاتصال/);
  await find(render(),'form').props.onSubmit(event);assert.equal(calls,2);assert.equal(states[3],false);
});
test('credentials reject pending/wrong-password users; OAuth creation starts inactive; onboarding flag is database driven',async()=>{
  let dbUser={id:'s',name:'Synthetic',email:'synthetic@example.invalid',role:'SELLER',password:'hash',isActive:false,hasCompletedOnboarding:true},created;
  const auth=load('src/lib/auth.ts',{
    '@next-auth/prisma-adapter':{PrismaAdapter:()=>({})},'next-auth/providers/credentials':options=>({id:'credentials',...options}),'next-auth/providers/google':options=>({id:'google',...options}),
    './prisma':{user:{findUnique:async()=>dbUser,create:async({data})=>{created=data;return{id:'new',...data};}}},bcryptjs:{compare:async password=>password==='correct'},
  },{process:{env:{}}}).authOptions;
  const credentials=auth.providers.find(provider=>provider.id==='credentials');
  await assert.rejects(credentials.authorize({email:'synthetic@example.invalid',password:'correct'}),/قيد المراجعة/);
  dbUser.isActive=true;await assert.rejects(credentials.authorize({email:'synthetic@example.invalid',password:'wrong'}));
  assert.equal((await credentials.authorize({email:'synthetic@example.invalid',password:'correct'})).id,'s');
  await auth.adapter.createUser({email:'new@example.invalid',name:'Synthetic'});assert.equal(created.isActive,false);assert.equal(created.role,'SELLER');
  const token=await auth.callbacks.jwt({token:{},user:{id:'s',role:'SELLER',isActive:true}});assert.equal(token.hasCompletedOnboarding,true);
  dbUser.hasCompletedOnboarding=false;assert.equal((await auth.callbacks.jwt({token,trigger:'update'})).hasCompletedOnboarding,false);
});
const apiCases=[
 ['seller/orders/create','POST','SELLER'],['seller/orders/create-bulk','POST','SELLER'],['seller/orders/import','POST','SELLER'],
 ['seller/batches/create','POST','SELLER'],['seller/batches/pay','POST','SELLER'],['seller/batches/eligible','GET','SELLER'],['seller/batches/list','GET','SELLER'],['seller/onboarding','POST','SELLER'],
 ['seller/wallet/deposit','POST','SELLER'],['seller/wallet/withdraw','POST','SELLER'],
 ['admin/wallet/topup','POST','ADMIN'],['admin/orders','GET','ADMIN'],['admin/batches/review','POST','ADMIN'],['admin/orders/dispatch','POST','ADMIN'],['admin/orders/deliver','POST','ADMIN'],['admin/orders/return','POST','ADMIN'],['admin/logistics/ship','POST','ADMIN'],
 ['call-center/orders','GET','CALL_CENTER'],
];
for(const [path,method,requiredRole] of apiCases)test(`direct API denies anonymous and wrong role before body/data: ${path}`,async()=>{
 for(const user of [null,{id:'wrong',role:requiredRole==='SELLER'?'ADMIN':'SELLER'}]) {
  const route=load('src/app/api/'+path+'/route.ts',{
   '@/lib/api-utils':api(user),'@/lib/prisma':{},'next/server':next,zod:{z},'@/lib/order-policy':policy,'@/lib/order-input':input,'@/lib/customer-allocation':allocation,
   '@/services/orderSubmissionService':{createDraftSubmission:fail,OrderSubmissionError:class extends Error{}},'@/services/orderService':{createBatch:fail,payBatchFromWallet:fail,reviewBatch:fail},
   '@/services/manualTopupService':{manualTopup:fail},'@/services/dispatchService':{canManuallyDispatch:fail,dispatchOrders:fail},'@/services/notificationService':{},
  });
  const response=await route[method]({json:fail,headers:{get:fail},url:'https://offline.invalid'});assert.equal(response.status,401);
 }
});
for(const kind of ['deposit','withdraw'])test(`seller wallet ${kind} rejects boolean, blank, null and nonpositive amounts before data writes`,async()=>{
 const route=load('src/app/api/seller/wallet/'+kind+'/route.ts',{'@/lib/api-utils':api({id:'s',role:'SELLER'}),'@/lib/prisma':{},'next/server':next,zod:{z},'@/lib/order-input':input});
 const valid={receiptImage:'https://receipt.invalid/r',bankName:'Synthetic',bankAccountName:'Synthetic Seller',rib:'1'.repeat(24)};
 for(const amount of [true,false,null,'',0,-1,'bad'])assert.equal((await route.POST({json:async()=>({...valid,amount})})).status,400);
});

test('catalog API hides supplier costs; actual cart provider accepts five PCS and rejects a sixth without stock', async()=>{
  const catalog=load('src/app/api/seller/products/route.ts',{'@/lib/api-utils':api({id:'s',role:'SELLER'}),'@/lib/prisma':{product:{findMany:async({select})=>{assert.equal(select.costPrice,undefined);assert.equal(select.supplierId,undefined);return[{id:'p',sellerPrice:50,stock:5}];}}},'next/server':next});
  assert.equal((await catalog.GET()).data.products[0].stock,5);
  const states=[],refs=[],effects=[];let si=0,ri=0,mounted=false;
  const storage=[];
  const context=load('src/context/CartContext.tsx',{
    react:{createContext:()=>({Provider:'provider'}),useContext:fail,useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=value;}];},useRef:initial=>refs[ri++]??={current:initial},useCallback:fn=>fn,useEffect:fn=>{if(!mounted)effects.push(fn);}},
    'next-auth/react':{useSession:()=>({data:{user:{id:'seller-a',role:'SELLER'}}})},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    '@/lib/cart':{...load('src/lib/cart.ts'),getCart:()=>[],saveCart:(sellerId,items)=>{assert.equal(sellerId,'seller-a');storage.push(items);},clearCart:fail},
  },{crypto:{randomUUID:()=> 'synthetic-cart-id'}});
  const outer=context.CartProvider({children:null});
  const render=()=>{si=0;ri=0;return outer.type(outer.props).props.value;};
  render();mounted=true;effects.forEach(effect=>effect());await Promise.resolve();
  let cart=render();assert.equal(cart.ready,true);
  const product={productId:'p',productName:'Synthetic',productImage:'',sellerPrice:50,marketPrice:100,stock:5,quantity:5};
  assert.equal(cart.addItem(product),true);assert.equal(cart.addItem({...product,quantity:1}),false);
  cart=render();assert.equal(cart.totalCount,5);assert.equal(cart.items.length,1);assert.equal(storage.length,1);
});
test('proxy guards role boundaries and seller onboarding, without treating confirmation as approval',()=>{
  let options;
  const guard=load('src/proxy.ts',{'next-auth/middleware':{withAuth:(fn,config)=>{options=config;return fn;}},'next/server':{NextResponse:{redirect:url=>({target:url.pathname})}}}).default;
  assert.equal(options.callbacks.authorized({token:null}),false);
  const request=(path,token)=>({nextUrl:{pathname:path},nextauth:{token},url:'https://offline.invalid'+path});
  assert.equal(guard(request('/admin/orders',{role:'SELLER'})).target,'/seller/dashboard');
  assert.equal(guard(request('/seller/orders',{role:'SELLER',hasCompletedOnboarding:false,isActive:true})).target,'/seller/onboarding');
  assert.equal(guard(request('/seller/onboarding',{role:'SELLER',hasCompletedOnboarding:true,isActive:true})).target,'/seller/dashboard');
  assert.equal(guard(request('/seller/orders',{role:'SELLER',hasCompletedOnboarding:true,isActive:false})).target,'/login');
  assert.equal(guard(request('/seller/orders',{role:'SELLER',hasCompletedOnboarding:true,isActive:true})),undefined);
});

function topupModalFixture({loseFirst=false,failCleanup=false}={}) {
  const states=['5','Verified transfer',false,false,false],refs=[],bodies=[];let si=0,ri=0,calls=0,actor='admin';
  const Modal=load('src/app/(dashboard)/admin/deposits/page.tsx',{
    react:{useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=value;}];},useRef:initial=>refs[ri++]??={current:initial},useEffect:()=>{},useCallback:fn=>fn},
    'next-auth/react':{useSession:()=>({data:{user:{id:actor,role:'ADMIN'}}})},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-hot-toast':{loading:()=> 'toast',success:()=>{},error:()=>{}},'lucide-react':{},
    axios:{post:async(url,body,config)=>{calls++;bodies.push(structuredClone({url,body,config}));if(loseFirst&&calls===1)throw Error('response lost');return{data:{success:true}};},isAxiosError:()=>false},
    '@/lib/order-submission-client':{submissionKey:async()=> '11111111-1111-4111-8111-111111111111',clearSubmissionKey:()=>{}},
  },{structuredClone},'\nmodule.exports.TestModal = TopupModal;').TestModal;
  const render=()=>{si=0;ri=0;return Modal({seller:{id:'seller',name:'Synthetic',balance:10},onClose:()=>{},onDone:()=>{if(failCleanup)throw Error('local callback failed');}});};
  function findForm(node){if(Array.isArray(node))return node.map(findForm).find(Boolean);if(!node||typeof node!=='object')return null;return node.type==='form'?node:findForm(node.props?.children);}
  return{submit:()=>findForm(render()).props.onSubmit({preventDefault(){}}),states,bodies,calls:()=>calls,setActor:value=>{actor=value;}};
}
test('Admin topup UI suppresses duplicate clicks and retries original data/key after an uncertain response',async()=>{
  const f=topupModalFixture({loseFirst:true});await Promise.all([f.submit(),f.submit()]);assert.equal(f.calls(),1);assert.equal(f.states[3],true);
  f.states[0]='999';await f.submit();assert.equal(f.calls(),2);assert.deepEqual(f.bodies[0],f.bodies[1]);assert.equal(f.states[4],true);
});
test('Admin topup acknowledged save cannot become a new credit when local refresh fails',async()=>{
  const f=topupModalFixture({failCleanup:true});await f.submit();await f.submit();assert.equal(f.calls(),1);assert.equal(f.states[4],true);
});

test('manual topup API validates identity/input before calling service and binds the authenticated Admin',async()=>{
  const calls=[];
  const route=load('src/app/api/admin/wallet/topup/route.ts',{'@/lib/api-utils':api({id:'real-admin',role:'ADMIN'}),'next/server':next,zod:{z},'@/lib/order-input':input,'@/services/manualTopupService':{manualTopup:async(...args)=>{calls.push(args);return{replayed:true};}}});
  const request=(body,key)=>({json:async()=>body,headers:{get:()=>key}});
  assert.equal((await route.POST(request({targetUserId:'seller',amount:5},null))).status,400);
  assert.equal((await route.POST(request({targetUserId:'seller',amount:true},'11111111-1111-4111-8111-111111111111'))).status,400);assert.equal(calls.length,0);
  const result=await route.POST(request({actorId:'spoofed',targetUserId:'seller',amount:'5',note:' Reviewed '},'11111111-1111-4111-8111-111111111111'));
  assert.equal(result.data.replayed,true);assert.equal(calls[0][0],'real-admin');assert.equal(calls[0][3],5);assert.equal(calls[0][4],'Reviewed');
});


test('an uncertain manual topup cannot be retried as a different Admin operation after account change',async()=>{
  const f=topupModalFixture({loseFirst:true});await f.submit();f.setActor('other-admin');await f.submit();assert.equal(f.calls(),1);
});

test('delivery with missing product cost or invalid quantity fails before any settlement or wallet mutation',async()=>{
  for(const order of [{product:null,quantity:2},{product:{sellerPrice:50},quantity:0},{product:{sellerPrice:50},quantity:1.5},{product:{sellerPrice:-5},quantity:2},{product:{sellerPrice:'bad'},quantity:2}]) {
    const route=load('src/app/api/admin/orders/deliver/route.ts',{'@/lib/api-utils':api({id:'admin',role:'ADMIN'}),'@/lib/prisma':{order:{findUnique:async()=>({...order,status:'SHIPPED',sellerId:'s'})},$transaction:fail},'next/server':next,zod:{z},'@/services/notificationService':{}});
    assert.equal((await route.POST({json:async()=>({orderId:'o',codReceived:200})})).status,409);
  }
});
