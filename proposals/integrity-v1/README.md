# Integrity v1 — unexecuted proposal

**DO NOT deploy these files or copy them into an active migration directory yet.** PostgreSQL syntax, transactions, privileges and adoption have NOT been tested on a database. Runtime adapters do not exist. Nothing in this directory activates new financial behavior.

The complete rationale, verified runtime evidence, owner decisions and NO-GO assessment are in [the architecture report](../../docs/financial-inventory-integrity-architecture.md).

## Exact artifacts

- `schema.proposed.prisma`: full current schema plus new `Fi*` models mapped to `fi_*` tables; isolated datasource names and generator output. Existing runtime schema is untouched.
- `schema-manifest.json`: field/type/index/unique/FK inventory for the additive models. SQL FKs are deliberate even though the copied legacy schema retains relationMode prisma. Future schema tooling must preserve these SQL-managed constraints, triggers, functions and ACLs.
- `baseline-manifest.json`: SHA256 of both local schema/history lineages; actual deployed history explicitly UNVERIFIED.
- `sql/000_readonly_preflight.proposed.sql`: future read-only catalog/history/data checks, not a repair script.
- `sql/001_expand.proposed.sql`: additive tables, indexes, unique keys, tenant FKs, private-object ACLs. No data backfill or money/stock openings.
- `sql/002_constraints.proposed.sql`: immutable facts and identity guards; deferred journal/wallet/stock/quantity/settlement invariants and operation closure checks.
- `sql/003_kernels.proposed.sql`: internal Serializable operation claim, exact text-money parser, wallet, reservation, stock, inspection and adjustment kernels. No grants to application callers.
- `sql/004_fences_and_privacy.proposed.sql`: activated legacy writer fences, approval coupling and ACL revocation. Old balance/stock fields become frozen; there is no dual-write projection.
- `sql/005_role_contract.proposed.sql`: separate NOLOGIN owner, restricted runtime-role checks, ownership transfer and scoped owner lock/read permissions. It does not create production roles or provide public business RPCs.
- `src/integrity-v1/` (repository root): pure exact-money/state/reconciliation code and injected batch-payment transaction contract. No database adapter or runtime import.

## Migration and cutover sequence — separately authorized future work

1. DBA inspects actual PostgreSQL catalog and `_prisma_migrations`, including schema names, roles, extensions, RLS, grants, dependent services, null/orphan/invalid legacy records and unapplied migrations. Compare both local histories with checksums. Root history says MySQL while runtime provider is PostgreSQL. Do not relabel the lock, mark unknown migrations applied, run MySQL SQL on PostgreSQL or apply the development initial migration over populated production tables. Approve a canonical PostgreSQL baseline and migration location first. No automatic baseline repair is proposed.
2. Review every SQL file against the chosen PostgreSQL version (minimum proposed 15), baseline and policies. Preflight requires explicit `winwincod.integrity_schema` and `winwincod.integrity_baseline_approval` session settings. Role script also requires the settings named in that file. These identifiers/approvals must come from the release runbook, never inferred from environment secrets. Scripts use explicit BEGIN/COMMIT, timeouts and a selected trusted schema. Expand rejects existing `fi_` objects, including partial/foreign prior installations: investigate rather than rerun blindly.
3. Apply 001 through 005 in order ONLY to an authorized disposable synthetic environment first. Each file is its own transaction. Failure must roll back that phase; inventory already committed prior phases before retry. No script seeds evidence, policy approval, opening funds, stock, costs, payments, settlements or activation timestamps. New objects remain inaccessible to runtime users. SQL-managed invariants must not be lost to later Prisma drift reconciliation.
4. Implement generated-client/SQL adapters for every `PaymentTransaction` method, snapshots on newly created lines, all wallet and stock writers, withdrawal/payout orchestration, settlement evidence ingestion and scoped read/reporting adapters. Expose only permissioned business commands with server-derived actor and payload binding. Never grant arbitrary caller access to the internal kernels. Add approved role/grant lifecycle, evidence encryption/retention and failure/retry instrumentation. These steps are NOT IMPLEMENTED.
5. Owner signs capture/pricing, recognition, return/refund, withdrawal, reservation, settlement and opening policies. Unknown historical costs stay UNKNOWN. Preserve historical orders/transactions/profits; opening evidence establishes the new projection boundary, not a fictional historical ledger. Each opening ledger account requires an attested amount and entity identity. Establish a balanced opening trial balance and documented differences outside normal cash operations; do not silently manufacture balancing funds.
6. Reconcile legacy requests with existing effects. Quiesce **all** writers and jobs during scoped activation. Active wallet checks reject unmatched pending legacy withdrawals; active stock checks reject old PROCESSING/SHIPPED obligations. Drain/reconcile these under a separately approved plan, without forcing statuses or mass canceling records. Verify physical stock and opening evidence. Cut over only a reviewed resource cohort with all readers and writers ready; no old/new mixed writer period. Activated old fields are stale and fenced, not synchronized.
7. Run every [staging verification](STAGING-VERIFICATION.md) case, then browser/mobile and operational rehearsal. Obtain explicit release approval before any production migration or activation. None is authorized or executed by this task.

