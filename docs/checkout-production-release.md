# Checkout production release candidate

2026-10-23. Repository branch: `preview-phase6`; HEAD/Preview `babb2f0`; local `main` is `eca1690b9ad66a0bf4f74aec287928f7705be1bb`. No remote fetch was performed, so hosting/remote branch state is not independently verified. No commit, push, merge, branch switch or deployment was performed. Production environment, credentials, active Prisma schemas/migrations and database data were not modified. No database/carrier/bank connection was made. An initial isolated-build environment-discovery defect and its correction are documented below.

## Release decision

**BLOCKED for direct production deployment of `babb2f0`.** That commit enables the new bulk confirmation operation before isolated PostgreSQL/browser verification. The local guarded UI-only candidate below removes that exposure while keeping the checkout design. It is prepared for review and Preview smoke testing; no production-ready commit or exact deployed artifact has been created automatically.

Production can use the reviewed guarded candidate after successful Preview/browser smoke testing and the normal release checks. Existing main financial deficiencies remain a separate platform NO-GO; this UI release does not fix, certify or expand those operations. Do not describe historical costs, holds, reservations or carrier settlement as implemented.

## Exact comparison with main

`main...preview-phase6` contains one commit, `babb2f0`, changing 17 files (686 insertions, 75 deletions before the local guard changes):

| Change | Exact files |
|---|---|
| Checkout design, translated steps, responsive summary, inline feedback and non-UUID success cards | `src/app/(dashboard)/seller/orders/checkout/page.tsx` |
| Draft selection/pagination/outcomes; now individually confirmed in guarded candidate | `src/app/(dashboard)/seller/orders/drafts/page.tsx` |
| Optional SKU propagation/product typing; quantity logic retained | `src/app/(dashboard)/seller/orders/new/page.tsx`, `src/lib/cart.ts` |
| Existing product thumbnails, selected/option image state and fallback | `src/components/seller/ProductPicker.tsx`, `src/components/seller/ProductThumbnail.tsx` |
| Optional localized city placeholder/form styling | `src/components/ui/CitySelect.tsx` |
| Arabic/French checkout and draft copy | `src/messages/ar.json`, `src/messages/fr.json` |
| Seller-scoped read includes product image/SKU only, not supplier cost | `src/app/api/seller/orders/drafts/route.ts` |
| New bulk transition implementation — now disabled | `src/app/api/seller/orders/drafts/submit/route.ts`, `src/services/draftConfirmationService.ts`, `src/lib/draft-selection.ts` |
| UI, allocation/retry and translation regressions | `tests/seller/checkout-upgrade.test.mjs`, `tests/seller/phase2.test.mjs`, `tests/shipping/livcash.test.mjs` |
| Original implementation handoff | `docs/seller-checkout-ui-upgrade.md` |

There is **no branch delta** to existing order creation, seller single-order status, batch review/payment, warehouse dispatch, delivery/return settlement, wallet approval services, dependencies or active schema/history. Separate pre-existing local Phase 6 edits are excluded, not silently folded into this release.

## Production guard implemented locally

- New `src/lib/checkout-release.ts` has `BULK_DRAFT_CONFIRMATION_ENABLED = false`. It is not an environment/public flag that can accidentally enable an unverified operation. A later reviewed source change and isolated DB tests are required to enable it.
- `src/app/api/seller/orders/drafts/submit/route.ts` authenticates first, then returns 503 before reading the body or invoking the bulk service.
- `src/services/draftConfirmationService.ts` independently denies the operation before receipt/database access. Direct service invocation cannot bypass the HTTP guard.
- `src/app/(dashboard)/seller/orders/drafts/page.tsx` hides bulk selection/submit controls in the release and shows one confirmation button per eligible draft. It calls the existing main `PATCH /api/seller/orders/[id]/status` with only `PENDING_CONFIRMATION`. No loop dispatches the selected set through individual requests, and no new batch behavior is simulated.
- Single confirmation requires a user confirmation, synchronous duplicate-click lock and a verified success response. Network/5xx/malformed success leaves the order visible with UNKNOWN outcome and disables new sends until a successful fresh list read. There is no blind same-operation replay against an endpoint without replay receipts.
- AR/FR single-action copy, responsive individual buttons and six new guard/fallback regressions added. Dormant bulk tests explicitly inject an enabled fixture; separate tests prove the actual shipped policy, HTTP endpoint and service are disabled.
- Removed an existing module-level environment diagnostic in `src/app/api/auth/[...nextauth]/route.ts` that printed database URL metadata/prefix during builds. GET/POST handler wiring and authentication behavior are unchanged; a new regression rejects diagnostic environment reads/logging at route initialization. No credential values are recorded in this report.

