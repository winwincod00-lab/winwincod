# Seller unit minimum, customer allocation and Admin review correction

## Correct business rule

The seller minimum is **five product units (5 PCS)**, never five distinct customer orders. Two confirmed eligible orders with quantities 2 and 3 qualify, as does one with quantity 5. Four units do not. Distinct IDs remain required to prevent duplicate counting, with a 500-order request limit independent of the unit threshold. Drafts can be saved below five; only submission for Admin review requires the minimum.

This supersedes earlier seller-workflow audit/phase2 and financial-review references to five distinct orders or automatic paid-batch creation. Their earlier validation counts are historical. No historical records or accounting amounts were changed.

## Verified trace and causes

- Cart (`CartContext`, `lib/cart`) contains product ID, quantity and current display prices; no server cart/purchase model exists. Product ID is the canonical inventory/SKU identity (product.sku is unique); duplicate cart rows for the same product must be aggregated.
- Old checkout created one customer form per cart row with fixed quantity. It could not split 5 units into 2+3 customers. `orderSubmissionService:createDraftSubmission` already persists independent single-SKU DRAFT rows and history under one seller-scoped idempotency receipt. It does not automatically confirm or charge. This remains the persistence path.
- Seller DRAFT → PENDING_CONFIRMATION → CONFIRMED remains explicit. Batched orders cannot use seller/call-center transition shortcuts. Confirmation is not Admin acceptance.
- `order-policy:assertBatchIds` incorrectly demanded at least five IDs; `orderService:createBatch` and `payBatchFromWallet` inherited this. BatchBuilder disabled submission for fewer than five selected IDs. Old creation charged immediately and set PROCESSING: effectively skipped separate review.
- No separate minimum was present in dispatch. Dispatch still accepts a subset of an approved paid batch, while checking each stock decrement, manual grant and reason. The five-unit requirement applies to review submission, not to every warehouse action.
- Admin orders API allowed only PROCESSING/SHIPPED/DELIVERED/RETURNED; Admin UI offered only those tabs and defaulted to PROCESSING. DRAFT, PENDING_CONFIRMATION, CONFIRMED and submitted WAITING_PAYMENT rows were invisible by construction. Actual live data was not inspected; these verified filters explain why earlier states could not appear, not whether any particular production row exists.
- Seller batch list omitted orders, yet its UI expected batch.orders.length. It now fetches actual IDs/quantities/statuses and returns total PCS and review state.

## Implemented behavior

### Multi-customer checkout

Starts with Client 1 and the first SKU quantity. Sellers can change its quantity, add clients with **+ Ajouter un client**, select a SKU for each, enter independent COD and required customer details, remove a client, and redistribute the released quantity. Removing one client preserves every other client's entered data. Mixed-product carts balance each product independently; duplicate cart rows are aggregated. Counters show allocated, remaining and total PCS plus each SKU's balance. The quantity editor blocks fractional/negative/zero and over-allocation; server validation also rejects invalid quantities, unknown products, incomplete customers and any allocation that does not exactly exhaust each cart SKU.

COD starts blank and is explicitly entered per customer; zero remains valid. Product cost display uses that customer's allocated quantity and current cart price and is labelled indicative, not historical COGS or realized net profit. No persisted financial formula changed.

Checkout posts a structured `checkout: { cart, customers }` envelope to create-bulk. The server repeats allocation validation before invoking the existing order submission service. Legacy valid `{orders}` bulk callers remain supported. Cart quantities in this envelope are seller-supplied declarations, not proof of a purchase/reservation: there is no authoritative server cart. Authoritative product existence and aggregate stock are independently checked transactionally by the submission service.

Each supported customer produces one single-SKU order with its own quantity/COD. Orders share the existing submission receipt, not a prematurely assigned paid batch. Seller-scoped UUID Idempotency-Key, normalized fingerprint mismatch rejection, transaction receipt, click lock, original payload retry after uncertain response and selective cart cleanup remain intact. Old draft receipts remain readable; no receipt migration.

**NOT IMPLEMENTED: one customer order containing multiple different SKUs.** Prisma order has one productId/quantity and no OrderLine relation. The UI explicitly supports one SKU per customer order and the server refuses multi-SKU allocations for one customer. Mixed carts can be distributed across separate single-SKU customer orders with separate COD values. It would be unsafe to multiply a customer's COD across rows, arbitrarily split their COD, add extra per-line shipping fees, or store inventory lines in a generic log while dispatch still assumes one product. This is a partial checkout implementation, not a claim of full multi-line support. See migration proposal below.

### Batch submission, review, payment and warehouse

