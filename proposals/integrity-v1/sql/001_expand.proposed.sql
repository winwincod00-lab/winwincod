-- PROPOSED ONLY. Outside active migration roots. No DML, backfill, grants or activation.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $gate$
DECLARE s text := current_setting('winwincod.integrity_schema', true); t text;
BEGIN
 IF s IS NULL OR s = '' OR current_setting('winwincod.integrity_baseline_approval', true) IS NULL THEN RAISE EXCEPTION 'Verified schema and baseline approval required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=s AND left(c.relname,3)='fi_') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=s AND left(p.proname,3)='fi_') THEN RAISE EXCEPTION 'Existing fi_ objects: baseline/partial recovery review required'; END IF;
 IF current_setting('server_version_num')::int < 150000 THEN RAISE EXCEPTION 'Proposal requires PostgreSQL 15+ staging validation'; END IF;
 FOREACH t IN ARRAY ARRAY['user','wallet','transaction','order','product','orderbatch','depositrequest','withdrawalrequest'] LOOP
  IF to_regclass(format('%I.%I',s,t)) IS NULL THEN RAISE EXCEPTION 'Missing legacy table % in %',t,s; END IF;
 END LOOP;
 PERFORM set_config('search_path', format('%I, pg_catalog, pg_temp',s), true);
END $gate$;
CREATE FUNCTION fi_money_ok(n numeric) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT n::text NOT IN ('NaN','Infinity','-Infinity') $$;

CREATE TABLE "fi_opening_evidence" (
 "id" TEXT PRIMARY KEY,
 "entityKind" TEXT NOT NULL,
 "entityId" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "approvedBy" TEXT NOT NULL,
 "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_opening_evidence_u0" UNIQUE ("entityKind", "entityId")
);
CREATE INDEX "fi_opening_evidence_i0" ON "fi_opening_evidence" ("approvedBy");

CREATE TABLE "fi_operation" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "businessKey" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "policyDecisionId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_operation_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_operation_u1" UNIQUE ("sellerId", "kind", "requestKey"),
 CONSTRAINT "fi_operation_u2" UNIQUE ("sellerId", "kind", "businessKey")
);
CREATE INDEX "fi_operation_i0" ON "fi_operation" ("actorId", "createdAt");
CREATE INDEX "fi_operation_i1" ON "fi_operation" ("sellerId");
CREATE INDEX "fi_operation_i2" ON "fi_operation" ("actorId");
CREATE INDEX "fi_operation_i3" ON "fi_operation" ("policyDecisionId");

CREATE TABLE "fi_ledger_account" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT,
 "kind" TEXT NOT NULL,
 "code" TEXT NOT NULL,
 "currency" TEXT NOT NULL,
 "openingDebitBalance" NUMERIC(65,30) NOT NULL,
 "openingEvidenceId" TEXT NOT NULL,
 CONSTRAINT "fi_ledger_account_u0" UNIQUE ("code"),
 CONSTRAINT "fi_ledger_account_u1" UNIQUE ("id", "sellerId"),
 CHECK (fi_money_ok("openingDebitBalance"))
);
CREATE INDEX "fi_ledger_account_i0" ON "fi_ledger_account" ("sellerId");
CREATE INDEX "fi_ledger_account_i1" ON "fi_ledger_account" ("openingEvidenceId");

CREATE TABLE "fi_wallet" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "legacyWalletId" TEXT NOT NULL,
 "ledgerAccountId" TEXT NOT NULL,
 "openingBalance" NUMERIC(65,30) NOT NULL,
 "balance" NUMERIC(65,30) NOT NULL,
 "held" NUMERIC(65,30) NOT NULL,
 "openingEvidenceId" TEXT NOT NULL,
 "activatedAt" TIMESTAMPTZ(6),
 CONSTRAINT "fi_wallet_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_wallet_u1" UNIQUE ("sellerId"),
 CONSTRAINT "fi_wallet_u2" UNIQUE ("legacyWalletId"),
 CONSTRAINT "fi_wallet_u3" UNIQUE ("ledgerAccountId"),
 CONSTRAINT "fi_wallet_u4" UNIQUE ("openingEvidenceId"),
 CHECK (fi_money_ok("openingBalance")),
 CHECK (fi_money_ok("balance")),
 CHECK (fi_money_ok("held"))
);

CREATE TABLE "fi_withdrawal_hold" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "walletId" TEXT NOT NULL,
 "legacyRequestId" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "remaining" NUMERIC(65,30) NOT NULL,
 "state" TEXT NOT NULL,
 "payoutSnapshot" TEXT NOT NULL,
 "createdOperationId" TEXT NOT NULL,
 CONSTRAINT "fi_withdrawal_hold_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_withdrawal_hold_u1" UNIQUE ("legacyRequestId"),
 CONSTRAINT "fi_withdrawal_hold_u2" UNIQUE ("createdOperationId"),
 CHECK (fi_money_ok("amount")),
 CHECK (fi_money_ok("remaining"))
);
CREATE INDEX "fi_withdrawal_hold_i0" ON "fi_withdrawal_hold" ("walletId", "state");
CREATE INDEX "fi_withdrawal_hold_i1" ON "fi_withdrawal_hold" ("sellerId");
CREATE INDEX "fi_withdrawal_hold_i2" ON "fi_withdrawal_hold" ("walletId", "sellerId");

