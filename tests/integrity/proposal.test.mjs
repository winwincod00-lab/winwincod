import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const base='proposals/integrity-v1/';
const manifest=JSON.parse(fs.readFileSync(base+'schema-manifest.json','utf8'));
const expand=fs.readFileSync(base+'sql/001_expand.proposed.sql','utf8');
const schema=fs.readFileSync(base+'schema.proposed.prisma','utf8');
const sqlFiles=fs.readdirSync(base+'sql').filter(name=>name.endsWith('.sql'));
const sql=sqlFiles.map(name=>fs.readFileSync(base+'sql/'+name,'utf8')).join('\n');
test('proposed Prisma models and expand SQL cover exactly the same new fields/tables/unique identities',()=>{
 const tables=[...expand.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match=>match[1]);
 assert.equal(tables.length,manifest.models.length);
 for(const model of manifest.models){
  assert.ok(schema.includes('model '+model.name+' {'));assert.ok(schema.includes('@@map("'+model.table+'")'));
  const table=expand.split('CREATE TABLE "'+model.table+'" (')[1]?.split('\n);')[0];assert.ok(table);
  for(const [field] of model.fields)assert.ok(table.includes('"'+field+'" '),model.name+'.'+field);
  for(const [index,fields] of model.unique.entries())assert.ok(table.includes('"'+model.table+'_u'+index+'" UNIQUE ('+fields.map(field=>'"'+field+'"').join(', ')+')'));
 }
});
test('new FK lookup columns have an explicit usable index/unique prefix and consistent model relation metadata',()=>{
 const models=Object.fromEntries(manifest.models.map(model=>[model.name,model]));
 for(const fk of manifest.foreignKeys){
  const child=models[fk.child];const keys=[child.fields.filter(([,kind])=>kind==='id').map(([name])=>name),...child.unique,...child.indexes];
  assert.ok(keys.some(key=>key.length>0&&key.length<=fk.fields.length&&key.every((field,i)=>field===fk.fields[i])),fk.name+' lacks FK index');
  assert.ok(expand.includes('CONSTRAINT "'+fk.name+'" FOREIGN KEY'));assert.ok(schema.includes('@relation("'+fk.name+'", fields:'));
  assert.ok(fk.name.length<=63);
 }
});
test('proposal scripts have one explicit transaction boundary and no fabricated legacy balances/cost backfill',()=>{
 for(const name of sqlFiles){const source=fs.readFileSync(base+'sql/'+name,'utf8');assert.equal((source.match(/^BEGIN(?: READ ONLY)?;/gm)??[]).length,1,name);assert.equal((source.match(/^(?:COMMIT|ROLLBACK);/gm)??[]).length,1,name);}
 assert.ok(!/INSERT INTO/i.test(expand));assert.ok(!/UPDATE\s+"?order"?\s+SET/i.test(sql));
 assert.ok(!/INSERT INTO\s+"?transaction"?/i.test(sql));assert.ok(!/INSERT INTO\s+fi_wallet\s/i.test(sql));
 assert.ok(sql.includes('Existing fi_ objects: baseline/partial recovery review required'));
 assert.ok(!schema.includes('env("DATABASE_URL")'));assert.ok(schema.includes('WINWINCOD_INTEGRITY_STAGING_URL'));
});
test('SQL proposal retains append-only, balanced journal, tenant FK, reservation, inspection, payout and closure guards',()=>{
 for(const marker of ['DEFERRABLE INITIALLY DEFERRED','fi_journal_balanced','fi_wallet_projection','fi_stock_projection','fi_inspect_return','fi_legacy_wallet_fence','fi_legacy_product_fence','fi_legacy_withdrawal_gate','fi_posting_open_journal','fi_open_operation_guard','Whole active hold required','In-flight/unknown payout cannot release funds','Inspection exceeds physically received quantity','Every paid unit must be reserved at commit, never auto-dispatched'])assert.ok(sql.includes(marker),marker);
 assert.ok(sql.includes('"orderFee"=20'));assert.ok(!sql.includes('wallet SET balance=0'));assert.ok(!sql.includes('LIMIT 5'));
});
test('SQL table references resolve to an actual proposed or documented legacy table, not an invented model',()=>{
 const allowed=new Set(manifest.models.map(model=>model.table));
 for(const match of sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(fi_[a-z_]+)\b/g))assert.ok(allowed.has(match[1]),'Unknown table '+match[1]);
});
test('migration lineage mismatch is preserved and checksummed, never silently relabelled or marked applied',()=>{
 const history=JSON.parse(fs.readFileSync(base+'baseline-manifest.json','utf8'));assert.equal(history.observedRootHistoryProvider,'mysql');assert.equal(history.deployedHistory,'UNVERIFIED');
 for(const file of history.files)assert.equal(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'),file.sha256,file.path);
 assert.ok(fs.readFileSync('prisma/migrations/migration_lock.toml','utf8').includes('mysql'));assert.ok(!fs.existsSync('prisma/migrations/integrity-v1'));
});
test('isolated architecture source cannot import a Prisma client, environment, transport or legacy runtime writer',()=>{
 for(const file of ['domain.ts','payment-contract.ts']){
  const source=fs.readFileSync('src/integrity-v1/'+file,'utf8');assert.ok(!source.includes('@/lib/prisma'));assert.ok(!source.includes('process.env'));assert.ok(!source.includes('fetch('));assert.ok(!source.includes('new PrismaClient'));
 }
});
test('SQL function definitions are unique and dollar quoting survives source generation',()=>{
 const names=[...sql.matchAll(/CREATE FUNCTION\s+(fi_[a-z_]+)/g)].map(match=>match[1]);
 assert.equal(new Set(names).size,names.length,'Duplicate function definition');
 assert.ok(!/AS \$\s*\r?\n|END \$;/m.test(sql),'Malformed single-dollar function delimiter');
 for(const name of sqlFiles){
  const source=fs.readFileSync(base+'sql/'+name,'utf8');
  const tags=source.match(/\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/g)??[];
  for(const tag of new Set(tags))assert.equal(tags.filter(value=>value===tag).length%2,0,name+': '+tag);
 }
});