1. `createBatch` verifies seller ownership, unbatched CONFIRMED rows, distinct IDs, positive safe integer quantities, total >= 5 PCS and aggregate physical stock. It calculates the existing product-price × quantity + **20 MAD per order** using Decimal. Creates unpaid orderbatch and WAITING_PAYMENT order/history rows. No wallet access, ledger credit/debit, stock reservation, automatic approval or dispatch.
2. A deterministic seller + sorted-order-ID submission receipt in existing log PK makes repeat/lost-response submissions recover the same batch. This is separate from checkout's Idempotency-Key. Overlapping selections must pass conditional eligibility claims; conflicts fail and roll back.
3. Existing WAITING_PAYMENT is interpreted with a real review audit record: absent decision = PENDING_REVIEW; BATCH_APPROVE = APPROVED awaiting payment; BATCH_REJECT = REJECTED with orders CANCELLED. This is an explicit projection, not a new Prisma enum or inferred approval. The existing log PK `batch-review:<batchId>` is the mutually exclusive durable decision identity. ADMIN-only review API requires a reason. Decision/history writes are in one Serializable transaction. Same decision retry is harmless; opposite decision rejects. Approval does not pay or change to PROCESSING. Rejection cancels the whole unpaid batch without refund, stock change or debit, preserving the batch and order history.
4. Payment requires positive valid total, explicit BATCH_APPROVE, >=5 PCS, all WAITING_PAYMENT, seller ownership and fresh aggregate stock checks. Conditional paid claim, sufficient-balance debit, real ledger and PROCESSING history commit together. An already-paid replay creates no additional charge. Existing pending-withdrawal hold-policy limitations remain unchanged and documented in the financial review.
5. Manual dispatch requires paid PROCESSING rows, explicit BATCH_APPROVE, matching batch/seller, sufficient physical stock, explicit warehouse permission and audit reason. Ready logistics filters for approval as well as payment. Manual dispatch still does not claim carrier acceptance.

All new financial/review operations use existing tables. Audit records are real submission/decision evidence, not simulated financial transactions. **Receipt/decision logs must be retained and protected from mutation/deletion.** A dedicated review model with enforceable relations would be preferable, but is not required to represent these explicit audited decisions in the existing schema.

### State meanings in Admin

| Meaning | Persisted state/evidence | UI |
|---|---|---|
| Seller draft | DRAFT, no batch | Brouillons vendeur |
| Pending seller/call-center confirmation | PENDING_CONFIRMATION | À confirmer |
| Confirmed, not submitted | CONFIRMED, batchId null | Confirmées — non soumises |
| Submitted, pending Admin review | WAITING_PAYMENT, unpaid batch, no decision | En attente de revue Admin; approve/reject whole lot |
| Approved, awaiting seller payment | WAITING_PAYMENT + BATCH_APPROVE | Approuvé — paiement vendeur requis |
| Rejected | CANCELLED + BATCH_REJECT | Annulées / rejetées; explicit rejected badge |
| Paid, warehouse preparation | PROCESSING + paid batch + approval evidence | Existing preparation tab |
| Dispatched / delivered / returned | SHIPPED / DELIVERED / RETURNED | Existing tabs and guards |
| Legacy paid without review evidence | Existing paid state, no invented decision | Historique payé; dispatch blocked pending reviewed remediation |

Admin GET is restricted to current ADMIN accounts and now exposes all existing order states. The default is the review/payment queue. Decisions and batch IDs appear with orders. Failed/stale requests no longer leave orders from a different tab as its active data. No broader seller query access was introduced; batch queries and checkout receipts remain seller scoped. Admin retains existing cross-seller operational permissions.

## Schema/workflow proposals — NOT EXECUTED

- Full multi-SKU customer orders need Order header (customer, COD, shipping/system fees once per customer order) + OrderLine (productId, positive quantity, immutable historical seller/supplier unit-cost snapshots) + submission/customer-order identity. Update all stock, dispatch, cost, returns, batch and delivery consumers together. Define partial shipment/return and COD/fee attribution explicitly. Never guess how to divide customer COD across lines or silently convert per-order fees into per-line fees. Preserve all old single-product orders and historical financial amounts with reviewed compatibility handling; do not backfill unknown COGS from today's prices.
- Dedicated BatchReview state/actor/reason/version/timestamps and unique operation identities could replace the existing durable audit projection after reviewed migration. Preserve current submission and decision receipts. No schema files or migrations were edited/executed.
- Reservation/return inspection/settlement models and wallet-wide available-balance enforcement remain absent; the earlier financial review's blockers still apply.

## Compatibility, limitations and production blockers

- Old automatically paid PROCESSING batches are not automatically approved or modified. They remain visible but cannot dispatch without explicit approval evidence. Current review API deliberately rejects paid legacy batches; a separate reviewed legacy approval/reconciliation process is required before operational use. This is a deliberate fail-closed blocker, not an invented acceptance or refund.
- Legacy unpaid batches also require review and five valid PCS before payment; no silent upgrade or historical rewrite occurs. Existing 20 MAD per-order fees and disabled legacy 30 MAD direct shipping behavior are retained.
- Paid/reviewed batches still do not reserve stock. Payment and dispatch recheck physical stock but cannot guarantee fulfillment across competing batches without the proposed reservation model. Returns remain inspection pending without automatic restock.
- Real PostgreSQL transaction isolation, uniqueness, rollback, race timing, audit retention permissions, browser interaction and live Admin visibility are UNVERIFIED. Offline fixtures serialize and model rollback; they do not prove database concurrency.
- No environment, credentials, Neon/Supabase settings, live database, external API, migration, deployment or application-data writes were used. Only local code/docs and synthetic test fixtures changed. Pre-existing workspace changes were preserved.

