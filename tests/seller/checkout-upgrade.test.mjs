import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

function load(path, imports = {}, globals = {}) {
  const fixture = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: fixture, exports: fixture.exports, console, structuredClone, crypto: crypto.webcrypto,
    ...globals, require(name) { if (!(name in imports)) throw Error('Blocked import ' + name); return imports[name]; } });
  return fixture.exports;
}
const selection = load('src/lib/draft-selection.ts');
const policy = load('src/lib/order-policy.ts');
const valid = (id, quantity) => ({ id, quantity, sellerId: 'seller', status: 'DRAFT', batchId: null, customerName: 'Client ' + id, productName: 'Product', city: 'Agadir' });
const key = '11111111-1111-4111-8111-111111111111';
const fr = JSON.parse(fs.readFileSync('src/messages/fr.json', 'utf8'));
const language = { useLanguage: () => ({ lang: 'fr', t: key => key.split('.').reduce((value, part) => value?.[part], fr) ?? key }) };

test('visible eligible selection counts PCS, excludes hidden/duplicate/ineligible IDs', () => {
  const rows = [valid('a', 2), valid('b', 3), { ...valid('paid', 5), status: 'PROCESSING' }, { ...valid('batch', 1), batchId: 'batch' }, valid('bad', 0)];
  const result = selection.selectedDrafts(rows, ['a', 'a', 'b', 'paid', 'batch', 'bad', 'hidden']);
  assert.equal(result.count, 2); assert.equal(result.units, 5);
  assert.equal(selection.selectedDrafts([valid('one', 5)], ['one']).units, 5);
});

function serviceFixture() {
  let state = { orders: [valid('a', 2), valid('b', 3)], logs: {}, history: [] }, queue = Promise.resolve();
  const config = { failHistory: false, loseResponse: false, loseClaim: false };
  const db = { log: { findUnique: async ({ where }) => state.logs[where.id] ?? null }, $transaction(work, options) {
    assert.equal(options.isolationLevel, 'Serializable');
    const result = queue.then(async () => {
      const next = structuredClone(state);
      const match = where => next.orders.filter(order => where.id.in.includes(order.id) && order.sellerId === where.sellerId && order.status === where.status && order.batchId === where.batchId);
      const response = await work({
        log: { create: async ({ data }) => { if (next.logs[data.id]) throw Error('Unique receipt'); next.logs[data.id] = data; } },
        order: {
          findMany: async ({ where }) => match(where),
          updateMany: async ({ where, data }) => { if (config.loseClaim) return { count: 0 }; const rows = match(where); rows.forEach(order => { order.status = data.status; }); return { count: rows.length }; },
        },
        orderStatusHistory: { createMany: async ({ data }) => { if (config.failHistory) throw Error('History unavailable'); next.history.push(...data); } },
      });
      state = next;
      if (config.loseResponse) { config.loseResponse = false; throw Error('Response lost after commit'); }
      return response;
    });
    queue = result.catch(() => {}); return result;
  } };
  const service = load('src/services/draftConfirmationService.ts', { 'node:crypto': crypto, '@/lib/prisma': db, '@/lib/order-policy': policy, '@/lib/draft-selection': selection, '@/lib/checkout-release': { BULK_DRAFT_CONFIRMATION_ENABLED: true } });
  return { state: () => state, config, service, call: (ids = ['a', 'b'], seller = 'seller', retryKey = key) => service.submitDraftsForConfirmation(seller, retryKey, ids) };
}
test('bulk confirmation claims whole selection once under modeled concurrent retries', async () => {
  const f = serviceFixture(); await Promise.all([f.call(), f.call()]); await f.call(['b', 'a']);
  assert.equal(f.state().history.length, 2); assert.equal(Object.keys(f.state().logs).length, 1);
  assert.ok(f.state().orders.every(order => order.status === 'PENDING_CONFIRMATION'));
});
test('confirmation allows one PCS; five confirmed PCS remain required only at batch review', async () => {
  const f = serviceFixture(); f.state().orders = [valid('one', 1)]; await f.call(['one']);
  assert.equal(f.state().orders[0].status, 'PENDING_CONFIRMATION');
  assert.throws(() => policy.assertBatchUnits([{ quantity: 1 }]));
});
test('foreign, batched, invalid quantity and changed drafts reject whole selection', async () => {
  for (const patch of [{ sellerId: 'other' }, { batchId: 'batch' }, { status: 'CONFIRMED' }, { quantity: 0 }]) {
    const f = serviceFixture(); Object.assign(f.state().orders[1], patch);
    await assert.rejects(f.call(), /ineligible/);
    assert.equal(f.state().orders[0].status, 'DRAFT'); assert.equal(f.state().history.length, 0); assert.equal(Object.keys(f.state().logs).length, 0);
  }
});
test('history failure or lost conditional claim rolls back all state and receipt', async () => {
  for (const flag of ['failHistory', 'loseClaim']) {
    const f = serviceFixture(); f.config[flag] = true; await assert.rejects(f.call());
    assert.ok(f.state().orders.every(order => order.status === 'DRAFT')); assert.equal(Object.keys(f.state().logs).length, 0);
  }
});
test('lost commit response recovers saved receipt; changed selection/key reuse rejected', async () => {
  const f = serviceFixture(); f.config.loseResponse = true;
  assert.equal((await f.call()).replayed, true); assert.equal(f.state().history.length, 2);
  await assert.rejects(f.call(['a']), /another selection/);
  await assert.rejects(f.call(['a', 'a'])); await assert.rejects(f.call(['a'], 'seller', null));
});
test('submission receipt is scoped to seller and corrupted receipts fail closed', async () => {
  const f = serviceFixture(); await f.call(); await assert.rejects(f.call(['a', 'b'], 'other'));
  const receipt = Object.values(f.state().logs)[0]; receipt.userId = 'other'; await assert.rejects(f.call(), /Invalid submission receipt/);
});
test('bulk endpoint rejects anonymous/wrong role and duplicate IDs before service', async () => {
  for (const actor of [null, { role: 'ADMIN', id: 'admin' }, { role: 'SELLER', id: 'seller' }]) {
    const route = load('src/app/api/seller/orders/drafts/submit/route.ts', {
      'next/server': { NextResponse: { json: body => body } }, zod: { z },
      '@/lib/api-utils': { getSessionUser: async () => actor, errorResponse: (message, status) => ({ message, status }) },
      '@/services/draftConfirmationService': { DraftConfirmationError: class extends Error {}, submitDraftsForConfirmation: () => assert.fail('Unexpected write') },
      '@/lib/checkout-release': { BULK_DRAFT_CONFIRMATION_ENABLED: true },
    });
    const result = await route.POST({ json: async () => ({ orderIds: ['a', 'a'] }) });
    assert.equal(result.status, actor?.role === 'SELLER' ? 400 : 401);
  }
});

