# Isolated PostgreSQL development preparation

Current connection procedure: [Session Pooler and authentication-only helper](supabase-session-pooler.md).
It supersedes the earlier direct-only restrictions below and adds mandatory CA
path/digest/trust gates to both connection modes. Local implementation and offline
tests do not authorize any live command or attest project identity, role state or TLS.

## Secure handoff hardening (offline implementation only)

Do not execute the interactive helper until separate live authorization. It launches
the existing deployment launcher, not an authentication-only check. Approved future
entry point (PowerShell 7, trusted workstation, no transcript/debug tracing):

```powershell
pwsh -NoProfile -File scripts/supabase-dev-handoff.ps1
```

Prompts collect independently dashboard-verified host, port, database, project ref,
project verification, method, target/security verification, and both explicit approval
literals. Verification values require exact true; approvals retain the documented
literals. Password uses Read-Host -AsSecureString. Never enter a connection URI.
Direct mode pins the independently supplied project ref, port 5432 and role
winwincod_dev_migrator. Session Pooler routing and CA pins are described in the
current connection procedure linked above.
The hostname/ref pattern check cannot prove the alias-to-project mapping; owner must
verify that mapping privately. No DNS or provider verification occurs in the helper.

Only the sanitized child receives the constructed URLs; parent process environment
is never modified. The helper percent-encodes the password and clears its hashtable,
ProcessStartInfo environment and SecureString in finally paths. Managed strings and
OS process-environment copies cannot be guaranteed physically zeroed. Use a trusted
account/workstation; local administrators may inspect process memory. Do not enable
PowerShell transcripts, debug tracing or environment dumps. Temporary credentials
must still be retired after the live window. Do not invoke the low-level environment
builder interactively: it returns sensitive in-memory data for helper use only.

Launcher independently rejects inherited runtime DB variables/NODE_OPTIONS even if
empty, wrong role/project host/port/database/schema, malformed credentials, duplicate
TLS parameters, fragments, insecure TLS, unknown migration files/directories and
contradictory approvals. No automatic retry or privileged fallback exists.

Offline tests (no real child launcher or network connection):

```powershell
node --test scripts/test-supabase-dev.mjs
pwsh -NoProfile -File scripts/test-supabase-dev-handoff.ps1
```

Owner UI actions before any live permission:
1. Select winwincod-rehearsal and privately compare its project ref and direct details.
2. Reopen Data API settings: winwincod_dev excluded; automatic exposure OFF. Confirm
   persistence after reload. Do not change main-project configuration.
3. Confirm schema ownership, migration-role least privilege and approved network/TLS.
4. Separately authorize administrator temporary credential/LOGIN and an existing-client
   authentication-only test: verify TLS and session/current role, then close it. Do not
   run this helper for that test. Never fall back to postgres, Neon or another endpoint.
5. On test failure stop. Administrator restores NOLOGIN, invalidates the credential
   and verifies all migrator sessions closed (termination separately authorized).
6. After a successful test, obtain separate one-attempt deployment approval before
   using the helper. On success/failure retire credentials and verify sessions closed.

No role, password, setting, network path or live target was changed by this patch.

## First rehearsal authorization correction

The launcher is now restricted to the privately verified target alias
`winwincod-rehearsal`, schema `winwincod_dev`. An alias is an owner attestation,
not independent proof of provider identity; host/database/user pinning still applies.

For the FIRST attempt only, keep HISTORY_PLACEMENT_VERIFIED absent, empty or false.
Set WINWINCOD_DEV_FIRST_REHEARSAL_APPROVAL to
`FIRST-REHEARSAL-EXPLICITLY-APPROVED` through the approved process environment.
The separate WINWINCOD_DEV_DEPLOY_APPROVAL must still be
`D2-B-EXPLICITLY-APPROVED`. First rehearsal is pinned to candidate SHA256
9c369f893753c8cb01d2e3416bbe966bee5bf3ccf61d21bfff2dc44e4be95357.
Combining first-rehearsal authorization with a true history-verification claim is
rejected. Subsequent verified runs must remove first-rehearsal authorization and
use a genuinely verified history-placement flag. No automatic retries.

Preflight (separate owner authorization required):
- Privately confirm the rehearsal project/connection and absence of application objects.
- Confirm no root/runtime DB variables are inherited; never load root .env.
- Review effective migration-role attributes, memberships and schema ownership.
- Verify API exclusion and grants, TLS and direct/session-pooler custom-role support.
- Approve temporary LOGIN and credentials through a secure administrator process.
- Approve exact checksum and one rehearsal attempt, plus metadata-only verification.