## Exact files changed in this correction

Implementation:
- `src/lib/order-policy.ts`
- `src/lib/customer-allocation.ts` (new)
- `src/services/orderService.ts`
- `src/services/dispatchService.ts`
- `src/app/api/seller/orders/create-bulk/route.ts`
- `src/app/api/seller/orders/ship-all/route.ts`
- `src/app/api/seller/batches/create/route.ts`
- `src/app/api/seller/batches/list/route.ts`
- `src/app/api/admin/batches/review/route.ts` (new)
- `src/app/api/admin/orders/route.ts`
- `src/app/api/admin/logistics/ready/route.ts`
- `src/components/seller/BatchBuilder.tsx`
- `src/app/(dashboard)/seller/orders/checkout/page.tsx`
- `src/app/(dashboard)/seller/orders/drafts/page.tsx`
- `src/app/(dashboard)/seller/orders/SellerOrdersClient.tsx`
- `src/app/(dashboard)/seller/batches/page.tsx`
- `src/app/(dashboard)/admin/orders/page.tsx`
- `src/app/seller/onboarding/page.tsx`

Tests/docs:
- `tests/seller/workflows.test.mjs` (replaced incorrect order-count/automatic-charge expectations; retained financial, tenant, stock and dispatch safeguards)
- `tests/seller/phase2.test.mjs` (adapted checkout payload tests; added actual create-bulk allocation-to-draft/replay regression)
- `tests/seller/units-review.test.mjs` (new)
- `docs/seller-units-review-correction.md` (this report)
- `docs/seller-workflow-audit.md`, `docs/seller-workflow-phase2.md`, `docs/financial-integrity-review.md` (explicit correction banners; old audit findings remain historical)

## Final offline validation

- PASS: **103 tests**, zero failures. A/B: 2+3 and one order ×5; C: four PCS rejected at review submission; D/E: over/incomplete allocations rejected; F: exact independent SKU balances and duplicate cart-row aggregation; G: actual create-bulk draft receipt replay plus concurrent batch-submission replay; H: pending-review Admin visibility, ADMIN-only decision API, no payment before approval, no dispatch without approval/payment/manual grant, guarded stock decrement. Includes a hook-based checkout UI regression for add/remove, remaining-unit defaults, over-allocation rejection and preservation of other customer data. Includes all retained finance/LIVCASH/seller checks, with obsolete five-order expectations corrected.
- PASS: TypeScript `--noEmit --incremental false` after final implementation changes.
- PASS: targeted ESLint on changed/new business logic, checkout, batches, Admin orders, API routes, dispatch and tests (19 files), zero findings. Final test-only additions were linted again.
- Copy-only legacy screens were also checked: `SellerOrdersClient.tsx` reports one existing no-explicit-any error (line 257); onboarding reports existing set-state-in-effect (377), no-explicit-any (401), and one exhaustive-deps warning (379). This correction only changes their instructions; those unrelated findings remain. No full-repository lint-clean claim.
- PASS: diff whitespace check. No tracked diff to root .env or Prisma schema paths; no schema edits were made.
- NOT EXECUTED: database/transaction concurrency tests, real browser tests, external APIs, migration, build or deployment. VM/hook fixtures are not browser or PostgreSQL verification.

```powershell
node --import ./tests/shipping/offline-loader.mjs --test tests/finance/integrity.test.mjs tests/shipping/livcash.test.mjs tests/seller/workflows.test.mjs tests/seller/phase2.test.mjs tests/seller/units-review.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\eslint.cmd src/lib/order-policy.ts src/lib/customer-allocation.ts src/services/orderService.ts src/services/dispatchService.ts src/app/api/seller/orders/create-bulk/route.ts src/app/api/seller/orders/ship-all/route.ts src/app/api/seller/batches/create/route.ts src/app/api/seller/batches/list/route.ts src/app/api/admin/batches/review/route.ts src/app/api/admin/orders/route.ts src/app/api/admin/logistics/ready/route.ts src/components/seller/BatchBuilder.tsx 'src/app/(dashboard)/seller/orders/checkout/page.tsx' 'src/app/(dashboard)/seller/batches/page.tsx' 'src/app/(dashboard)/admin/orders/page.tsx' 'src/app/(dashboard)/seller/orders/drafts/page.tsx' tests/seller/workflows.test.mjs tests/seller/phase2.test.mjs tests/seller/units-review.test.mjs
```
