> BUSINESS CORRECTION: The minimum is **5 product units (PCS)** summed across eligible confirmed orders, not five customer orders. Earlier five-distinct-order requirements in this historical report were incorrect and are superseded by [the unit/review correction](seller-units-review-correction.md). Submission is now unpaid and pending separate Admin review; approval, payment and dispatch are distinct. Historical validation counts describe the earlier revision.

# Seller workflow follow-up: safe daily operation

This follow-up starts from `seller-workflow-audit.md` and inspects the actual current repository. The earlier audit and its changes remain in place. This document distinguishes new findings from previously repaired safeguards.

No production access, external API calls, database connections, application-data writes, schema changes, migrations, dependency installation or deployment were performed. Root `.env`, database configuration and carrier integration code were not changed.

## Ranked findings

| Priority | Classification | Actual evidence | Outcome in this follow-up |
| --- | --- | --- | --- |
| P0 | VERIFIED BUG / missing historical-cost capability | `prisma/schema.prisma:order` lacks immutable unit cost; `api/admin/orders/deliver:POST` reads current `product.sellerPrice`. | Remains blocked pending approved accounting and schema work. Formula untouched. |
| P0 | VERIFIED BUG | `walletService:approveDeposit/rejectDeposit/chargeWallet`, seller withdrawal creation and admin withdrawal approval have stale-read/separate-write paths. | Remains a financial concurrency blocker. No new fee, reservation or refund rules invented. |
| P1 | VERIFIED BUG | `CheckoutPage:handleSubmit` and `ImportOrdersPage:handleImport` had only asynchronous button disabling; all three creation handlers created fresh rows on every request. A lost response followed by retry could duplicate orders. | Synchronous client locks plus durable seller-scoped submission receipts, replay/mismatch checks and safe manual retry. |
| P1 | VERIFIED BUG | `lib/cart.ts` used one `winwin_cart_v3` localStorage key; `CartContext` survived account changes. Product selections could appear under the next seller account on the same browser. | Seller-specific storage and provider remount; old shared cart is never imported. This protects application state across account switches, not access by someone controlling the same device's storage. |
| P1 | VERIFIED BUG | Numeric coercion accepted blank/null/boolean COD as zero; checkout defaulted to one unit's price regardless of quantity and labelled the pre-fee margin as profit. | Reject malformed monetary input; suggested total uses unit price × quantity; zero remains zero. Display says margin before fees, not realized profit or wallet credit. No persisted financial formula changed. |
| P1 | VERIFIED BUG | `SellerWalletPage:fetchBalance` had no error handler and started at zero; history failure looked like an empty ledger. `api/seller/wallet/history:GET` omitted `page`, but the UI used it for pagination. | Unknown balance displays unavailable/retry; no fabricated zero/empty history; pagination validates positive integers and returns the page. |
| P1 | VERIFIED BUG / UX IMPROVEMENT | Creation/import routes returned generic validation errors. Pasted formatted Moroccan numbers failed; import preview omitted addresses. | Shared strict validation, equivalent Moroccan phone normalization, field/row messages, address preview and correction instructions. Deliverability itself is not verified. |
| P1 | VERIFIED BUG / UX IMPROVEMENT | `onboarding:Step4` implied funding was necessary to add orders and displayed a 200 MAD recommendation, placeholder account and unverified 24-hour promise. | Explain free draft saving, actual batch-dependent funding, minimum five and payment-before-dispatch; remove placeholder banking instructions and promise. Illustrative sample arithmetic is explicitly labelled as an example. |
| P1 | VERIFIED BUG | Order list used a four-character fallback reference, checkout used a different six-character suffix, and local tracking parsed neither. International stored phone variants could fail a normalized lookup. | Shared full-ID fallback/reference parser, exact accepted phone variants and mandatory seller scoping. Does not change LIVCASH. |
| P1 | NEW FEATURE, not an existing implemented workflow | Schema has status history and generic logs, but no call-attempt/outcome/follow-up model. `callCenterService` contains comments for future notes rather than a working call log. | Not invented. Phase 3 needs explicit ownership, outcomes, follow-up scheduling and audit rules. |
| P2 | VERIFIED BUG / UX IMPROVEMENT | `MyCatalogPage` never completed loading on error; image JSON was passed directly to img; photo button had no action. City selectors used mouse-only div/li interactions. | Catalog retry and real detail link; shared image parsing; native labelled city select supports keyboard/mobile controls. |

## Seller journey: before and after