The UI and new guard module must be released together. Deploying only the existing `babb2f0` commit, or omitting the server/service guard patches, does not produce this candidate.

## Audit of every order-effect action

All existing writers below match local main byte-for-byte in the selected release, except the new disabled bulk endpoint/service. "Retained" means existing source behavior, not independently verified production transaction guarantees.

| Action / entrypoint | Guard and effect | Release disposition |
|---|---|---|
| Seller `POST /api/seller/orders/create`, `/create-bulk`, `/import` -> `orderSubmissionService:createDraftSubmission` | Current SELLER, server-derived seller ID, strict customer/quantity/COD and exact per-SKU allocation, seller/key/payload receipt. Creates DRAFT rows + history; aggregate stock check only. No wallet write/reservation/dispatch. | Retained main writer. Checkout still posts to existing create-bulk; new summary validates IDs before clearing original cart. |
| Seller `PATCH /api/seller/orders/[id]/status` | Current SELLER, seller-owned order, `sellerTransitions`, unbatched conditional status claim + history. Draft -> pending confirmation and subsequent allowed early transitions only. | Retained main endpoint for individual draft action. Existing offline ownership/transition tests retained; no real DB guarantee asserted. |
| New `POST /api/seller/orders/drafts/submit` -> `submitDraftsForConfirmation` | Proposed transactional multi-draft claim/history/audit/replay. | **DISABLED at route and service.** No production invocation possible through this release path. |
| Staff `POST /api/call-center/update-status` | Current CALL_CENTER/ADMIN, shared early-status allowlist, no batch, conditional claim/history. Staff role has existing operational cross-seller access, not seller role access. | Retained; cannot pay/ship/settle through status spoofing. |
| `callCenterService:updateOrderItemStatus` | Unguarded generic helper; source scan found definition only, no runtime caller. | Not wired or expanded. Must not become a new entrypoint. |
| Seller `POST /api/seller/batches/create` -> `orderService:createBatch` | Owned confirmed unbatched rows; minimum five **units**, aggregate stock check; unpaid submission, per-order 20 MAD fee and audit receipt. | Retained. No automatic payment, reservation or dispatch. |
| Admin `POST /api/admin/batches/review` -> `reviewBatch` | ADMIN, reason, exclusive decision receipt, unpaid/awaiting-review eligibility; rejection cancels without debit/refund/restock. | Retained. Approval remains distinct from payment. |
| Seller `POST /api/seller/batches/pay` -> `payBatchFromWallet` | Seller-owned batch, explicit Admin approval, valid five-unit membership/stock, conditional paid claim/debit, signed ledger and processing history. | Retained unchanged. Pending withdrawal holds/reservations remain absent; PostgreSQL guarantees unverified, paid replay does not reconcile ledger. No new payment call added by this UI. |
| Seller `POST /api/seller/orders/ship-all` | Existing retired endpoint rejects with 409 after role guard. | Still blocked; no direct draft shipping. |
| Admin `POST /api/admin/orders/dispatch`, `/api/admin/logistics/ship` -> `dispatchOrders` | ADMIN + existing manual-dispatch grant + reason; paid PROCESSING batch, real approval and batch/order seller agreement; conditional stock decrement/status + audit/history. | Retained; no new grant/env value or carrier call. `logistics/ready` is a read filtered by paid + approval evidence. |
| Admin `POST /api/admin/orders/deliver` | ADMIN, SHIPPED claim, positive COD and current product-cost validity; existing clamped profit formula/20 MAD fee + wallet/ledger. | Retained unchanged. Mutable cost and no remittance linkage remain pre-existing P0 concerns; not historical COGS or verified realized settlement. |
| Admin `POST /api/admin/orders/return` | ADMIN, SHIPPED -> RETURNED conditional claim; history and inspection-pending audit. | Retained; **no stock increment/refund**. Old `logistics/update-delivery` financial/restock path remains rejected. |
| Admin product POST/PUT/DELETE | ADMIN writes master prices/absolute stock; deletion assumes referenced-data protection that is not verified on deployed PostgreSQL. | Retained main behavior, no new adjustment/warehouse operation. Absolute stock edits remain pre-existing inventory/audit risk. |
| Deposit/withdrawal approvals -> `walletApprovalService:decide` | ADMIN; request claim, signed ledger consistency and balance/audit transaction; partial legacy effects fail closed. | Retained. Whole-system holds/business funding evidence and real DB isolation remain unverified. |
| Admin top-up -> `manualTopupService:manualTopup`; seller deposit/withdraw request creation | Existing role/input/idempotency guards as applicable. Withdrawal requests still lack durable holds/immutable destination. | Retained main versions. Local Phase 6 RIB edit is excluded from the UI candidate. No new wallet operation enabled. |
| `walletService:creditWallet/chargeWallet/deductForOrder/creditProfit` | Generic helpers; no current route callers found. | Not wired or expanded; not suitable new idempotent financial entrypoints. |
| Phase 6 `src/integrity-v1/*` | Injected draft interfaces only, no DB adapter or runtime route callers. | Existing main state retained, local Phase 6 changes excluded. No snapshots/holds/reservations/loss/reconciliation activation. |
| LIVCASH modules | Default-disabled submission/tracking configuration and no runtime financial/dispatch route integration. | No API capability, settlement evidence, grant or transport activation assumed. |

