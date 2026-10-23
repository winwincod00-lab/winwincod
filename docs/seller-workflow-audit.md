> BUSINESS CORRECTION: The minimum is **5 product units (PCS)** summed across eligible confirmed orders, not five customer orders. Earlier five-distinct-order requirements in this historical report were incorrect and are superseded by [the unit/review correction](seller-units-review-correction.md). Submission is now unpaid and pending separate Admin review; approval, payment and dispatch are distinct. Historical validation counts describe the earlier revision.

# Seller workflow audit and implemented fixes

Current follow-up: [Seller workflow Phase 2](seller-workflow-phase2.md) records subsequent fixes, ranked remaining issues and the latest validation. The results below describe the earlier pass.

Scope: actual Next.js App Router pages, API handlers, services, route guard and `prisma/schema.prisma`. This is an offline code audit. No environment files, database connection settings, schema, migrations, application data or carrier configuration were changed. Existing unrelated workspace changes were preserved.

## Ten highest-impact findings

| Rank | Severity / classification | Evidence before this change | Result |
| --- | --- | --- | --- |
| 1 | P0 VERIFIED BUG: sensitive information disclosure | `src/app/api/debug-env/route.ts:GET` returned a database URL prefix publicly. `src/app/api/seller/catalog/route.ts:GET` included the complete product, exposing supplier cost. `src/lib/auth.ts:authorize` logged connection prefixes and login emails. | Debug endpoint returns 404; catalog selects seller-safe fields; login diagnostic logging removed. |
| 2 | P0 VERIFIED BUG: unrestricted status transitions | `src/app/api/seller/orders/[id]/status/route.ts:PATCH` accepted every enum value. `src/app/api/call-center/update-status/route.ts:POST` accepted caller-supplied status and could increment batch costs repeatedly. | Shared transition policy limits unbatched pre-payment actions. Compare-and-set writes and history run transactionally. Payment, dispatch and settlement cannot be reached through either status handler. |
| 3 | P0 VERIFIED BUG: confirmation/minimum-five bypass | `src/services/orderService.ts:createBatch` accepted one DRAFT order. `src/app/api/seller/orders/ship-all/route.ts:POST` charged 30 MAD and moved drafts directly to PROCESSING without a paid batch. | New batches require 5–500 distinct confirmed unbatched seller orders, aggregate stock checks and sufficient balance. Legacy direct shipping returns 409 without writes. Legacy unpaid batches below five cannot be paid. |
| 4 | P0 VERIFIED BUG: unpaid/repeated/negative-stock dispatch | `src/app/api/admin/logistics/ship/route.ts:POST` lacked payment/state guards and decremented stock on every call. `src/app/api/admin/orders/dispatch/route.ts:POST` could decrement stock below zero. `src/app/api/admin/logistics/ready/route.ts:GET` deliberately omitted isPaid. | Shared `dispatchOrders` requires paid PROCESSING orders, matching batch/seller, conditional sufficient-stock decrements, conditional status claims, serializable transaction, explicit manual grant, reason, history and audit. Ready list requires paid batches. |
| 5 | P0 VERIFIED BUG: return automatically restocks | `src/app/api/admin/orders/return/route.ts:POST` incremented stock immediately. Duplicate legacy update-delivery handler also restocked/refunded from current prices. | Canonical return records RETURNED and inspection-pending audit only; no stock increment. Legacy handler returns 409 and its page redirects to canonical admin orders. Physical inspection/restock workflow remains UNIMPLEMENTED. |
| 6 | P0 VERIFIED BUG: read-then-write financial races | `createBatch`, `payBatchFromWallet` and `src/app/api/admin/orders/deliver/route.ts:POST` could charge/credit after stale checks. | Conditional wallet debits, batch/order claims and transactional history added. Delivery replay cannot reach wallet credit after a failed claim. Remaining deposit/withdrawal races are a blocker; see below. Actual database concurrency is UNVERIFIED. |
| 7 | P0 VERIFIED BUG + UNIMPLEMENTED historical cost snapshot | `prisma/schema.prisma:order` has no historical unit-cost field. `deliver:POST` calculates cost from related product.sellerPrice at delivery time, so product repricing can change profit. | Formula intentionally unchanged. No invented historical values, backfill or schema change. Requires a separate reviewed accounting change before production use. |
| 8 | P1 VERIFIED BUG: broken seller navigation | `SellerOrdersClient` linked to `/seller/orders/[id]`, which did not exist. `MobileNav` linked to nonexistent `/seller/profile`. | Added seller-scoped order detail page with contact, COD, payment, history and next steps. Replaced the seller mobile profile link with batches. |
| 9 | P1 VERIFIED BUG / UX RISK: dashboard failure and no daily queues | `SellerDashboard` displayed skeletons forever after an initial API failure; it showed only period charts, with no route to older actionable orders. | Accessible error/retry and loading states; cancellable chart request; all-time seller-scoped action counts; queue links filter order status across all dates. Date validation added. |
| 10 | P1 VERIFIED BUG / UX RISK: misleading order creation and input | Single-create accepted fractional quantities; import accepted negative quantities and replaced explicit zero COD with suggested price. Checkout described new drafts as confirmed. Product cards labelled pre-fee margin as profit. | Integer/positive quantities, trimmed required fields and Moroccan phone validation; canonical server product names; zero COD preserved on import; exact price default; truthful draft success wording; cart aggregate stock check and pre-fee margin wording. |