Administrator SQL review: CREATE on the schema alone does not confer ownership or
authority over all schema-level revocations. Schema ownership is the preferred
solution, not membership in postgres or a privileged role. ALTER SCHEMA OWNER may
require the receiving owner to have database CREATE under the administrator's actual
privileges. Do not assume the Supabase postgres role can bypass that requirement.
The previous script must abort on transfer failure. Any temporary privilege needed
to perform transfer requires a separate reviewed, transaction-scoped administrator
procedure with revocation before commit; do not grant persistent database CREATE.
Pre-existing schema creation checks must also be confirmed in rehearsal. Keep the
migrator NOLOGIN until the separately approved access window. PUBLIC-derived TEMP
remains a documented residual capability; do not change PUBLIC grants globally.

After the one approved launcher invocation, verify history in
winwincod_dev._prisma_migrations with matching checksum and successful completion;
16 application tables, six enums, 21 application indexes, 15 application PKs and
zero FKs; RLS on all application tables; expected ownership; API access excluded;
no application objects/history newly introduced into public. Metadata-table indexes
are additional and must be counted separately. Record sanitized timestamps/results.
Only then attest history placement. Restore NOLOGIN, invalidate temporary credentials
and verify sessions closed. Never assume NOLOGIN terminates existing sessions.

## D2-A private namespace update (not deployed)

The initial migration has never been applied; its revised checksum supersedes D0.
Models/enums remain unchanged. `supabase-dev-sql.mjs` transforms installed Prisma
6.19.2 empty-to-datamodel SQL deterministically: schema/table/type qualification,
enum column references and index table targets. Index names inherit table namespace
in PostgreSQL. Normal regeneration refuses a different existing artifact.

Offline commands:

```powershell
node scripts/supabase-dev-env.mjs generate-initial
node scripts/supabase-dev-env.mjs validate
node scripts/supabase-dev-env.mjs check-sql
node scripts/supabase-dev-env.mjs verify-namespace
node --test scripts/test-supabase-dev.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

### Compatibility evidence and limits

Installed Prisma CLI/client are 6.19.2. Local validation accepts the unchanged
PostgreSQL datamodel. A separate offline diff with inert schema-selected datasource
placeholders verifies that Prisma 6.19.2 honors the schema URL parameter. Diff
generation is local and succeeds. Qualified SQL is checked and regenerated exactly.
The installed engine contains namespace/search-path and migration-history handling,
but binary markers are NOT proof of behavior. No PostgreSQL parser or database replay
has run. Live `_prisma_migrations` placement, DDL permissions and SQL execution remain
UNVERIFIED. Prisma should select its migration namespace through the connection's
`schema=winwincod_dev` parameter; explicit application DDL qualification alone cannot
ensure history placement. Do not assert compatibility complete before rehearsal.

### D2-B prerequisite and launcher contract

Do NOT run `scripts/supabase-dev-deploy.mjs` during D2-A. It is Windows-only with
the existing installed engine. It takes no arguments, reads no env files, prints
no connection details or raw Prisma output, and rejects inherited DATABASE_URL,
DIRECT_URL or NODE_OPTIONS. Supply secrets only through an approved process-secret
mechanism. It cannot independently verify the provider branch through a URL.

Both development URLs must be the SAME approved migration connection, use the
private schema and TLS verify-full, and match privately pinned host/database/user.
No unreviewed connection parameters are accepted. A separate runtime role/URL is
future work. The source root env remains untouched. Do not log environment dumps.

Required gates in the example file are deliberately empty. The approval literal is
`D2-B-EXPLICITLY-APPROVED`; three verification flags require exact `true`, and the
approved SHA256 must equal the final migration bytes. These are owner attestations,
not substitutes for evidence. Before enabling them:

1. Owner approves exact target alias, namespace, migration role, network path and SQL.
2. Admin provisions schema/role separately. Require schema ownership/DDL only within
   the intended namespace, no superuser/database CREATE/role management capability.
3. In an owner-approved disposable Supabase target rehearse the exact schema-selected
   Prisma deploy. Verify history resides in winwincod_dev, not public, and that all
   inventory/security assertions pass. Rehearsal itself needs live mutation approval.
4. Privately verify target equivalence and exclude winwincod_dev from exposed API
   schemas. Verify existing grants/default grants and API role memberships.
5. Approve recovery and credential retirement, then authorize the actual target.

The future launcher runs only the installed CLI `migrate deploy --schema` against
the isolated schema, with credentials in child environment, isolated cwd and no
shell. It captures diagnostics and stops after two minutes. A timeout may leave
partial migration state: never assume rollback or retry automatically.

### Security limitations

RLS is enabled without policies; no FORCE RLS. Table owners/bypass roles can bypass
RLS. Do not use the migration owner as the long-term application role. No runtime
policy or grant is authorized here. Revocations do not prove absence of privileges
inherited from other roles. Default privilege statements affect the executing creator,
not every possible creator. Supabase API exposure is an external setting and remains
unverified; SQL alone cannot guarantee it. Provider roles anon/authenticated must exist
for these statements. All security changes target only the private namespace.

Keep the initial namespace free of unrelated objects: ALL TABLES revocations act on
every table in that namespace. No backup or restore readiness is established. Stop
on pre-existing conflicts. Any destructive cleanup or metadata resolution requires
separate approval. Preserve failed-state evidence and rotate/disable migration
credentials after the approved deployment window; NOLOGIN does not close sessions.

Status: offline artifacts only. Nothing has been applied to Supabase or Neon.

## Local preparation

Requires the existing Prisma CLI and engine version 6.19.2. No installation or
download is allowed. Run from the repository root:

```powershell
node scripts/supabase-dev-env.mjs schema-parity
node scripts/supabase-dev-env.mjs validate
node scripts/supabase-dev-env.mjs generate-initial
node scripts/supabase-dev-env.mjs check-sql
node scripts/supabase-dev-env.mjs verify-namespace
npx --no-install tsc --noEmit --incremental false
```

The wrapper allows the listed named offline operations (not typecheck).
It does not load `.env.supabase-dev`, start the app, generate a client, or accept
arbitrary Prisma arguments. It uses an isolated temporary working directory,
a sanitized child environment, inert loopback datasource placeholders and an
explicit installed schema engine. No database-source diff or shadow database is
used. Raw child diagnostics are withheld to prevent accidental secret disclosure.
Generation refuses to overwrite a differing existing migration. Repeated output
must be byte-identical. The fixed initial directory is an artifact identifier,
not evidence of execution time.

The development schema is identical to `prisma/schema.prisma` except its two
datasource environment variable names. The parity check preserves quoted literal
contents while ignoring comments and formatting. Every schema change must update
both copies and receive review. SQL checks cover statement allowlisting, expected
table/enum identities, key/index counts and forbidden syntax. They do not replace
column-by-column SQL review or a PostgreSQL replay test.

## Preserved configuration and history

Root `.env`, runtime schema and historical `prisma/migrations` remain unchanged.
The latter is MySQL history and must never be replayed against PostgreSQL.
The PostgreSQL lock and migrations live beside the isolated development schema.
No logistics additions or 20/30 MAD financial changes are included.

The example file contains empty placeholders only. A future secret-bearing
`.env.supabase-dev` is ignored. The current offline wrapper deliberately cannot
load real targets. A live wrapper requires a separate implementation review.

Next.js development normally resolves process variables before development-local,
local, development and root env files. Prisma CLI uses different env discovery.
Do not assume `.env.local` controls both tools. Future runtime isolation must
explicitly inject both approved development connection variables into a separate
checkout/process without fallback to root Neon credentials. Do not paste URLs in
chat, arguments or logs.

## Required approvals before any live work

1. Owner identifies the development project, branch/database and namespace
   privately, assigns an alias, and confirms runtime/direct target equivalence.
2. Separate read-only authorization names operator, existing restricted account,
   approved client/network, catalog queries, evidence retention, 15-minute session,
   10-second statement and 2-second lock limits. Abort on mismatch or timeout.
3. Catalog verification establishes namespace contents, migration metadata,
   permissions and API exposure. A new provider project is not an empty server.
4. Owner approves exact SQL checksum, target, execution role and application window.
   A separately reviewed live launcher may then select ONLY the isolated schema
   for migration application. The D0 wrapper rejects deploy and all other database
   commands. Never use the historical default migration path, reset, db push,
   migrate resolve, or the existing seed script as an initialization shortcut.

Generated SQL explicitly targets `winwincod_dev`. It enables RLS on all 16 tables,
revokes PUBLIC/anon/authenticated schema and table access, and revokes default table
grants for the migration creator. API exposed-schema settings require live verification.

`relationMode="prisma"` intentionally yields no database foreign keys. Direct SQL
can create orphans; declared Prisma cascades are not database cascades. UUID/CUID
and updatedAt behavior must be reviewed as client behavior, not assumed triggers.
No synthetic historical stock/accounting records should be inferred.

## Later validation and synthetic tests

After separate isolated-database mutation/test approval, replay this migration,
compare all tables, columns/defaults, six enums, 21 indexes (eight unique), 15 primary
keys and zero FKs, and verify actual migration metadata. Use synthetic identities,
supplier/products, orders, wallets and auth fixtures. Verify uniqueness, decimal
round-trips, nullable relations, Prisma timestamp behavior, and unchanged 20/30 MAD
calculations. No carrier calls, production copies or automatic seed execution.
Cleanup requires explicit approval too. No backup or restore has been verified.

## Failure and rollback

On local validation failure stop; do not install tools or retry against a database.
On future live identity mismatch, conflicting tables/history or partial migration,
stop and retain sanitized evidence. Do not mark a migration applied, delete metadata
or blindly rerun it. Disable the isolated development process to roll back runtime
selection; preserve Neon configuration. Dropping/recreating any namespace, fixture
cleanup, or restore requires separate authorization. Returning to Neon does not
reverse changes made to Supabase.
