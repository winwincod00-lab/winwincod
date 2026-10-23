import { test, after } from 'node:test';
import { rootCertificates } from 'node:tls';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deploymentPlan, checkMigrationDirectory, prismaTlsUrl } from './supabase-dev-deploy.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePrivateSql, isolateSql } from './supabase-dev-sql.mjs';

const sql = readFileSync(new URL('../prisma/postgresql-dev/migrations/20261018000000_initial/migration.sql', import.meta.url), 'utf8');
const hash = createHash('sha256').update(sql).digest('hex');
const caDirectory = mkdtempSync(join(tmpdir(), 'wwc-ca-test-'));
const caPath = join(caDirectory, 'synthetic-public-ca.pem');
// Public CA material is a local parser fixture, never an attestation of Supabase trust.
writeFileSync(caPath, rootCertificates[0]);
after(() => rmSync(caDirectory, { recursive: true }));
const url = 'postgresql://winwincod_dev_migrator:synthetic@db.abcdefghijklmnopqrst.supabase.co:5432/synthetic?schema=winwincod_dev&sslmode=verify-full&sslaccept=strict&sslcert=' + encodeURIComponent(caPath);
const env = {
  WINWINCOD_DEV_CA_PATH: caPath, WINWINCOD_DEV_CA_SHA256: createHash('sha256').update(rootCertificates[0]).digest('hex'), WINWINCOD_DEV_CA_VERIFIED: 'true',
  WINWINCOD_DEV_PROJECT_REF: 'abcdefghijklmnopqrst', WINWINCOD_DEV_PROJECT_VERIFIED: 'true', WINWINCOD_DEV_CONNECTION_METHOD: 'direct', WINWINCOD_DEV_APPROVED_PORT: '5432',
  WINWINCOD_DEV_DEPLOY_APPROVAL: 'D2-B-EXPLICITLY-APPROVED', WINWINCOD_DEV_TARGET_VERIFIED: 'true',
  WINWINCOD_DEV_SECURITY_VERIFIED: 'true', WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED: 'true',
  WINWINCOD_DEV_TARGET_ALIAS: 'winwincod-rehearsal', WINWINCOD_DEV_APPROVED_SHA256: hash,
  WINWINCOD_DEV_APPROVED_HOST: 'db.abcdefghijklmnopqrst.supabase.co', WINWINCOD_DEV_APPROVED_DATABASE_PATH: '/synthetic',
  WINWINCOD_DEV_APPROVED_USERNAME: 'winwincod_dev_migrator', WINWINCOD_SUPABASE_DEV_DATABASE_URL: url,
  WINWINCOD_SUPABASE_DEV_DIRECT_URL: url,
};
test('session pooler pins project-scoped role, host, database, port and CA without relaxing approvals', () => {
  const poolUrl = url.replace('winwincod_dev_migrator:', 'winwincod_dev_migrator.abcdefghijklmnopqrst:')
    .replace('db.abcdefghijklmnopqrst.supabase.co', 'aws-0-eu-west-1.pooler.supabase.com').replace('/synthetic?', '/postgres?');
  const pool = { ...env, WINWINCOD_DEV_CONNECTION_METHOD: 'session-pooler', WINWINCOD_DEV_APPROVED_HOST: 'aws-0-eu-west-1.pooler.supabase.com',
    WINWINCOD_DEV_APPROVED_USERNAME: 'winwincod_dev_migrator.abcdefghijklmnopqrst', WINWINCOD_DEV_APPROVED_DATABASE_PATH: '/postgres',
    WINWINCOD_SUPABASE_DEV_DATABASE_URL: poolUrl, WINWINCOD_SUPABASE_DEV_DIRECT_URL: poolUrl };
  assert.deepEqual(deploymentPlan(pool, sql), { hash });
  for (const key of Object.keys(pool)) { const candidate = { ...pool }; delete candidate[key]; assert.throws(() => deploymentPlan(candidate, sql)); }
  for (const patch of [
    { WINWINCOD_DEV_CONNECTION_METHOD: 'transaction-pooler' }, { WINWINCOD_DEV_APPROVED_PORT: '6543' },
    { WINWINCOD_DEV_PROJECT_REF: 'differentprojectref00' }, { WINWINCOD_DEV_APPROVED_HOST: 'aws-1-eu-west-1.pooler.supabase.com' },
    { WINWINCOD_DEV_APPROVED_USERNAME: 'postgres.abcdefghijklmnopqrst' }, { WINWINCOD_DEV_APPROVED_DATABASE_PATH: '/other' },
    { WINWINCOD_DEV_CA_PATH: 'relative.pem' }, { WINWINCOD_DEV_CA_SHA256: '0'.repeat(64) }, { WINWINCOD_DEV_CA_VERIFIED: 'false' },
    ...['sslaccept=accept_invalid_certs', 'sslaccept=strict&sslaccept=strict', 'sslaccept=strict&host=other', 'sslaccept=strict&sslrootcert=other'].map(value =>
      ({ WINWINCOD_SUPABASE_DEV_DIRECT_URL: poolUrl.replace('sslaccept=strict', value) })),
    { WINWINCOD_SUPABASE_DEV_DIRECT_URL: poolUrl.replace('sslcert=', 'sslcert=wrong') },
  ]) assert.throws(() => deploymentPlan({ ...pool, ...patch }, sql));
});
test('guard rejects every missing approval/target field', () => {
  for (const key of Object.keys(env)) { const e = { ...env }; delete e[key]; assert.throws(() => deploymentPlan(e, sql)); }
});
test('guard rejects inherited runtime settings, mismatch and checksum drift', () => {
  for (const patch of [{ DATABASE_URL: 'inherited' }, { DIRECT_URL: 'inherited' }, { NODE_OPTIONS: 'inherited' }, { WINWINCOD_DEV_APPROVED_HOST: 'other' }, { WINWINCOD_DEV_APPROVED_SHA256: 'wrong' }, { WINWINCOD_SUPABASE_DEV_DIRECT_URL: url.replace('winwincod_dev', 'public') }]) assert.throws(() => deploymentPlan({ ...env, ...patch }, sql));
});
test('synthetic plan only; never invokes launcher or any transport', () => {
  assert.deepEqual(deploymentPlan(env, sql), { hash });
});
test('Prisma uses its documented strict TLS dialect without relying on verify-full parsing', () => {
  const converted = new URL(prismaTlsUrl(url));
  assert.equal(converted.searchParams.get('sslmode'), 'require');
  assert.equal(converted.searchParams.get('sslaccept'), 'strict');
  assert.equal(converted.searchParams.get('sslcert'), caPath);
  assert.equal(converted.username, new URL(url).username);
  assert.equal(converted.hostname, new URL(url).hostname);
  assert.throws(() => prismaTlsUrl(url.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs')));
  assert.throws(() => prismaTlsUrl(url.replace('sslmode=verify-full', 'sslmode=prefer')));
});
test('a matching digest does not make malformed or missing CA files acceptable', () => {
  const badPath = join(caDirectory, 'malformed.pem');
  writeFileSync(badPath, 'not a certificate');
  const candidate = { ...env, WINWINCOD_DEV_CA_PATH: badPath,
    WINWINCOD_DEV_CA_SHA256: createHash('sha256').update('not a certificate').digest('hex') };
  assert.throws(() => deploymentPlan(candidate, sql));
  assert.throws(() => deploymentPlan({ ...candidate, WINWINCOD_DEV_CA_PATH: join(caDirectory, 'absent.pem') }, sql));
});
const first = { ...env, WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED: 'false', WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL: 'FIRST-REHEARSAL-EXPLICITLY-APPROVED' };
test('first rehearsal requires separate approval without a false history claim', () => {
  for (const history of [undefined, '', 'false']) assert.deepEqual(deploymentPlan({ ...first, WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED: history }, sql), { hash });
  for (const patch of [
    { WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL: undefined },
    { WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL: 'true' },
    { WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED: 'true' },
    { WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED: 'unknown' },
    { WINWINCOD_DEV_DEPLOY_APPROVAL: undefined },
    { WINWINCOD_DEV_TARGET_ALIAS: 'main-project' },
    { DATABASE_URL: 'inherited' }, { DIRECT_URL: 'inherited' },
    { WINWINCOD_DEV_APPROVED_SHA256: 'wrong' },
    { WINWINCOD_DEV_APPROVED_HOST: 'other' },
  ]) assert.throws(() => deploymentPlan({ ...first, ...patch }, sql));
});
test('first rehearsal retains all shared prerequisite guards', () => {
  for (const key of Object.keys(env).filter(k => k !== 'WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED')) {
    const candidate = { ...first }; delete candidate[key]; assert.throws(() => deploymentPlan(candidate, sql));
  }
});
test('identity, credentials, port, TLS and method cannot be weakened', () => {
  for (const patch of [
    { WINWINCOD_DEV_CONNECTION_METHOD: 'session-pooler' }, { WINWINCOD_DEV_PROJECT_REF: 'otherprojectreference' },
    { WINWINCOD_DEV_APPROVED_PORT: '6543' }, { WINWINCOD_DEV_APPROVED_USERNAME: 'postgres' },
    { DATABASE_URL: '' }, { NODE_OPTIONS: '' },
    ...['sslmode=require', 'sslmode=verify-full&sslmode=require', 'sslmode=verify-full#fragment'].map(v => ({ WINWINCOD_SUPABASE_DEV_DIRECT_URL: url.replace('sslmode=verify-full', v) })),
    { WINWINCOD_SUPABASE_DEV_DIRECT_URL: url.replace(':synthetic@', ':@') },
    { WINWINCOD_SUPABASE_DEV_DIRECT_URL: url.replace(':synthetic@', ':%00@') },
  ]) assert.throws(() => deploymentPlan({ ...first, ...patch }, sql));
});
test('unexpected migration directories/files fail closed', () => {
  checkMigrationDirectory(fileURLToPath(new URL('../prisma/postgresql-dev/migrations', import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'wwc-guard-test-'));
  try {
    mkdirSync(join(dir, '20261018000000_initial'));
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
    writeFileSync(join(dir, '20261018000000_initial/migration.sql'), sql);
    checkMigrationDirectory(dir);
    mkdirSync(join(dir, 'unexpected')); assert.throws(() => checkMigrationDirectory(dir));
  } finally { rmSync(dir, { recursive: true }); }
});
test('qualified objects, RLS and exact transformation round trip', () => {
  validatePrivateSql(sql);
  const raw = sql.split('\n-- Private-schema defense')[0]
    .replaceAll('"winwincod_dev".', '').replace('CREATE SCHEMA IF NOT EXISTS "winwincod_dev";', 'CREATE SCHEMA IF NOT EXISTS "public";');
  assert.equal(isolateSql(raw), sql);
  assert.equal((sql.match(/CREATE TABLE "winwincod_dev"\./g) || []).length, 16);
  assert.equal((sql.match(/CREATE TYPE "winwincod_dev"\./g) || []).length, 6);
  for (const tail of ['\nDROP SCHEMA x;', '\nGRANT ALL ON SCHEMA x TO PUBLIC;', '\nCREATE TABLE "public"."bad" (id INT);']) assert.throws(() => validatePrivateSql(sql + tail));
});