function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function draftsUI(post, confirmed = true, bulk = true, get = async () => ({ data: { drafts: [] } })) {
  const states = [[valid('a', 2), valid('b', 3), { ...valid('blocked', 9), batchId: 'batch' }], [], false];
  const refs = []; let stateIndex = 0, refIndex = 0, confirms = 0;
  const Page = load('src/app/(dashboard)/seller/orders/drafts/page.tsx', {
    react: { useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
      useRef: initial => { const index = refIndex++; return refs[index] ??= { current: initial }; }, useEffect: () => {} },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', axios: { post, patch: post, get, isAxiosError: error => !!error.response }, '@/context/LanguageContext': language,
    '@/lib/checkout-release': { BULK_DRAFT_CONFIRMATION_ENABLED: bulk },
    '@/context/CartContext': { useCart: () => ({ sellerId: 'seller', ready: true }) },
    '@/lib/draft-selection': selection, '@/lib/product-images': { productImages: () => [] }, '@/components/seller/ProductThumbnail': 'thumbnail',
    '@/lib/order-submission-client': { submissionKey: async () => key, clearSubmissionKey: () => {} },
  }, { window: { confirm: () => { confirms++; return confirmed; } } }).default;
  const render = () => { stateIndex = 0; refIndex = 0; const root = Page(); return root.type(root.props); };
  const button = (view, label) => nodes(view, node => node.type === 'button' && node.props.children === label)[0];
  return { render, button, states, confirms: () => confirms };
}
test('draft UI selects/deselects visible eligible rows and displays exact 2+3 PCS', () => {
  const f = draftsUI(() => assert.fail('No submission')); let view = f.render();
  f.button(view, fr.sellerDrafts.selectAll).props.onClick(); view = f.render();
  assert.equal(f.states[1].length, 2);
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'checkbox' && node.props.disabled).length, 1);
  const status = nodes(view, node => node.type === 'p' && node.props.role === 'status')[0];
  assert.equal(nodes(status, node => node.type === 'strong')[1].props.children, 5);
  f.button(view, fr.sellerDrafts.deselectAll).props.onClick(); assert.equal(f.states[1].length, 0);
});
test('draft UI double click sends once, confirms once and reports success per order', async () => {
  let calls = 0, release; const wait = new Promise(resolve => { release = resolve; });
  const f = draftsUI(async (url, payload) => { calls++; await wait; return { data: { orderIds: payload.orderIds } }; });
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick();
  const button = f.button(f.render(), fr.sellerDrafts.send);
  const first = button.props.onClick(); const second = button.props.onClick();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); assert.equal(f.confirms(), 1);
  release(); await Promise.all([first, second]);
  assert.equal(f.states[6].length, 2); assert.ok(f.states[6].every(row => row.status === 'success'));
  assert.equal(f.states[0].length, 1);
});
test('draft UI uncertain result freezes selection and retries exact payload with same key', async () => {
  let calls = 0; const sent = [];
  const f = draftsUI(async (url, payload, options) => { sent.push({ payload, key: options.headers['Idempotency-Key'] }); if (++calls === 1) throw Error('Uncertain response'); return { data: { orderIds: payload.orderIds } }; });
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick(); await f.button(f.render(), fr.sellerDrafts.send).props.onClick();
  assert.ok(f.states[6].every(row => row.status === 'unknown'));
  assert.ok(nodes(f.render(), node => node.type === 'input' && node.props.type === 'checkbox').every(node => node.props.disabled));
  f.states[0] = [valid('new', 99)]; await f.button(f.render(), fr.sellerDrafts.retrySame).props.onClick();
  assert.deepEqual(sent[0], sent[1]); assert.equal(f.confirms(), 1);
});