Existing zero-balance wallet creation during account approval is also unchanged; it is not a payment, inventory reservation or order transition.

## Validation and safe build

- **212 release-scoped offline tests passed**, zero failed. This excludes the 25 unrelated uncommitted Phase 6 tests. **237 complete workspace offline tests passed**, zero failed. Seven new tests cover the actual disabled policy, HTTP/service denial before operation access, single-endpoint fallback, double clicks, uncertain-response refresh requirement, malformed response rejection and absence of credential diagnostics in auth route initialization.
- TypeScript `--noEmit --incremental false`: passed. Independent checking is required because existing `next.config.ts` has `typescript.ignoreBuildErrors: true`; that setting is unchanged.
- Targeted lint covering the 17-file implementation's source/tests plus new guard/build script: zero errors, one existing product-selection `<img>` optimization warning.
- Whitespace check: passed. No changes to dependency manifests, active schema/migrations or root environment are part of the candidate.
- The offline compile-mode rehearsal passed. The corrected `scripts/check-checkout-release-build.mjs` reconstructs local main in an OS temporary project and overlays exactly 15 allowlisted runtime release files; it excludes local Phase 6/configuration files. It reuses installed dependencies, never runs `prisma generate`, and inherits only a minimal OS environment plus synthetic unreachable loopback database URLs. Network requests and `.env*` reads are denied in child processes, with a fail-closed preflight before Next starts. Only in the temporary copy, Prisma is replaced with a throwing proxy and Google font loading with local placeholder class metadata. Root environment files are never copied; the corrected run blocks their discovery by generated packages as well.
- `--full` performs a full Next build with the same temporary substitutes. A substituted offline build is **not** a real production auth/database/font integration test and is not a deployable artifact. No `next start`, deployment of the output, browser session or live HTTP/DB call is authorized by the script.

