# Session Pooler and authentication-only test

Status: local implementation and offline tests only. No live connection, SQL,
credential change, LOGIN change or migration is authorized or performed.
Actual role state, project identity, CA provenance and live TLS remain UNVERIFIED.
This procedure supersedes the older direct-only restrictions in supabase-development.md.

## Mandatory private owner configuration

Supabase explicitly documents shared-pooler custom-role routing as
`[ROLE].[PROJECT-REF]`, and session mode on port 5432:
[connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres),
[tenant routing](https://supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found).

Both helpers share offline validation in `scripts/supabase-dev-connection.ps1`:

| Pin | Session Pooler requirement |
| --- | --- |
| Method | `session-pooler` |
| HostName | `aws-0-eu-west-1.pooler.supabase.com` (owner's Connect panel) |
| Port | `5432` |
| Database | `postgres` (database name, never the test role) |
| ProjectRef | Mandatory owner-supplied rehearsal reference |
| ProjectVerified, TargetVerified, SecurityVerified | Each exact `true` after actual verification |
| CaPath | Mandatory absolute Windows path to trusted PEM CA outside source control |
| CaSha256 | Mandatory lowercase SHA256 of the approved file's bytes |
| CaVerified | Exact `true` after private provenance/trust review |

The routing username is derived as
`winwincod_dev_migrator.<owner-verified-rehearsal-project-ref>`.
No project ref or CA is prefilled. These flags are owner attestations, not proof.
Compare organization, project and project ref in the authenticated Dashboard with
trusted owner records. Neither DNS, a regional pooler certificate, nor a database
called postgres proves the mapping to winwincod-rehearsal.

Download the server root CA through that project's authenticated Database settings:
[Supabase psql pooler TLS instructions](https://supabase.com/docs/guides/database/psql).
Keep it in an administrator-controlled directory protected against replacement.
Compute its byte digest locally with `Get-FileHash -LiteralPath '<CA path>' -Algorithm SHA256`.
Helpers reject missing/relative, malformed, expired, non-CA, linked or digest-mismatched
files. Local parsing and hashes establish integrity, not provider trust. No CA is
automatically downloaded or installed in a trust store.

Direct mode remains available explicitly: `db.<ProjectRef>.supabase.co`, port 5432,
owner-approved database, unsuffixed `winwincod_dev_migrator`. There is no fallback.
Transaction pooler mode, port 6543, other clusters and privileged roles are rejected.

## Authentication-only helper: separate live approval required

Only after separate live authorization, use a trusted PowerShell 7 interactive
console with recording, transcripts and debug tracing disabled:

```powershell
pwsh -NoProfile -File scripts/supabase-dev-auth.ps1
```

Enter only the nonsecret pins above, then the distinct live approval literal
`AUTH-ONLY-EXPLICITLY-APPROVED`. Never enter a password or URI at these prompts.
Approval of local code does not authorize this invocation. Deployment approvals
are not accepted as authentication approval.

The helper starts only `C:\Program Files\PostgreSQL\17\bin\psql.exe`, without
a shell or deployment imports. psql `-W` collects the password with hidden console
entry; PowerShell never receives it. No password enters arguments, environment,
source or history. `-X` skips startup files, `PGPASSFILE=NUL` blocks password-file
use, and the allowlisted child environment excludes inherited PG settings,
service files, runtime URLs and NODE_OPTIONS. Parent environment is unchanged.

libpq uses `sslmode=verify-full`, explicit `sslrootcert=CaPath`, and
`gssencmode=disable` so GSS encryption cannot bypass TLS verification.
Startup options set `search_path=winwincod_dev`, statement timeout 10 seconds,
lock timeout 2 seconds and idle-session timeout 15 minutes. Connect timeout is
10 seconds; the helper kills its psql child after the total 15-minute window.
Pooler forwarding of startup options remains a live compatibility check: stop
on rejection or schema mismatch, without adding SQL or retrying.

The fixed command runs exactly once and psql exits automatically:

```sql
SELECT current_user, session_user, current_database(), current_schema();
```

The helper accepts only exit status zero and exactly one CSV result row with both
users `winwincod_dev_migrator`, approved database (`postgres` for session mode),
and schema `winwincod_dev`. stdout is checked in memory; only a sanitized result
is printed. Normal psql stderr and its hidden password prompt remain on the console.
There are no SET statements, catalog queries, extra identity queries or migrations.
Stop on any failure; no automatic retries or role/endpoint fallback.

Administrator provisioning is separately authorized and is never done by the helper.
Confirm existing restricted attributes/memberships, schema ownership/USAGE and
Data API exclusion using previously approved evidence; new catalog queries need
their own approval. Keep NOLOGIN until the approved window. In an existing,
authorized administrator psql session on the independently verified target with
strict TLS, use SCRAM password encryption, a UTC VALID UNTIL at most 15 minutes
ahead, and `\password winwincod_dev_migrator` with a unique temporary password.
Enable LOGIN only for that window. Never place a literal password in SQL, SQL
Editor history, shell history, URLs, env files or logs; review verifier logging too.
[PostgreSQL password command](https://www.postgresql.org/docs/17/app-psql.html)

Administrator approval must include retirement on success or failure: restore
NOLOGIN, invalidate the password and independently verify sessions closed.
Expiry, NOLOGIN and closing the psql client do not prove pooled backends closed.
Supavisor can briefly cache authentication information after password changes.
Any session inspection/termination or pooler changes need separately approved scope.

## Deployment launcher: not an authentication tool

`supabase-dev-handoff.ps1` still starts migration deployment. NEVER use it for
the authentication test. Both handoff and JS launcher now enforce the explicit
direct/session branches, mandatory CA pins, and every existing rehearsal alias,
checksum, first-attempt/history-placement, security, inherited-runtime-variable,
migration inventory and deployment approval gate.

Guarded input URLs require exactly one of each: `schema=winwincod_dev`,
`sslmode=verify-full`, `sslaccept=strict`, `sslcert=<encoded absolute CA path>`.
Both URLs must match. Unknown/duplicate parameters, TLS weakening or altered
identity/host/database/port are rejected. Session mode does not enable pgbouncer mode.

Prisma 6 uses a different TLS dialect from libpq. After validation, only the
child URL maps verify-full to documented `sslmode=require`, retaining
`sslaccept=strict` and `sslcert` for certificate/hostname verification. This
requires encryption AND verification; bare require is never accepted as input.
Do not assume Prisma interprets libpq verify-full or sslrootcert.
[Prisma 6 TLS documentation](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)
and [installed engine source](https://github.com/prisma/prisma-engines/tree/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/quaint/src/connector/postgres)
support this translation. Installed schema-engine reports revision
`c2990dca591cba766e3b7ef5d9e8a84796e47ab7`.

Offline checks validate URL construction and guards, not TLS handshakes, rejection
of hostile servers, actual pooler authentication, migration permissions or history
placement. These remain UNVERIFIED. A successful psql test does not validate Prisma.

## Offline validation

```powershell
node --test scripts/test-supabase-dev.mjs
pwsh -NoProfile -File scripts/test-supabase-dev-handoff.ps1
pwsh -NoProfile -File scripts/test-supabase-dev-auth.ps1
```

These tests construct plans and inject a handoff stub; they never start psql, the
deployment launcher or a transport. Ephemeral synthetic/public CA fixtures do not
assert real trust. No certificate-store changes or real credentials are used.
SQL artifacts, application runtime configuration and root env are unchanged.

Next owner action: privately supply independently verified rehearsal project
reference and trusted CA path/digest; this is configuration evidence, not live approval.
