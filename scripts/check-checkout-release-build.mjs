// Offline compilation rehearsal ONLY. Never runs the repository build script,
// prisma generate, a database client, migrations or deployment. --full permits
// static rendering ONLY with the same temporary DB/font/network substitutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git(['rev-parse', 'main']);
const full = process.argv.includes('--full');
const releaseFiles = [
  'src/app/(dashboard)/seller/orders/checkout/page.tsx',
  'src/app/(dashboard)/seller/orders/drafts/page.tsx',
  'src/app/(dashboard)/seller/orders/new/page.tsx',
  'src/app/api/seller/orders/drafts/route.ts',
  'src/app/api/seller/orders/drafts/submit/route.ts',
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/components/seller/ProductPicker.tsx', 'src/components/seller/ProductThumbnail.tsx',
  'src/components/ui/CitySelect.tsx', 'src/lib/cart.ts', 'src/lib/draft-selection.ts',
  'src/lib/checkout-release.ts', 'src/services/draftConfirmationService.ts',
  'src/messages/ar.json', 'src/messages/fr.json',
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'winwincod-checkout-compile-'));
const baselineFiles = git(['ls-tree', '-r', '--name-only', baseline, '--', 'src', 'public',
  'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs']).split('\n').filter(Boolean);
for (const file of baselineFiles) {
  if (!(file.startsWith('src/') || file.startsWith('public/') || ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs'].includes(file))) throw new Error('Unexpected baseline path');
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, execFileSync('git', ['show', baseline + ':' + file], { cwd: root }));
}
for (const file of releaseFiles) {
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
// Existing generated client/dependencies are reused read-only; no install/generate.
// Stub only in the disposable copy: accidental module evaluation cannot touch DB.
fs.writeFileSync(path.join(temp, 'src/lib/prisma.ts'), `import type { PrismaClient } from '@prisma/client';
export const prisma = new Proxy({} as PrismaClient, { get() { throw new Error('Database access disabled in isolated compile'); } });
export default prisma;
`);
const layoutPath = path.join(temp, 'src/app/layout.tsx');
let layout = fs.readFileSync(layoutPath, 'utf8');
if (!layout.includes('from "next/font/google"') || !layout.includes('const cairo = Cairo(') || !layout.includes('const inter = Inter(')) throw new Error('Review changed font source before offline compilation');
layout = layout.replace(/import \{ Cairo, Inter \} from "next\/font\/google";\r?\n/, '')
  .replace(/const cairo = Cairo\([\s\S]*?\);/, 'const cairo = { variable: "offline-cairo" };')
  .replace(/const inter = Inter\([\s\S]*?\);/, 'const inter = { variable: "offline-inter" };');
fs.writeFileSync(layoutPath, layout);
const guard = path.join(temp, 'deny-network.cjs');
fs.writeFileSync(guard, `const deny = () => { throw new Error('Network disabled in isolated compile'); };
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const module of ['node:http', 'node:https']) { require(module).request = deny; require(module).get = deny; }
globalThis.fetch = async () => deny();
// Generated Prisma modules can discover their original project's .env through
// the node_modules junction. Deny those reads before ANY package is evaluated.
const fs = require('node:fs'), path = require('node:path');
const isEnv = file => /^\\.env(?:\\.|$)/i.test(path.basename(String(file)));
const unavailable = () => Object.assign(new Error('Environment file unavailable in isolated build'), { code: 'ENOENT' });
for (const method of ['readFileSync', 'openSync']) {
  const original = fs[method]; fs[method] = function(file, ...args) { if (isEnv(file)) throw unavailable(); return original.call(this, file, ...args); };
}
for (const method of ['readFile', 'open']) {
  const original = fs[method]; fs[method] = function(file, ...args) {
    if (isEnv(file)) { const callback = args.at(-1); if (typeof callback === 'function') { queueMicrotask(() => callback(unavailable())); return; } throw unavailable(); }
    return original.call(this, file, ...args);
  };
}
for (const method of ['readFile', 'open']) {
  const original = fs.promises[method]; fs.promises[method] = async function(file, ...args) { if (isEnv(file)) throw unavailable(); return original.call(this, file, ...args); };
}
const exists = fs.existsSync; fs.existsSync = file => isEnv(file) ? false : exists(file);
`);
// Explicit allowlist; do NOT inherit root credentials, NODE_OPTIONS or dotenv.
const env = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: `--require "${guard.replaceAll('\\', '/')}"`,
  DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
  DIRECT_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
});
// Fail closed before Next runs if either isolation hook was not installed.
execFileSync(process.execPath, ['-e', `
try { require('node:fs').readFileSync(process.argv[1]); throw new Error('Environment read guard failed'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try { require('node:net').connect(1, '127.0.0.1'); throw new Error('Network guard failed'); }
catch (error) { if (error.message !== 'Network disabled in isolated compile') throw error; }
`, path.join(root, '.env')], { cwd: temp, env, windowsHide: true });
process.stdout.write(JSON.stringify({ temporaryProject: temp, baseline, overlays: releaseFiles.length,
  limitations: ['font loader replaced only in temp', 'Prisma replaced only in temp', full ? 'full build with substitutes; not production integration' : 'compile only; no static render', 'network denied'] }) + '\n');
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack', ...(full ? [] : ['--experimental-build-mode', 'compile'])],
  { cwd: temp, env, stdio: 'inherit', windowsHide: true });
const timer = setTimeout(() => { child.kill(); }, 180000);
child.on('error', error => { clearTimeout(timer); process.stderr.write(error.message + '\n'); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); process.exitCode = code ?? 1; });
// Keep temp artifacts for inspection; never delete unrelated or computed paths.