## Recovery and reversibility

Before activation, retain additive private objects on application rollback; no destructive down migration is supplied. Dropping new tables could destroy audit/evidence even if application feature flags are off. After the first financial or stock event, never resume old writers against frozen legacy balances. Use forward repairs with compensating, linked journals/movements and evidence; immutable facts remain intact. Revoked policy/grant blocks future effects rather than editing history. Settlement rematching requires reversal/revocation first. An insufficient available balance during reversal is an unresolved debt policy, not permission to go negative.

Rehearse backups, restore and point-in-time recovery on the disposable instance. Recovery of an entire database is an incident procedure requiring quiescence and external-payment reconciliation, not a substitute for an accounting reversal. Lost response: query the existing operation receipt and retry the same business identity/payload. Serialization/deadlock retry restarts the WHOLE transaction; never repeat an external transfer as a blind DB retry. UNKNOWN payout remains held until evidence resolves it.

## Offline validation, 22 October 2026

PASS: 181 offline tests, 0 failures; TypeScript `--noEmit --incremental false`; targeted ESLint on the two isolated TS modules, two new test files and three proposal utilities (zero errors/warnings). PASS: installed Prisma schema validation in an OS temporary project with dummy loopback URLs, without connection or root .env discovery. Prisma reports relationMode indexing recommendations; SQL manifest tests verify a usable explicit index/unique prefix for every new FK. Query plans still require PostgreSQL verification.

```powershell
node --import ./tests/shipping/offline-loader.mjs --test tests/finance/integrity.test.mjs tests/finance/manual-topup.test.mjs tests/shipping/livcash.test.mjs tests/seller/workflows.test.mjs tests/seller/phase2.test.mjs tests/seller/units-review.test.mjs tests/seller/launch-readiness.test.mjs tests/integrity/architecture.test.mjs tests/integrity/proposal.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\eslint.cmd src/integrity-v1/domain.ts src/integrity-v1/payment-contract.ts tests/integrity/architecture.test.mjs tests/integrity/proposal.test.mjs proposals/integrity-v1/generate-proposal.mjs proposals/integrity-v1/validate-schema-offline.mjs proposals/integrity-v1/rebuild-constraints-offline.mjs
node proposals/integrity-v1/validate-schema-offline.mjs
```

`generate-proposal.mjs` regenerates the full Prisma copy, expand SQL and manifests from local schema/model declarations. It does not regenerate kernels or fences. `rebuild-constraints-offline.mjs` reconstructs CHECK/trigger declarations while retaining the first definitions of the 21 constraint functions; review its diff, do not treat it as a SQL parser. Generation uses no database. Structural tests explicitly check unique functions and balanced dollar quoting after an interpolation defect was found and corrected during preparation. Static tests and mocks prove neither SQL syntax nor lock behavior. Full build/repository lint, actual PostgreSQL execution, migrations, production data validation and browser E2E were NOT run.