| Step | Before this follow-up | After / preserved behavior |
| --- | --- | --- |
| Onboarding | Funding advice did not match batching; fake bank placeholders; custom city click controls. | Clear draft → confirmation → minimum-five paid batch → warehouse sequence, verified-payment-instruction guidance and accessible native city control. |
| Dashboard | Earlier patch already supplied real all-time queues and report error recovery. | Preserved. No new KPI numbers or invented operational queues added. Call follow-up queue remains unavailable because there is no real data source. |
| Catalog | My-products request failure could load forever; photos failed for JSON arrays and button did nothing. | Retry state, decoded first image and a working product-details link. Marketplace/new-order callers no longer announce success when cart addition was rejected. |
| Order entry | Per-unit suggested COD despite multiple units; generic errors; initial city picker required mouse/touch. | Total suggested COD, linked labels/errors, native city selector, Moroccan phone formatting support and explicit draft-saving button. |
| Import | Invalid data discovered only after sending; no address preview; delayed navigation allowed another import click. | Shared row validation before sending, address preview, explicit success/next action, synchronous submission lock and durable retry key. |
| Confirmation | Earlier restricted transitions and audit history were already present. | Preserved. Creation now also writes DRAFT history atomically. No bulk confirmation bypass or call-attempt claims added. |
| Batch building | Earlier minimum-five/aggregate stock/payment validation was already present. | Preserved. Draft creation neither reserves stock nor pays a batch; server aggregate stock is checked without decrementing inventory. |
| Dispatch | Earlier separately permissioned, paid, stock-safe manual dispatch with audit. | Preserved; no new dispatch capability or permission grant. |
| Tracking | Local lookup could not accept the fallback reference shown to the seller. | Copy the full displayed reference or use an exact Moroccan phone form; all lookup paths remain seller-scoped. Carrier status/data contract unchanged. |
| Returns | Earlier automatic restocking was blocked. | Preserved. Physical inspection/restock/refund remains an operational feature requiring approved rules. |
| Finance | Pre-fee margin could be read as realized profit; failed wallet reads showed zero or empty history; pagination lost its page. | Margin clearly labelled, unknown reads show retry, successful ledger pagination is stable. Historical COGS and wallet concurrency blockers remain explicit. |

## Implementation and affected files

### Durable submission and shared input validation

- `src/services/orderSubmissionService.ts:createDraftSubmission` — existing `log.id` primary key provides a deterministic, seller/key-specific unique claim. The claim, DRAFT order rows, DRAFT history and final receipt commit in one transaction. A matching request returns the saved IDs; the same key with changed normalized data or endpoint is rejected. Product names are resolved on the server; aggregate stock is checked; the existing 20 MAD creation fee is preserved. No wallet or dispatch writes occur here.
- `src/lib/order-input.ts` — required customer fields, normalized valid Moroccan phones, strictly positive integer quantity, explicit finite nonnegative COD, import schema and field/row messages. Missing import price keeps the existing suggested-price default; explicit zero is preserved. Booleans/null/blank amounts are rejected.
- `src/app/api/seller/orders/create/route.ts`, `create-bulk/route.ts`, `import/route.ts` — authenticated seller only; validate then use shared submission service; expose sanitized errors instead of raw database exceptions.
- `src/lib/order-submission-client.ts` — sessionStorage contains only a digest and random retry key, scoped to seller and workflow. It does not persist raw customer fields.
- `src/lib/checkout.ts` — truthful suggested COD and pre-fee margin display helpers; invalid/blank display amounts stay unknown, not zero.
- `src/app/(dashboard)/seller/orders/checkout/page.tsx` — explicit draft action, accessible field-level errors, synchronous lock, immutable original retry payload after uncertain responses, safe success cleanup and next action. Successful cleanup removes only submitted cart rows, preserving newly added rows.
- `src/app/(dashboard)/seller/orders/import/page.tsx` — product retry, readable file errors, 500-row limit, row validation, address preview, duplicate-click lock, stable retry metadata and clear saved-draft next action.

### Account-scoped cart and navigation

- `src/lib/cart.ts` — seller-specific storage, parsed shape validation and aggregate quantity guards.
- `src/context/CartContext.tsx` — remount on account change, explicit hydration state, synchronous cart state reference, random item IDs and truthful add result. No cross-account legacy-cart import.
- `src/app/(dashboard)/seller/products/page.tsx`, `seller/orders/new/page.tsx` — handle rejected cart additions before showing success.
- `src/lib/order-reference.ts` — one full-ID fallback, existing sequence references and exact local lookup/phone variants.
- `src/app/(dashboard)/seller/orders/SellerOrdersClient.tsx`, `seller/orders/[id]/page.tsx` — show the shared searchable reference.
- `src/app/api/seller/tracking/route.ts` — exact query construction remains scoped to authenticated seller. No raw carrier payload or new carrier call.

### Accessible controls and recovery

- `src/components/ui/CitySelect.tsx` — native required labelled control, associated errors, keyboard/mobile support.
- `src/components/CitySelector.tsx` — existing onboarding city data through the shared accessible control; no city alias/carrier mapping changes.
- `src/app/seller/onboarding/page.tsx` — accurate funding/batching guidance, no fake bank account or fulfillment promise.
- `src/lib/product-images.ts`, `src/app/(dashboard)/seller/my-products/page.tsx`, `seller/products/[id]/page.tsx` — shared JSON/plain image parsing, retry and real detail navigation; explicit seller guard on product detail.
- `src/app/api/seller/wallet/history/route.ts` — valid integer page/limit and page in response; financial service formulas untouched.
- `src/app/(dashboard)/seller/wallet/page.tsx` — loading/unknown/error states separate from successful zero results; retry, stable page and recorded-profit wording.