CREATE TABLE "fi_funding_evidence" (
 "id" TEXT PRIMARY KEY,
 "sourceAccountRef" TEXT NOT NULL,
 "externalRef" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "verifiedBy" TEXT NOT NULL,
 "verifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_funding_evidence_u0" UNIQUE ("sourceAccountRef", "externalRef"),
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_funding_evidence_i0" ON "fi_funding_evidence" ("verifiedBy");

CREATE TABLE "fi_funding_claim" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "evidenceId" TEXT NOT NULL,
 "legacyDepositId" TEXT,
 CONSTRAINT "fi_funding_claim_u0" UNIQUE ("operationId"),
 CONSTRAINT "fi_funding_claim_u1" UNIQUE ("evidenceId"),
 CONSTRAINT "fi_funding_claim_u2" UNIQUE ("legacyDepositId")
);
CREATE INDEX "fi_funding_claim_i0" ON "fi_funding_claim" ("sellerId");

CREATE TABLE "fi_journal" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "settlementMatchId" TEXT,
 "currency" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_journal_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_journal_u1" UNIQUE ("operationId"),
 CONSTRAINT "fi_journal_u2" UNIQUE ("settlementMatchId")
);
CREATE INDEX "fi_journal_i0" ON "fi_journal" ("sellerId");

CREATE TABLE "fi_posting" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "journalId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "reversalOfId" TEXT,
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_posting_i0" ON "fi_posting" ("journalId");
CREATE INDEX "fi_posting_i1" ON "fi_posting" ("accountId");
CREATE INDEX "fi_posting_i2" ON "fi_posting" ("reversalOfId");
CREATE INDEX "fi_posting_i3" ON "fi_posting" ("sellerId");

CREATE TABLE "fi_wallet_event" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "walletId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "cashDelta" NUMERIC(65,30) NOT NULL,
 "heldDelta" NUMERIC(65,30) NOT NULL,
 "holdId" TEXT,
 "journalId" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_wallet_event_u0" UNIQUE ("walletId", "operationId"),
 CONSTRAINT "fi_wallet_event_u1" UNIQUE ("journalId"),
 CHECK (fi_money_ok("cashDelta")),
 CHECK (fi_money_ok("heldDelta"))
);
CREATE INDEX "fi_wallet_event_i0" ON "fi_wallet_event" ("walletId", "createdAt");
CREATE INDEX "fi_wallet_event_i1" ON "fi_wallet_event" ("holdId");
CREATE INDEX "fi_wallet_event_i2" ON "fi_wallet_event" ("sellerId");
CREATE INDEX "fi_wallet_event_i3" ON "fi_wallet_event" ("walletId", "sellerId");
CREATE INDEX "fi_wallet_event_i4" ON "fi_wallet_event" ("operationId", "sellerId");

CREATE TABLE "fi_order_line" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "legacyOrderId" TEXT NOT NULL,
 "productId" TEXT NOT NULL,
 "quantity" INTEGER NOT NULL,
 "createdOperationId" TEXT,
 CONSTRAINT "fi_order_line_u0" UNIQUE ("legacyOrderId"),
 CONSTRAINT "fi_order_line_u1" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_order_line_u2" UNIQUE ("id", "sellerId", "productId")
);
CREATE INDEX "fi_order_line_i0" ON "fi_order_line" ("sellerId");
CREATE INDEX "fi_order_line_i1" ON "fi_order_line" ("productId");
CREATE INDEX "fi_order_line_i2" ON "fi_order_line" ("createdOperationId", "sellerId");

CREATE TABLE "fi_cost_snapshot" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "lineId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "source" TEXT NOT NULL,
 "sellerUnitCost" NUMERIC(65,30),
 "supplierUnitCost" NUMERIC(65,30),
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT,
 "operationId" TEXT,
 "capturedAt" TIMESTAMPTZ(6),
 CONSTRAINT "fi_cost_snapshot_u0" UNIQUE ("lineId", "version"),
 CONSTRAINT "fi_cost_snapshot_u1" UNIQUE ("id", "sellerId", "lineId"),
 CHECK (fi_money_ok("sellerUnitCost")),
 CHECK (fi_money_ok("supplierUnitCost"))
);
CREATE INDEX "fi_cost_snapshot_i0" ON "fi_cost_snapshot" ("sellerId");
CREATE INDEX "fi_cost_snapshot_i1" ON "fi_cost_snapshot" ("lineId", "sellerId");
CREATE INDEX "fi_cost_snapshot_i2" ON "fi_cost_snapshot" ("operationId", "sellerId");

CREATE TABLE "fi_cost_recognition" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "lineId" TEXT NOT NULL,
 "snapshotId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "quantityDelta" INTEGER NOT NULL,
 "basis" TEXT NOT NULL,
 "policyApprovalRef" TEXT NOT NULL,
 "reversalOfId" TEXT,
 "dispositionId" TEXT,
 CONSTRAINT "fi_cost_recognition_u0" UNIQUE ("operationId")
);
CREATE INDEX "fi_cost_recognition_i0" ON "fi_cost_recognition" ("lineId");
CREATE INDEX "fi_cost_recognition_i1" ON "fi_cost_recognition" ("reversalOfId");
CREATE INDEX "fi_cost_recognition_i2" ON "fi_cost_recognition" ("sellerId");
CREATE INDEX "fi_cost_recognition_i3" ON "fi_cost_recognition" ("snapshotId", "sellerId", "lineId");
CREATE INDEX "fi_cost_recognition_i4" ON "fi_cost_recognition" ("dispositionId", "sellerId");
CREATE INDEX "fi_cost_recognition_i5" ON "fi_cost_recognition" ("policyApprovalRef");

