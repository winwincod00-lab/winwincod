import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
function load(path, imports) {
  const fixtureModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: fixtureModule, exports: fixtureModule.exports, require(name) { if (!(name in imports)) throw Error('Blocked import '+name); return imports[name]; },
  });
  return fixtureModule.exports;
}
const margin = load('src/lib/historical-margin.ts', { '@prisma/client': { Prisma } }).historicalMargin;
test('snapshot contract ignores subsequent product repricing; missing historical cost stays unknown', () => {
  const product = { cost: '10.10' };
  const input = { unitCost: product.cost, quantity: 3, proceeds: '100', fee: '20', realized: false };
  product.cost = '99';
  assert.equal(margin(input).amount, '49.7');
  assert.equal(margin(input).kind, 'PROJECTED');
  assert.equal(margin({ ...input, realized: true }).kind, 'REALIZED');
  assert.equal(margin({ ...input, unitCost: null }).amount, null);
});
function fixture(kind = 'deposit', balance = '100', fail = false) {
  let state = { status: 'PENDING', balance: new Prisma.Decimal(balance), entries: [], logs: [] };
  let queue = Promise.resolve();
  const db = { $transaction(operation, options) {
    assert.equal(options.isolationLevel, 'Serializable');
    const promise = queue.then(async () => {
      const work = { ...state, entries: [...state.entries], logs: [...state.logs] };
      const wallet = () => ({ id: 'w', userId: 's', balance: work.balance });
      const request = {
        findUnique: async () => ({ id: 'r', sellerId: 's', amount: new Prisma.Decimal('60.10'), status: work.status }),
        updateMany: async ({ where, data }) => { if (work.status !== where.status) return { count: 0 }; work.status = data.status; return { count: 1 }; },
      };
      const tx = { depositrequest: request, withdrawalrequest: request, wallet: {
        findUniqueOrThrow: async () => wallet(),
        update: async ({ data }) => { work.balance = work.balance.plus(data.balance.increment); return wallet(); },
        updateMany: async ({ where, data }) => { if (work.balance.lt(where.balance.gte)) return { count: 0 }; work.balance = work.balance.minus(data.balance.decrement); return { count: 1 }; },
      }, transaction: {
        create: async ({ data }) => { if (fail === true) throw Error('ledger failure'); work.entries.push(data); },
        findMany: async () => work.entries,
      }, log: { create: async ({ data }) => { if (fail === 'audit') throw Error('audit failure'); work.logs.push(data); } } };
      const result = await operation(tx); state = work; return result;
    });
    queue = promise.catch(() => {}); return promise;
  } };
  const service = load('src/services/walletApprovalService.ts', { '@prisma/client': { Prisma }, '@/lib/prisma': { default: db } });
  return { state: () => state, call: decision => kind === 'deposit' ? service.decideDeposit('r', decision, 'admin') : service.decideWithdrawal('r', decision, 'admin', 'https://receipt.invalid') };
}
for (const kind of ['deposit', 'withdrawal']) {
  test(`${kind}: serialized concurrent approval and retry create one ledger entry`, async () => {
    const f = fixture(kind); await Promise.all([f.call('APPROVED'), f.call('APPROVED')]);
    await f.call('APPROVED');
    assert.equal(f.state().entries.length, 1); assert.equal(f.state().logs.length, 1);
    assert.equal(f.state().balance.toString(), kind === 'deposit' ? '160.1' : '39.9');
    await assert.rejects(f.call('REJECTED'));
  });
  test(`${kind}: ledger failure rolls back status and balance in transaction model`, async () => {
    const f = fixture(kind, '100', true); await assert.rejects(f.call('APPROVED'));
    assert.equal(f.state().status, 'PENDING'); assert.equal(f.state().balance.toString(), '100');
  });
}
test('withdrawal cannot debit below zero; rejection retry has no ledger effect', async () => {
  const f = fixture('withdrawal', '10'); await assert.rejects(f.call('APPROVED'));
  assert.equal(f.state().status, 'PENDING'); await f.call('REJECTED'); await f.call('REJECTED');
  assert.equal(f.state().entries.length, 0);
});

test('approval racing rejection commits one decision and no contradictory effect', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.call('APPROVED'), f.call('REJECTED')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.state().status, 'APPROVED'); assert.equal(f.state().entries.length, 1);
});
test('legacy approved request with missing ledger fails closed on retry', async () => {
  const f = fixture(); await f.call('APPROVED'); f.state().entries.length = 0;
  await assert.rejects(f.call('APPROVED'), /Ledger mismatch/);
  assert.equal(f.state().balance.toString(), '160.1');
});
test('audit failure rolls back request, ledger and balance in model', async () => {
  const f = fixture('deposit', '100', 'audit'); await assert.rejects(f.call('APPROVED'));
  assert.equal(f.state().status, 'PENDING'); assert.equal(f.state().entries.length, 0);
  assert.equal(f.state().balance.toString(), '100');
});

for (const kind of ['deposit', 'withdrawal']) test(`${kind}: pending legacy request with an existing ledger cannot be approved or rejected again`, async () => {
  const f = fixture(kind); await f.call('APPROVED');
  const balance = f.state().balance.toString();
  f.state().status = 'PENDING'; // Model the old debit/status split-write failure.
  await assert.rejects(f.call('APPROVED'), /manual reconciliation/);
  await assert.rejects(f.call('REJECTED'), /manual reconciliation/);
  assert.equal(f.state().balance.toString(), balance); assert.equal(f.state().entries.length, 1);
  assert.equal(f.state().status, 'PENDING');
});
