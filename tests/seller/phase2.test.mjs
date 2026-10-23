import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import * as nodeCrypto from 'node:crypto';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const fixture = { exports: {} };
  vm.runInNewContext(code, { module: fixture, exports: fixture.exports, console, structuredClone, TextEncoder, Uint8Array, crypto: nodeCrypto.webcrypto,
    ...globals, require(name) { if (!(name in imports)) throw Error('Unmocked import blocked: ' + name); return imports[name]; },
  }, { filename: path });
  return fixture.exports;
}
const input = load('src/lib/order-input.ts', { zod: { z } });
const allocation = load('src/lib/customer-allocation.ts', { zod: { z }, './order-input': input });
const checkout = load('src/lib/checkout.ts', { './order-input': input });
const reference = load('src/lib/order-reference.ts', { './order-input': input });
const key = '11111111-1111-4111-8111-111111111111';
const order = { productId: 'p', customerName: 'Synthetic Name', customerPhone: '0612345678', address: 'Synthetic address', city: 'Agadir', quantity: 1, codAmount: 123.45 };

function submissionFixture() {
  let state = { logs: new Map(), orders: [], history: [] };
  let queue = Promise.resolve();
  const config = { stock: 10, failHistory: false, loseResponse: false };
  const stats = { productReads: 0, transactions: 0 };
  const db = {
    log: { findUnique: async ({ where }) => structuredClone(state.logs.get(where.id) ?? null) },
    $transaction(operation) {
      stats.transactions++;
      const pending = queue.then(async () => {
        const working = structuredClone(state);
        const tx = {
          log: {
            async create({ data }) { if (working.logs.has(data.id)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); working.logs.set(data.id, { ...data, details: null }); },
            async update({ where, data }) { Object.assign(working.logs.get(where.id), data); },
          },
          product: { async findMany({ where }) { stats.productReads++; assert.deepEqual(Array.from(where.id.in), ['p']); return [{ id: 'p', name: 'Server product', stock: config.stock, marketPrice: 150 }]; } },
          order: { async create({ data }) { const id = 'order-' + (working.orders.length + 1); working.orders.push({ ...data, id }); return { id }; } },
          orderStatusHistory: { async createMany({ data }) { if (config.failHistory) throw Error('history unavailable'); working.history.push(...data); } },
        };
        const result = await operation(tx);
        state = working;
        if (config.loseResponse) { config.loseResponse = false; throw Error('commit response lost'); }
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
  const service = load('src/services/orderSubmissionService.ts', { '@/lib/prisma': db, 'node:crypto': nodeCrypto });
  return { service, db, config, stats, state: () => state };
}

test('same submission key replays the same seller draft IDs without new writes', async () => {
  const f = submissionFixture();
  const first = await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  f.config.stock = 0;
  const replay = await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  assert.equal(first.orderIds[0], replay.orderIds[0]); assert.equal(replay.replayed, true);
  assert.equal(f.state().orders.length, 1); assert.equal(f.stats.productReads, 1);
});
test('simulated concurrent identical requests share one unique claim and one draft', async () => {
  const f = submissionFixture();
  const results = await Promise.all([1, 2].map(() => f.service.createDraftSubmission('seller-a', key, 'bulk', [order])));
  assert.equal(results[0].orderIds[0], results[1].orderIds[0]); assert.equal(f.state().orders.length, 1); assert.equal(f.state().history.length, 1);
});
test('a lost commit response is recovered from the durable audit receipt', async () => {
  const f = submissionFixture(); f.config.loseResponse = true;
  const result = await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  assert.equal(result.replayed, true); assert.equal(f.state().orders.length, 1);
});
test('same key with changed customer, amount or endpoint is rejected', async () => {
  const f = submissionFixture(); await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  for (const patch of [{ codAmount: 0 }, { customerPhone: '0712345678' }]) {
    await assert.rejects(f.service.createDraftSubmission('seller-a', key, 'bulk', [{ ...order, ...patch }]), error => error.status === 409);
  }
  await assert.rejects(f.service.createDraftSubmission('seller-a', key, 'single', [order]), error => error.status === 409);
  assert.equal(f.state().orders.length, 1);
});
test('submission claims and results are isolated across sellers', async () => {
  const f = submissionFixture();
  const a = await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  const b = await f.service.createDraftSubmission('seller-b', key, 'bulk', [order]);
  assert.notEqual(a.orderIds[0], b.orderIds[0]); assert.equal(f.state().logs.size, 2);
  assert.equal(f.state().orders[0].sellerId, 'seller-a'); assert.equal(f.state().orders[1].sellerId, 'seller-b');
});
test('missing and malformed keys fail before any database access', async () => {
  const service = load('src/services/orderSubmissionService.ts', { '@/lib/prisma': {}, 'node:crypto': nodeCrypto });
  for (const bad of [null, '', 'postgres', 'not-a-uuid']) await assert.rejects(service.createDraftSubmission('seller-a', bad, 'bulk', [order]), error => error.status === 400);
});
test('stock shortage creates neither drafts, history nor a committed receipt', async () => {
  const f = submissionFixture(); f.config.stock = 1;
  await assert.rejects(f.service.createDraftSubmission('seller-a', key, 'bulk', [order, order]), error => error.status === 409);
  assert.equal(f.state().logs.size, 0); assert.equal(f.state().orders.length, 0); assert.equal(f.state().history.length, 0);
});
test('failed history rolls back the submission claim; explicit retry is safe', async () => {
  const f = submissionFixture(); f.config.failHistory = true;
  await assert.rejects(f.service.createDraftSubmission('seller-a', key, 'bulk', [order]), error => error.status === 503);
  assert.equal(f.state().logs.size, 0); assert.equal(f.state().orders.length, 0);
  f.config.failHistory = false;
  await f.service.createDraftSubmission('seller-a', key, 'bulk', [order]);
  assert.equal(f.state().orders.length, 1); assert.equal(f.state().history.length, 1);
});
test('saved drafts have server names, DRAFT history, unchanged 20 MAD fee and no wallet writes', async () => {
  const f = submissionFixture(); await f.service.createDraftSubmission('seller-a', key, 'bulk', [{ ...order, productName: 'Spoofed' }]);
  const saved = f.state().orders[0]; assert.equal(saved.productName, 'Server product'); assert.equal(saved.shippingFee, 20); assert.equal(saved.status, 'DRAFT');
  assert.equal(f.state().history[0].status, 'DRAFT'); assert.equal(f.state().history[0].userId, 'seller-a');
  const receipt = [...f.state().logs.values()][0].details;
  assert.ok(!receipt.includes(order.customerName)); assert.ok(!receipt.includes(order.customerPhone)); assert.ok(!receipt.includes(order.address));
});
test('import defaults only omitted COD and preserves explicit zero', async () => {
  const f = submissionFixture(); await f.service.createDraftSubmission('seller-a', key, 'import', [{ ...order, codAmount: 0 }, { ...order, codAmount: undefined }]);
  assert.equal(f.state().orders[0].codAmount, 0); assert.equal(f.state().orders[1].codAmount, 150);
});
test('formatted Moroccan phone forms normalize to the same valid local number', () => {
  for (const phone of ['06 12 34 56 78', '+212 (6) 12-34-56-78', '00212612345678']) {
    const parsed = input.draftOrderInput.parse({ ...order, customerPhone: phone }); assert.equal(parsed.customerPhone, '0612345678');
  }
  for (const phone of ['+33612345678', '0612345', '0812345678', '061234567890']) assert.equal(input.draftOrderInput.safeParse({ ...order, customerPhone: phone }).success, false);
});
test('blank, boolean, null and nonfinite COD cannot silently become zero', () => {
  for (const value of ['', ' ', null, true, false, Infinity, NaN, -1]) assert.equal(input.codInput.safeParse(value).success, false);
  assert.equal(input.codInput.parse('0'), 0); assert.equal(input.codInput.parse('123.45'), 123.45);
});
test('quantity remains a strictly positive integer for every creation path', () => {
  for (const value of [null, true, '', 0, -1, 1.5, Infinity]) assert.equal(input.quantityInput.safeParse(value).success, false);
});
test('row-level validation identifies the actual invalid import field', () => {
  const result = input.importOrdersInput.safeParse({ productId: 'p', orders: [{ name: 'Name', phone: 'bad', address: 'Address', city: 'Agadir', quantity: 1, price: 0 }] });
  assert.equal(result.success, false); const message = input.orderInputError(result.error); assert.ok(message.includes('1')); assert.ok(message.includes('الهاتف'));
});
test('checkout defaults total COD for quantity and preserves exact editable zero', () => {
  assert.equal(checkout.initialCheckoutForm(123.45, 3).codAmount, String(123.45 * 3));
  assert.equal(checkout.checkoutAmounts('0', 50, 2).cod, 0); assert.equal(checkout.checkoutAmounts('0', 50, 2).margin, -100);
  assert.equal(checkout.checkoutAmounts('', 50, 2).cod, null);
});
function memoryStorage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
test('browser retry metadata persists only digest/key and is seller-scoped', async () => {
  const storage = memoryStorage(); const client = load('src/lib/order-submission-client.ts');
  const first = await client.submissionKey('seller-a', 'checkout', order, storage);
  assert.equal(await client.submissionKey('seller-a', 'checkout', order, storage), first);
  assert.notEqual(await client.submissionKey('seller-b', 'checkout', order, storage), first);
  const saved = [...storage.values.values()].join(''); assert.ok(!saved.includes(order.customerName)); assert.ok(!saved.includes(order.customerPhone));
  client.clearSubmissionKey('seller-a', 'checkout', storage); assert.equal(storage.values.size, 1);
});
test('cart cannot expose another seller or legacy unscoped cart', () => {
  const storage = memoryStorage();
  const cart = load('src/lib/cart.ts', {}, { window: {}, localStorage: storage });
  const item = { cartId: 'one', productId: 'p', productName: 'Product', productImage: '', sellerPrice: 50, marketPrice: 100, quantity: 1, stock: 2 };
  storage.setItem('winwin_cart_v3', JSON.stringify([item]));
  assert.equal(cart.getCart('seller-b').length, 0);
  cart.saveCart('seller-a', [item]); assert.equal(cart.getCart('seller-a').length, 1); assert.equal(cart.getCart('seller-b').length, 0);
  cart.clearCart('seller-b'); assert.equal(cart.getCart('seller-a').length, 1);
});
test('cart aggregate demand cannot exceed stock across repeated product rows', () => {
  const cart = load('src/lib/cart.ts');
  const items = [{ cartId: 'a', productId: 'p', quantity: 1, stock: 2 }, { cartId: 'b', productId: 'p', quantity: 1, stock: 2 }];
  assert.equal(cart.canAddToCart(items, 'p', 1, 2), false); assert.equal(cart.canAddToCart([], 'p', 1, 0), false);
  assert.equal(cart.changeCartQuantity(items, 'a', 1), items); assert.equal(cart.canAddToCart([], 'p', 1.5, 5), false);
});
test('full fallback reference and sequence references round-trip to exact local lookup', () => {
  const id = 'a1234567-abcd-4abc-8abc-123456789abc';
  assert.equal(reference.localOrderLookup(reference.orderReference(id, null)).id, id);
  assert.equal(reference.localOrderLookup(reference.orderReference(id, 12)).seqId, 12);
  assert.equal(reference.localOrderLookup('ORD-A123'), null);
  const phone = reference.localOrderLookup('+212 612-345-678'); assert.equal(phone.customerPhone.in.length, 3);
});
test('tracking handler scopes exact lookup to authenticated seller', async () => {
  let queried = false;
  const route = load('src/app/api/seller/tracking/route.ts', {
    '@/lib/order-reference': reference,
    '@/lib/api-utils': { getSessionUser: async () => ({ id: 'seller-a', role: 'SELLER' }), errorResponse: (error, status) => ({ error, status }) },
    '@/lib/prisma': { order: { findFirst: async ({ where }) => { queried = true; assert.equal(where.sellerId, 'seller-a'); assert.equal(where.id, 'a1234567-abcd-4abc-8abc-123456789abc'); return null; } } },
    'next/server': { NextResponse: { json: data => data } },
  });
  await route.GET({ nextUrl: { searchParams: new URLSearchParams({ q: 'ORD-A1234567-ABCD-4ABC-8ABC-123456789ABC' }) } }); assert.equal(queried, true);
});
test('native city selector renders an associated accessible required control', () => {
  const City = load('src/components/ui/CitySelect.tsx', { react: React, 'react/jsx-runtime': jsxRuntime }).default;
  const markup = renderToStaticMarkup(React.createElement(City, { id: 'customer-city', value: '', onChange: () => {}, cities: ['Agadir'], error: 'اختر المدينة' }));
  assert.ok(markup.includes('for="customer-city"')); assert.ok(markup.includes('aria-invalid="true"')); assert.ok(markup.includes('aria-describedby="customer-city-error"')); assert.ok(markup.includes('<select')); assert.ok(markup.includes('required=""'));
});
test('rapid checkout submit events send only one request before React rerenders', async () => {
  let calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const item = { cartId: 'cart', productId: 'p', productName: 'Product', productImage: '', quantity: 1, sellerPrice: 50, marketPrice: 100, stock: 5 };
  let stateIndex = 0;
  const Checkout = load('src/app/(dashboard)/seller/orders/checkout/page.tsx', {
    react: { useState: initial => [stateIndex++ === 0 ? [{ id: 'client', customerName: order.customerName, customerPhone: order.customerPhone, address: order.address, city: order.city, codAmount: '100', allocations: [{ productId: 'p', quantity: '1' }] }] : initial, () => {}], useRef: value => ({ current: value }) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', axios: { post: async () => { calls++; await held; return { data: { orderIds: ['o'] } }; }, isAxiosError: () => false },
    'react-hot-toast': { success: () => {}, error: () => {} },
    '@/context/CartContext': { useCart: () => ({ items: [item], ready: true, sellerId: 'seller-a', removeItem: () => {} }) },
    '@/lib/moroccan-cities': { MOROCCAN_CITIES: ['Agadir'] }, '@/lib/customer-allocation': allocation, '@/lib/order-input': input, '@/lib/checkout': checkout,
    '@/lib/order-submission-client': { submissionKey: async () => key, clearSubmissionKey: () => {} }, '@/components/ui/CitySelect': 'select',
  }).default;
  const form = Checkout(); const event = { preventDefault() {} };
  const first = form.props.onSubmit(event); const second = form.props.onSubmit(event);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); release(); await Promise.all([first, second]);
});

test('uncertain checkout retries its original snapshot even if the external cart changes', async () => {
  const items = [{ cartId: 'cart', productId: 'p', productName: 'Product', productImage: '', quantity: 1, sellerPrice: 50, marketPrice: 100, stock: 5 }];
  let stateIndex = 0, calls = 0; const bodies = [], removed = [];
  const Checkout = load('src/app/(dashboard)/seller/orders/checkout/page.tsx', {
    react: { useState: initial => [stateIndex++ === 0 ? [{ id: 'client', customerName: order.customerName, customerPhone: order.customerPhone, address: order.address, city: order.city, codAmount: '100', allocations: [{ productId: 'p', quantity: '1' }] }] : initial, () => {}], useRef: value => ({ current: value }) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', axios: { post: async (url, payload) => { bodies.push(structuredClone(payload)); if (++calls === 1) throw Error('response lost'); return { data: { orderIds: ['o'] } }; }, isAxiosError: () => false },
    'react-hot-toast': { success: () => {}, error: () => {} },
    '@/context/CartContext': { useCart: () => ({ items, ready: true, sellerId: 'seller-a', removeItem: id => removed.push(id) }) },
    '@/lib/moroccan-cities': { MOROCCAN_CITIES: ['Agadir'] }, '@/lib/customer-allocation': allocation, '@/lib/order-input': input, '@/lib/checkout': checkout,
    '@/lib/order-submission-client': { submissionKey: async () => key, clearSubmissionKey: () => {} }, '@/components/ui/CitySelect': 'select',
  }).default;
  const form = Checkout(); const event = { preventDefault() {} };
  await form.props.onSubmit(event); assert.equal(calls, 1);
  items[0].quantity = 3; items.push({ ...items[0], cartId: 'new-cart' });
  await form.props.onSubmit(event);
  assert.equal(calls, 2); assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(removed, ['cart']);
});
test('rapid import submit events cannot enqueue duplicate imports', async () => {
  const rows = [{ name: order.customerName, phone: order.customerPhone, address: order.address, city: order.city, quantity: 1, price: 100 }];
  let stateIndex = 0, calls = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const Import = load('src/app/(dashboard)/seller/orders/import/page.tsx', {
    react: { useState: initial => { const index = stateIndex++; return [index === 0 ? [{ id: 'p', name: 'Product', stock: 5 }] : index === 2 ? false : index === 4 ? 'p' : index === 5 ? rows : initial, () => {}]; }, useRef: value => ({ current: value }), useEffect: () => {} },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', 'next-auth/react': { useSession: () => ({ data: { user: { id: 'seller-a', role: 'SELLER' } } }) }, xlsx: {},
    axios: { post: async () => { calls++; await held; return { data: { count: 1 } }; }, isAxiosError: () => false },
    '@/lib/order-input': input, '@/lib/order-submission-client': { submissionKey: async () => key, clearSubmissionKey: () => {} },
  }).default;
  const view = Import(); const button = view.props.children.at(-1);
  const first = button.props.onClick(); const second = button.props.onClick();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); release(); await Promise.all([first, second]);
});

test('wallet history returns its page and rejects invalid pagination before querying', async () => {
  let calls = 0;
  const route = load('src/app/api/seller/wallet/history/route.ts', {
    '@/lib/api-utils': { getSessionUser: async () => ({ id: 'seller-a', role: 'SELLER' }), errorResponse: (error, status) => ({ error, status }) },
    '@/services/walletService': { getWalletHistory: async (id, page, limit) => { calls++; assert.equal(id, 'seller-a'); assert.equal(page, 2); assert.equal(limit, 20); return { items: [], total: 50, totalPages: 3 }; }, getWalletStats: async () => ({ totalDeposits: 0, totalDeductions: 0, totalProfits: 0 }) },
    'next/server': { NextResponse: { json: data => data } },
  }, { URL });
  const result = await route.GET({ url: 'https://offline.invalid/api/seller/wallet/history?page=2&limit=20' }); assert.equal(result.page, 2); assert.equal(calls, 1);
  for (const query of ['page=NaN', 'page=0', 'page=1.5', 'limit=0', 'limit=51', 'limit=NaN']) {
    assert.equal((await route.GET({ url: 'https://offline.invalid/api/seller/wallet/history?' + query })).status, 400);
  }
  assert.equal(calls, 1);
});
test('failed wallet reads render unavailable/retry, never a fabricated zero balance or empty history', () => {
  let index = 0;
  const Wallet = load('src/app/(dashboard)/seller/wallet/page.tsx', {
    react: { useState: initial => { const i = index++; return [[7, 9].includes(i) ? true : [6, 8].includes(i) ? false : initial, () => {}]; }, useCallback: fn => fn, useEffect: () => {} },
    'react/jsx-runtime': jsxRuntime, axios: {}, 'react-hot-toast': {},
    'lucide-react': Object.fromEntries(['CreditCard', 'Package', 'DollarSign', 'RotateCcw', 'Banknote', 'Paperclip', 'CheckCircle'].map(name => [name, 'i'])),
    '@/context/LanguageContext': { useLanguage: () => ({ lang: 'fr', t: key => key }) },
  }).default;
  const markup = renderToStaticMarkup(Wallet());
  assert.ok(markup.includes('Solde indisponible')); assert.ok(markup.includes('Historique indisponible')); assert.ok(markup.includes('Réessayer'));
  assert.ok(!markup.includes('0.00')); assert.ok(!markup.includes('wallet.noHistory')); assert.ok(!markup.includes('wallet.totalProfits'));
});


test('multi-customer checkout endpoint persists two independent draft orders and replays the seller receipt', async () => {
  const f = submissionFixture();
  const route = load('src/app/api/seller/orders/create-bulk/route.ts', {
    zod: { z }, '@/lib/order-input': input, '@/lib/customer-allocation': allocation,
    '@/lib/api-utils': { getSessionUser: async () => ({ id: 'seller-a', role: 'SELLER' }), errorResponse: (error, status) => ({ error, status }) },
    '@/services/orderSubmissionService': f.service, 'next/server': { NextResponse: { json: data => data } },
  });
  const checkout = { cart: [{ productId: 'p', quantity: 5 }], customers: [2, 3].map((quantity, index) => ({ ...order, codAmount: index === 0 ? 0 : 250, allocations: [{ productId: 'p', quantity }] })) };
  const request = { json: async () => ({ checkout }), headers: { get: () => key } };
  const first = await route.POST(request); const retry = await route.POST(request);
  assert.equal(first.orderIds.length, 2); assert.equal(retry.replayed, true);
  assert.equal(first.orderIds[0], retry.orderIds[0]); assert.equal(f.state().orders.length, 2);
  assert.equal(f.state().orders[0].quantity, 2); assert.equal(f.state().orders[1].quantity, 3);
  assert.equal(f.state().orders[0].codAmount, 0); assert.equal(f.state().orders[1].codAmount, 250);
  assert.equal(f.state().orders[0].status, 'DRAFT'); assert.equal(f.state().orders[1].sellerId, 'seller-a');
  const invalid = { ...checkout, customers: checkout.customers.map(row => ({ ...row, allocations: [{ productId: 'p', quantity: 2 }] })) };
  const result = await route.POST({ ...request, json: async () => ({ checkout: invalid }) });
  assert.equal(result.status, 400); assert.equal(f.state().orders.length, 2);
});

test('checkout UI adds remaining units, rejects over-allocation and preserves other clients when removing one', () => {
  const states = [], refs = []; let stateIndex = 0, refIndex = 0;
  const Checkout = load('src/app/(dashboard)/seller/orders/checkout/page.tsx', {
    react: { useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; }, useRef: initial => { const index = refIndex++; return refs[index] ??= { current: initial }; } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', axios: {},
    '@/context/CartContext': { useCart: () => ({ items: [{ cartId: 'cart', productId: 'p', productName: 'Product', quantity: 5, sellerPrice: 50 }], ready: true, sellerId: 'seller-a', removeItem: () => {} }) },
    '@/lib/moroccan-cities': { MOROCCAN_CITIES: ['Agadir'] }, '@/lib/customer-allocation': allocation,
    '@/lib/order-submission-client': {}, '@/components/ui/CitySelect': 'select',
  }).default;
  const render = () => { stateIndex = 0; refIndex = 0; return Checkout(); };
  function all(node, predicate) {
    if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
  }
  const inputFor = (section, label) => all(section, node => node.type === 'label' && node.props.children[0] === label)[0].props.children[1];
  const sections = view => all(view, node => node.type === 'section');
  let view = render();
  inputFor(sections(view)[0], 'Quantité pour ce client').props.onChange({ target: { value: '2' } });
  view = render(); all(view, node => node.type === 'button' && node.props.children === '+ Ajouter un client')[0].props.onClick();
  view = render(); assert.equal(sections(view).length, 2);
  assert.equal(inputFor(sections(view)[1], 'Quantité pour ce client').props.value, '3');
  inputFor(sections(view)[1], 'Nom complet').props.onChange({ target: { value: 'Client conservé' } });
  view = render(); inputFor(sections(view)[0], 'Quantité pour ce client').props.onChange({ target: { value: '4' } });
  view = render(); assert.equal(inputFor(sections(view)[0], 'Quantité pour ce client').props.value, '2');
  all(sections(view)[0], node => node.type === 'button' && node.props.children === 'Retirer ce client')[0].props.onClick();
  view = render(); assert.equal(sections(view).length, 1);
  assert.equal(inputFor(sections(view)[0], 'Nom complet').props.value, 'Client conservé');
  assert.equal(inputFor(sections(view)[0], 'Quantité pour ce client').props.value, '3');
});
