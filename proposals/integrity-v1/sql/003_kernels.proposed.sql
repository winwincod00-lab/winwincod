-- PROPOSED ONLY. Internal transaction kernels, NOT public APIs or deployed adapters.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $gate$
DECLARE s text:=current_setting('winwincod.integrity_schema',true);
BEGIN
 IF s IS NULL OR current_setting('winwincod.integrity_baseline_approval',true) IS NULL THEN RAISE EXCEPTION 'Approved schema/baseline required'; END IF;
 PERFORM set_config('search_path',format('%I, pg_catalog, pg_temp',s),true);
END $gate$;
CREATE FUNCTION fi_serializable() RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'Serializable transaction required'; END IF; END $$;
CREATE FUNCTION fi_parse_money(v text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path FROM CURRENT AS $$
BEGIN
 IF v IS NULL OR v !~ '^-?[0-9]{1,35}([.][0-9]{1,30})?$' THEN RAISE EXCEPTION 'Exact numeric(65,30) decimal string required'; END IF;
 RETURN v::numeric; -- validate BEFORE assigning typmod; never silently round excess fractional digits.
END $$;
CREATE FUNCTION fi_actor(actor text, allowed text[]) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "user" WHERE id=actor AND "isActive" AND role::text=ANY(allowed)) THEN RAISE EXCEPTION 'Current active role required'; END IF;
END $$;
CREATE FUNCTION fi_warehouse_authority(operation_id text, capability text) RETURNS fi_stock_operation LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE o fi_stock_operation%ROWTYPE;
BEGIN
 SELECT * INTO STRICT o FROM fi_stock_operation WHERE id=operation_id;
 PERFORM fi_actor(o."actorId",ARRAY['ADMIN']);
 IF NOT EXISTS(SELECT 1 FROM fi_warehouse_grant g WHERE g.id=o."grantId" AND g."actorId"=o."actorId" AND g.capability=fi_warehouse_authority.capability AND NOT EXISTS(SELECT 1 FROM fi_grant_revocation r WHERE r."grantId"=g.id)) THEN RAISE EXCEPTION 'Explicit audited warehouse grant required'; END IF;
 RETURN o;
END $$;

-- Claim request AND business identity. A collision is a read-only recovery case, never a blind effect retry.
CREATE FUNCTION fi_claim_operation(p_id text,p_seller text,p_kind text,p_request text,p_business text,p_hash text,p_actor text,p_policy text) RETURNS text LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r fi_operation%ROWTYPE; matches int;
BEGIN
 PERFORM fi_serializable();
 PERFORM fi_actor(p_actor,ARRAY['SELLER','ADMIN']);
 IF p_actor<>p_seller AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=p_actor AND role::text='ADMIN') THEN RAISE EXCEPTION 'Seller scope mismatch'; END IF;
 SELECT count(*) INTO matches FROM fi_operation WHERE "sellerId"=p_seller AND kind=p_kind AND ("requestKey"=p_request OR "businessKey"=p_business);
 IF matches>1 THEN RAISE EXCEPTION 'Conflicting operation identities: manual review'; END IF;
 IF matches=1 THEN
  SELECT * INTO STRICT r FROM fi_operation WHERE "sellerId"=p_seller AND kind=p_kind AND ("requestKey"=p_request OR "businessKey"=p_business);
  IF r."payloadHash"<>p_hash OR r."businessKey"<>p_business OR r."policyDecisionId"<>p_policy THEN RAISE EXCEPTION 'Idempotency payload mismatch'; END IF;
  RETURN r.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM fi_policy_decision d WHERE d.id=p_policy AND jsonb_exists(d.terms->'approvedOperationKinds',p_kind) AND NOT EXISTS(SELECT 1 FROM fi_policy_revocation WHERE "decisionId"=d.id)) THEN RAISE EXCEPTION 'Unrevoked owner-approved operation policy required'; END IF;
 INSERT INTO fi_operation(id,"sellerId",kind,"requestKey","businessKey","payloadHash","policyDecisionId","actorId") VALUES(p_id,p_seller,p_kind,p_request,p_business,p_hash,p_policy,p_actor);
 RETURN p_id;
END $$;

