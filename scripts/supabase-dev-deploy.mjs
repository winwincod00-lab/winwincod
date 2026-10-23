import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync, mkdtempSync, rmdirSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkParity } from './check-dev-schema-parity.mjs';
import { validatePrivateSql } from './supabase-dev-sql.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function checkMigrationDirectory(directory) {
  const expected = ['20261018000000_initial', 'migration_lock.toml'];
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected.sort())) throw Error('Unexpected migration inventory.');
  for (const name of expected) if (lstatSync(join(directory, name)).isSymbolicLink()) throw Error('Linked migration rejected.');
  const initial = join(directory, '20261018000000_initial');
  if (!lstatSync(initial).isDirectory() || JSON.stringify(readdirSync(initial)) !== JSON.stringify(['migration.sql']) ||
      lstatSync(join(initial, 'migration.sql')).isSymbolicLink() ||
      readFileSync(join(directory, 'migration_lock.toml'), 'utf8').trim() !== 'provider = "postgresql"') throw Error('Unexpected migration files.');
}
export function deploymentPlan(env, sql) {
  if (['DATABASE_URL', 'DIRECT_URL', 'NODE_OPTIONS'].some(key => Object.hasOwn(env, key))) throw Error('Inherited runtime configuration rejected.');
  const pooler = env.WINWINCOD_DEV_CONNECTION_METHOD === 'session-pooler';
  const username = pooler ? `winwincod_dev_migrator.${env.WINWINCOD_DEV_PROJECT_REF}` : 'winwincod_dev_migrator';
  if (!['direct', 'session-pooler'].includes(env.WINWINCOD_DEV_CONNECTION_METHOD) ||
      env.WINWINCOD_DEV_PROJECT_VERIFIED !== 'true' ||
      !/^[a-z0-9]{10,64}$/.test(env.WINWINCOD_DEV_PROJECT_REF ?? '') ||
      env.WINWINCOD_DEV_APPROVED_HOST !== (pooler ? 'aws-0-eu-west-1.pooler.supabase.com' : `db.${env.WINWINCOD_DEV_PROJECT_REF}.supabase.co`) ||
      (pooler && env.WINWINCOD_DEV_APPROVED_DATABASE_PATH !== '/postgres') ||
      env.WINWINCOD_DEV_APPROVED_PORT !== '5432' ||
      env.WINWINCOD_DEV_APPROVED_USERNAME !== username) throw Error('Pinned restricted target required.');
  if (env.WINWINCOD_DEV_CA_VERIFIED !== 'true' || !/^[a-f0-9]{64}$/.test(env.WINWINCOD_DEV_CA_SHA256 ?? '') ||
      !/^[A-Za-z]:[\\/]/.test(env.WINWINCOD_DEV_CA_PATH ?? '') || /[\u0000-\u001f\u007f]/.test(env.WINWINCOD_DEV_CA_PATH) ||
      !lstatSync(env.WINWINCOD_DEV_CA_PATH).isFile() || lstatSync(env.WINWINCOD_DEV_CA_PATH).isSymbolicLink()) throw Error('Verified absolute CA file required.');
  const ca = readFileSync(env.WINWINCOD_DEV_CA_PATH);
  const certificate = new X509Certificate(ca);
  if (createHash('sha256').update(ca).digest('hex') !== env.WINWINCOD_DEV_CA_SHA256 || !certificate.ca ||
      Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw Error('CA file rejected.');
  const hash = createHash('sha256').update(sql).digest('hex');
  const firstRehearsal = env.WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL;
  const historyVerified = env.WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED === 'true';
  if (env.WINWINCOD_DEV_TARGET_ALIAS !== 'winwincod-rehearsal') throw Error('Rehearsal target required.');
  if (firstRehearsal !== undefined && firstRehearsal !== '') {
    if (firstRehearsal !== 'FIRST-REHEARSAL-EXPLICITLY-APPROVED' ||
        historyVerified || ![undefined, '', 'false'].includes(env.WINWINCOD_DEV_HISTORY_PLACEMENT_VERIFIED) ||
        hash !== '9c369f893753c8cb01d2e3416bbe966bee5bf3ccf61d21bfff2dc44e4be95357') {
      throw Error('Invalid first-rehearsal authorization.');
    }
  } else if (!historyVerified) throw Error('History verification or first-rehearsal authorization required.');
  if (env.WINWINCOD_DEV_DEPLOY_APPROVAL !== 'D2-B-EXPLICITLY-APPROVED' ||
      env.WINWINCOD_DEV_TARGET_VERIFIED !== 'true' ||
      env.WINWINCOD_DEV_SECURITY_VERIFIED !== 'true' ||
      !env.WINWINCOD_DEV_TARGET_ALIAS || env.WINWINCOD_DEV_APPROVED_SHA256 !== hash) throw Error('Deployment prerequisites missing.');
  const urls = ['WINWINCOD_SUPABASE_DEV_DATABASE_URL', 'WINWINCOD_SUPABASE_DEV_DIRECT_URL'].map(key => {
    const u = new URL(env[key] || '');
    const keys = [...u.searchParams.keys()];
    const password = decodeURIComponent(u.password);
    if (u.protocol !== 'postgresql:' || decodeURIComponent(u.username) !== username ||
        !password || password.length > 4096 || /[\u0000-\u001f\u007f]/.test(password) ||
        !u.pathname.slice(1) || u.hash || u.port !== env.WINWINCOD_DEV_APPROVED_PORT ||
        u.searchParams.getAll('sslmode').length !== 1 ||
        u.searchParams.getAll('schema').length !== 1 || u.searchParams.get('schema') !== 'winwincod_dev' ||
        u.searchParams.get('sslmode') !== 'verify-full' ||
        u.searchParams.getAll('sslaccept').length !== 1 || u.searchParams.get('sslaccept') !== 'strict' ||
        u.searchParams.getAll('sslcert').length !== 1 || u.searchParams.get('sslcert') !== env.WINWINCOD_DEV_CA_PATH ||
        keys.some(k => !['schema', 'sslmode', 'sslcert', 'sslaccept'].includes(k)) ||
        u.hostname !== env.WINWINCOD_DEV_APPROVED_HOST || u.pathname !== env.WINWINCOD_DEV_APPROVED_DATABASE_PATH ||
        u.username !== env.WINWINCOD_DEV_APPROVED_USERNAME || !u.hostname.endsWith('.supabase.com') && !u.hostname.endsWith('.supabase.co')) throw Error('Target rejected.');
    return u;
  });
  if (urls[0].href !== urls[1].href) throw Error('Use one verified migration connection for both settings.');
  validatePrivateSql(sql);
  return { hash };
}
// Call only AFTER deploymentPlan. Prisma 6's documented TLS dialect uses require,
// sslaccept=strict and sslcert for encryption + certificate/hostname validation.
// Never rely on Prisma interpreting libpq's verify-full spelling.
export function prismaTlsUrl(verifiedUrl) {
  const u = new URL(verifiedUrl);
  if (u.searchParams.get('sslmode') !== 'verify-full' || u.searchParams.get('sslaccept') !== 'strict' ||
      !u.searchParams.get('sslcert')) throw Error('Strict TLS required.');
  u.searchParams.set('sslmode', 'require');
  return u.href;
}
// Importing this module performs no I/O or execution; tests exercise guards only.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let scratch;
  try {
    if (process.argv.length !== 2) throw Error('Arguments rejected.');
    const sql = readFileSync(join(root, 'prisma/postgresql-dev/migrations/20261018000000_initial/migration.sql'), 'utf8');
    checkMigrationDirectory(join(root, 'prisma/postgresql-dev/migrations'));
    deploymentPlan(process.env, sql);
    checkParity();
    const cli = join(root, 'node_modules/prisma/build/index.js');
    const engine = join(root, 'node_modules/@prisma/engines/schema-engine-windows.exe');
    if (!existsSync(engine) || JSON.parse(readFileSync(join(root, 'node_modules/prisma/package.json'), 'utf8')).version !== '6.19.2') throw Error('Tooling mismatch.');
    const env = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
    for (const key of ['WINWINCOD_SUPABASE_DEV_DATABASE_URL', 'WINWINCOD_SUPABASE_DEV_DIRECT_URL']) env[key] = prismaTlsUrl(process.env[key]);
    Object.assign(env, { CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_SCHEMA_ENGINE_BINARY: engine });
    scratch = mkdtempSync(join(tmpdir(), 'winwincod-deploy-'));
    const r = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', join(root, 'prisma/postgresql-dev/schema.prisma')], { cwd: scratch, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 });
    if (r.error || r.status !== 0) throw Error('Deployment failed.');
    console.log('Deployment command completed; separate catalog verification required.');
  } catch { console.error('Deployment blocked or failed. Raw diagnostics withheld. Do not blindly retry.'); process.exitCode = 1; }
  finally { if (scratch) rmdirSync(scratch); }
}