test('draft UI Select All applies only to visible page and changing page clears selection', () => {
  const f = draftsUI(() => assert.fail('No submission'));
  f.states[0] = Array.from({ length: 51 }, (_, index) => valid(String(index), 1));
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick(); assert.equal(f.states[1].length, 50);
  f.button(f.render(), fr.sellerDrafts.nextPage).props.onClick(); assert.equal(f.states[1].length, 0);
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick(); assert.deepEqual(f.states[1], ['50']);
});
test('draft UI rejected selection reports each failure with no false successes', async () => {
  const f = draftsUI(async () => { throw { response: { status: 409 } }; });
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick(); await f.button(f.render(), fr.sellerDrafts.send).props.onClick();
  assert.equal(f.states[6].length, 2); assert.ok(f.states[6].every(row => row.status === 'failed'));
  assert.equal(f.states[0].length, 3); assert.equal(f.states[5], false);
});
test('draft UI cancelled confirmation performs no request', async () => {
  const f = draftsUI(() => assert.fail('Cancelled selection must not send'), false);
  f.button(f.render(), fr.sellerDrafts.selectAll).props.onClick(); await f.button(f.render(), fr.sellerDrafts.send).props.onClick();
  assert.equal(f.states[0].length, 3); assert.equal(f.confirms(), 1);
});

test('product picker renders thumbnail choices and selected state with native accessible radios', () => {
  const Thumbnail = load('src/components/seller/ProductThumbnail.tsx', { 'react/jsx-runtime': jsxRuntime }).default;
  const Picker = load('src/components/seller/ProductPicker.tsx', { 'react/jsx-runtime': jsxRuntime, './ProductThumbnail': Thumbnail }).default;
  const markup = renderToStaticMarkup(React.createElement(Picker, { products: [{ productId: 'p', productName: 'Product', productImage: '/existing.png', sku: 'SKU-1' }], value: 'p', onChange: () => {}, name: 'customer-product', label: 'Produit', placeholder: 'Choisir' }));
  assert.equal((markup.match(/src="\/existing.png"/g) ?? []).length, 2);
  assert.ok(markup.includes('type="radio"')); assert.ok(markup.includes('checked=""')); assert.ok(markup.includes('<summary')); assert.ok(markup.includes('customer-product-selected')); assert.ok(markup.includes('SKU-1'));
  const fallback = renderToStaticMarkup(React.createElement(Thumbnail, { name: 'Missing' })); assert.ok(fallback.includes('<svg')); assert.equal(fallback.includes('<img'), false);
});
test('checkout/draft translation keys match in Arabic and French', () => {
  const ar = JSON.parse(fs.readFileSync('src/messages/ar.json', 'utf8'));
  for (const group of ['sellerCheckout', 'sellerDrafts']) assert.deepEqual(Object.keys(ar[group]).sort(), Object.keys(fr[group]).sort());
});