CREATE FUNCTION fi_wallet_apply(p_event text,p_operation text,p_wallet text,p_kind text,p_amount text,p_hold text,p_counterparty text,p_journal text,p_payout_snapshot text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE op fi_operation%ROWTYPE; w fi_wallet%ROWTYPE; h fi_withdrawal_hold%ROWTYPE; prior fi_wallet_event%ROWTYPE; a numeric; cash numeric:=0; held_change numeric:=0; r record;
BEGIN
 PERFORM fi_serializable(); a:=fi_parse_money(p_amount);
 IF a<=0 THEN RAISE EXCEPTION 'Positive amount required'; END IF;
 SELECT * INTO STRICT op FROM fi_operation WHERE id=p_operation FOR UPDATE;
 SELECT * INTO STRICT w FROM fi_wallet WHERE id=p_wallet AND "sellerId"=op."sellerId" FOR UPDATE;
 IF w."activatedAt" IS NULL THEN RAISE EXCEPTION 'Wallet not activated/reconciled'; END IF;
 IF p_kind IN ('CREDIT','CONSUME','RELEASE') THEN PERFORM fi_actor(op."actorId",ARRAY['ADMIN']);
 ELSE PERFORM fi_actor(op."actorId",ARRAY['SELLER']); IF op."actorId"<>op."sellerId" THEN RAISE EXCEPTION 'Seller scope required'; END IF; END IF;
 IF NOT ((p_kind='CREDIT' AND op.kind IN ('DEPOSIT_APPROVAL','MANUAL_TOPUP','SETTLEMENT_CREDIT','RETURN_REFUND')) OR
 (p_kind='DEBIT' AND op.kind='BATCH_PAYMENT') OR (p_kind='HOLD' AND op.kind='WITHDRAWAL_REQUEST') OR
 (p_kind='RELEASE' AND op.kind='WITHDRAWAL_REJECTION') OR (p_kind='CONSUME' AND op.kind='WITHDRAWAL_APPROVAL')) THEN RAISE EXCEPTION 'Operation kind/effect mismatch'; END IF;
 cash:=CASE WHEN p_kind='CREDIT' THEN a WHEN p_kind IN ('DEBIT','CONSUME') THEN -a ELSE 0 END;
 held_change:=CASE WHEN p_kind='HOLD' THEN a WHEN p_kind IN ('RELEASE','CONSUME') THEN -a ELSE 0 END;
 SELECT * INTO prior FROM fi_wallet_event WHERE "walletId"=w.id AND "operationId"=op.id;
 IF FOUND THEN
  IF prior.kind<>p_kind OR prior."cashDelta"<>cash OR prior."heldDelta"<>held_change OR prior."holdId" IS DISTINCT FROM p_hold OR
   (cash<>0 AND NOT EXISTS(SELECT 1 FROM fi_posting WHERE "journalId"=prior."journalId" AND "accountId"=p_counterparty AND amount=cash)) THEN RAISE EXCEPTION 'Effect replay mismatch'; END IF;
  RETURN prior.id;
 END IF;
 IF EXISTS(SELECT 1 FROM fi_operation_receipt WHERE "operationId"=op.id) THEN RAISE EXCEPTION 'Completed operation cannot acquire new effects'; END IF;
 IF p_kind='CREDIT' AND op.kind IN ('DEPOSIT_APPROVAL','MANUAL_TOPUP') THEN
  SELECT e.amount,c."legacyDepositId" INTO STRICT r FROM fi_funding_claim c JOIN fi_funding_evidence e ON e.id=c."evidenceId" WHERE c."operationId"=op.id AND c."sellerId"=op."sellerId";
  IF r.amount<>a THEN RAISE EXCEPTION 'Funding evidence amount mismatch'; END IF;
  IF op.kind='DEPOSIT_APPROVAL' AND (r."legacyDepositId" IS NULL OR NOT EXISTS(SELECT 1 FROM depositrequest d WHERE d.id=r."legacyDepositId" AND d."sellerId"=op."sellerId" AND d.amount=a AND d.status::text='APPROVED')) THEN RAISE EXCEPTION 'Deposit decision/evidence mismatch'; END IF;
 END IF;
 IF p_kind='CREDIT' AND op.kind IN ('RETURN_REFUND','SETTLEMENT_CREDIT') THEN
  IF NOT EXISTS(SELECT 1 FROM fi_wallet_entitlement e WHERE e."operationId"=op.id AND e."sellerId"=op."sellerId" AND e.amount=a AND e."policyApprovalRef"=op."policyDecisionId") THEN RAISE EXCEPTION 'Explicit approved refund/profit entitlement required'; END IF;
 END IF;
 IF p_kind='DEBIT' THEN
  IF NOT EXISTS(SELECT 1 FROM orderbatch b WHERE b.id=op."businessKey" AND b."sellerId"=op."sellerId" AND b."isPaid" AND b."totalAmount"=a) OR
   NOT EXISTS(SELECT 1 FROM log WHERE id='batch-review:'||op."businessKey" AND action='BATCH_APPROVE') THEN RAISE EXCEPTION 'Paid, explicitly approved batch and exact quote required'; END IF;
 END IF;
 IF p_kind='HOLD' THEN
  SELECT "sellerId",amount,status INTO STRICT r FROM withdrawalrequest WHERE id=op."businessKey" FOR UPDATE;
  IF r."sellerId"<>op."sellerId" OR r.amount<>a OR r.status::text<>'PENDING' OR p_hold IS NULL OR p_payout_snapshot IS NULL OR length(p_payout_snapshot)=0 THEN RAISE EXCEPTION 'Withdrawal request/snapshot mismatch'; END IF;
  INSERT INTO fi_withdrawal_hold(id,"sellerId","walletId","legacyRequestId",amount,remaining,state,"payoutSnapshot","createdOperationId") VALUES(p_hold,op."sellerId",w.id,op."businessKey",a,a,'ACTIVE',p_payout_snapshot,op.id);
 ELSIF p_kind IN ('RELEASE','CONSUME') THEN
  SELECT * INTO STRICT h FROM fi_withdrawal_hold WHERE id=p_hold AND "walletId"=w.id AND "sellerId"=op."sellerId" FOR UPDATE;
  IF h.state<>'ACTIVE' OR h.remaining<>a OR h."legacyRequestId"<>op."businessKey" THEN RAISE EXCEPTION 'Whole active hold required'; END IF;
  IF p_kind='RELEASE' AND EXISTS(SELECT 1 FROM fi_payout_intent WHERE "holdId"=h.id AND state<>'VOID') THEN RAISE EXCEPTION 'In-flight/unknown payout cannot release funds'; END IF;
  IF p_kind='CONSUME' AND NOT EXISTS(SELECT 1 FROM fi_payout_evidence e JOIN fi_payout_intent i ON i."holdId"=e."holdId" WHERE e."holdId"=h.id AND e.amount=a AND i.state='CONFIRMED') THEN RAISE EXCEPTION 'Confirmed, uniquely evidenced bank payout required'; END IF;
  UPDATE fi_withdrawal_hold SET remaining=0,state=CASE WHEN p_kind='RELEASE' THEN 'RELEASED' ELSE 'CONSUMED' END WHERE id=h.id;
 END IF;
 UPDATE fi_wallet SET balance=balance+cash,held=held+held_change WHERE id=w.id AND balance+cash>=held+held_change AND held+held_change>=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
 IF cash<>0 THEN
  IF p_journal IS NULL OR NOT EXISTS(SELECT 1 FROM fi_ledger_account WHERE id=p_counterparty AND "sellerId" IS NULL AND kind<>'SELLER_WALLET' AND currency='MAD') THEN RAISE EXCEPTION 'Platform counterparty and journal required'; END IF;
  INSERT INTO fi_journal(id,"sellerId","operationId","settlementMatchId",currency) VALUES(p_journal,op."sellerId",op.id,CASE WHEN op.kind='SETTLEMENT_CREDIT' THEN op."businessKey" ELSE NULL END,'MAD');
  INSERT INTO fi_posting(id,"sellerId","journalId","accountId",amount) VALUES(p_event||':wallet',op."sellerId",p_journal,w."ledgerAccountId",-cash),(p_event||':counterparty',op."sellerId",p_journal,p_counterparty,cash);
 END IF;
 INSERT INTO fi_wallet_event(id,"sellerId","operationId","walletId",kind,"cashDelta","heldDelta","holdId","journalId") VALUES(p_event,op."sellerId",op.id,w.id,p_kind,cash,held_change,p_hold,CASE WHEN cash<>0 THEN p_journal ELSE NULL END);
 RETURN p_event;
END $$;

CREATE FUNCTION fi_reserve(p_id text,p_operation text,p_line text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE op fi_stock_operation%ROWTYPE; l fi_order_line%ROWTYPE; b fi_stock_balance%ROWTYPE; prior fi_reservation%ROWTYPE;
BEGIN
 PERFORM fi_serializable();
 SELECT * INTO STRICT op FROM fi_stock_operation WHERE id=p_operation FOR UPDATE;
 SELECT * INTO STRICT l FROM fi_order_line WHERE id=p_line AND "sellerId"=op."sellerId" FOR UPDATE;
 IF op.kind<>'RESERVE' OR op."financialOperationId" IS NULL THEN RAISE EXCEPTION 'Payment-linked reservation required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM fi_operation f JOIN "order" o ON o."batchId"=f."businessKey" JOIN orderbatch b ON b.id=o."batchId"
  WHERE f.id=op."financialOperationId" AND f.kind='BATCH_PAYMENT' AND f."sellerId"=l."sellerId" AND o.id=l."legacyOrderId" AND b."isPaid" AND o.status::text='PROCESSING' AND
  EXISTS(SELECT 1 FROM log WHERE id='batch-review:'||b.id AND action='BATCH_APPROVE')) THEN RAISE EXCEPTION 'Approved/paid batch claim required'; END IF;
 SELECT * INTO prior FROM fi_reservation WHERE "lineId"=l.id;
 IF FOUND THEN IF prior."operationId"<>op.id THEN RAISE EXCEPTION 'Line already reserved'; END IF; RETURN prior.id; END IF;
 SELECT * INTO STRICT b FROM fi_stock_balance WHERE "productId"=l."productId" FOR UPDATE;
 IF b."activatedAt" IS NULL OR b.available<l.quantity THEN RAISE EXCEPTION 'Stock inactive or insufficient'; END IF;
 UPDATE fi_stock_balance SET available=available-l.quantity,reserved=reserved+l.quantity WHERE "productId"=l."productId";
 INSERT INTO fi_reservation(id,"sellerId","lineId","productId",units,remaining,dispatched,released,"operationId") VALUES(p_id,l."sellerId",l.id,l."productId",l.quantity,l.quantity,0,0,op.id);
 INSERT INTO fi_stock_movement(id,"operationId",sequence,"sellerId","productId","fromBucket","toBucket",units,"reservationId") VALUES(p_id||':reserve',op.id,(SELECT count(*)::int FROM fi_stock_movement WHERE "operationId"=op.id),l."sellerId",l."productId",'AVAILABLE','RESERVED',l.quantity,p_id);
 RETURN p_id;
END $$;

CREATE FUNCTION fi_move_stock(p_id text,p_operation text,p_sequence int,p_product text,p_units int,p_reservation text DEFAULT NULL,p_item text DEFAULT NULL,p_receipt text DEFAULT NULL,p_disposition text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE op fi_stock_operation%ROWTYPE; b fi_stock_balance%ROWTYPE; r fi_reservation%ROWTYPE; i fi_shipment_item%ROWTYPE; rc fi_return_receipt%ROWTYPE; d fi_disposition%ROWTYPE; prior fi_stock_movement%ROWTYPE; from_bucket text; to_bucket text;
BEGIN
 PERFORM fi_serializable(); IF p_units<=0 THEN RAISE EXCEPTION 'Positive units required'; END IF;
 SELECT * INTO STRICT op FROM fi_stock_operation WHERE id=p_operation FOR UPDATE;
 SELECT * INTO prior FROM fi_stock_movement WHERE "operationId"=op.id AND sequence=p_sequence;
 IF FOUND THEN
  IF prior."productId"<>p_product OR prior.units<>p_units OR prior."reservationId" IS DISTINCT FROM p_reservation OR prior."shipmentItemId" IS DISTINCT FROM p_item OR prior."receiptId" IS DISTINCT FROM p_receipt OR prior."dispositionId" IS DISTINCT FROM p_disposition THEN RAISE EXCEPTION 'Warehouse replay mismatch'; END IF;
  RETURN prior.id;
 END IF;
 IF EXISTS(SELECT 1 FROM fi_stock_operation_receipt WHERE "operationId"=op.id) THEN RAISE EXCEPTION 'Completed stock operation cannot acquire new effects'; END IF;
 PERFORM fi_warehouse_authority(op.id,op.kind); -- grants are empty until explicitly approved/provisioned.
 SELECT * INTO STRICT b FROM fi_stock_balance WHERE "productId"=p_product FOR UPDATE;
 IF b."activatedAt" IS NULL THEN RAISE EXCEPTION 'Stock not activated'; END IF;
 IF op.kind IN ('RELEASE','DISPATCH') THEN
  SELECT * INTO STRICT r FROM fi_reservation WHERE id=p_reservation AND "productId"=p_product AND "sellerId"=op."sellerId" FOR UPDATE;
  IF r.remaining<p_units THEN RAISE EXCEPTION 'Reservation already consumed/released'; END IF;
  IF op.kind='RELEASE' THEN
   IF EXISTS(SELECT 1 FROM "order" o JOIN fi_order_line l ON l."legacyOrderId"=o.id WHERE l.id=r."lineId" AND o.status::text<>'CANCELLED') THEN RAISE EXCEPTION 'Explicit reviewed cancellation required'; END IF;
   UPDATE fi_reservation SET remaining=remaining-p_units,released=released+p_units WHERE id=r.id; from_bucket:='RESERVED';to_bucket:='AVAILABLE';
  ELSE
   SELECT * INTO STRICT i FROM fi_shipment_item WHERE id=p_item AND "reservationId"=r.id AND "lineId"=r."lineId" AND "productId"=p_product AND "sellerId"=op."sellerId" AND "operationId"=op.id AND units=p_units FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM fi_order_line l JOIN "order" o ON o.id=l."legacyOrderId" JOIN orderbatch ba ON ba.id=o."batchId" WHERE l.id=r."lineId" AND o.status::text='PROCESSING' AND ba."isPaid" AND EXISTS(SELECT 1 FROM log WHERE id='batch-review:'||ba.id AND action='BATCH_APPROVE')) THEN RAISE EXCEPTION 'Paid/approved PROCESSING order required'; END IF;
   UPDATE fi_reservation SET remaining=remaining-p_units,dispatched=dispatched+p_units WHERE id=r.id;from_bucket:='RESERVED';to_bucket:='IN_TRANSIT';
  END IF;
 ELSIF op.kind IN ('DELIVER','RECEIVE_RETURN') THEN
  SELECT * INTO STRICT i FROM fi_shipment_item WHERE id=p_item AND "productId"=p_product AND "sellerId"=op."sellerId" FOR UPDATE;
  IF i.units-i.delivered-i.returned<p_units THEN RAISE EXCEPTION 'Shipment already resolved'; END IF;
  IF op.kind='DELIVER' THEN UPDATE fi_shipment_item SET delivered=delivered+p_units WHERE id=i.id;from_bucket:='IN_TRANSIT';to_bucket:='EXTERNAL';
  ELSE
   SELECT * INTO STRICT rc FROM fi_return_receipt WHERE id=p_receipt AND "shipmentItemId"=i.id AND "sellerId"=op."sellerId" AND "operationId"=op.id AND units=p_units;
   UPDATE fi_shipment_item SET returned=returned+p_units WHERE id=i.id;from_bucket:='IN_TRANSIT';to_bucket:='RETURNED_PENDING_INSPECTION';
  END IF;
 ELSIF op.kind IN ('RESTOCK','DISPOSE_DAMAGED') THEN
  SELECT * INTO STRICT d FROM fi_disposition WHERE id=p_disposition AND "sellerId"=op."sellerId" FOR UPDATE;
  SELECT si.* INTO STRICT i FROM fi_return_receipt rr JOIN fi_shipment_item si ON si.id=rr."shipmentItemId" WHERE rr.id=d."receiptId" AND si."productId"=p_product;
  IF d.units-d.moved<p_units OR d.kind<>CASE WHEN op.kind='RESTOCK' THEN 'SELLABLE' ELSE 'DAMAGED' END THEN RAISE EXCEPTION 'Unused inspected disposition required'; END IF;
  UPDATE fi_disposition SET moved=moved+p_units WHERE id=d.id;from_bucket:='RETURNED_PENDING_INSPECTION';to_bucket:=CASE WHEN op.kind='RESTOCK' THEN 'AVAILABLE' ELSE 'DAMAGED' END;
 ELSE RAISE EXCEPTION 'Unsupported movement: reserve, inspect and adjustments have separate transaction contracts';
 END IF;
 UPDATE fi_stock_balance SET
 available=available+CASE WHEN to_bucket='AVAILABLE' THEN p_units ELSE 0 END-CASE WHEN from_bucket='AVAILABLE' THEN p_units ELSE 0 END,
 reserved=reserved+CASE WHEN to_bucket='RESERVED' THEN p_units ELSE 0 END-CASE WHEN from_bucket='RESERVED' THEN p_units ELSE 0 END,
 "inTransit"="inTransit"+CASE WHEN to_bucket='IN_TRANSIT' THEN p_units ELSE 0 END-CASE WHEN from_bucket='IN_TRANSIT' THEN p_units ELSE 0 END,
 "returnedPendingInspection"="returnedPendingInspection"+CASE WHEN to_bucket='RETURNED_PENDING_INSPECTION' THEN p_units ELSE 0 END-CASE WHEN from_bucket='RETURNED_PENDING_INSPECTION' THEN p_units ELSE 0 END,
 damaged=damaged+CASE WHEN to_bucket='DAMAGED' THEN p_units ELSE 0 END-CASE WHEN from_bucket='DAMAGED' THEN p_units ELSE 0 END
 WHERE "productId"=p_product;
 INSERT INTO fi_stock_movement(id,"operationId",sequence,"sellerId","productId","fromBucket","toBucket",units,"reservationId","shipmentItemId","receiptId","dispositionId") VALUES(p_id,op.id,p_sequence,op."sellerId",p_product,from_bucket,to_bucket,p_units,p_reservation,p_item,p_receipt,p_disposition);
 RETURN p_id;
END $$;

CREATE FUNCTION fi_inspect_return(p_disposition text,p_operation text,p_receipt text,p_kind text,p_units int) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE op fi_stock_operation%ROWTYPE; r fi_return_receipt%ROWTYPE; prior fi_disposition%ROWTYPE;
BEGIN
 PERFORM fi_serializable(); op:=fi_warehouse_authority(p_operation,'INSPECT_RETURN');
 IF op.kind<>'INSPECT_RETURN' OR p_kind NOT IN ('SELLABLE','DAMAGED') OR p_units<=0 THEN RAISE EXCEPTION 'Valid inspection required'; END IF;
 SELECT * INTO prior FROM fi_disposition WHERE "operationId"=op.id;
 IF FOUND THEN IF prior."receiptId"<>p_receipt OR prior.kind<>p_kind OR prior.units<>p_units THEN RAISE EXCEPTION 'Inspection replay mismatch'; END IF;RETURN prior.id; END IF;
 SELECT * INTO STRICT r FROM fi_return_receipt WHERE id=p_receipt AND "sellerId"=op."sellerId" FOR UPDATE;
 IF p_units>(r.units-(SELECT coalesce(sum(units),0) FROM fi_disposition WHERE "receiptId"=r.id)) THEN RAISE EXCEPTION 'Receipt already inspected'; END IF;
 INSERT INTO fi_disposition(id,"sellerId","receiptId",kind,units,moved,"operationId") VALUES(p_disposition,op."sellerId",r.id,p_kind,p_units,0,op.id);
 RETURN p_disposition; -- no stock increment; a separate permissioned RESTOCK consumes sellable disposition.
END $$;
-- No grants. 004 revokes default/inherited grants before any cutover.
CREATE FUNCTION fi_adjust_stock(p_id text,p_operation text,p_product text,p_delta int) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE op fi_stock_operation%ROWTYPE; prior fi_stock_movement%ROWTYPE; quantity int;
BEGIN
 PERFORM fi_serializable(); op:=fi_warehouse_authority(p_operation,'ADJUST');
 IF op.kind<>'ADJUST' OR op."sellerId" IS NOT NULL OR p_delta=0 OR p_delta=-2147483648 THEN RAISE EXCEPTION 'Global, evidenced nonzero stock adjustment required'; END IF;
 quantity:=abs(p_delta);
 SELECT * INTO prior FROM fi_stock_movement WHERE "operationId"=op.id AND sequence=0;
 IF FOUND THEN
  IF prior."productId"<>p_product OR prior.units<>quantity OR prior."toBucket"<>CASE WHEN p_delta>0 THEN 'AVAILABLE' ELSE 'EXTERNAL' END THEN RAISE EXCEPTION 'Adjustment replay mismatch'; END IF;
  RETURN prior.id;
 END IF;
 PERFORM 1 FROM fi_stock_balance WHERE "productId"=p_product AND "activatedAt" IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock not activated'; END IF;
 UPDATE fi_stock_balance SET available=available+p_delta WHERE "productId"=p_product AND available::bigint+p_delta>=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment exceeds available stock'; END IF;
 INSERT INTO fi_stock_movement(id,"operationId",sequence,"productId","fromBucket","toBucket",units) VALUES(p_id,op.id,0,p_product,CASE WHEN p_delta>0 THEN 'EXTERNAL' ELSE 'AVAILABLE' END,CASE WHEN p_delta>0 THEN 'AVAILABLE' ELSE 'EXTERNAL' END,quantity);
 RETURN p_id;
END $$;
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