CREATE TABLE "fi_warehouse_grant" (
 "id" TEXT PRIMARY KEY,
 "actorId" TEXT NOT NULL,
 "capability" TEXT NOT NULL,
 "approvedBy" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "fi_warehouse_grant_i0" ON "fi_warehouse_grant" ("actorId", "capability");
CREATE INDEX "fi_warehouse_grant_i1" ON "fi_warehouse_grant" ("actorId");
CREATE INDEX "fi_warehouse_grant_i2" ON "fi_warehouse_grant" ("approvedBy");

CREATE TABLE "fi_grant_revocation" (
 "id" TEXT PRIMARY KEY,
 "grantId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_grant_revocation_u0" UNIQUE ("grantId")
);
CREATE INDEX "fi_grant_revocation_i0" ON "fi_grant_revocation" ("actorId");

CREATE TABLE "fi_stock_operation" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT,
 "actorId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "businessKey" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "financialOperationId" TEXT,
 "grantId" TEXT,
 "evidenceHash" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_stock_operation_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_stock_operation_u1" UNIQUE ("actorId", "requestKey"),
 CONSTRAINT "fi_stock_operation_u2" UNIQUE ("kind", "businessKey"),
 CONSTRAINT "fi_stock_operation_u3" UNIQUE ("financialOperationId")
);
CREATE INDEX "fi_stock_operation_i0" ON "fi_stock_operation" ("sellerId");
CREATE INDEX "fi_stock_operation_i1" ON "fi_stock_operation" ("actorId");
CREATE INDEX "fi_stock_operation_i2" ON "fi_stock_operation" ("grantId");

CREATE TABLE "fi_stock_balance" (
 "productId" TEXT PRIMARY KEY,
 "openingAvailable" INTEGER NOT NULL,
 "available" INTEGER NOT NULL,
 "reserved" INTEGER NOT NULL,
 "inTransit" INTEGER NOT NULL,
 "returnedPendingInspection" INTEGER NOT NULL,
 "damaged" INTEGER NOT NULL,
 "openingEvidenceId" TEXT NOT NULL,
 "activatedAt" TIMESTAMPTZ(6),
 CONSTRAINT "fi_stock_balance_u0" UNIQUE ("openingEvidenceId")
);

CREATE TABLE "fi_reservation" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "lineId" TEXT NOT NULL,
 "productId" TEXT NOT NULL,
 "units" INTEGER NOT NULL,
 "remaining" INTEGER NOT NULL,
 "dispatched" INTEGER NOT NULL,
 "released" INTEGER NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_reservation_u0" UNIQUE ("lineId"),
 CONSTRAINT "fi_reservation_u1" UNIQUE ("id", "sellerId", "productId")
);
CREATE INDEX "fi_reservation_i0" ON "fi_reservation" ("productId");
CREATE INDEX "fi_reservation_i1" ON "fi_reservation" ("sellerId");
CREATE INDEX "fi_reservation_i2" ON "fi_reservation" ("operationId", "sellerId");

CREATE TABLE "fi_carrier_account" (
 "id" TEXT PRIMARY KEY,
 "carrier" TEXT NOT NULL,
 "accountRef" TEXT NOT NULL,
 CONSTRAINT "fi_carrier_account_u0" UNIQUE ("carrier", "accountRef")
);

CREATE TABLE "fi_shipment" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "carrierAccountId" TEXT,
 "externalRef" TEXT,
 "trackingRef" TEXT,
 "expectedCod" NUMERIC(65,30),
 "currency" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_shipment_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_shipment_u1" UNIQUE ("carrierAccountId", "externalRef"),
 CHECK (fi_money_ok("expectedCod"))
);
CREATE INDEX "fi_shipment_i0" ON "fi_shipment" ("sellerId");
CREATE INDEX "fi_shipment_i1" ON "fi_shipment" ("carrierAccountId");
CREATE INDEX "fi_shipment_i2" ON "fi_shipment" ("operationId", "sellerId");

CREATE TABLE "fi_shipment_item" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "shipmentId" TEXT NOT NULL,
 "reservationId" TEXT NOT NULL,
 "lineId" TEXT NOT NULL,
 "productId" TEXT NOT NULL,
 "units" INTEGER NOT NULL,
 "delivered" INTEGER NOT NULL,
 "returned" INTEGER NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_shipment_item_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_shipment_item_u1" UNIQUE ("operationId", "lineId")
);
CREATE INDEX "fi_shipment_item_i0" ON "fi_shipment_item" ("reservationId");
CREATE INDEX "fi_shipment_item_i1" ON "fi_shipment_item" ("sellerId");
CREATE INDEX "fi_shipment_item_i2" ON "fi_shipment_item" ("shipmentId", "sellerId");
CREATE INDEX "fi_shipment_item_i3" ON "fi_shipment_item" ("lineId", "sellerId", "productId");
CREATE INDEX "fi_shipment_item_i4" ON "fi_shipment_item" ("operationId", "sellerId");

CREATE TABLE "fi_return_receipt" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "shipmentItemId" TEXT NOT NULL,
 "units" INTEGER NOT NULL,
 "warehouseRef" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_return_receipt_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_return_receipt_u1" UNIQUE ("warehouseRef"),
 CONSTRAINT "fi_return_receipt_u2" UNIQUE ("operationId")
);
CREATE INDEX "fi_return_receipt_i0" ON "fi_return_receipt" ("shipmentItemId");
CREATE INDEX "fi_return_receipt_i1" ON "fi_return_receipt" ("sellerId");

CREATE TABLE "fi_disposition" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "receiptId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "units" INTEGER NOT NULL,
 "moved" INTEGER NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_disposition_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_disposition_u1" UNIQUE ("operationId")
);
CREATE INDEX "fi_disposition_i0" ON "fi_disposition" ("receiptId");
CREATE INDEX "fi_disposition_i1" ON "fi_disposition" ("sellerId");

