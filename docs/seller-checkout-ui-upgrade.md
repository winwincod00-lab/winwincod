# Seller checkout and draft selection upgrade

2026-10-23. Local source changes only; no commit, branch change, push or deployment. Root environment, credentials, active Prisma schema and migrations remain untouched. No database, bank or carrier connection, live data write or dependency installation occurred. Existing Phase 6 work and `.claude/settings.local.json` were preserved.

## Implemented

- Replaced the plain checkout with WinWinCOD blue/white surfaces, a three-step indicator, customer cards, grouped fields and a desktop sticky summary. Summary appears before customer cards on mobile. Both Arabic RTL and French LTR use explicit direction and translated copy. Inline associated validation errors, labelled controls, focus styles, loading/empty/recovery states and responsive grids are included.
- Product selection uses native `details`/`summary` and grouped radio choices, with existing catalog thumbnails in both selected and option states. Keyboard opening, radio semantics and focus return use native browser controls. Missing or failed images show a neutral package fallback. No custom combobox keyboard emulation or new package was added.
- Kept the quantity/allocation rules and calculations. Added inline feedback when the existing quantity guard rejects an input. Current cart values still represent catalog estimates, never persisted historical COGS or realized profit. Optional SKU is carried from product selection through the cart; older carts without SKU remain valid.
- Replaced raw UUID success links with customer/city/product/image/SKU/quantity/status cards. Technical IDs remain only in link destinations. Cards use the original submitted snapshot, not subsequently changed cart contents. Save responses must contain the expected unique order IDs before the cart is cleared. Copy explicitly states that drafts are not Admin approved, paid or dispatched.
- Draft list supports per-row selection, Select All/Deselect All for the current visible eligible page, selected order count and PCS count, and 50-row client-side pagination. Changing pages or refreshing clears selection. Ineligible rows are disabled and explained. The API still returns the seller-scoped draft list; large-list server pagination remains a future performance improvement.
- Added a schema-compatible bulk confirmation endpoint and service. This is a source-level transactional implementation, not a client-side loop pretending to be atomic. It requires current SELLER authentication, nonempty unique IDs, seller ownership, DRAFT status, no batch and valid quantities. Claim, all conditional transitions, status history and actor audit share one Serializable transaction. Any failed eligibility/count/history check aborts the entire unit. PostgreSQL behavior remains unverified until isolated testing.
- Client confirmation happens before sending. A synchronous ref lock prevents double clicks while hashing/sending. A seller-scoped persisted retry key and immutable selection protect uncertain retries. No automatic retry runs. A validated successful response reports success for each order; a rejected atomic selection reports each order not sent; a transport/5xx/invalid receipt reports each outcome unknown and freezes selection. Refresh remains available; retry retains the original selection/key. Changing accounts remounts draft state and suppresses old async UI updates.

## Business rules and safety

Saving drafts and sending DRAFT -> PENDING_CONFIRMATION may contain one PCS. The minimum **five eligible confirmed PCS** applies later when submitting a batch for Admin review. Two orders 2+3 and one order ×5 remain supported; four PCS cannot enter review. One SKU per customer order, independent COD/customer fields, seller isolation, 20/30 MAD policies and separate Admin approval/payment/warehouse steps remain intact. No wallet debit, inventory reservation, shipment or return restock is introduced.

The new service uses the existing `log.id` primary key as a seller/key-specific receipt identity with a fingerprint of sorted order IDs. Audit stores identifiers only, no customer form payload or financial secrets. Reusing a key for different IDs conflicts. Same-key replay returns the original committed result even if orders have since progressed. A fresh key cannot transition an already-submitted draft again because eligibility and conditional updates require DRAFT. Receipt/history retention and actual database constraints still require isolated PostgreSQL verification; no production guarantee is asserted from mocks.

## Exact files changed in this task

1. `src/app/(dashboard)/seller/orders/checkout/page.tsx`
2. `src/app/(dashboard)/seller/orders/drafts/page.tsx`
3. `src/app/(dashboard)/seller/orders/new/page.tsx` — optional SKU propagation and explicit product types; quantity logic retained.
4. `src/app/api/seller/orders/drafts/route.ts` — seller-scoped product image/SKU projection, no supplier costs.
5. `src/app/api/seller/orders/drafts/submit/route.ts` — new bulk confirmation endpoint.
6. `src/services/draftConfirmationService.ts` — new transaction/receipt service.
7. `src/lib/draft-selection.ts` — new eligibility and selected PCS helpers.
8. `src/lib/cart.ts` — optional validated SKU metadata only.
9. `src/components/seller/ProductPicker.tsx` — new image selector presentation.
10. `src/components/seller/ProductThumbnail.tsx` — new shared thumbnail/fallback.
11. `src/components/ui/CitySelect.tsx` — optional localized placeholder and aligned form height.
12. `src/messages/ar.json`
13. `src/messages/fr.json`
14. `tests/seller/checkout-upgrade.test.mjs` — 19 new tests.
15. `tests/seller/phase2.test.mjs` — adapted checkout fixture imports for translations/components; earlier assertions retained.
16. `tests/shipping/livcash.test.mjs` — translation regression now protects all existing keys and unchanged tracking key structure while allowing additive UI translations. It previously rejected any added translation namespace.
17. `docs/seller-checkout-ui-upgrade.md` — this handoff.

