import fs from 'node:fs';
const path='proposals/integrity-v1/sql/002_constraints.proposed.sql';
const old=fs.readFileSync(path,'utf8');
const funcs=new Map();
for(const match of old.matchAll(/CREATE FUNCTION (fi_[a-z_]+)[\s\S]*?AS \$\$[\s\S]*?\$\$;/g))if(!funcs.has(match[1]))funcs.set(match[1],match[0]);
if(funcs.size!==21)throw Error('Unexpected function inventory');
const manifest=JSON.parse(fs.readFileSync('proposals/integrity-v1/schema-manifest.json','utf8'));
const projections=['fi_wallet','fi_stock_balance','fi_reservation','fi_withdrawal_hold','fi_shipment_item','fi_disposition','fi_payout_intent'];
const immutable=manifest.models.map(m=>m.table).filter(t=>!projections.includes(t)&&t!=='fi_settlement_link');
const header=`-- PROPOSED ONLY: constraints and immutable facts. PostgreSQL execution still required.
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
`;
let triggers='\n';
for(const table of immutable)triggers+=`CREATE TRIGGER fi_no_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();\n`;
for(const table of projections)triggers+=`CREATE TRIGGER fi_identity BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION fi_projection_identity();\nCREATE TRIGGER fi_no_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();\n`;
const ct=(name,events,table,fn)=>`CREATE CONSTRAINT TRIGGER ${name} AFTER ${events} ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}();\n`;
triggers+=ct('fi_balanced_header','INSERT','fi_journal','fi_journal_balanced')+ct('fi_balanced_posting','INSERT','fi_posting','fi_journal_balanced');
triggers+=ct('fi_wallet_cache','INSERT OR UPDATE','fi_wallet','fi_wallet_projection')+ct('fi_wallet_events','INSERT','fi_wallet_event','fi_wallet_projection')+ct('fi_wallet_postings','INSERT','fi_posting','fi_posting_wallet_projection');
for(const table of ['fi_stock_balance','fi_stock_movement','fi_reservation'])triggers+=ct('fi_stock_projection',table==='fi_stock_movement'?'INSERT':'INSERT OR UPDATE',table,'fi_stock_projection');
for(const table of ['fi_disposition','fi_return_receipt','fi_shipment_item','fi_cost_recognition','fi_posting'])triggers+=ct('fi_aggregate','INSERT OR UPDATE',table,'fi_aggregate_guard');
triggers+='CREATE TRIGGER fi_line_binding BEFORE INSERT ON fi_order_line FOR EACH ROW EXECUTE FUNCTION fi_line_binding();\nCREATE TRIGGER fi_snapshot_binding BEFORE INSERT ON fi_cost_snapshot FOR EACH ROW EXECUTE FUNCTION fi_snapshot_binding();\n';
triggers+=ct('fi_operation_complete','INSERT','fi_operation','fi_completion_required')+ct('fi_stock_complete','INSERT','fi_stock_operation','fi_completion_required');
triggers+=ct('fi_hold_cache','INSERT OR UPDATE','fi_withdrawal_hold','fi_hold_projection')+ct('fi_hold_events','INSERT','fi_wallet_event','fi_hold_projection');
triggers+=ct('fi_match_math','INSERT','fi_settlement_match','fi_settlement_guard')+ct('fi_active_match','INSERT OR UPDATE OR DELETE','fi_settlement_link','fi_settlement_guard')+ct('fi_match_journal','INSERT','fi_journal','fi_settlement_guard')+ct('fi_revocation_final','INSERT','fi_match_revocation','fi_revocation_final');
triggers+='CREATE TRIGGER fi_link_no_truncate BEFORE TRUNCATE ON fi_settlement_link FOR EACH STATEMENT EXECUTE FUNCTION fi_immutable();\n';
triggers+=ct('fi_remittance_cap','INSERT','fi_remittance_allocation','fi_remittance_caps');
triggers+='CREATE TRIGGER fi_wallet_activation BEFORE INSERT OR UPDATE ON fi_wallet FOR EACH ROW EXECUTE FUNCTION fi_activation_guard();\nCREATE TRIGGER fi_stock_activation BEFORE INSERT OR UPDATE ON fi_stock_balance FOR EACH ROW EXECUTE FUNCTION fi_activation_guard();\nCREATE TRIGGER fi_stock_shape BEFORE INSERT ON fi_stock_movement FOR EACH ROW EXECUTE FUNCTION fi_stock_shape();\n';
triggers+=ct('fi_payout_state','INSERT OR UPDATE','fi_payout_intent','fi_payout_guard')+ct('fi_payout_event','INSERT','fi_payout_event','fi_payout_guard');
const financial={fi_journal:'operationId',fi_wallet_event:'operationId',fi_funding_claim:'operationId',fi_cost_recognition:'operationId',fi_payout_event:'operationId',fi_remittance_allocation:'operationId',fi_wallet_entitlement:'operationId',fi_line_charge:'operationId',fi_shipment_terms:'operationId',fi_withdrawal_hold:'createdOperationId',fi_order_line:'createdOperationId',fi_cost_snapshot:'operationId',fi_payout_intent:'operationId',fi_settlement_match:'operationId'};
for(const [table,field] of Object.entries(financial))triggers+=`CREATE TRIGGER fi_open_op BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('${field}','financial');\n`;
for(const table of ['fi_reservation','fi_shipment','fi_shipment_item','fi_return_receipt','fi_disposition','fi_stock_movement'])triggers+=`CREATE TRIGGER fi_open_op BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fi_open_operation_guard('operationId','stock');\n`;
triggers+='CREATE TRIGGER fi_entitlement BEFORE INSERT ON fi_wallet_entitlement FOR EACH ROW EXECUTE FUNCTION fi_entitlement_guard();\nCREATE TRIGGER fi_posting_open BEFORE INSERT ON fi_posting FOR EACH ROW EXECUTE FUNCTION fi_posting_open_journal();\nCREATE TRIGGER fi_charge_binding BEFORE INSERT ON fi_line_charge FOR EACH ROW EXECUTE FUNCTION fi_charge_binding();\n';
for(const m of manifest.models)if(m.fields.some(([f])=>f==='currency'))triggers+=`ALTER TABLE ${m.table} ADD CHECK (currency='MAD');\n`;
fs.writeFileSync(path,header+'\n'+[...funcs.values()].join('\n\n')+'\n'+triggers+'\n'+fs.readFileSync('proposals/integrity-v1/privacy-tail.sqlfrag','utf8')+'\nCOMMIT;\n');
// Repair the one function inserted via JS replacement; literal split/join cannot expand dollar patterns.
const fence='proposals/integrity-v1/sql/004_fences_and_privacy.proposed.sql';
let text=fs.readFileSync(fence,'utf8');text=text.split('SET search_path FROM CURRENT AS $\n').join('SET search_path FROM CURRENT AS $$\n').split('END $;\n').join('END $$;\n');fs.writeFileSync(fence,text);