CREATE TABLE "fi_stock_movement" (
 "id" TEXT PRIMARY KEY,
 "operationId" TEXT NOT NULL,
 "sequence" INTEGER NOT NULL,
 "sellerId" TEXT,
 "productId" TEXT NOT NULL,
 "fromBucket" TEXT NOT NULL,
 "toBucket" TEXT NOT NULL,
 "units" INTEGER NOT NULL,
 "reservationId" TEXT,
 "shipmentItemId" TEXT,
 "receiptId" TEXT,
 "dispositionId" TEXT,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_stock_movement_u0" UNIQUE ("operationId", "sequence")
);
CREATE INDEX "fi_stock_movement_i0" ON "fi_stock_movement" ("productId", "createdAt");
CREATE INDEX "fi_stock_movement_i1" ON "fi_stock_movement" ("reservationId");
CREATE INDEX "fi_stock_movement_i2" ON "fi_stock_movement" ("shipmentItemId");
CREATE INDEX "fi_stock_movement_i3" ON "fi_stock_movement" ("receiptId");
CREATE INDEX "fi_stock_movement_i4" ON "fi_stock_movement" ("dispositionId");
CREATE INDEX "fi_stock_movement_i5" ON "fi_stock_movement" ("sellerId");
CREATE INDEX "fi_stock_movement_i6" ON "fi_stock_movement" ("operationId");
CREATE INDEX "fi_stock_movement_i7" ON "fi_stock_movement" ("productId");

CREATE TABLE "fi_carrier_observation" (
 "id" TEXT PRIMARY KEY,
 "carrierAccountId" TEXT NOT NULL,
 "externalEventKey" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "evidenceRef" TEXT NOT NULL,
 "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_carrier_observation_u0" UNIQUE ("carrierAccountId", "externalEventKey")
);
CREATE INDEX "fi_carrier_observation_i0" ON "fi_carrier_observation" ("carrierAccountId");

CREATE TABLE "fi_settlement_statement" (
 "id" TEXT PRIMARY KEY,
 "carrierAccountId" TEXT NOT NULL,
 "statementRef" TEXT NOT NULL,
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_settlement_statement_u0" UNIQUE ("carrierAccountId", "statementRef"),
 CONSTRAINT "fi_settlement_statement_u1" UNIQUE ("id", "carrierAccountId")
);
CREATE INDEX "fi_settlement_statement_i0" ON "fi_settlement_statement" ("carrierAccountId");

CREATE TABLE "fi_settlement_line" (
 "id" TEXT PRIMARY KEY,
 "statementId" TEXT NOT NULL,
 "carrierAccountId" TEXT NOT NULL,
 "externalLineRef" TEXT NOT NULL,
 "externalShipmentRef" TEXT,
 "grossCod" NUMERIC(65,30) NOT NULL,
 "carrierFee" NUMERIC(65,30) NOT NULL,
 "adjustment" NUMERIC(65,30) NOT NULL,
 "netRemittance" NUMERIC(65,30) NOT NULL,
 "currency" TEXT NOT NULL,
 CONSTRAINT "fi_settlement_line_u0" UNIQUE ("statementId", "externalLineRef"),
 CONSTRAINT "fi_settlement_line_u1" UNIQUE ("id", "carrierAccountId"),
 CHECK (fi_money_ok("grossCod")),
 CHECK (fi_money_ok("carrierFee")),
 CHECK (fi_money_ok("adjustment")),
 CHECK (fi_money_ok("netRemittance"))
);
CREATE INDEX "fi_settlement_line_i0" ON "fi_settlement_line" ("carrierAccountId", "externalShipmentRef");
CREATE INDEX "fi_settlement_line_i1" ON "fi_settlement_line" ("statementId", "carrierAccountId");

CREATE TABLE "fi_settlement_match" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "shipmentId" TEXT NOT NULL,
 "settlementLineId" TEXT NOT NULL,
 "carrierAccountId" TEXT NOT NULL,
 "termsId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "policyApprovalRef" TEXT NOT NULL,
 CONSTRAINT "fi_settlement_match_u0" UNIQUE ("id", "sellerId"),
 CONSTRAINT "fi_settlement_match_u1" UNIQUE ("operationId")
);
CREATE INDEX "fi_settlement_match_i0" ON "fi_settlement_match" ("sellerId");
CREATE INDEX "fi_settlement_match_i1" ON "fi_settlement_match" ("shipmentId", "sellerId");
CREATE INDEX "fi_settlement_match_i2" ON "fi_settlement_match" ("settlementLineId", "carrierAccountId");
CREATE INDEX "fi_settlement_match_i3" ON "fi_settlement_match" ("policyApprovalRef");
CREATE INDEX "fi_settlement_match_i4" ON "fi_settlement_match" ("termsId", "sellerId", "shipmentId");

