-- PROPOSED ONLY. Fence old writers per activated wallet/product; do not activate anything here.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $gate$
DECLARE s text:=current_setting('winwincod.integrity_schema',true);
BEGIN
 IF s IS NULL OR current_setting('winwincod.integrity_baseline_approval',true) IS NULL THEN RAISE EXCEPTION 'Approved schema/baseline required'; END IF;
 PERFORM set_config('search_path',format('%I, pg_catalog, pg_temp',s),true);
END $gate$;
CREATE FUNCTION fi_legacy_wallet_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_wallet WHERE "legacyWalletId"=OLD.id AND "activatedAt" IS NOT NULL) AND
  (TG_OP='DELETE' OR NEW.balance IS DISTINCT FROM OLD.balance OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN RAISE EXCEPTION 'Activated wallet uses v2 projection; legacy balance is frozen'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER fi_legacy_wallet BEFORE UPDATE OR DELETE ON wallet FOR EACH ROW EXECUTE FUNCTION fi_legacy_wallet_fence();
CREATE FUNCTION fi_legacy_journal_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_wallet WHERE "legacyWalletId"=NEW."walletId" AND "activatedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Legacy journal writes forbidden after wallet activation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fi_legacy_journal BEFORE INSERT ON "transaction" FOR EACH ROW EXECUTE FUNCTION fi_legacy_journal_fence();
CREATE FUNCTION fi_legacy_product_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_stock_balance WHERE "productId"=OLD.id AND "activatedAt" IS NOT NULL) AND
  (TG_OP='DELETE' OR NEW.stock IS DISTINCT FROM OLD.stock) THEN RAISE EXCEPTION 'Activated stock uses v2 movement projection; legacy stock is frozen'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER fi_legacy_stock BEFORE UPDATE OR DELETE ON product FOR EACH ROW EXECUTE FUNCTION fi_legacy_product_fence();
CREATE FUNCTION fi_legacy_line_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_order_line WHERE "legacyOrderId"=OLD.id) AND
  (TG_OP='DELETE' OR NEW."sellerId" IS DISTINCT FROM OLD."sellerId" OR NEW."productId" IS DISTINCT FROM OLD."productId" OR NEW.quantity IS DISTINCT FROM OLD.quantity OR (NEW."batchId" IS DISTINCT FROM OLD."batchId" AND EXISTS(SELECT 1 FROM fi_order_line l JOIN fi_line_charge c ON c."lineId"=l.id WHERE l."legacyOrderId"=OLD.id))) THEN RAISE EXCEPTION 'Snapshotted line identity is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER fi_legacy_line BEFORE UPDATE OR DELETE ON "order" FOR EACH ROW EXECUTE FUNCTION fi_legacy_line_fence();
CREATE FUNCTION fi_legacy_withdrawal_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE h fi_withdrawal_hold%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fi_wallet WHERE "sellerId"=NEW."sellerId" AND "activatedAt" IS NOT NULL) THEN RETURN NULL; END IF;
 SELECT * INTO h FROM fi_withdrawal_hold WHERE "legacyRequestId"=NEW.id;
 IF NOT FOUND OR (NEW.status::text='PENDING' AND h.state<>'ACTIVE') OR (NEW.status::text='APPROVED' AND h.state<>'CONSUMED') OR (NEW.status::text='REJECTED' AND h.state<>'RELEASED') THEN RAISE EXCEPTION 'Withdrawal decision and hold must commit together'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER fi_legacy_withdrawal AFTER INSERT OR UPDATE ON withdrawalrequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_legacy_withdrawal_gate();
CREATE FUNCTION fi_legacy_deposit_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.status::text='APPROVED' AND EXISTS(SELECT 1 FROM fi_wallet WHERE "sellerId"=NEW."sellerId" AND "activatedAt" IS NOT NULL) AND
 NOT EXISTS(SELECT 1 FROM fi_funding_claim c JOIN fi_wallet_event e ON e."operationId"=c."operationId" WHERE c."legacyDepositId"=NEW.id AND c."sellerId"=NEW."sellerId" AND e.kind='CREDIT' AND e."cashDelta"=NEW.amount) THEN RAISE EXCEPTION 'Deposit approval requires uniquely evidenced v2 credit'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER fi_legacy_deposit AFTER INSERT OR UPDATE ON depositrequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fi_legacy_deposit_gate();

CREATE FUNCTION fi_legacy_batch_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM fi_operation op JOIN fi_operation_receipt r ON r."operationId"=op.id WHERE op.kind='BATCH_PAYMENT' AND op."businessKey"=OLD.id) AND (TG_OP='DELETE' OR NEW."sellerId" IS DISTINCT FROM OLD."sellerId" OR NEW."totalAmount" IS DISTINCT FROM OLD."totalAmount" OR NEW."isPaid" IS DISTINCT FROM OLD."isPaid") THEN RAISE EXCEPTION 'Paid commitment cannot be rewritten; append a reviewed reversal instead'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER fi_legacy_batch BEFORE UPDATE OR DELETE ON orderbatch FOR EACH ROW EXECUTE FUNCTION fi_legacy_batch_fence();
-- Remove every inherited/default grant on NEW objects, not legacy ACLs or existing data.
DO $private$
DECLARE r record; grant_role text;
BEGIN
 FOR r IN SELECT c.oid,c.relname,c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND left(c.relname,3)='fi_' AND c.relkind='r' LOOP
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',r.relname);
  FOR grant_role IN SELECT pg_get_userbyid(a.grantee) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=r.oid AND a.grantee<>0 AND a.grantee<>r.relowner LOOP
   EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',r.relname,grant_role);
  END LOOP;
 END LOOP;
 FOR r IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND left(p.proname,3)='fi_' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %I(%s) FROM PUBLIC',r.proname,r.args);
 END LOOP;
END $private$;
-- NO application EXECUTE/DML grants are supplied until authorized business adapters exist.
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
