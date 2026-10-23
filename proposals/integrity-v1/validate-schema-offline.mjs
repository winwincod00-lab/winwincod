// Offline schema validation in an OS temp project: Prisma must not discover root .env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = new URL('./', import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'winwincod-integrity-schema-'));
fs.writeFileSync(path.join(temp, 'package.json'), '{"name":"isolated-proposal-validation","private":true}');
fs.copyFileSync(new URL('schema.proposed.prisma', here), path.join(temp, 'schema.prisma'));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/prisma/build/index.js', here)), 'validate', '--schema', path.join(temp, 'schema.prisma')], {
  cwd: temp, encoding: 'utf8', env: { ...process.env, WINWINCOD_INTEGRITY_STAGING_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', WINWINCOD_INTEGRITY_STAGING_DIRECT_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' }, timeout: 30000,
});
// Keep temporary validation artifacts for review; never recursively delete a computed path.
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