CREATE TABLE "fi_remittance" (
 "id" TEXT PRIMARY KEY,
 "sourceAccountRef" TEXT NOT NULL,
 "bankReference" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "verifiedBy" TEXT NOT NULL,
 "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_remittance_u0" UNIQUE ("sourceAccountRef", "bankReference"),
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_remittance_i0" ON "fi_remittance" ("verifiedBy");

CREATE TABLE "fi_remittance_allocation" (
 "id" TEXT PRIMARY KEY,
 "remittanceId" TEXT NOT NULL,
 "statementId" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "operationId" TEXT NOT NULL,
 CONSTRAINT "fi_remittance_allocation_u0" UNIQUE ("remittanceId", "statementId"),
 CONSTRAINT "fi_remittance_allocation_u1" UNIQUE ("operationId"),
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_remittance_allocation_i0" ON "fi_remittance_allocation" ("statementId");
CREATE INDEX "fi_remittance_allocation_i1" ON "fi_remittance_allocation" ("remittanceId");

CREATE TABLE "fi_payout_intent" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "holdId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "state" TEXT NOT NULL,
 "externalRequestKey" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_payout_intent_u0" UNIQUE ("holdId"),
 CONSTRAINT "fi_payout_intent_u1" UNIQUE ("operationId"),
 CONSTRAINT "fi_payout_intent_u2" UNIQUE ("externalRequestKey")
);
CREATE INDEX "fi_payout_intent_i0" ON "fi_payout_intent" ("sellerId");

CREATE TABLE "fi_payout_evidence" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "holdId" TEXT NOT NULL,
 "sourceAccountRef" TEXT NOT NULL,
 "bankReference" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "verifiedBy" TEXT NOT NULL,
 "verifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_payout_evidence_u0" UNIQUE ("holdId"),
 CONSTRAINT "fi_payout_evidence_u1" UNIQUE ("sourceAccountRef", "bankReference"),
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_payout_evidence_i0" ON "fi_payout_evidence" ("sellerId");
CREATE INDEX "fi_payout_evidence_i1" ON "fi_payout_evidence" ("verifiedBy");

CREATE TABLE "fi_payout_event" (
 "id" TEXT PRIMARY KEY,
 "intentId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "sequence" INTEGER NOT NULL,
 "state" TEXT NOT NULL,
 "evidenceClass" TEXT NOT NULL,
 "evidenceRef" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_payout_event_u0" UNIQUE ("operationId"),
 CONSTRAINT "fi_payout_event_u1" UNIQUE ("intentId", "sequence")
);
CREATE INDEX "fi_payout_event_i0" ON "fi_payout_event" ("intentId");

CREATE TABLE "fi_settlement_link" (
 "shipmentId" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "settlementLineId" TEXT NOT NULL,
 "matchId" TEXT NOT NULL,
 CONSTRAINT "fi_settlement_link_u0" UNIQUE ("settlementLineId"),
 CONSTRAINT "fi_settlement_link_u1" UNIQUE ("matchId")
);
CREATE INDEX "fi_settlement_link_i0" ON "fi_settlement_link" ("sellerId");

CREATE TABLE "fi_match_revocation" (
 "id" TEXT PRIMARY KEY,
 "matchId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_match_revocation_u0" UNIQUE ("matchId"),
 CONSTRAINT "fi_match_revocation_u1" UNIQUE ("operationId")
);

CREATE TABLE "fi_operation_receipt" (
 "operationId" TEXT PRIMARY KEY,
 "result" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fi_stock_operation_receipt" (
 "operationId" TEXT PRIMARY KEY,
 "result" JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fi_policy_decision" (
 "id" TEXT PRIMARY KEY,
 "code" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "ownerId" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "terms" JSONB NOT NULL,
 "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_policy_decision_u0" UNIQUE ("code", "version")
);
CREATE INDEX "fi_policy_decision_i0" ON "fi_policy_decision" ("ownerId");

CREATE TABLE "fi_policy_revocation" (
 "id" TEXT PRIMARY KEY,
 "decisionId" TEXT NOT NULL,
 "revokedBy" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_policy_revocation_u0" UNIQUE ("decisionId")
);
CREATE INDEX "fi_policy_revocation_i0" ON "fi_policy_revocation" ("revokedBy");

CREATE TABLE "fi_wallet_entitlement" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "amount" NUMERIC(65,30) NOT NULL,
 "policyApprovalRef" TEXT NOT NULL,
 "approvedBy" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "settlementMatchId" TEXT,
 "dispositionId" TEXT,
 "quantity" INTEGER,
 CONSTRAINT "fi_wallet_entitlement_u0" UNIQUE ("operationId"),
 CONSTRAINT "fi_wallet_entitlement_u1" UNIQUE ("settlementMatchId"),
 CONSTRAINT "fi_wallet_entitlement_u2" UNIQUE ("dispositionId"),
 CHECK (fi_money_ok("amount"))
);
CREATE INDEX "fi_wallet_entitlement_i0" ON "fi_wallet_entitlement" ("sellerId");
CREATE INDEX "fi_wallet_entitlement_i1" ON "fi_wallet_entitlement" ("policyApprovalRef");
CREATE INDEX "fi_wallet_entitlement_i2" ON "fi_wallet_entitlement" ("approvedBy");

CREATE TABLE "fi_line_charge" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "lineId" TEXT NOT NULL,
 "snapshotId" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "unitCharge" NUMERIC(65,30) NOT NULL,
 "orderFee" NUMERIC(65,30) NOT NULL,
 CONSTRAINT "fi_line_charge_u0" UNIQUE ("lineId"),
 CONSTRAINT "fi_line_charge_u1" UNIQUE ("operationId", "lineId"),
 CHECK (fi_money_ok("unitCharge")),
 CHECK (fi_money_ok("orderFee"))
);
CREATE INDEX "fi_line_charge_i0" ON "fi_line_charge" ("sellerId");
CREATE INDEX "fi_line_charge_i1" ON "fi_line_charge" ("snapshotId", "sellerId", "lineId");
CREATE INDEX "fi_line_charge_i2" ON "fi_line_charge" ("operationId", "sellerId");

