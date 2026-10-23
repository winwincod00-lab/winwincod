import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// Tokenize rather than removing whitespace inside quoted schema literals.
function tokens(source) {
  return source.match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[^\s]/g)
    .filter(token => !token.startsWith('//') && !token.startsWith('/*'));
}
export function checkParity() {
  const runtime = readFileSync(new URL('prisma/schema.prisma', root), 'utf8');
  const development = readFileSync(new URL('prisma/postgresql-dev/schema.prisma', root), 'utf8');
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!development.includes(`env("WINWINCOD_SUPABASE_DEV_${name}")`)) {
      throw new Error('Development datasource names are not isolated.');
    }
  }
  const normalized = development
    .replaceAll('env("WINWINCOD_SUPABASE_DEV_DATABASE_URL")', 'env("DATABASE_URL")')
    .replaceAll('env("WINWINCOD_SUPABASE_DEV_DIRECT_URL")', 'env("DIRECT_URL")');
  if (JSON.stringify(tokens(runtime)) !== JSON.stringify(tokens(normalized))) {
    throw new Error('Runtime/development schema drift detected.');
  }
  console.log('Schema parity passed (only datasource variable names differ).');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { checkParity(); } catch { console.error('Schema parity failed.'); process.exitCode = 1; }
}