### Offline tests and documentation

- `tests/seller/phase2.test.mjs` — 26 regression tests. Tests execute the actual service/handlers/components with allowlisted mocks. Includes simulated transaction uniqueness/rollback, lost response recovery, seller separation, header checks, strict input, retry metadata, cart boundaries, full references, tracking scoping, static accessible markup, duplicate handler calls, immutable retry snapshots, wallet pagination and unknown-state rendering.
- `tests/seller/workflows.test.mjs` — existing creation-route mocks updated for the shared validation/submission service; prior business safeguard checks retained.
- `docs/qa/seller-phase2-validation.json` — compact validation counts.
- `docs/seller-workflow-audit.md` — links to this follow-up; earlier audit retained as historical context.

## Compatibility and operational limits

- All three internal creation POST handlers now require a UUID-v4 `Idempotency-Key` header. Both repository callers are updated. Any client outside this repository needs the same contract. Missing/invalid keys reject before database access. Same key is a retry, not a request for another identical order; a deliberate new operation uses a new key. This is not semantic deduplication across distinct keys, browser tabs or intentionally separate submissions.
- `SELLER_DRAFT_SUBMISSION` log receipts must be retained for replay protection. No log deletion or retention changes were made. Receipts contain normalized request digest/order IDs, not raw customer fields. Deleting receipts would remove replay protection for their keys.
- There is no automatic resubmission. After an uncertain response the current form offers retry of the original payload and a link to review drafts. Customer form data is not persisted; after navigation/reload the seller should inspect drafts before starting a different operation.
- The legacy shared browser cart is deliberately not migrated to a seller because ownership cannot be established. Sellers reselect products once. Existing legacy storage is not deleted.
- Native city controls retain each workflow's existing city list. Neither city deliverability nor address completeness beyond structural required-field checks is asserted.
- Old short fallback references are not guessed or searched by ambiguous prefix. Current displays expose the full searchable ID. Legacy phone values stored in unsupported formatting can still require full-ID lookup; no application-data normalization/backfill was run.
- Live transaction latency/limits for large imports, receipt durability, database rollback and real concurrent sessions require a separately authorized database test. Mock simulations are not evidence of live PostgreSQL behavior.

## Remaining financial and operational blockers / Phase 3

1. **P0:** Approve immutable historical COGS capture and historical handling before changing profit or refunds. No financial formula or old fee was changed here.
2. **P0:** Review atomic, idempotent deposit/withdrawal approval and pending-withdrawal/spendable-balance rules. Existing races remain; this patch does not claim financial production readiness.
3. **P1 NEW FEATURE:** Call-attempt outcomes, attempt history, follow-up ownership/date and real dashboard queue. Requires explicit business rules and a reviewed persistence model; do not use status spoofing as a substitute.
4. **P1 NEW FEATURE:** Physical receipt/inspection of returns, approved disposition, audited restock and refund reconciliation.
5. **P1 NEW FEATURE:** Inventory reservation lifecycle and competing paid batches; payment still does not reserve physical stock.
6. **P1 validation:** Real browser keyboard/mobile flow and separately authorized isolated database concurrency verification. All production and external operations remain out of scope.
7. **P2:** Remaining Arabic/French copy consistency, staff assignment/access model, paginating ledger queries in the database and broad lint debt. No schema or financial-rule shortcut should be used to hide these gaps.

## Validation

- PASS: 71 offline tests, zero failures (45 retained checks + 26 new regressions).
- PASS: TypeScript `--noEmit --incremental false`.
- Full repository ESLint remains FAIL: 99 errors, including 97 in src/tests. Source/test baseline at the start of this follow-up was 111. No added findings by file/rule comparison to the captured baseline. Existing lint debt is not waived.
- PASS: final diff whitespace check.
- NOT EXECUTED: live browser, database, carrier, production or deployment tests. UI tests use static markup and mocked hooks/handlers, not a browser. Transaction tests simulate commit/rollback/uniqueness; no real database is imported.

```powershell
node --import ./tests/shipping/offline-loader.mjs --test tests/shipping/livcash.test.mjs tests/seller/workflows.test.mjs tests/seller/phase2.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

ESLint was run offline through its installed API over the full repository, with a per-file/rule comparison against the start-of-turn baseline. No Next build was run because it can load root environment and prerender database-backed routes.
- PASS: targeted ESLint on the submission service, shared validation/retry/cart/reference helpers, cart provider, city control, checkout/import screens and new regression suite: zero findings.