Full isolated build result: **PASS**, exit 0, after environment-read/network guard preflight. Next.js 16.1.6 webpack compiled successfully in 37.3 seconds and generated all 66 static pages. No environment diagnostic was emitted by the corrected auth route. The build used main plus the 15 release runtime overlays and excluded all local Phase 6 changes. Production integration/browser behavior remains unverified.

An initial build-wrapper attempt failed because Windows NODE_OPTIONS consumed backslashes in the preload path. Forward-slash normalization corrected the wrapper. A subsequent full build passed but exposed a generated Prisma dotenv fallback through the shared node_modules junction: the original project environment was discovered despite no copy/inheritance. Network blocking was already active, the temporary database module was a throwing proxy and no DB connection occurred. The wrapper now denies all `.env*` file reads before package loading and uses synthetic loopback URLs; the corrected full build is rerun for the final record. The existing auth URL-prefix diagnostic was removed from the release source. A new test initially trapped ESM interop property inspection rather than database access; its mock wrapper was corrected. No financial behavior or safeguard was weakened to pass these checks.

## Exact candidate file set and exclusions

Release file set = the 17 comparison files listed above, with local guard amendments, plus:

```text
src/lib/checkout-release.ts
src/app/api/auth/[...nextauth]/route.ts
scripts/check-checkout-release-build.mjs
docs/checkout-production-release.md
```

This is **21 files total relative to main**, including tests/docs; 15 are runtime overlays in the isolated build. Do not use a blanket stage-all operation. Exclude the pre-existing unrelated local work:

```text
.claude/settings.local.json
src/app/api/seller/wallet/withdraw/route.ts
src/integrity-v1/operations.ts
src/integrity-v1/staging-support.ts
tests/finance/phase6-wallet-input.test.mjs
tests/integrity/operations.test.mjs
tests/integrity/staging-support.test.mjs
docs/phase6-financial-implementation.md
```

The local configuration must never be included. The other seven files are separate Phase 6 work, not dependencies of the UI release. No file was reverted, stashed or overwritten to exclude it; the build snapshot uses main for all non-allowlisted source files.

## Shortest safe handoff

1. Review the 21-file candidate and confirm the bulk policy remains false in UI, route and service. Keep current financial/inventory routes and existing grants unchanged. Do not deploy `babb2f0` directly.
2. After the owner authorizes version-control/release actions, create a reviewed new commit containing only the candidate. Nothing was committed here. Preview must point to that new SHA, not the earlier bulk-enabled SHA.
3. Run AR/FR desktop/mobile and keyboard smoke tests on the guarded Preview: thumbnail/fallback, 5 and 2+3 allocation, save/recovery/success cards, individual confirmation, UNKNOWN -> refresh, wrong-role/foreign-order denial and bulk route returning 503. Use synthetic data and separately authorized isolated services for mutations; do not run smoke transactions against production just to validate UI.
4. Complete normal build/integration checks in the authorized release environment, verify exact candidate SHA and get explicit release approval. No migration or environment-variable change is required. Only then may an authorized operator promote the guarded candidate to main/production.
5. Re-enable bulk confirmation only in a later reviewed release after real PostgreSQL race/rollback/receipt-retention tests. Do not enable pending Phase 6 financial/stock drafts as part of a UI promotion.

Darija: التصميم الجديد واجد محلياً، والتأكيد الجماعي تسدّ فالسيرفر والخدمة. إرسال المسودات رجع فردي بنفس مسار main، بلا عمليات مالية أو مخزنية جديدة. النشر المباشر ديال babb2f0 باقي BLOCKED؛ خاص commit جديد بالحراسة وQA ديال Preview قبل الترقية.
