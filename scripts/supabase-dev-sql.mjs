export const namespace = 'winwincod_dev';
export function isolateSql(source) {
  if (!source.includes('CREATE SCHEMA IF NOT EXISTS "public";')) throw new Error('Unexpected Prisma SQL format.');
  const enums = [...source.matchAll(/CREATE TYPE "([^"]+)" AS ENUM/g)].map(x => x[1]);
  const tables = [...source.matchAll(/CREATE TABLE "([^"]+)"/g)].map(x => x[1]);
  let sql = source.replace('CREATE SCHEMA IF NOT EXISTS "public";', `CREATE SCHEMA IF NOT EXISTS "${namespace}";`)
    .replace(/CREATE TYPE "([^"]+)" AS ENUM/g, `CREATE TYPE "${namespace}"."$1" AS ENUM`)
    .replace(/CREATE TABLE "([^"]+)"/g, `CREATE TABLE "${namespace}"."$1"`)
    .replace(/(CREATE (?:UNIQUE )?INDEX "[^"]+" ON )"([^"]+)"/g, `$1"${namespace}"."$2"`);
  for (const name of enums) sql = sql.replaceAll(` "${name}"`, ` "${namespace}"."${name}"`);
  // Index names inherit the table namespace in PostgreSQL CREATE INDEX syntax.
  sql += '\n-- Private-schema defense in depth; no policies or grants to API roles.\n';
  sql += `REVOKE ALL ON SCHEMA "${namespace}" FROM PUBLIC, anon, authenticated;\n`;
  sql += `REVOKE ALL ON ALL TABLES IN SCHEMA "${namespace}" FROM PUBLIC, anon, authenticated;\n`;
  sql += `ALTER DEFAULT PRIVILEGES IN SCHEMA "${namespace}" REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;\n`;
  for (const table of tables) sql += `ALTER TABLE "${namespace}"."${table}" ENABLE ROW LEVEL SECURITY;\n`;
  return sql;
}
export function validatePrivateSql(sql) {
  if (/"public"|FOREIGN KEY|\b(?:DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT)\b|`/i.test(sql.replace(/--[^\n]*/g, ''))) throw new Error('Unsafe SQL.');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean);
  for (const s of statements) {
    if (/^CREATE SCHEMA IF NOT EXISTS "winwincod_dev"$/.test(s)) continue;
    if (/^CREATE (?:TABLE|TYPE) "winwincod_dev"\."\w+"[\s(]/.test(s)) continue;
    if (/^CREATE (?:UNIQUE )?INDEX "\w+" ON "winwincod_dev"\."\w+"\(/.test(s)) continue;
    if (/^ALTER TABLE "winwincod_dev"\."\w+" ENABLE ROW LEVEL SECURITY$/.test(s)) continue;
    if (/^REVOKE ALL ON (?:SCHEMA "winwincod_dev"|ALL TABLES IN SCHEMA "winwincod_dev") FROM PUBLIC, anon, authenticated$/.test(s)) continue;
    if (s === 'ALTER DEFAULT PRIVILEGES IN SCHEMA "winwincod_dev" REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated') continue;
    throw new Error('Unexpected SQL statement.');
  }
  if ((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length !== 16) throw new Error('RLS inventory mismatch.');
}
