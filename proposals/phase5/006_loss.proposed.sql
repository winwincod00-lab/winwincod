-- DESIGN DRAFT ONLY. Not part of the integrity-v1 executable sequence.
-- Intentional hard stop until kernels, deferred quantity guards and role ownership
-- are integrated and approved. NEVER remove this gate just to apply the DDL.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'Loss integration and owner policy are NOT approved'; END $$;
-- Intended reviewed schema/search_path must be selected by the release runbook.
CREATE TABLE fi_inventory_loss (
  id text PRIMARY KEY,
  "sellerId" text NOT NULL,
  "shipmentItemId" text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  "sourceBucket" text NOT NULL CHECK ("sourceBucket" IN ('IN_TRANSIT','RETURNED_PENDING_INSPECTION')),
  "evidenceHash" text NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  "actorId" text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  "policyRef" text NOT NULL REFERENCES fi_policy_decision(id) ON DELETE RESTRICT,
  "operationKey" text NOT NULL UNIQUE,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("shipmentItemId", "sellerId") REFERENCES fi_shipment_item(id, "sellerId") ON DELETE RESTRICT
);
CREATE INDEX fi_inventory_loss_item ON fi_inventory_loss("shipmentItemId", "sellerId");
CREATE TRIGGER fi_loss_immutable BEFORE UPDATE OR DELETE ON fi_inventory_loss
  FOR EACH ROW EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_loss_no_truncate BEFORE TRUNCATE ON fi_inventory_loss
  FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
REVOKE ALL ON fi_inventory_loss FROM PUBLIC;
-- REQUIRED BEFORE removing the hard stop:
-- 1. Explicit capability/policy + tenant-bound operation receipt and payload hash.
-- 2. Lock shipment item, physical receipt (if applicable), then affected balances
--    in the SAME global order used by dispatch/return/delivery kernels.
-- 3. Deferred invariant delivered + returned + transitLoss <= shipped units;
--    receipt sellable + damaged + quarantineLoss <= physically received units.
--    Returned units include quarantine losses; do NOT count them twice at shipment.
-- 4. One linked stock movement from sourceBucket to EXTERNAL; exact quantity,
--    seller/product/shipment match; atomic decrement and loss receipt closure.
-- 5. Separate loss recognition/insurance claim; NEVER restock or auto refund.
-- 6. Correct NOLOGIN owner/ACL contract; direct app writes denied.
COMMIT;
