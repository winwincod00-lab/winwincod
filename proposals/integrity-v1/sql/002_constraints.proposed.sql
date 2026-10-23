-- PROPOSED ONLY: constraints and immutable facts. PostgreSQL execution still required.
BEGIN;
SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
DO $gate$
DECLARE s text:=current_setting('winwincod.integrity_schema',true);
BEGIN
 IF s IS NULL OR coalesce(current_setting('winwincod.integrity_baseline_approval',true),'')='' THEN RAISE EXCEPTION 'Approved schema/baseline required'; END IF;
 PERFORM set_config('search_path',format('%I, pg_catalog, pg_temp',s),true);
 IF to_regclass('fi_operation') IS NULL THEN RAISE EXCEPTION 'Expand migration missing'; END IF;
END $gate$;
ALTER TABLE fi_ledger_account ADD CHECK (kind IN ('SELLER_WALLET','BANK_CLEARING','CARRIER_CLEARING','PLATFORM_CLEARING','ADJUSTMENT_CLEARING') AND ((kind='SELLER_WALLET')=("sellerId" IS NOT NULL)));
ALTER TABLE fi_opening_evidence ADD CHECK ("entityKind" IN ('WALLET','STOCK','LEDGER') AND length("entityId")>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_wallet ADD CHECK ("openingBalance">=0 AND balance>=held AND held>=0);
ALTER TABLE fi_withdrawal_hold ADD CHECK (amount>0 AND remaining BETWEEN 0 AND amount AND state IN ('ACTIVE','RELEASED','CONSUMED') AND ((state='ACTIVE' AND remaining=amount) OR (state<>'ACTIVE' AND remaining=0)) AND length("payoutSnapshot")>0);
ALTER TABLE fi_operation ADD CHECK (length("requestKey")>0 AND length("businessKey")>0 AND "payloadHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_funding_evidence ADD CHECK (amount>0 AND length("externalRef")>0 AND length("sourceAccountRef")>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_wallet_event ADD CHECK (kind IN ('CREDIT','DEBIT','HOLD','RELEASE','CONSUME') AND
 ((kind='CREDIT' AND "cashDelta">0 AND "heldDelta"=0 AND "holdId" IS NULL) OR (kind='DEBIT' AND "cashDelta"<0 AND "heldDelta"=0 AND "holdId" IS NULL) OR
 (kind='HOLD' AND "cashDelta"=0 AND "heldDelta">0 AND "holdId" IS NOT NULL) OR (kind='RELEASE' AND "cashDelta"=0 AND "heldDelta"<0 AND "holdId" IS NOT NULL) OR
 (kind='CONSUME' AND "cashDelta"<0 AND "heldDelta"="cashDelta" AND "holdId" IS NOT NULL)) AND (("cashDelta"=0 AND "journalId" IS NULL) OR ("cashDelta"<>0 AND "journalId" IS NOT NULL)));
ALTER TABLE fi_posting ADD CHECK (amount<>0 AND id IS DISTINCT FROM "reversalOfId");
ALTER TABLE fi_order_line ADD CHECK (quantity>0);
ALTER TABLE fi_cost_snapshot ADD CHECK (version>0 AND source IN ('UNKNOWN','AT_CREATION','AT_SUBMISSION','EVIDENCE_REVIEW') AND ("sellerUnitCost" IS NULL OR "sellerUnitCost">=0) AND ("supplierUnitCost" IS NULL OR "supplierUnitCost">=0) AND
 ((source='UNKNOWN' AND "sellerUnitCost" IS NULL AND "supplierUnitCost" IS NULL AND "capturedAt" IS NULL) OR
 (source IN ('AT_CREATION','AT_SUBMISSION') AND "sellerUnitCost" IS NOT NULL AND "supplierUnitCost" IS NOT NULL AND "operationId" IS NOT NULL AND "capturedAt" IS NOT NULL) OR
 (source='EVIDENCE_REVIEW' AND ("sellerUnitCost" IS NOT NULL OR "supplierUnitCost" IS NOT NULL) AND "evidenceHash" IS NOT NULL AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "operationId" IS NOT NULL AND "capturedAt" IS NOT NULL)));
ALTER TABLE fi_cost_recognition ADD CHECK ("quantityDelta"<>0 AND length("policyApprovalRef")>0 AND basis IN ('DELIVERY','SETTLEMENT','INSPECTED_RETURN','LOSS') AND (("quantityDelta">0 AND "reversalOfId" IS NULL) OR ("quantityDelta"<0 AND "reversalOfId" IS NOT NULL AND "dispositionId" IS NOT NULL)));
ALTER TABLE fi_stock_balance ADD CHECK ("openingAvailable">=0 AND available>=0 AND reserved>=0 AND "inTransit">=0 AND "returnedPendingInspection">=0 AND damaged>=0);
ALTER TABLE fi_reservation ADD CHECK (units>0 AND remaining>=0 AND dispatched>=0 AND released>=0 AND units=remaining+dispatched+released);
ALTER TABLE fi_shipment_item ADD CHECK (units>0 AND delivered>=0 AND returned>=0 AND delivered+returned<=units);
ALTER TABLE fi_return_receipt ADD CHECK (units>0 AND length("warehouseRef")>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_disposition ADD CHECK (kind IN ('SELLABLE','DAMAGED') AND units>0 AND moved BETWEEN 0 AND units);
ALTER TABLE fi_stock_operation ADD CHECK (kind IN ('RESERVE','RELEASE','DISPATCH','DELIVER','RECEIVE_RETURN','INSPECT_RETURN','RESTOCK','DISPOSE_DAMAGED','ADJUST') AND length(reason)>0 AND length("requestKey")>0 AND length("businessKey")>0 AND "payloadHash" ~ '^[a-f0-9]{64}$' AND ("financialOperationId" IS NULL OR "sellerId" IS NOT NULL) AND (kind<>'ADJUST' OR ("evidenceHash" IS NOT NULL AND "evidenceHash" ~ '^[a-f0-9]{64}$')));
ALTER TABLE fi_stock_movement ADD CHECK (units>0 AND sequence>=0 AND "fromBucket"<>"toBucket" AND "fromBucket" IN ('EXTERNAL','AVAILABLE','RESERVED','IN_TRANSIT','RETURNED_PENDING_INSPECTION','DAMAGED') AND "toBucket" IN ('EXTERNAL','AVAILABLE','RESERVED','IN_TRANSIT','RETURNED_PENDING_INSPECTION','DAMAGED') AND (("reservationId" IS NULL AND "shipmentItemId" IS NULL AND "receiptId" IS NULL AND "dispositionId" IS NULL) OR "sellerId" IS NOT NULL));
ALTER TABLE fi_shipment ADD CHECK ("expectedCod" IS NULL OR "expectedCod">=0);
ALTER TABLE fi_shipment_terms ADD CHECK (version>0 AND source IN ('ORDER_COD','AGREED_PARTIAL_COD','CORRECTION') AND ("expectedCod" IS NULL OR "expectedCod">=0) AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_settlement_line ADD CHECK ("grossCod">=0 AND "carrierFee">=0 AND "netRemittance"="grossCod"-"carrierFee"+adjustment);
ALTER TABLE fi_remittance ADD CHECK (amount>0 AND length("bankReference")>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_remittance_allocation ADD CHECK (amount>0);
ALTER TABLE fi_payout_intent ADD CHECK (state IN ('READY','SENDING','UNKNOWN','CONFIRMED','VOID') AND length("externalRequestKey")>0);
ALTER TABLE fi_payout_evidence ADD CHECK (amount>0 AND length("bankReference")>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE fi_payout_event ADD CHECK (sequence>0 AND state IN ('READY','SENDING','UNKNOWN','CONFIRMED','VOID') AND length("evidenceRef")>0);
ALTER TABLE fi_policy_decision ADD CHECK (version>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof(terms)='object' AND jsonb_exists(terms,'approvedOperationKinds') AND jsonb_typeof(terms->'approvedOperationKinds')='array');
ALTER TABLE fi_policy_revocation ADD CHECK (length(reason)>0);
ALTER TABLE fi_wallet_entitlement ADD CHECK (amount>0 AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND (("settlementMatchId" IS NOT NULL AND "dispositionId" IS NULL AND quantity IS NULL) OR ("settlementMatchId" IS NULL AND "dispositionId" IS NOT NULL AND quantity IS NOT NULL AND quantity>0)));
ALTER TABLE fi_line_charge ADD CHECK ("unitCharge">=0 AND "orderFee"=20);
CREATE UNIQUE INDEX fi_one_creation_snapshot ON fi_cost_snapshot("lineId") WHERE source='AT_CREATION';

CREATE FUNCTION fi_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN RAISE EXCEPTION 'Append-only fact: % cannot be updated, deleted or truncated',TG_TABLE_NAME; END $$;

CREATE FUNCTION fi_projection_identity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE permitted text[];
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Projection identity cannot be deleted/truncated'; END IF;
 permitted := CASE TG_TABLE_NAME
 WHEN 'fi_wallet' THEN ARRAY['balance','held','activatedAt']
 WHEN 'fi_stock_balance' THEN ARRAY['available','reserved','inTransit','returnedPendingInspection','damaged','activatedAt']
 WHEN 'fi_reservation' THEN ARRAY['remaining','dispatched','released']
 WHEN 'fi_withdrawal_hold' THEN ARRAY['remaining','state']
 WHEN 'fi_shipment_item' THEN ARRAY['delivered','returned']
 WHEN 'fi_disposition' THEN ARRAY['moved']
 WHEN 'fi_payout_intent' THEN ARRAY['state'] END;
 IF (to_jsonb(NEW)-permitted) IS DISTINCT FROM (to_jsonb(OLD)-permitted) THEN RAISE EXCEPTION 'Immutable projection identity changed'; END IF;
 IF TG_TABLE_NAME IN ('fi_wallet','fi_stock_balance') AND to_jsonb(OLD)->>'activatedAt' IS NOT NULL AND (to_jsonb(NEW)->>'activatedAt') IS DISTINCT FROM (to_jsonb(OLD)->>'activatedAt') THEN RAISE EXCEPTION 'Activation is irreversible without reviewed recovery'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_journal_balanced() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE j text; n bigint; total numeric; bad bigint;
BEGIN
 j := to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='fi_journal' THEN 'id' ELSE 'journalId' END;
 SELECT count(*),coalesce(sum(amount),0) INTO n,total FROM fi_posting WHERE "journalId"=j;
 IF n<2 OR total<>0 THEN RAISE EXCEPTION 'Unbalanced/empty journal %',j; END IF;
 SELECT count(*) INTO bad FROM fi_posting p JOIN fi_ledger_account a ON a.id=p."accountId" JOIN fi_journal h ON h.id=p."journalId"
 WHERE h.id=j AND (a.currency<>h.currency OR (a."sellerId" IS NOT NULL AND a."sellerId"<>h."sellerId"));
 IF bad<>0 THEN RAISE EXCEPTION 'Cross-tenant/currency posting'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_wallet_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; w fi_wallet%ROWTYPE; cash numeric; holds numeric; posted numeric;
BEGIN
 k := to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='fi_wallet' THEN 'id' ELSE 'walletId' END;
 SELECT * INTO STRICT w FROM fi_wallet WHERE id=k FOR UPDATE;
 SELECT coalesce(sum("cashDelta"),0),coalesce(sum("heldDelta"),0) INTO cash,holds FROM fi_wallet_event WHERE "walletId"=k;
 SELECT coalesce(sum(amount),0) INTO posted FROM fi_posting WHERE "accountId"=w."ledgerAccountId";
 IF w.balance<>w."openingBalance"+cash OR w.held<>holds OR posted<>-cash THEN RAISE EXCEPTION 'Wallet projection/journal drift'; END IF;
 IF EXISTS (SELECT 1 FROM fi_ledger_account a WHERE a.id=w."ledgerAccountId" AND (a.kind<>'SELLER_WALLET' OR a."sellerId" IS DISTINCT FROM w."sellerId" OR a."openingDebitBalance"<>-w."openingBalance")) THEN RAISE EXCEPTION 'Invalid wallet ledger account'; END IF;
 IF EXISTS (SELECT 1 FROM fi_wallet_event e WHERE e."walletId"=k AND e."cashDelta"<>0 AND
  (SELECT coalesce(sum(p.amount),0) FROM fi_posting p WHERE p."journalId"=e."journalId" AND p."accountId"=w."ledgerAccountId")<>-e."cashDelta") THEN RAISE EXCEPTION 'Wallet event lacks matching posting'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_posting_wallet_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE w fi_wallet%ROWTYPE; cash numeric; holds numeric; posted numeric;
BEGIN
 SELECT * INTO w FROM fi_wallet WHERE "ledgerAccountId"=NEW."accountId" FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum("cashDelta"),0),coalesce(sum("heldDelta"),0) INTO cash,holds FROM fi_wallet_event WHERE "walletId"=w.id;
 SELECT coalesce(sum(amount),0) INTO posted FROM fi_posting WHERE "accountId"=w."ledgerAccountId";
 IF w.balance<>w."openingBalance"+cash OR w.held<>holds OR posted<>-cash THEN RAISE EXCEPTION 'Wallet posting/cache drift'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_stock_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p text; b fi_stock_balance%ROWTYPE; bucket text; expected bigint; actual bigint;
BEGIN
 p:=NEW."productId";
 SELECT * INTO STRICT b FROM fi_stock_balance WHERE "productId"=p FOR UPDATE;
 FOREACH bucket IN ARRAY ARRAY['AVAILABLE','RESERVED','IN_TRANSIT','RETURNED_PENDING_INSPECTION','DAMAGED'] LOOP
  SELECT coalesce(sum(CASE WHEN "toBucket"=bucket THEN units ELSE 0 END)-sum(CASE WHEN "fromBucket"=bucket THEN units ELSE 0 END),0) INTO expected FROM fi_stock_movement WHERE "productId"=p;
  actual := CASE bucket WHEN 'AVAILABLE' THEN b.available WHEN 'RESERVED' THEN b.reserved WHEN 'IN_TRANSIT' THEN b."inTransit" WHEN 'RETURNED_PENDING_INSPECTION' THEN b."returnedPendingInspection" ELSE b.damaged END;
  IF bucket='AVAILABLE' THEN expected:=expected+b."openingAvailable"; END IF;
  IF actual<>expected THEN RAISE EXCEPTION 'Stock projection drift: % %',p,bucket; END IF;
 END LOOP;
 IF b.reserved<>(SELECT coalesce(sum(remaining),0) FROM fi_reservation WHERE "productId"=p) THEN RAISE EXCEPTION 'Reservation/cache drift'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_aggregate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; n bigint; max_n bigint; original fi_cost_recognition%ROWTYPE; post fi_posting%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='fi_disposition' THEN
  PERFORM 1 FROM fi_return_receipt WHERE id=NEW."receiptId" FOR UPDATE;
  SELECT units INTO max_n FROM fi_return_receipt WHERE id=NEW."receiptId";
  SELECT coalesce(sum(units),0) INTO n FROM fi_disposition WHERE "receiptId"=NEW."receiptId";
  IF n>max_n THEN RAISE EXCEPTION 'Inspection exceeds physically received quantity'; END IF;
  IF NEW.moved<>(SELECT coalesce(sum(units),0) FROM fi_stock_movement WHERE "dispositionId"=NEW.id) THEN RAISE EXCEPTION 'Disposition moved counter drift'; END IF;
 ELSIF TG_TABLE_NAME='fi_return_receipt' THEN
  PERFORM 1 FROM fi_shipment_item WHERE id=NEW."shipmentItemId" FOR UPDATE;
  SELECT units-delivered INTO max_n FROM fi_shipment_item WHERE id=NEW."shipmentItemId";
  SELECT coalesce(sum(units),0) INTO n FROM fi_return_receipt WHERE "shipmentItemId"=NEW."shipmentItemId";
  IF n>max_n THEN RAISE EXCEPTION 'Return receipt exceeds outstanding shipment units'; END IF;
  IF NEW.units<>(SELECT coalesce(sum(units),0) FROM fi_stock_movement WHERE "receiptId"=NEW.id AND "toBucket"='RETURNED_PENDING_INSPECTION') THEN RAISE EXCEPTION 'Receipt lacks physical quarantine movement'; END IF;
 ELSIF TG_TABLE_NAME='fi_shipment_item' THEN
  PERFORM 1 FROM fi_reservation WHERE id=NEW."reservationId" FOR UPDATE;
  SELECT dispatched INTO max_n FROM fi_reservation WHERE id=NEW."reservationId";
  SELECT coalesce(sum(units),0) INTO n FROM fi_shipment_item WHERE "reservationId"=NEW."reservationId";
  IF n<>max_n THEN RAISE EXCEPTION 'Dispatched reservation/item mismatch'; END IF;
  IF NEW.units<>(SELECT coalesce(sum(units),0) FROM fi_stock_movement WHERE "shipmentItemId"=NEW.id AND "toBucket"='IN_TRANSIT') OR NEW.delivered<>(SELECT coalesce(sum(units),0) FROM fi_stock_movement WHERE "shipmentItemId"=NEW.id AND "toBucket"='EXTERNAL') OR NEW.returned<>(SELECT coalesce(sum(units),0) FROM fi_return_receipt WHERE "shipmentItemId"=NEW.id) THEN RAISE EXCEPTION 'Shipment item lacks matching dispatch/delivery/return facts'; END IF;
 ELSIF TG_TABLE_NAME='fi_cost_recognition' THEN
  PERFORM 1 FROM fi_order_line WHERE id=NEW."lineId" FOR UPDATE;
  SELECT quantity INTO max_n FROM fi_order_line WHERE id=NEW."lineId";
  SELECT coalesce(sum("quantityDelta"),0) INTO n FROM fi_cost_recognition WHERE "lineId"=NEW."lineId";
  IF n<0 OR n>max_n THEN RAISE EXCEPTION 'COGS quantity exceeds line'; END IF;
  IF NEW."reversalOfId" IS NOT NULL THEN
   SELECT * INTO STRICT original FROM fi_cost_recognition WHERE id=NEW."reversalOfId" FOR UPDATE;
   IF original."quantityDelta"<=0 OR original."snapshotId"<>NEW."snapshotId" OR original."lineId"<>NEW."lineId" OR original."sellerId"<>NEW."sellerId" OR
    (SELECT -sum("quantityDelta") FROM fi_cost_recognition WHERE "reversalOfId"=original.id)>original."quantityDelta" THEN RAISE EXCEPTION 'Invalid/excess COGS reversal'; END IF;
   IF NOT EXISTS(SELECT 1 FROM fi_disposition d JOIN fi_return_receipt r ON r.id=d."receiptId" JOIN fi_shipment_item i ON i.id=r."shipmentItemId" WHERE d.id=NEW."dispositionId" AND d.kind='SELLABLE' AND i."lineId"=NEW."lineId") THEN RAISE EXCEPTION 'COGS reversal requires matching inspected sellable return'; END IF;
   IF (SELECT -sum("quantityDelta") FROM fi_cost_recognition WHERE "dispositionId"=NEW."dispositionId")>(SELECT units FROM fi_disposition WHERE id=NEW."dispositionId") THEN RAISE EXCEPTION 'COGS reversal exceeds disposition'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='fi_posting' AND NEW."reversalOfId" IS NOT NULL THEN
  SELECT * INTO STRICT post FROM fi_posting WHERE id=NEW."reversalOfId" FOR UPDATE;
  IF post."accountId"<>NEW."accountId" OR post."sellerId"<>NEW."sellerId" OR post.amount*NEW.amount>=0 OR
   (SELECT sum(abs(amount)) FROM fi_posting WHERE "reversalOfId"=post.id)>abs(post.amount) THEN RAISE EXCEPTION 'Invalid/excess journal reversal'; END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_line_binding() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE o record; op fi_operation%ROWTYPE;
BEGIN
 SELECT "sellerId","productId",quantity INTO STRICT o FROM "order" WHERE id=NEW."legacyOrderId" FOR KEY SHARE;
 IF o."sellerId"<>NEW."sellerId" OR o."productId" IS DISTINCT FROM NEW."productId" OR o.quantity<>NEW.quantity THEN RAISE EXCEPTION 'Legacy line ownership/product/quantity mismatch'; END IF;
 IF NEW."createdOperationId" IS NOT NULL THEN
  SELECT * INTO STRICT op FROM fi_operation WHERE id=NEW."createdOperationId";
  IF op.kind<>'ORDER_CREATE' OR op."businessKey"<>NEW."legacyOrderId" THEN RAISE EXCEPTION 'Wrong creation operation'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_snapshot_binding() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE l fi_order_line%ROWTYPE; op fi_operation%ROWTYPE;
BEGIN
 SELECT * INTO STRICT l FROM fi_order_line WHERE id=NEW."lineId" FOR UPDATE;
 IF NEW.source='AT_CREATION' AND NEW."operationId" IS DISTINCT FROM l."createdOperationId" THEN RAISE EXCEPTION 'Snapshot must belong to creation operation'; END IF;
 IF NEW.source='AT_SUBMISSION' THEN
  SELECT * INTO STRICT op FROM fi_operation WHERE id=NEW."operationId";
  IF op.kind<>'BATCH_SUBMISSION' THEN RAISE EXCEPTION 'Submission-time quote operation required'; END IF;
 END IF;
 IF NEW.source='EVIDENCE_REVIEW' THEN
  SELECT * INTO STRICT op FROM fi_operation WHERE id=NEW."operationId";
  IF op.kind<>'COST_EVIDENCE_REVIEW' THEN RAISE EXCEPTION 'Reviewed evidence operation required'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_completion_required() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE total numeric; pcs bigint; op fi_operation%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='fi_operation' THEN
  op:=NEW;
  IF op.kind IN ('WITHDRAWAL_REQUEST','WITHDRAWAL_APPROVAL','WITHDRAWAL_REJECTION','DEPOSIT_APPROVAL','MANUAL_TOPUP','SETTLEMENT_CREDIT','RETURN_REFUND') AND NOT EXISTS(SELECT 1 FROM fi_wallet_event WHERE "operationId"=op.id AND kind=CASE op.kind WHEN 'WITHDRAWAL_REQUEST' THEN 'HOLD' WHEN 'WITHDRAWAL_APPROVAL' THEN 'CONSUME' WHEN 'WITHDRAWAL_REJECTION' THEN 'RELEASE' ELSE 'CREDIT' END) THEN RAISE EXCEPTION 'Financial effect missing from completed operation'; END IF;
  IF op.kind='BATCH_PAYMENT' THEN
   SELECT sum(l.quantity),sum(c."unitCharge"*l.quantity+c."orderFee") INTO pcs,total FROM fi_line_charge c JOIN fi_order_line l ON l.id=c."lineId" WHERE c."operationId"=op.id;
   IF EXISTS(SELECT 1 FROM fi_line_charge c JOIN fi_order_line l ON l.id=c."lineId" JOIN "order" o ON o.id=l."legacyOrderId" WHERE c."operationId"=op.id AND o."batchId" IS DISTINCT FROM op."businessKey") THEN RAISE EXCEPTION 'Charge belongs to another batch'; END IF;
   IF pcs IS NULL OR pcs<5 OR NOT EXISTS(SELECT 1 FROM fi_wallet_event WHERE "operationId"=op.id AND kind='DEBIT' AND -"cashDelta"=total) THEN RAISE EXCEPTION 'Payment lacks five PCS, immutable allocations and exact debit'; END IF;
   IF NOT EXISTS(SELECT 1 FROM orderbatch WHERE id=op."businessKey" AND "sellerId"=op."sellerId" AND "isPaid" AND "totalAmount"=total) THEN RAISE EXCEPTION 'Batch/payment mismatch'; END IF;
   IF EXISTS(SELECT 1 FROM "order" o LEFT JOIN fi_order_line l ON l."legacyOrderId"=o.id LEFT JOIN fi_line_charge c ON c."lineId"=l.id LEFT JOIN fi_reservation r ON r."lineId"=l.id LEFT JOIN fi_stock_operation so ON so.id=r."operationId" WHERE o."batchId"=op."businessKey" AND (o."sellerId"<>op."sellerId" OR o.status::text<>'PROCESSING' OR c."operationId" IS DISTINCT FROM op.id OR so."financialOperationId" IS DISTINCT FROM op.id OR r.remaining IS DISTINCT FROM o.quantity OR r.dispatched<>0 OR r.released<>0)) THEN RAISE EXCEPTION 'Every paid unit must be reserved at commit, never auto-dispatched'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='fi_operation' AND NOT EXISTS(SELECT 1 FROM fi_operation_receipt WHERE "operationId"=NEW.id) THEN RAISE EXCEPTION 'Financial operation cannot commit without receipt'; END IF;
 IF TG_TABLE_NAME='fi_stock_operation' AND NOT EXISTS(SELECT 1 FROM fi_stock_operation_receipt WHERE "operationId"=NEW.id) THEN RAISE EXCEPTION 'Stock operation cannot commit without receipt'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_hold_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; h fi_withdrawal_hold%ROWTYPE; expected numeric; r record;
BEGIN
 k:=to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='fi_withdrawal_hold' THEN 'id' ELSE 'holdId' END;
 IF k IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT h FROM fi_withdrawal_hold WHERE id=k FOR UPDATE;
 SELECT coalesce(sum("heldDelta"),0) INTO expected FROM fi_wallet_event WHERE "holdId"=k;
 SELECT "sellerId",amount,status INTO STRICT r FROM withdrawalrequest WHERE id=h."legacyRequestId";
 IF expected<>h.remaining OR r."sellerId"<>h."sellerId" OR r.amount<>h.amount THEN RAISE EXCEPTION 'Hold projection/request drift'; END IF;
 IF (h.state='CONSUMED' AND r.status::text<>'APPROVED') OR (h.state='RELEASED' AND r.status::text<>'REJECTED') THEN RAISE EXCEPTION 'Hold/request decision mismatch'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_settlement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE m fi_settlement_match%ROWTYPE; s fi_shipment%ROWTYPE; l fi_settlement_line%ROWTYPE; old_match text; terms fi_shipment_terms%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='fi_settlement_link' THEN
  IF TG_OP IN ('UPDATE','DELETE') THEN
   old_match:=OLD."matchId";
   IF NOT EXISTS(SELECT 1 FROM fi_match_revocation WHERE "matchId"=old_match) THEN RAISE EXCEPTION 'Append revocation before replacing/removing active match'; END IF;
   IF EXISTS(SELECT 1 FROM fi_posting p JOIN fi_journal j ON j.id=p."journalId" WHERE j."settlementMatchId"=old_match AND
    (SELECT coalesce(sum(abs(r.amount)),0) FROM fi_posting r WHERE r."reversalOfId"=p.id)<>abs(p.amount)) THEN RAISE EXCEPTION 'Posted match must be fully reversed before unlinking'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN NULL; END IF;
  SELECT * INTO STRICT m FROM fi_settlement_match WHERE id=NEW."matchId";
  IF m."shipmentId"<>NEW."shipmentId" OR m."settlementLineId"<>NEW."settlementLineId" OR m."sellerId"<>NEW."sellerId" OR EXISTS(SELECT 1 FROM fi_match_revocation WHERE "matchId"=m.id) THEN RAISE EXCEPTION 'Active match identity/revocation mismatch'; END IF;
 ELSIF TG_TABLE_NAME='fi_journal' THEN
  IF NEW."settlementMatchId" IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO STRICT m FROM fi_settlement_match WHERE id=NEW."settlementMatchId";
  IF NOT EXISTS(SELECT 1 FROM fi_settlement_link WHERE "matchId"=m.id) OR EXISTS(SELECT 1 FROM fi_match_revocation WHERE "matchId"=m.id) THEN RAISE EXCEPTION 'Settlement journal requires active unrevoked match'; END IF;
 ELSE
  m:=NEW;
 END IF;
 SELECT * INTO STRICT s FROM fi_shipment WHERE id=m."shipmentId";
 SELECT * INTO STRICT l FROM fi_settlement_line WHERE id=m."settlementLineId";
 SELECT * INTO STRICT terms FROM fi_shipment_terms WHERE id=m."termsId" AND "shipmentId"=m."shipmentId" AND "sellerId"=m."sellerId";
 IF s."carrierAccountId" IS DISTINCT FROM l."carrierAccountId" OR s."externalRef" IS NULL OR s."externalRef" IS DISTINCT FROM l."externalShipmentRef" OR terms."expectedCod" IS NULL OR terms."expectedCod"<>l."grossCod" OR terms.currency<>l.currency OR s.currency<>l.currency OR m."carrierAccountId"<>l."carrierAccountId" THEN RAISE EXCEPTION 'Missing/mismatched shipment settlement'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_remittance_caps() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE paid numeric; allocated numeric; net numeric;
BEGIN
 PERFORM 1 FROM fi_remittance WHERE id=NEW."remittanceId" FOR UPDATE;
 PERFORM 1 FROM fi_settlement_statement WHERE id=NEW."statementId" FOR UPDATE;
 SELECT amount INTO STRICT paid FROM fi_remittance WHERE id=NEW."remittanceId";
 SELECT coalesce(sum(amount),0) INTO allocated FROM fi_remittance_allocation WHERE "remittanceId"=NEW."remittanceId";
 IF allocated>paid THEN RAISE EXCEPTION 'Bank remittance allocated twice'; END IF;
 SELECT coalesce(sum("netRemittance"),0) INTO net FROM fi_settlement_line WHERE "statementId"=NEW."statementId";
 SELECT coalesce(sum(amount),0) INTO allocated FROM fi_remittance_allocation WHERE "statementId"=NEW."statementId";
 IF allocated>net THEN RAISE EXCEPTION 'Statement over-remitted'; END IF;
 IF (SELECT currency FROM fi_remittance WHERE id=NEW."remittanceId") IS DISTINCT FROM (SELECT currency FROM fi_settlement_statement WHERE id=NEW."statementId") THEN RAISE EXCEPTION 'Remittance currency mismatch'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_activation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE o fi_opening_evidence%ROWTYPE; legacy record;
BEGIN
 IF NEW."activatedAt" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD."activatedAt" IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO STRICT o FROM fi_opening_evidence WHERE id=NEW."openingEvidenceId";
 IF TG_TABLE_NAME='fi_wallet' THEN
  SELECT "userId",balance INTO STRICT legacy FROM wallet WHERE id=NEW."legacyWalletId" FOR UPDATE;
  IF o."entityKind"<>'WALLET' OR o."entityId"<>NEW."legacyWalletId" OR legacy."userId"<>NEW."sellerId" OR legacy.balance<>NEW."openingBalance" THEN RAISE EXCEPTION 'Wallet opening evidence/legacy mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM withdrawalrequest r WHERE r."sellerId"=NEW."sellerId" AND r.status::text='PENDING' AND NOT EXISTS(SELECT 1 FROM fi_withdrawal_hold h WHERE h."legacyRequestId"=r.id AND h.state='ACTIVE')) THEN RAISE EXCEPTION 'Unresolved pending legacy withdrawal'; END IF;
 ELSE
  IF o."entityKind"<>'STOCK' OR o."entityId"<>NEW."productId" THEN RAISE EXCEPTION 'Stock opening evidence mismatch'; END IF;
  PERFORM 1 FROM product WHERE id=NEW."productId" FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "order" WHERE "productId"=NEW."productId" AND status::text IN ('PROCESSING','SHIPPED')) THEN RAISE EXCEPTION 'Drain/reconcile legacy in-flight stock before cutover'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_stock_shape() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE o fi_stock_operation%ROWTYPE; expected_from text; expected_to text;
BEGIN
 SELECT * INTO STRICT o FROM fi_stock_operation WHERE id=NEW."operationId";
 IF NEW."sellerId" IS DISTINCT FROM o."sellerId" THEN RAISE EXCEPTION 'Movement/operation tenant mismatch'; END IF;
 expected_from:=CASE o.kind WHEN 'RESERVE' THEN 'AVAILABLE' WHEN 'RELEASE' THEN 'RESERVED' WHEN 'DISPATCH' THEN 'RESERVED' WHEN 'DELIVER' THEN 'IN_TRANSIT' WHEN 'RECEIVE_RETURN' THEN 'IN_TRANSIT' WHEN 'RESTOCK' THEN 'RETURNED_PENDING_INSPECTION' WHEN 'DISPOSE_DAMAGED' THEN 'RETURNED_PENDING_INSPECTION' END;
 expected_to:=CASE o.kind WHEN 'RESERVE' THEN 'RESERVED' WHEN 'RELEASE' THEN 'AVAILABLE' WHEN 'DISPATCH' THEN 'IN_TRANSIT' WHEN 'DELIVER' THEN 'EXTERNAL' WHEN 'RECEIVE_RETURN' THEN 'RETURNED_PENDING_INSPECTION' WHEN 'RESTOCK' THEN 'AVAILABLE' WHEN 'DISPOSE_DAMAGED' THEN 'DAMAGED' END;
 IF o.kind='ADJUST' THEN
  IF NEW."sellerId" IS NOT NULL OR NOT ((NEW."fromBucket"='EXTERNAL' AND NEW."toBucket"='AVAILABLE') OR (NEW."fromBucket"='AVAILABLE' AND NEW."toBucket"='EXTERNAL')) THEN RAISE EXCEPTION 'Adjustment cannot impersonate a return/restock/reservation'; END IF;
 ELSIF expected_from IS NULL OR NEW."fromBucket"<>expected_from OR NEW."toBucket"<>expected_to THEN RAISE EXCEPTION 'Movement/state-machine mismatch'; END IF;
 IF o.kind IN ('RESERVE','RELEASE') AND (NEW."reservationId" IS NULL OR NEW."shipmentItemId" IS NOT NULL OR NEW."receiptId" IS NOT NULL OR NEW."dispositionId" IS NOT NULL) THEN RAISE EXCEPTION 'Reservation linkage required'; END IF;
 IF o.kind='DISPATCH' AND (NEW."reservationId" IS NULL OR NEW."shipmentItemId" IS NULL OR NEW."receiptId" IS NOT NULL OR NEW."dispositionId" IS NOT NULL) THEN RAISE EXCEPTION 'Dispatch linkage required'; END IF;
 IF o.kind='DELIVER' AND (NEW."shipmentItemId" IS NULL OR NEW."reservationId" IS NOT NULL OR NEW."receiptId" IS NOT NULL OR NEW."dispositionId" IS NOT NULL) THEN RAISE EXCEPTION 'Delivery linkage required'; END IF;
 IF o.kind='RECEIVE_RETURN' AND (NEW."shipmentItemId" IS NULL OR NEW."receiptId" IS NULL OR NEW."reservationId" IS NOT NULL OR NEW."dispositionId" IS NOT NULL) THEN RAISE EXCEPTION 'Physical return linkage required'; END IF;
 IF o.kind IN ('RESTOCK','DISPOSE_DAMAGED') AND (NEW."dispositionId" IS NULL OR NEW."reservationId" IS NOT NULL OR NEW."shipmentItemId" IS NOT NULL OR NEW."receiptId" IS NOT NULL) THEN RAISE EXCEPTION 'Inspection disposition linkage required'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_revocation_final() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_settlement_link WHERE "matchId"=NEW."matchId") THEN RAISE EXCEPTION 'Revoked match cannot remain active'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_payout_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE i fi_payout_intent%ROWTYPE; latest text; h fi_withdrawal_hold%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='fi_payout_intent' THEN SELECT * INTO STRICT i FROM fi_payout_intent WHERE id=NEW.id FOR UPDATE;
 ELSE SELECT * INTO STRICT i FROM fi_payout_intent WHERE id=NEW."intentId" FOR UPDATE; END IF;
 SELECT state INTO latest FROM fi_payout_event WHERE "intentId"=i.id ORDER BY sequence DESC LIMIT 1;
 IF latest IS DISTINCT FROM i.state THEN RAISE EXCEPTION 'Payout state requires matching append-only event'; END IF;
 IF TG_TABLE_NAME='fi_payout_event' THEN
  IF (NEW.state='VOID' AND NEW."evidenceClass"<>'BANK_NOT_PAID_VERIFIED') OR (NEW.state='CONFIRMED' AND NEW."evidenceClass"<>'BANK_CONFIRMED') THEN RAISE EXCEPTION 'Definitive evidence required; timeout is not failure proof'; END IF;
 END IF;
 SELECT * INTO STRICT h FROM fi_withdrawal_hold WHERE id=i."holdId";
 IF i.state IN ('READY','SENDING','UNKNOWN') AND h.state<>'ACTIVE' THEN RAISE EXCEPTION 'In-flight/unknown payout must retain hold'; END IF;
 IF i.state='CONFIRMED' AND h.state<>'CONSUMED' THEN RAISE EXCEPTION 'Confirmation, bank evidence, wallet consumption and request APPROVED must commit together'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION fi_open_operation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE k text; stock boolean:=TG_ARGV[1]='stock';
BEGIN
 k:=to_jsonb(NEW)->>TG_ARGV[0]; IF k IS NULL THEN RETURN NEW; END IF;
 IF stock THEN
  PERFORM 1 FROM fi_stock_operation WHERE id=k FOR UPDATE;
  IF EXISTS(SELECT 1 FROM fi_stock_operation_receipt WHERE "operationId"=k) THEN RAISE EXCEPTION 'Cannot append effects to closed stock operation'; END IF;
 ELSE
  PERFORM 1 FROM fi_operation WHERE id=k FOR UPDATE;
  IF EXISTS(SELECT 1 FROM fi_operation_receipt WHERE "operationId"=k) THEN RAISE EXCEPTION 'Cannot append effects to closed financial operation'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_entitlement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE op fi_operation%ROWTYPE; statement text; received numeric; expected numeric;
BEGIN
 SELECT * INTO STRICT op FROM fi_operation WHERE id=NEW."operationId";
 IF op."policyDecisionId"<>NEW."policyApprovalRef" OR NOT EXISTS(SELECT 1 FROM "user" WHERE id=NEW."approvedBy" AND role::text='ADMIN' AND "isActive") THEN RAISE EXCEPTION 'Explicit active approval required'; END IF;
 IF op.kind='SETTLEMENT_CREDIT' THEN
  IF NEW."settlementMatchId" IS DISTINCT FROM op."businessKey" THEN RAISE EXCEPTION 'Settlement entitlement identity mismatch'; END IF;
  SELECT l."statementId" INTO STRICT statement FROM fi_settlement_match m JOIN fi_settlement_link active ON active."matchId"=m.id JOIN fi_settlement_line l ON l.id=m."settlementLineId" WHERE m.id=NEW."settlementMatchId";
  SELECT coalesce(sum(amount),0) INTO received FROM fi_remittance_allocation WHERE "statementId"=statement;
  SELECT coalesce(sum("netRemittance"),0) INTO expected FROM fi_settlement_line WHERE "statementId"=statement;
  IF expected<=0 OR received<>expected THEN RAISE EXCEPTION 'Bank remittance not fully reconciled; no assumed carrier payment'; END IF;
 ELSIF op.kind='RETURN_REFUND' THEN
  IF NEW."dispositionId" IS DISTINCT FROM op."businessKey" OR NEW.quantity>(SELECT units FROM fi_disposition WHERE id=NEW."dispositionId") THEN RAISE EXCEPTION 'Refund entitlement exceeds inspected disposition'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported entitlement policy'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_posting_open_journal() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE op text;
BEGIN
 SELECT "operationId" INTO STRICT op FROM fi_journal WHERE id=NEW."journalId";
 PERFORM 1 FROM fi_operation WHERE id=op FOR UPDATE;
 IF EXISTS(SELECT 1 FROM fi_operation_receipt WHERE "operationId"=op) THEN RAISE EXCEPTION 'Completed journal cannot acquire postings'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION fi_charge_binding() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fi_cost_snapshot WHERE id=NEW."snapshotId" AND "sellerId"=NEW."sellerId" AND "lineId"=NEW."lineId" AND "sellerUnitCost"=NEW."unitCharge") THEN RAISE EXCEPTION 'Unknown or mismatched immutable charge snapshot'; END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_opening_evidence FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_operation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_ledger_account FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_funding_evidence FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_funding_claim FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_journal FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_posting FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_wallet_event FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_order_line FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_cost_snapshot FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_cost_recognition FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_warehouse_grant FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_grant_revocation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_stock_operation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_carrier_account FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_shipment FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_return_receipt FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_stock_movement FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_carrier_observation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_settlement_statement FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_settlement_line FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_settlement_match FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_remittance FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_remittance_allocation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_payout_evidence FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_payout_event FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_match_revocation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_operation_receipt FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_stock_operation_receipt FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_policy_decision FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_policy_revocation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_wallet_entitlement FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_line_charge FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON fi_shipment_terms FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_wallet FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_wallet FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_stock_balance FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_stock_balance FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_reservation FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_reservation FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_withdrawal_hold FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_withdrawal_hold FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_shipment_item FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_shipment_item FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_disposition FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_disposition FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON fi_payout_intent FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();
CREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON fi_payout_intent FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE CONSTRAINT TRIGGER fi_balanced_header AFTER INSERT ON fi_journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_journal_balanced();
CREATE CONSTRAINT TRIGGER fi_balanced_posting AFTER INSERT ON fi_posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_journal_balanced();
CREATE CONSTRAINT TRIGGER fi_wallet_cache AFTER INSERT OR UPDATE ON fi_wallet DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_wallet_projection();
CREATE CONSTRAINT TRIGGER fi_wallet_events AFTER INSERT ON fi_wallet_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_wallet_projection();
CREATE CONSTRAINT TRIGGER fi_wallet_postings AFTER INSERT ON fi_posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_posting_wallet_projection();
CREATE CONSTRAINT TRIGGER fi_stock_projection AFTER INSERT OR UPDATE ON fi_stock_balance DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_stock_projection();
CREATE CONSTRAINT TRIGGER fi_stock_projection AFTER INSERT ON fi_stock_movement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_stock_projection();
CREATE CONSTRAINT TRIGGER fi_stock_projection AFTER INSERT OR UPDATE ON fi_reservation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_stock_projection();
CREATE CONSTRAINT TRIGGER fi_aggregate AFTER INSERT OR UPDATE ON fi_disposition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_aggregate_guard();
CREATE CONSTRAINT TRIGGER fi_aggregate AFTER INSERT OR UPDATE ON fi_return_receipt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_aggregate_guard();
CREATE CONSTRAINT TRIGGER fi_aggregate AFTER INSERT OR UPDATE ON fi_shipment_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_aggregate_guard();
CREATE CONSTRAINT TRIGGER fi_aggregate AFTER INSERT OR UPDATE ON fi_cost_recognition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_aggregate_guard();
CREATE CONSTRAINT TRIGGER fi_aggregate AFTER INSERT OR UPDATE ON fi_posting DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_aggregate_guard();
CREATE TRIGGER fi_line_binding BEFORE INSERT ON fi_order_line FOR EACH ROW EXECUTE FUNCTION fi_line_binding();
CREATE TRIGGER fi_snapshot_binding BEFORE INSERT ON fi_cost_snapshot FOR EACH ROW EXECUTE FUNCTION fi_snapshot_binding();
CREATE CONSTRAINT TRIGGER fi_operation_complete AFTER INSERT ON fi_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_completion_required();
CREATE CONSTRAINT TRIGGER fi_stock_complete AFTER INSERT ON fi_stock_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_completion_required();
CREATE CONSTRAINT TRIGGER fi_hold_cache AFTER INSERT OR UPDATE ON fi_withdrawal_hold DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_hold_projection();
CREATE CONSTRAINT TRIGGER fi_hold_events AFTER INSERT ON fi_wallet_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_hold_projection();
CREATE CONSTRAINT TRIGGER fi_match_math AFTER INSERT ON fi_settlement_match DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_settlement_guard();
CREATE CONSTRAINT TRIGGER fi_active_match AFTER INSERT OR UPDATE OR DELETE ON fi_settlement_link DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_settlement_guard();
CREATE CONSTRAINT TRIGGER fi_match_journal AFTER INSERT ON fi_journal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_settlement_guard();
CREATE CONSTRAINT TRIGGER fi_revocation_final AFTER INSERT ON fi_match_revocation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_revocation_final();
CREATE TRIGGER fi_link_no_truncate BEFORE TRUNCATE ON fi_settlement_link FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();
CREATE CONSTRAINT TRIGGER fi_remittance_cap AFTER INSERT ON fi_remittance_allocation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_remittance_caps();
CREATE TRIGGER fi_wallet_activation BEFORE INSERT OR UPDATE ON fi_wallet FOR EACH ROW EXECUTE FUNCTION fi_activation_guard();
CREATE TRIGGER fi_stock_activation BEFORE INSERT OR UPDATE ON fi_stock_balance FOR EACH ROW EXECUTE FUNCTION fi_activation_guard();
CREATE TRIGGER fi_stock_shape BEFORE INSERT ON fi_stock_movement FOR EACH ROW EXECUTE FUNCTION fi_stock_shape();
CREATE CONSTRAINT TRIGGER fi_payout_state AFTER INSERT OR UPDATE ON fi_payout_intent DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_payout_guard();
CREATE CONSTRAINT TRIGGER fi_payout_event AFTER INSERT ON fi_payout_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_payout_guard();
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_journal FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_wallet_event FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_funding_claim FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_cost_recognition FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_payout_event FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_remittance_allocation FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_wallet_entitlement FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_line_charge FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_shipment_terms FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_withdrawal_hold FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('createdOperationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_order_line FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('createdOperationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_cost_snapshot FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_payout_intent FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_settlement_match FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','financial');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_reservation FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_shipment FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_shipment_item FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_return_receipt FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_disposition FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_open_op BEFORE INSERT ON fi_stock_movement FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');
CREATE TRIGGER fi_entitlement BEFORE INSERT ON fi_wallet_entitlement FOR EACH ROW EXECUTE FUNCTION fi_entitlement_guard();
CREATE TRIGGER fi_posting_open BEFORE INSERT ON fi_posting FOR EACH ROW EXECUTE FUNCTION fi_posting_open_journal();
CREATE TRIGGER fi_charge_binding BEFORE INSERT ON fi_line_charge FOR EACH ROW EXECUTE FUNCTION fi_charge_binding();
ALTER TABLE fi_ledger_account ADD CHECK (currency='MAD');
ALTER TABLE fi_funding_evidence ADD CHECK (currency='MAD');
ALTER TABLE fi_journal ADD CHECK (currency='MAD');
ALTER TABLE fi_cost_snapshot ADD CHECK (currency='MAD');
ALTER TABLE fi_shipment ADD CHECK (currency='MAD');
ALTER TABLE fi_settlement_statement ADD CHECK (currency='MAD');
ALTER TABLE fi_settlement_line ADD CHECK (currency='MAD');
ALTER TABLE fi_remittance ADD CHECK (currency='MAD');
ALTER TABLE fi_payout_evidence ADD CHECK (currency='MAD');
ALTER TABLE fi_shipment_terms ADD CHECK (currency='MAD');

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