Unrelated pre-existing Phase 6 modifications/untracked files are outside this change list and were not overwritten.

## Before / after

| Before | After |
|---|---|
| Plain French-only checkout and text product select | AR/FR customer cards with image selector, clear totals, inline feedback and desktop/mobile summary |
| UUID list after saving | Customer/product summary cards and clear next-step CTAs |
| One-at-a-time draft action | Visible eligible selection, PCS totals, guarded bulk endpoint and individual outcome display |
| Limited recovery feedback | Frozen same-key retry on uncertainty, validated receipts and no false partial success |

## Validation

- **230 offline tests passed, zero failed**: all 211 earlier tests plus 19 upgrade regressions. New tests cover selection/eligibility/visible pagination, one PCS draft confirmation, 2+3 counts, duplicate IDs/requests, seller isolation, whole-selection rejection, conditional-claim/history rollback in the fixture, lost response recovery, changed-payload replay rejection, cancelled confirmation, per-order failure/unknown/success, accessible radio/image markup, AR/FR keys, RTL, inline errors, success-card content and malformed save receipts. Existing tests still cover 5, 2+3, over-allocation, incomplete allocation and distinct batch review/payment/dispatch.
- TypeScript `--noEmit --incremental false`: passed.
- Targeted ESLint on every changed/new source/test file: zero errors, one existing `@next/next/no-img-element` warning in product selection (`orders/new/page.tsx`, now line 105). Other repository lint debt was not broadened or waived.
- `git diff --check` and separate trailing-whitespace checks for new files: passed.
- Full build **not run**. The repository build runs `prisma generate && next build`; it may discover root environment and evaluate DB-backed pages. It is not an offline-safe verification under this task's constraints.
- No real browser/mobile/screen-reader session, HTTP integration server or PostgreSQL concurrency/rollback test was run. Hook/markup fixtures establish application behavior and semantic structure, not visual certification or database durability.

Initial test failures were fixture imports for new UI dependencies and an existing test that required translation keys to equal HEAD exactly. Both were corrected while retaining prior functional assertions and protection against translation deletion. No final failing test is waived.

Commands:

```powershell
node --import ./tests/shipping/offline-loader.mjs --test tests/finance/*.test.mjs tests/shipping/*.test.mjs tests/seller/*.test.mjs tests/integrity/*.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\eslint.cmd 'src/app/(dashboard)/seller/orders/checkout/page.tsx' 'src/app/(dashboard)/seller/orders/drafts/page.tsx' 'src/app/(dashboard)/seller/orders/new/page.tsx' src/components/seller/ProductPicker.tsx src/components/seller/ProductThumbnail.tsx src/components/ui/CitySelect.tsx src/lib/cart.ts src/lib/draft-selection.ts src/services/draftConfirmationService.ts src/app/api/seller/orders/drafts/route.ts src/app/api/seller/orders/drafts/submit/route.ts tests/seller/phase2.test.mjs tests/seller/checkout-upgrade.test.mjs tests/shipping/livcash.test.mjs
git diff --check
```

## Remaining gates and safe Preview handoff

Financial launch remains NO-GO under Phase 5/6: persisted cost snapshots, wallet holds, stock reservations, loss/inspection workflows and verified carrier/bank settlements were not enabled by this UI change. Existing transaction/audit guarantees require actual isolated PostgreSQL tests. Bulk confirmation needs the same disposable DB verification, including a race with the existing single-order status endpoint and receipt retention permissions. The UI and API must be released together; the prior Preview cannot service this new bulk route.

Next safe action: review only the 17-file change list above and run a browser rehearsal with mocked HTTP responses, no database: 320/375/768/1440 widths, AR/FR direction, keyboard product choice/fallback images, one client ×5 and two clients 2+3, success cards, ineligible selections, select/page changes, rejected atomic selection, lost response, same-key retry and account switch. Then test real bulk transactions in a separately authorized disposable PostgreSQL environment with synthetic data. After QA and owner authorization, commit the reviewed UI/API files together and create a Preview from that exact new SHA; exclude `.claude/settings.local.json` and unrelated Phase 6 work. No commit/push/deployment was performed here.

Résumé Darija: تبدّل شكل checkout وملخص النجاح، وتزادو صور المنتجات، الترجمة والتحديد الجماعي للمسودات. منطق الكميات وقاعدة 5 وحدات مؤكدة بقاو كيف ما هما. اختبارات offline ناجحة، ولكن المتصفح وPostgreSQL باقي خاصهم تحقق معزول قبل النشر.
