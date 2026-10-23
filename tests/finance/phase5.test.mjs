import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';

function service(db) {
  const fixture = { exports: {} };
  const imports = { '@prisma/client': { Prisma }, '@/lib/prisma': { __esModule: true, default: db }, './walletApprovalService': {}, './notificationService': {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/walletService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: fixture, exports: fixture.exports, console, require(name) {
    if (!(name in imports)) throw Error('Blocked import ' + name);
    return imports[name];
  } });
  return fixture.exports;
}

test('legacy wallet entrypoints reject invalid amounts before database access', async () => {
  const s = service(new Proxy({}, { get() { throw Error('Unexpected database access'); } }));
  for (const amount of [NaN, Infinity, -Infinity, -1, 0]) {
    await assert.rejects(s.creditWallet('seller', amount, 'DEPOSIT'), /Invalid wallet amount/);
    await assert.rejects(s.chargeWallet('seller', amount, 'ORDER_PAYMENT'), /Invalid wallet amount/);
    await assert.rejects(s.createDepositRequest('seller', amount, 'receipt'), /Invalid wallet amount/);
  }
  for (const amount of [NaN, Infinity, -1]) {
    await assert.rejects(s.deductForOrder('seller', 'order', amount, 10), /Invalid wallet amount/);
    await assert.rejects(s.deductForOrder('seller', 'order', 20, amount), /Invalid wallet amount/);
    await assert.rejects(s.creditProfit('seller', 'order', 100, amount, 20), /Invalid wallet amount/);
    await assert.rejects(s.creditProfit('seller', 'order', amount, 10, 20), /Invalid wallet amount/);
    await assert.rejects(s.creditProfit('seller', 'order', 100, 10, amount), /Invalid wallet amount/);
  }
  await assert.rejects(s.deductForOrder('seller', 'order', Number.MAX_VALUE, Number.MAX_VALUE), /Invalid wallet amount/);
});

test('legacy order debit loses conditional balance claim without writing a ledger', async () => {
  let journalWrites = 0;
  const s = service({ $transaction: async fn => fn({
    wallet: {
      findUniqueOrThrow: async () => ({ id: 'wallet', balance: 100 }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.userId, 'seller');
        assert.equal(where.balance.gte.toString(), '70');
        assert.equal(data.balance.decrement, 70);
        return { count: 0 }; // Another writer spent funds after the read.
      },
    },
    transaction: { create: async () => { journalWrites++; } },
  }) });
  await assert.rejects(s.deductForOrder('seller', 'order', 20, 50), /Insufficient balance/);
  assert.equal(journalWrites, 0);
});

test('legacy nonpositive valid profit remains a no-op', async () => {
  const s = service(new Proxy({}, { get() { throw Error('Unexpected database access'); } }));
  assert.equal(await s.creditProfit('seller', 'order', 30, 10, 20), null);
  assert.equal(await s.creditProfit('seller', 'order', 0, 10, 20), null);
});

for (const path of ['src/app/api/admin/products/route.ts', 'src/app/api/admin/products/[id]/route.ts']) {
  test(path + ': supplier cost reads require a current Admin before database access', async () => {
    for (const actor of [null, { id: 'seller', role: 'SELLER' }, { id: 'staff', role: 'CALL_CENTER' }, { id: 'admin', role: 'ADMIN' }]) {
      let reads = 0;
      const product = { costPrice: 10 };
      const read = async () => { reads++; return product; };
      const imports = {
        'next/server': { NextResponse: { json: body => body } },
        '@/lib/prisma': { __esModule: true, default: { product: { findMany: read, findUnique: read } } },
        '@/lib/api-utils': { getSessionUser: async () => actor, errorResponse: (message, status) => ({ message, status }) },
      };
      const fixture = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText, { module: fixture, exports: fixture.exports, console, require(name) {
        if (!(name in imports)) throw Error('Blocked import ' + name);
        return imports[name];
      } });
      const response = await fixture.exports.GET({}, { params: Promise.resolve({ id: 'product' }) });
      assert.equal(reads, actor?.role === 'ADMIN' ? 1 : 0);
      if (actor?.role !== 'ADMIN') assert.equal(response.status, 401);
    }
  });
}