## Actual seller journey

- **Login:** `src/app/login/page.tsx`, `src/lib/auth.ts:authorize`, `src/proxy.ts`. Credentials check activation and OAuth creates pending sellers. API helper `getSessionUser` now rechecks current activation/role rather than trusting stale JWT roles. Route proxy still uses JWT claims; immediate revocation of existing server-rendered page access is not fully solved.
- **Dashboard:** `src/app/(dashboard)/seller/dashboard/page.tsx:SellerDashboard` → `src/app/api/seller/analytics/route.ts:GET`. Operational queues are all-time; report charts/profit remain period-based and tenant-scoped.
- **Product creation/catalog:** Sellers browse shared products and save catalog entries; actual product creation is ADMIN-only at `src/app/(dashboard)/admin/products/new/page.tsx` and `src/app/api/admin/products/route.ts`. Seller-authored products are UNIMPLEMENTED, not a broken seller creation route. This patch improves the seller's actual product-to-order form flow.
- **Stock:** `src/app/api/seller/products/route.ts:GET`, `src/app/(dashboard)/seller/orders/new/page.tsx:ProductSelectionPage`. Stock is physical shared stock; there is no reservation model. Drafts and paid batches do not reserve it. UI explains that stock is checked again at dispatch. Concurrent paid batches competing for stock remain an operational risk, although dispatch cannot decrement below zero through the repaired handlers.
- **Incoming orders:** Single, bulk and import routes create DRAFT. Draft page now submits individual orders to PENDING_CONFIRMATION without a charge. No unsafe bulk confirmation was added.
- **Confirmation:** Seller status menu only exposes permitted actions; cancellation asks for confirmation. Call-center handler uses the same pre-payment transition boundary and writes history. Batched legacy confirmation is blocked instead of repeatedly changing batch totals.
- **Shipping eligibility/payment:** `BatchBuilder` → `/api/seller/batches/eligible` → `/api/seller/batches/create` → `createBatch`. Picker displays confirmed orders, quantity, physical stock, individual costs, aggregate shortages, selected count and total before a payment confirmation. The server revalidates eligibility; client display is not authoritative.
- **Warehouse handoff:** Paid batch means PROCESSING, not carrier acceptance. Both manual dispatch APIs use `dispatchOrders`. Manual dispatch does not call LIVCASH or assert carrier acceptance.
- **LIVCASH tracking:** `src/lib/shipping/livcash/client.ts` is still a disconnected, disabled-by-default client. Existing tracking UI/API shows local order data/history. No automatic webhook, tracking-status mapping or order-to-carrier submission was invented. Live integration remains UNIMPLEMENTED/UNVERIFIED.
- **Delivery/return:** Canonical admin actions record conditional status changes/history. Return does not restock. Delivery preserves the existing `max(0, codReceived - currentProductPrice * quantity - 20)` formula. That formula's use of current cost is a documented blocker, not repaired historical COGS.
- **Profit/reconciliation:** Order details distinguish expected COD, received COD and recorded delivered profit, with links to actual wallet entries. `walletService:getWalletHistory/getWalletStats` remain unchanged. Full reconciliation, historical snapshots and physical inspection need further work.

## Files changed for this task

Shared rules and services:
- `src/lib/order-policy.ts` — seller transition boundary and distinct minimum-five selection validation.
- `src/services/orderService.ts` — eligible paid batches, guarded debits/claims and legacy payment checks; existing 20 MAD batch fee retained.
- `src/services/dispatchService.ts` — shared manual dispatch permission, paid/state/stock guards, history and audit.
- `src/lib/api-utils.ts` — current account activation and role validation.
- `src/lib/auth.ts` — remove credential/connection/login diagnostic logging only.

Seller APIs:
- `src/app/api/seller/orders/[id]/status/route.ts`
- `src/app/api/seller/orders/ship-all/route.ts`
- `src/app/api/seller/orders/create/route.ts`
- `src/app/api/seller/orders/create-bulk/route.ts`
- `src/app/api/seller/orders/import/route.ts`
- `src/app/api/seller/batches/create/route.ts`
- `src/app/api/seller/batches/eligible/route.ts`
- `src/app/api/seller/analytics/route.ts`
- `src/app/api/seller/catalog/route.ts`

Seller UI:
- `src/app/(dashboard)/seller/dashboard/page.tsx`
- `src/app/(dashboard)/seller/orders/page.tsx`
- `src/app/(dashboard)/seller/orders/SellerOrdersClient.tsx`
- `src/app/(dashboard)/seller/orders/[id]/page.tsx`
- `src/app/(dashboard)/seller/orders/drafts/page.tsx`
- `src/app/(dashboard)/seller/orders/new/page.tsx`
- `src/app/(dashboard)/seller/orders/checkout/page.tsx`
- `src/app/(dashboard)/seller/batches/page.tsx`
- `src/components/seller/BatchBuilder.tsx`
- `src/components/layout/MobileNav.tsx`

