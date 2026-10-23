import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkParity } from './check-dev-schema-parity.mjs';
import { isolateSql, validatePrivateSql } from './supabase-dev-sql.mjs';

// D0 is deliberately incapable of loading real credentials or executing DB commands.
// A future live-access wrapper requires separate review and owner authorization.
const root = fileURLToPath(new URL('../', import.meta.url));
const schema = join(root, 'prisma/postgresql-dev/schema.prisma');
const output = join(root, 'prisma/postgresql-dev/migrations/20261018000000_initial/migration.sql');
const allowed = new Set(['schema-parity', 'validate', 'generate-initial', 'check-sql', 'verify-namespace']);
function inventory(sql) {
  validatePrivateSql(sql);
  sql = sql.replaceAll('"winwincod_dev".', '').replace('CREATE SCHEMA IF NOT EXISTS "winwincod_dev";', 'CREATE SCHEMA IF NOT EXISTS "public";')
    .split('\n').filter(line => !/^(REVOKE |ALTER )/.test(line)).join('\n');
  const clean = sql.replace(/--[^\n]*/g, '').trim();
  const statements = clean.split(';').map(x => x.trim()).filter(Boolean);
  if (statements.some(x => !/^(CREATE TABLE|CREATE TYPE|CREATE (?:UNIQUE )?INDEX)\s/.test(x) && x !== 'CREATE SCHEMA IF NOT EXISTS "public"')) {
    throw new Error('SQL contains an unapproved statement.');
  }
  if (/`|\b(?:FOREIGN KEY|REFERENCES|DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|GRANT|REVOKE|CHECK)\b|utf8mb4|AUTO_INCREMENT/i.test(clean)) {
    throw new Error('SQL contains forbidden syntax.');
  }
  const names = regex => [...clean.matchAll(regex)].map(m => m[1]).sort();
  const source = readFileSync(schema, 'utf8');
  const expectedTables = [...source.matchAll(/^model\s+(\w+)/gm)].map(m => m[1]).sort();
  const expectedEnums = [...source.matchAll(/^enum\s+(\w+)/gm)].map(m => m[1]).sort();
  const tables = names(/CREATE TABLE "([^"]+)"/g);
  const enums = names(/CREATE TYPE "([^"]+)" AS ENUM/g);
  const indexes = names(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g);
  const uniques = names(/CREATE UNIQUE INDEX "([^"]+)"/g);
  if (tables.length !== 16 || enums.length !== 6 || JSON.stringify(tables) !== JSON.stringify(expectedTables) || JSON.stringify(enums) !== JSON.stringify(expectedEnums)) throw new Error('SQL schema inventory mismatch.');
  console.log(JSON.stringify({ indexCount: indexes.length, uniqueCount: uniques.length, primaryKeyCount: (clean.match(/PRIMARY KEY/g) || []).length }));
  if (indexes.length !== 21 || uniques.length !== 8 || (clean.match(/PRIMARY KEY/g) || []).length !== 15) throw new Error('SQL key/index count mismatch.');
  console.log(JSON.stringify({ tables: tables.length, enums: enums.length, indexes: indexes.length, uniqueIndexes: uniques.length, primaryKeys: 15, foreignKeys: 0 }));
}
try {
  const [command, ...extra] = process.argv.slice(2);
  if (!allowed.has(command) || extra.length) throw new Error('Command rejected.');
  checkParity();
  if (command === 'check-sql') inventory(readFileSync(output, 'utf8'));
  else if (command !== 'schema-parity') {
    const cli = join(root, 'node_modules/prisma/build/index.js');
    const engineDir = join(root, 'node_modules/@prisma/engines');
    const engine = join(engineDir, process.platform === 'win32' ? 'schema-engine-windows.exe' : 'schema-engine-debian-openssl-3.0.x');
    if (!existsSync(cli) || !existsSync(engine) || JSON.parse(readFileSync(join(root, 'node_modules/prisma/package.json'), 'utf8')).version !== '6.19.2') throw new Error('Required installed offline tooling unavailable.');
    // Isolated cwd prevents project-root .env discovery. No inherited DB credentials.
    const scratch = mkdtempSync(join(tmpdir(), 'winwincod-offline-'));
    const env = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
      CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
      PRISMA_SCHEMA_ENGINE_BINARY: engine,
      WINWINCOD_SUPABASE_DEV_DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
      WINWINCOD_SUPABASE_DEV_DIRECT_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
    });
    if (command === 'verify-namespace') {
      for (const key of ['WINWINCOD_SUPABASE_DEV_DATABASE_URL', 'WINWINCOD_SUPABASE_DEV_DIRECT_URL']) env[key] += '?schema=winwincod_dev';
    }
    const args = command === 'validate' ? ['validate', '--schema', schema] : ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'];
    let result;
    try { result = spawnSync(process.execPath, [cli, ...args], { cwd: scratch, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 }); }
    finally { rmdirSync(scratch); }
    if (result.error || result.status !== 0) throw new Error('Offline Prisma command failed; raw diagnostics withheld.');
    if (command === 'verify-namespace') {
      const text = result.stdout;
      if (!text.includes('CREATE SCHEMA IF NOT EXISTS "winwincod_dev"') || text.includes('CREATE SCHEMA IF NOT EXISTS "public"')) throw new Error('Namespace selection failed.');
      console.log('Installed Prisma 6.19.2 offline diff honors the schema URL parameter; history placement still requires live rehearsal.');
    } else if (command === 'generate-initial') {
      const sql = isolateSql(result.stdout.replaceAll('\r\n', '\n'));
      inventory(sql);
      if (existsSync(output) && readFileSync(output, 'utf8') !== sql) throw new Error('Existing artifact differs; refusing overwrite.');
      if (!existsSync(output)) writeFileSync(output, sql, 'utf8');
      console.log('Initial SQL generated/verified locally; nothing applied.');
    } else console.log('Offline Prisma validation passed.');
  }
} catch {
  console.error('Offline operation rejected or failed. No database operation is permitted; inspect local prerequisites.');
  process.exitCode = 1;
}
