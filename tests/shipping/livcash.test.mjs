import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createLivcashClient } from '../../src/lib/shipping/livcash/client.ts';
import { readLivcashConfig } from '../../src/lib/shipping/config.ts';
import { mapApprovedOrder } from '../../src/lib/shipping/order-mapping.ts';
import { validParcel } from '../../src/lib/shipping/livcash/validation.ts';

const config = { token: 'synthetic-test-token', submissionEnabled: true, trackingEnabled: true, timeoutMs: 100 };
const parcel = { ville: 'Agadir', phone: '0620302052', qty: 1, adresse: 'Synthetic address', note: '', price: '120.00100', name: 'Synthetic customer', tracking: 'TEST-STABLE-001' };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
test('exact multipart add fields, no manual content-type, safe success', async () => {
  let calls = 0;
  const client = createLivcashClient(config, async (url, init) => {
    calls++; assert.equal(url, 'https://clients.livcash.ma/api-parcels');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(init.headers, undefined); assert.ok(init.body instanceof FormData);
    assert.deepEqual(Object.fromEntries(init.body), { action: 'add', token: config.token, ...parcel, qty: '1' });
    return json({ status: true, msg: 'ajouté avec succès', sku: parcel.tracking, private: config.token });
  });
  const result = await client.add(parcel); assert.equal(result.acceptance, 'accepted');
  assert.equal(result.sku, parcel.tracking); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(config.token)); assert.ok(!JSON.stringify(result).includes(parcel.adresse));
});
for (const [label, response, acceptance, code] of [
  ['city', { status: false, msg: 'Ville introuvable' }, 'rejected', 'invalid_city'],
  ['duplicate', { status: false, msg: 'code de suivi déjà utilisé' }, 'unknown', 'duplicate_requires_reconciliation'],
  ['malformed', { status: true }, 'unknown', 'response'],
  ['unrecognized', { status: false, msg: 'other' }, 'unknown', 'response'],
]) test(label + ' response never retries', async () => {
  let calls = 0; const client = createLivcashClient(config, async () => { calls++; return json(response); });
  const r = await client.add(parcel); assert.equal(r.acceptance, acceptance); assert.equal(r.code, code); assert.equal(calls, 1);
});
test('non-JSON, HTTP error, oversized and redirects are uncertain', async () => {
  for (const response of [new Response('<html>bad</html>'), new Response('{}', { status: 500 }), new Response('x'.repeat(65537)), new Response(null, { status: 302 })]) {
    let calls = 0; const r = await createLivcashClient(config, async () => { calls++; return response; }).add(parcel);
    assert.equal(r.acceptance, 'unknown'); assert.equal(calls, 1);
  }
});
test('timeout is bounded even if injected fetch ignores abort; no retry', async () => {
  let calls = 0; const r = await createLivcashClient(config, async () => { calls++; return new Promise(() => {}); }).add(parcel);
  assert.equal(r.transport, 'timeout'); assert.equal(r.acceptance, 'unknown'); assert.equal(calls, 1);
});
test('transport exceptions are sanitized', async () => {
  const r = await createLivcashClient(config, async () => { throw Error(config.token + parcel.phone + parcel.adresse); }).add(parcel);
  assert.deepEqual(r, { transport: 'network_error', code: 'transport_error', acceptance: 'unknown' });
});
test('default config disables operations, including token-only config', async () => {
  for (const env of [{}, { LIVCASH_API_TOKEN: config.token }]) {
    const c = readLivcashConfig(env); assert.equal(c.submissionEnabled, false); assert.equal(c.trackingEnabled, false);
    const client = createLivcashClient(c, async () => { assert.fail('must not send'); });
    assert.equal((await client.add(parcel)).transport, 'not_sent');
    assert.equal((await client.track({ tracking: parcel.tracking })).transport, 'not_sent');
  }
  assert.throws(() => readLivcashConfig({ LIVCASH_TIMEOUT_MS: 'NaN' }), /Invalid LIVCASH/);
});
test('tracking uses only documented fields and preserves uninterpreted JSON', async () => {
  const data = { inventedStatus: 'DELIVERED', events: [] };
  const r = await createLivcashClient(config, async (_url, init) => {
    assert.deepEqual(Object.fromEntries(init.body), { action: 'track', token: config.token, tracking: parcel.tracking });
    return json(data);
  }).track({ tracking: parcel.tracking });
  assert.equal(r.observation, 'json'); assert.deepEqual(r.data, data); assert.equal(r.deliveryStatus, undefined);
});
test('mapping preserves decimal text and supplied stable identifier', () => {
  const snapshot = { customerName: parcel.name, customerPhone: parcel.phone, city: parcel.ville, address: parcel.adresse, quantity: 1, codAmount: '9007199254740993.00100' };
  const mapped = mapApprovedOrder(snapshot, parcel.tracking);
  assert.equal(mapped.price, snapshot.codAmount); assert.equal(mapped.tracking, parcel.tracking);
  assert.equal(mapped.ville, parcel.ville);
});
test('required fields and application limits reject unsafe input without transport', async () => {
  for (const patch of [{ name: '' }, { ville: '' }, { adresse: '' }, { phone: 'bad' }, { qty: 1.5 }, { qty: 0 }, { price: 120 }, { price: '1e3' }, { price: '-1' }, { tracking: '' }, { note: 'x'.repeat(1001) }]) {
    const input = { ...parcel, ...patch }; assert.equal(validParcel(input), false);
    const r = await createLivcashClient(config, async () => { assert.fail('invalid request sent'); }).add(input);
    assert.equal(r.code, 'invalid_input');
  }
});
test('translations preserve key structure and use neutral preparation wording', () => {
  function keys(x, prefix = '') { return Object.entries(x).flatMap(([k,v]) => typeof v === 'object' ? keys(v, prefix+k+'.') : [prefix+k]).sort(); }
  for (const lang of ['ar', 'fr']) {
    const path = `src/messages/${lang}.json`;
    const current = JSON.parse(readFileSync(path, 'utf8'));
    const previous = JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }));
    assert.deepEqual(keys(current), keys(previous));
    assert.ok(!/ozon|livcash/i.test(current.tracking.step3sub));
  }
});
test('LIVCASH remains disconnected from live financial and dispatch routes', () => {
  for (const path of ['src/services/orderService.ts', 'src/services/walletService.ts', 'src/app/api/seller/orders/ship-all/route.ts', 'src/app/api/admin/orders/dispatch/route.ts', 'src/app/api/admin/logistics/ship/route.ts']) {
    assert.ok(!/from\s+['"][^'"]*livcash|createLivcashClient|mapApprovedOrder/.test(readFileSync(path, 'utf8')), path);
  }
});