Operational/security API and UI:
- `src/app/api/admin/orders/dispatch/route.ts`
- `src/app/api/admin/orders/deliver/route.ts`
- `src/app/api/admin/orders/return/route.ts`
- `src/app/api/admin/logistics/ready/route.ts`
- `src/app/api/admin/logistics/ship/route.ts`
- `src/app/api/admin/logistics/update-delivery/route.ts`
- `src/app/api/call-center/update-status/route.ts`
- `src/app/api/debug-env/route.ts`
- `src/app/(dashboard)/admin/orders/page.tsx`
- `src/app/(dashboard)/admin/logistics/page.tsx`
- `src/app/(dashboard)/admin/logistics/update/page.tsx`

Validation:
- `tests/seller/workflows.test.mjs` — actual handlers/services transpiled in memory with strict mocked imports; no real Prisma, auth provider, environment loading or transport.
- `tests/shipping/livcash.test.mjs` — replaced the obsolete L1 whole-file freeze assertion with a check that carrier integration remains disconnected from live financial/dispatch paths. Carrier behavior assertions retained.
- `docs/seller-workflow-audit.md` — this audit.

## Compatibility and operational checkpoints

- New batches retain product cost + **20 MAD/order**. Delivery retains its existing **20 MAD** commission and formula. The unsafe legacy **30 MAD** direct-draft-shipping endpoint is disabled, not repriced or redirected to a different charge. Existing fee values/history were not rewritten.
- Manual dispatch now fails closed unless the authenticated ADMIN's exact ID occurs in the server-controlled comma-separated `MANUAL_DISPATCH_ADMIN_IDS` allowlist. No grant was configured and no environment was changed. Both admin UIs collect the required audit reason. This is an explicit manual permission boundary, not a new carrier capability.
- Paid legacy batches are not backfilled or altered. Legacy unpaid batches require at least five WAITING_PAYMENT orders before payment. Legacy data not meeting these rules needs reviewed remediation; no silent upgrade is performed.
- No automatic retry of financial or dispatch transactions; conflicts return an error for refresh/review.
- Changes are local and reviewable. No deployment was performed.

## Validation and limits

Commands:

```powershell
node --import ./tests/shipping/offline-loader.mjs --test tests/shipping/livcash.test.mjs tests/seller/workflows.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm run lint -- --quiet
```

The offline suite covers transition authorization, seller isolation, minimum/distinct order counts, aggregate stock checks, conditional wallet/order claims, manual permission default-off, paid dispatch, audit/history, no return restocking, delivery replay rejection, unchanged commission/formula, invalid order quantities, explicit zero COD, catalog field exposure and all-time queue scoping.

Mocked transaction tests verify guarded calls and failure paths. They do not establish real PostgreSQL serialization, rollback semantics, transaction timing or live tenant isolation. Full browser/mobile interaction, live authentication, warehouse data, real reconciliation, live database state and LIVCASH behavior remain UNVERIFIED. No Next build was run because it can load root environment and prerender database-backed pages.

## Remaining blockers and next work

1. **P0:** Historical COGS snapshot absent from schema. Review immutable cost capture and historical treatment before changing accounting. Do not infer old cost from today's product price.
2. **P0:** `walletService:approveDeposit/rejectDeposit`, `chargeWallet`, seller withdrawal creation and admin withdrawal approval still contain stale-read/separate-write paths. Concurrent approval can duplicate ledger effects; pending-withdrawal and spendable-balance semantics need a reviewed atomic workflow. No financial readiness claim is made.
3. **P1 UNIMPLEMENTED:** Physical return receipt/inspection and audited restock/refund reconciliation. Returned goods intentionally remain unavailable until this exists.
4. **P1 UNIMPLEMENTED:** Reservation model and visibility across competing paid batches. Stock is rechecked at actual manual dispatch, but payment does not reserve it.
5. **P1 UX RISKS:** Some existing catalog/image-download controls, Arabic-only legacy copy, reference formatting, tracking timelines and unrestricted staff access across sellers still need review. No call-center assignment model exists in the schema. Existing marketplace products are shared by design; seller orders/batches remain tenant-scoped.
6. Broad existing lint debt remains; do not mistake TypeScript/test success for a clean repository lint run.

Next highest-impact workflow: immutable historical cost + idempotent wallet reconciliation, followed by inspected-return disposition. This must include agreed fee/refund semantics and migration review, rather than silently changing profit calculations in a UX patch.

Final offline results:
- PASS: 45 tests (31 seller workflow regressions + 14 existing LIVCASH checks), zero failures.
- PASS: TypeScript `--noEmit --incremental false`.
- PASS: `git diff --check`.
- FAIL: full repository lint, 113 errors remain. A file/rule comparison against HEAD found zero additional lint findings in changed/new implementation and seller-test files; this does not waive the existing lint debt.
- Confirmed no diff to root `.env`, Prisma application schema, dependency manifests, Prisma connection module or authentication connection helper.
- UNVERIFIED: live database workflows, real transaction concurrency, browser/mobile interaction and external carrier behavior.