function checkoutUI(post, lang = 'fr') {
  const states = [], refs = []; let stateIndex = 0, refIndex = 0;
  const messages = JSON.parse(fs.readFileSync('src/messages/' + lang + '.json', 'utf8'));
  const input = load('src/lib/order-input.ts', { zod: { z } });
  const allocation = load('src/lib/customer-allocation.ts', { zod: { z }, './order-input': input });
  const items = [{ cartId: 'cart', productId: 'p', productName: 'Visible product', sku: 'SKU-VISIBLE', productImage: '/existing.png', sellerPrice: 10, marketPrice: 40, stock: 5, quantity: 5 }];
  const removed = [];
  const Page = load('src/app/(dashboard)/seller/orders/checkout/page.tsx', {
    react: { useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
      useRef: initial => { const index = refIndex++; return refs[index] ??= { current: initial }; } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/link': 'a', axios: { post, isAxiosError: () => false },
    '@/context/LanguageContext': { useLanguage: () => ({ lang, t: key => key.split('.').reduce((value, part) => value?.[part], messages) ?? key }) },
    '@/context/CartContext': { useCart: () => ({ items, ready: true, sellerId: 'seller', removeItem: id => removed.push(id) }) },
    '@/lib/customer-allocation': allocation, '@/lib/moroccan-cities': { MOROCCAN_CITIES: ['Agadir'] },
    '@/lib/order-submission-client': { submissionKey: async () => key, clearSubmissionKey: () => {} },
    '@/components/ui/CitySelect': 'city-select', '@/components/seller/ProductPicker': 'picker', '@/components/seller/ProductThumbnail': 'thumbnail',
  }).default;
  return { states, items, removed, render: () => { stateIndex = 0; refIndex = 0; return Page(); },
    fill: () => { states[0] = [{ id: 'client', customerName: 'Client visible', customerPhone: '0612345678', city: 'Agadir', address: 'Adresse complète', codAmount: '200', allocations: [{ productId: 'p', quantity: '5' }] }]; } };
}
test('checkout success shows customer/product/SKU/quantity, hides UUID text and preserves original receipt summary', async () => {
  const rawId = '11111111-2222-4333-8444-555555555555';
  const f = checkoutUI(async () => ({ data: { orderIds: [rawId] } })); f.render(); f.fill();
  await f.render().props.onSubmit({ preventDefault() {} }); f.items[0].productName = 'Changed cart';
  const result = f.render();
  const text = nodes(result, node => node.props?.children).flatMap(node => Array.isArray(node.props.children) ? node.props.children.filter(value => typeof value === 'string') : [node.props.children]).filter(value => typeof value === 'string').join(' ');
  assert.ok(text.includes('Client visible')); assert.ok(text.includes('Visible product')); assert.ok(text.includes('SKU-VISIBLE')); assert.equal(text.includes(rawId), false);
  assert.ok(nodes(result, node => node.type === 'a' && node.props.href === '/seller/orders/' + rawId).length === 1);
  assert.deepEqual(f.removed, ['cart']);
});
test('checkout Arabic sets RTL; invalid fields mark associated controls without sending', async () => {
  const f = checkoutUI(() => assert.fail('Invalid form must not send'), 'ar'); const first = f.render();
  assert.equal(first.props.dir, 'rtl'); await first.props.onSubmit({ preventDefault() {} });
  const view = f.render(); assert.ok(nodes(view, node => node.type === 'input' && node.props['aria-invalid']).length >= 3);
  assert.ok(nodes(view, node => node.props?.role === 'alert').length > 0);
});
test('checkout malformed save receipt keeps original cart and enters uncertain recovery', async () => {
  const f = checkoutUI(async () => ({ data: { orderIds: [] } })); f.render(); f.fill();
  await f.render().props.onSubmit({ preventDefault() {} });
  assert.equal(f.states[3], true); assert.equal(f.states[4], null); assert.equal(f.removed.length, 0);
});

test('production release policy keeps unverified bulk confirmation disabled', () => {
  const release = load('src/lib/checkout-release.ts');
  assert.equal(release.BULK_DRAFT_CONFIRMATION_ENABLED, false);
});
test('release bulk route denies sellers before body/service access and still denies other roles', async () => {
  for (const actor of [null, { id: 'admin', role: 'ADMIN' }, { id: 'seller', role: 'SELLER' }]) {
    const route = load('src/app/api/seller/orders/drafts/submit/route.ts', {
      'next/server': { NextResponse: { json: body => body } }, zod: { z },
      '@/lib/checkout-release': load('src/lib/checkout-release.ts'),
      '@/lib/api-utils': { getSessionUser: async () => actor, errorResponse: (message, status) => ({ message, status }) },
      '@/services/draftConfirmationService': { DraftConfirmationError: class extends Error {}, submitDraftsForConfirmation: () => assert.fail('No bulk write allowed') },
    });
    const result = await route.POST({ json: async () => assert.fail('Disabled route must not read body') });
    assert.equal(result.status, actor?.role === 'SELLER' ? 503 : 401);
  }
});
test('release bulk service fails closed even if called without the HTTP guard', async () => {
  const service = load('src/services/draftConfirmationService.ts', {
    'node:crypto': crypto, '@/lib/prisma': { __esModule: true, default: new Proxy({}, { get() { assert.fail('Disabled service must not access database'); } }) },
    '@/lib/order-policy': policy, '@/lib/draft-selection': selection, '@/lib/checkout-release': load('src/lib/checkout-release.ts'),
  });
  await assert.rejects(service.submitDraftsForConfirmation('seller', key, ['a']), /not available/);
});
test('release draft UI hides bulk selection and sends one guarded main PATCH despite double click', async () => {
  const requests = []; let release; const wait = new Promise(resolve => { release = resolve; });
  const f = draftsUI(async (url, payload) => { requests.push({ url, payload }); await wait; return { data: { success: true, status: 'PENDING_CONFIRMATION' } }; }, true, false);
  const view = f.render();
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'checkbox').length, 0);
  assert.equal(f.button(view, fr.sellerDrafts.selectAll), undefined);
  const send = f.button(view, fr.sellerDrafts.send);
  const first = send.props.onClick(); const second = send.props.onClick();
  assert.equal(requests.length, 1); assert.equal(f.confirms(), 1);
  assert.equal(requests[0].url, '/api/seller/orders/a/status'); assert.equal(requests[0].payload.status, 'PENDING_CONFIRMATION'); assert.equal(requests[0].payload.orderIds, undefined);
  release(); await Promise.all([first, second]);
  assert.equal(f.states[6].length, 1); assert.equal(f.states[6][0].status, 'success');
});
test('release single confirmation never retries uncertainty until a fresh list is read', async () => {
  let calls = 0;
  const f = draftsUI(async () => { calls++; throw Error('Response lost'); }, true, false,
    async () => ({ data: { drafts: [valid('a', 2)] } }));
  await f.button(f.render(), fr.sellerDrafts.send).props.onClick(); assert.equal(calls, 1);
  let view = f.render(); assert.equal(f.states[5], true);
  assert.ok(nodes(view, node => node.type === 'button' && node.props.children === fr.sellerDrafts.send).every(node => node.props.disabled));
  await f.button(view, fr.sellerDrafts.send).props.onClick(); assert.equal(calls, 1);
  await f.button(view, fr.sellerDrafts.refresh).props.onClick(); assert.equal(f.states[5], false);
  view = f.render(); assert.equal(f.button(view, fr.sellerDrafts.send).props.disabled, false);
});
test('release single confirmation rejects malformed success without removing the order', async () => {
  const f = draftsUI(async () => ({ data: { success: true, status: 'SHIPPED' } }), true, false);
  await f.button(f.render(), fr.sellerDrafts.send).props.onClick();
  assert.equal(f.states[0].length, 3); assert.equal(f.states[6][0].status, 'unknown');
});

test('auth route initialization preserves GET/POST handler without reading or logging database credentials', () => {
  const options = {}; const handler = () => {};
  const route = load('src/app/api/auth/[...nextauth]/route.ts', {
    '@/lib/auth': { authOptions: options }, 'next-auth': actual => { assert.equal(actual, options); return handler; },
  }, { process: new Proxy({}, { get() { assert.fail('Auth route must not inspect environment diagnostics'); } }),
    console: { log: () => assert.fail('Auth route must not log environment diagnostics') } });
  assert.equal(route.GET, handler); assert.equal(route.POST, handler);
});