CREATE TABLE "fi_shipment_terms" (
 "id" TEXT PRIMARY KEY,
 "sellerId" TEXT NOT NULL,
 "shipmentId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "source" TEXT NOT NULL,
 "expectedCod" NUMERIC(65,30),
 "currency" TEXT NOT NULL,
 "evidenceHash" TEXT NOT NULL,
 "policyApprovalRef" TEXT NOT NULL,
 "operationId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "fi_shipment_terms_u0" UNIQUE ("shipmentId", "version"),
 CONSTRAINT "fi_shipment_terms_u1" UNIQUE ("id", "sellerId", "shipmentId"),
 CONSTRAINT "fi_shipment_terms_u2" UNIQUE ("operationId"),
 CHECK (fi_money_ok("expectedCod"))
);
CREATE INDEX "fi_shipment_terms_i0" ON "fi_shipment_terms" ("sellerId");
CREATE INDEX "fi_shipment_terms_i1" ON "fi_shipment_terms" ("shipmentId", "sellerId");
CREATE INDEX "fi_shipment_terms_i2" ON "fi_shipment_terms" ("policyApprovalRef");
ALTER TABLE "fi_operation" ADD CONSTRAINT "fi_operation_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_ledger_account" ADD CONSTRAINT "fi_ledger_account_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet" ADD CONSTRAINT "fi_wallet_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_withdrawal_hold" ADD CONSTRAINT "fi_withdrawal_hold_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_funding_claim" ADD CONSTRAINT "fi_funding_claim_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_journal" ADD CONSTRAINT "fi_journal_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_posting" ADD CONSTRAINT "fi_posting_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_event" ADD CONSTRAINT "fi_wallet_event_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_order_line" ADD CONSTRAINT "fi_order_line_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_snapshot" ADD CONSTRAINT "fi_cost_snapshot_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_cost_recognition_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_operation" ADD CONSTRAINT "fi_stock_operation_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_reservation" ADD CONSTRAINT "fi_reservation_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment" ADD CONSTRAINT "fi_shipment_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_item" ADD CONSTRAINT "fi_shipment_item_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_return_receipt" ADD CONSTRAINT "fi_return_receipt_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_disposition" ADD CONSTRAINT "fi_disposition_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_stock_movement_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_settlement_match_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_intent" ADD CONSTRAINT "fi_payout_intent_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_evidence" ADD CONSTRAINT "fi_payout_evidence_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_link" ADD CONSTRAINT "fi_settlement_link_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_wallet_entitlement_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_line_charge" ADD CONSTRAINT "fi_line_charge_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_terms" ADD CONSTRAINT "fi_shipment_terms_seller_fk" FOREIGN KEY ("sellerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_opening_evidence" ADD CONSTRAINT "FiOpeningEvidence_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_operation" ADD CONSTRAINT "FiOperation_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_warehouse_grant" ADD CONSTRAINT "FiWarehouseGrant_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_warehouse_grant" ADD CONSTRAINT "FiWarehouseGrant_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_grant_revocation" ADD CONSTRAINT "FiGrantRevocation_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_operation" ADD CONSTRAINT "FiStockOperation_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_funding_evidence" ADD CONSTRAINT "FiFundingEvidence_verifiedBy_fk" FOREIGN KEY ("verifiedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_remittance" ADD CONSTRAINT "FiRemittance_verifiedBy_fk" FOREIGN KEY ("verifiedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_ledger_account" ADD CONSTRAINT "fi_account_opening_fk" FOREIGN KEY ("openingEvidenceId") REFERENCES "fi_opening_evidence" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet" ADD CONSTRAINT "fi_wallet_opening_fk" FOREIGN KEY ("openingEvidenceId") REFERENCES "fi_opening_evidence" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet" ADD CONSTRAINT "fi_wallet_legacy_fk" FOREIGN KEY ("legacyWalletId") REFERENCES "wallet" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet" ADD CONSTRAINT "fi_wallet_account_fk" FOREIGN KEY ("ledgerAccountId", "sellerId") REFERENCES "fi_ledger_account" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_withdrawal_hold" ADD CONSTRAINT "fi_hold_wallet_fk" FOREIGN KEY ("walletId", "sellerId") REFERENCES "fi_wallet" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_withdrawal_hold" ADD CONSTRAINT "fi_hold_operation_fk" FOREIGN KEY ("createdOperationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_withdrawal_hold" ADD CONSTRAINT "fi_hold_request_fk" FOREIGN KEY ("legacyRequestId") REFERENCES "withdrawalrequest" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_funding_claim" ADD CONSTRAINT "fi_funding_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_funding_claim" ADD CONSTRAINT "fi_claim_evidence_fk" FOREIGN KEY ("evidenceId") REFERENCES "fi_funding_evidence" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_funding_claim" ADD CONSTRAINT "fi_claim_deposit_fk" FOREIGN KEY ("legacyDepositId") REFERENCES "depositrequest" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_journal" ADD CONSTRAINT "fi_journal_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_journal" ADD CONSTRAINT "fi_journal_match_fk" FOREIGN KEY ("settlementMatchId", "sellerId") REFERENCES "fi_settlement_match" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_posting" ADD CONSTRAINT "fi_posting_journal_fk" FOREIGN KEY ("journalId", "sellerId") REFERENCES "fi_journal" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_posting" ADD CONSTRAINT "fi_posting_account_fk" FOREIGN KEY ("accountId") REFERENCES "fi_ledger_account" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_posting" ADD CONSTRAINT "fi_posting_reversal_fk" FOREIGN KEY ("reversalOfId") REFERENCES "fi_posting" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_event" ADD CONSTRAINT "fi_event_wallet_fk" FOREIGN KEY ("walletId", "sellerId") REFERENCES "fi_wallet" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_event" ADD CONSTRAINT "fi_event_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_event" ADD CONSTRAINT "fi_event_hold_fk" FOREIGN KEY ("holdId", "sellerId") REFERENCES "fi_withdrawal_hold" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_event" ADD CONSTRAINT "fi_event_journal_fk" FOREIGN KEY ("journalId", "sellerId") REFERENCES "fi_journal" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_order_line" ADD CONSTRAINT "fi_line_legacy_fk" FOREIGN KEY ("legacyOrderId") REFERENCES "order" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_order_line" ADD CONSTRAINT "fi_line_product_fk" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_order_line" ADD CONSTRAINT "fi_line_operation_fk" FOREIGN KEY ("createdOperationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_snapshot" ADD CONSTRAINT "fi_snapshot_line_fk" FOREIGN KEY ("lineId", "sellerId") REFERENCES "fi_order_line" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_snapshot" ADD CONSTRAINT "fi_snapshot_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_recognition_snapshot_fk" FOREIGN KEY ("snapshotId", "sellerId", "lineId") REFERENCES "fi_cost_snapshot" ("id", "sellerId", "lineId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_recognition_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_recognition_reversal_fk" FOREIGN KEY ("reversalOfId") REFERENCES "fi_cost_recognition" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_recognition_disposition_fk" FOREIGN KEY ("dispositionId", "sellerId") REFERENCES "fi_disposition" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_grant_revocation" ADD CONSTRAINT "fi_grant_revocation_fk" FOREIGN KEY ("grantId") REFERENCES "fi_warehouse_grant" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_operation" ADD CONSTRAINT "fi_stock_grant_fk" FOREIGN KEY ("grantId") REFERENCES "fi_warehouse_grant" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_operation" ADD CONSTRAINT "fi_stock_financial_fk" FOREIGN KEY ("financialOperationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_balance" ADD CONSTRAINT "fi_stock_product_fk" FOREIGN KEY ("productId") REFERENCES "product" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_balance" ADD CONSTRAINT "fi_stock_opening_fk" FOREIGN KEY ("openingEvidenceId") REFERENCES "fi_opening_evidence" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_reservation" ADD CONSTRAINT "fi_reservation_line_fk" FOREIGN KEY ("lineId", "sellerId", "productId") REFERENCES "fi_order_line" ("id", "sellerId", "productId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_reservation" ADD CONSTRAINT "fi_reservation_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_stock_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment" ADD CONSTRAINT "fi_shipment_carrier_fk" FOREIGN KEY ("carrierAccountId") REFERENCES "fi_carrier_account" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment" ADD CONSTRAINT "fi_shipment_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_stock_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_item" ADD CONSTRAINT "fi_item_shipment_fk" FOREIGN KEY ("shipmentId", "sellerId") REFERENCES "fi_shipment" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_item" ADD CONSTRAINT "fi_item_reservation_fk" FOREIGN KEY ("reservationId", "sellerId", "productId") REFERENCES "fi_reservation" ("id", "sellerId", "productId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_item" ADD CONSTRAINT "fi_item_line_fk" FOREIGN KEY ("lineId", "sellerId", "productId") REFERENCES "fi_order_line" ("id", "sellerId", "productId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_item" ADD CONSTRAINT "fi_item_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_stock_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_return_receipt" ADD CONSTRAINT "fi_receipt_item_fk" FOREIGN KEY ("shipmentItemId", "sellerId") REFERENCES "fi_shipment_item" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_return_receipt" ADD CONSTRAINT "fi_receipt_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_stock_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_disposition" ADD CONSTRAINT "fi_disposition_receipt_fk" FOREIGN KEY ("receiptId", "sellerId") REFERENCES "fi_return_receipt" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_disposition" ADD CONSTRAINT "fi_disposition_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_stock_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_operation_fk" FOREIGN KEY ("operationId") REFERENCES "fi_stock_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_product_fk" FOREIGN KEY ("productId") REFERENCES "fi_stock_balance" ("productId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_reservation_fk" FOREIGN KEY ("reservationId", "sellerId", "productId") REFERENCES "fi_reservation" ("id", "sellerId", "productId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_item_fk" FOREIGN KEY ("shipmentItemId", "sellerId") REFERENCES "fi_shipment_item" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_receipt_fk" FOREIGN KEY ("receiptId", "sellerId") REFERENCES "fi_return_receipt" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_movement" ADD CONSTRAINT "fi_movement_disposition_fk" FOREIGN KEY ("dispositionId", "sellerId") REFERENCES "fi_disposition" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_carrier_observation" ADD CONSTRAINT "fi_observation_account_fk" FOREIGN KEY ("carrierAccountId") REFERENCES "fi_carrier_account" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_statement" ADD CONSTRAINT "fi_statement_account_fk" FOREIGN KEY ("carrierAccountId") REFERENCES "fi_carrier_account" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_line" ADD CONSTRAINT "fi_settlement_statement_fk" FOREIGN KEY ("statementId", "carrierAccountId") REFERENCES "fi_settlement_statement" ("id", "carrierAccountId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_match_shipment_fk" FOREIGN KEY ("shipmentId", "sellerId") REFERENCES "fi_shipment" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_match_settlement_fk" FOREIGN KEY ("settlementLineId", "carrierAccountId") REFERENCES "fi_settlement_line" ("id", "carrierAccountId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_match_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_remittance_allocation" ADD CONSTRAINT "fi_allocation_remittance_fk" FOREIGN KEY ("remittanceId") REFERENCES "fi_remittance" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_remittance_allocation" ADD CONSTRAINT "fi_allocation_statement_fk" FOREIGN KEY ("statementId") REFERENCES "fi_settlement_statement" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_remittance_allocation" ADD CONSTRAINT "fi_allocation_operation_fk" FOREIGN KEY ("operationId") REFERENCES "fi_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_intent" ADD CONSTRAINT "fi_payout_hold_fk" FOREIGN KEY ("holdId", "sellerId") REFERENCES "fi_withdrawal_hold" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_intent" ADD CONSTRAINT "fi_payout_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_evidence" ADD CONSTRAINT "fi_payout_evidence_hold_fk" FOREIGN KEY ("holdId", "sellerId") REFERENCES "fi_withdrawal_hold" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_evidence" ADD CONSTRAINT "fi_payout_evidence_actor_fk" FOREIGN KEY ("verifiedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_event" ADD CONSTRAINT "fi_payout_event_intent_fk" FOREIGN KEY ("intentId") REFERENCES "fi_payout_intent" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_payout_event" ADD CONSTRAINT "fi_payout_event_operation_fk" FOREIGN KEY ("operationId") REFERENCES "fi_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_link" ADD CONSTRAINT "fi_active_match_fk" FOREIGN KEY ("matchId", "sellerId") REFERENCES "fi_settlement_match" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_link" ADD CONSTRAINT "fi_active_line_fk" FOREIGN KEY ("settlementLineId") REFERENCES "fi_settlement_line" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_link" ADD CONSTRAINT "fi_active_shipment_fk" FOREIGN KEY ("shipmentId", "sellerId") REFERENCES "fi_shipment" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_match_revocation" ADD CONSTRAINT "fi_match_revocation_fk" FOREIGN KEY ("matchId") REFERENCES "fi_settlement_match" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_match_revocation" ADD CONSTRAINT "fi_match_revoke_operation_fk" FOREIGN KEY ("operationId") REFERENCES "fi_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_operation_receipt" ADD CONSTRAINT "fi_operation_receipt_fk" FOREIGN KEY ("operationId") REFERENCES "fi_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_stock_operation_receipt" ADD CONSTRAINT "fi_stock_receipt_fk" FOREIGN KEY ("operationId") REFERENCES "fi_stock_operation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_operation" ADD CONSTRAINT "fi_operation_policy_fk" FOREIGN KEY ("policyDecisionId") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_policy_decision" ADD CONSTRAINT "fi_policy_owner_fk" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_policy_revocation" ADD CONSTRAINT "fi_policy_revocation_fk" FOREIGN KEY ("decisionId") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_policy_revocation" ADD CONSTRAINT "fi_policy_revoke_actor_fk" FOREIGN KEY ("revokedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_cost_recognition" ADD CONSTRAINT "fi_recognition_policy_fk" FOREIGN KEY ("policyApprovalRef") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_match_policy_fk" FOREIGN KEY ("policyApprovalRef") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_entitlement_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_entitlement_match_fk" FOREIGN KEY ("settlementMatchId", "sellerId") REFERENCES "fi_settlement_match" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_entitlement_disposition_fk" FOREIGN KEY ("dispositionId", "sellerId") REFERENCES "fi_disposition" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_entitlement_policy_fk" FOREIGN KEY ("policyApprovalRef") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_wallet_entitlement" ADD CONSTRAINT "fi_entitlement_actor_fk" FOREIGN KEY ("approvedBy") REFERENCES "user" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_line_charge" ADD CONSTRAINT "fi_charge_line_fk" FOREIGN KEY ("lineId", "sellerId") REFERENCES "fi_order_line" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_line_charge" ADD CONSTRAINT "fi_charge_snapshot_fk" FOREIGN KEY ("snapshotId", "sellerId", "lineId") REFERENCES "fi_cost_snapshot" ("id", "sellerId", "lineId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_line_charge" ADD CONSTRAINT "fi_charge_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_terms" ADD CONSTRAINT "fi_terms_shipment_fk" FOREIGN KEY ("shipmentId", "sellerId") REFERENCES "fi_shipment" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_terms" ADD CONSTRAINT "fi_terms_operation_fk" FOREIGN KEY ("operationId", "sellerId") REFERENCES "fi_operation" ("id", "sellerId") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_shipment_terms" ADD CONSTRAINT "fi_terms_policy_fk" FOREIGN KEY ("policyApprovalRef") REFERENCES "fi_policy_decision" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "fi_settlement_match" ADD CONSTRAINT "fi_match_terms_fk" FOREIGN KEY ("termsId", "sellerId", "shipmentId") REFERENCES "fi_shipment_terms" ("id", "sellerId", "shipmentId") ON UPDATE RESTRICT ON DELETE RESTRICT;
REVOKE ALL ON TABLE "fi_opening_evidence" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_operation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_ledger_account" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_wallet" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_withdrawal_hold" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_funding_evidence" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_funding_claim" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_journal" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_posting" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_wallet_event" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_order_line" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_cost_snapshot" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_cost_recognition" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_warehouse_grant" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_grant_revocation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_stock_operation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_stock_balance" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_reservation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_carrier_account" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_shipment" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_shipment_item" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_return_receipt" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_disposition" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_stock_movement" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_carrier_observation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_settlement_statement" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_settlement_line" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_settlement_match" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_remittance" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_remittance_allocation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_payout_intent" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_payout_evidence" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_payout_event" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_settlement_link" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_match_revocation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_operation_receipt" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_stock_operation_receipt" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_policy_decision" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_policy_revocation" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_wallet_entitlement" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_line_charge" FROM PUBLIC;
REVOKE ALL ON TABLE "fi_shipment_terms" FROM PUBLIC;

REVOKE ALL ON FUNCTION fi_money_ok(numeric) FROM PUBLIC;
-- Included before COMMIT in each DDL phase. 001 rejects any pre-existing fi_ object.
DO $private_new_objects$
DECLARE r record; gr text;
BEGIN
 FOR r IN SELECT c.oid,c.relname,c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND left(c.relname,3)='fi_' AND c.relkind='r' LOOP
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',r.relname);
  FOR gr IN SELECT pg_get_userbyid(a.grantee) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=r.oid AND a.grantee<>0 AND a.grantee<>r.relowner LOOP
   EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',r.relname,gr);
  END LOOP;
 END LOOP;
 FOR r IN SELECT p.oid,p.proname,p.proowner,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND left(p.proname,3)='fi_' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %I(%s) FROM PUBLIC',r.proname,r.args);
  FOR gr IN SELECT pg_get_userbyid(a.grantee) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=r.oid AND a.grantee<>0 AND a.grantee<>r.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %I(%s) FROM %I',r.proname,r.args,gr);
  END LOOP;
 END LOOP;
END $private_new_objects$;

COMMIT;
