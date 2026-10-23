-- PROPOSED ONLY, READ-ONLY DISCOVERY. No assumptions about deployed migration history.
BEGIN READ ONLY;
DO $gate$
DECLARE s text:=current_setting('winwincod.integrity_schema',true);
BEGIN
 IF s IS NULL OR s='' THEN RAISE EXCEPTION 'Explicit verified legacy schema required'; END IF;
 PERFORM set_config('search_path',format('%I, pg_catalog, pg_temp',s),true);
END $gate$;
SELECT current_setting('server_version') AS server_version, current_schema() AS inspected_schema;
SELECT schemaname,tablename FROM pg_tables WHERE tablename='_prisma_migrations';
-- DBA must separately read the discovered migration history/checksums, not mark MySQL history applied on PostgreSQL.
SELECT table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('user','wallet','transaction','order','orderbatch','product','depositrequest','withdrawalrequest') ORDER BY table_name,ordinal_position;
SELECT count(*) AS invalid_wallet_balances FROM wallet WHERE balance<0 OR balance::text IN ('NaN','Infinity','-Infinity');
SELECT count(*) AS invalid_product_stock FROM product WHERE stock<0;
SELECT count(*) AS invalid_order_quantities FROM "order" WHERE quantity<=0;
SELECT count(*) AS historical_orders_without_cost_snapshots FROM "order"; -- schema has none; NOT a backfill instruction.
SELECT count(*) AS orphan_orders FROM "order" o LEFT JOIN "user" s ON s.id=o."sellerId" LEFT JOIN product p ON p.id=o."productId" WHERE s.id IS NULL OR (o."productId" IS NOT NULL AND p.id IS NULL);
SELECT count(*) AS cross_seller_batch_rows FROM "order" o JOIN orderbatch b ON b.id=o."batchId" WHERE o."sellerId"<>b."sellerId";
SELECT t."walletId",t.type,t."referenceId",count(*) AS effects FROM "transaction" t WHERE t."referenceId" IS NOT NULL GROUP BY t."walletId",t.type,t."referenceId" HAVING count(*)>1;
SELECT count(*) AS pending_requests_with_existing_effect FROM depositrequest d JOIN wallet w ON w."userId"=d."sellerId" JOIN "transaction" t ON t."walletId"=w.id AND t."referenceId"=d.id AND t.type::text='DEPOSIT' WHERE d.status::text='PENDING';
SELECT count(*) AS pending_withdrawals_with_existing_effect FROM withdrawalrequest d JOIN wallet w ON w."userId"=d."sellerId" JOIN "transaction" t ON t."walletId"=w.id AND t."referenceId"=d.id AND t.type::text='WITHDRAWAL' WHERE d.status::text='PENDING';
SELECT w.id,w.balance,coalesce(sum(r.amount),0) AS pending_holds_required FROM wallet w LEFT JOIN withdrawalrequest r ON r."sellerId"=w."userId" AND r.status::text='PENDING' GROUP BY w.id,w.balance HAVING coalesce(sum(r.amount),0)>w.balance;
SELECT b.id,b."isPaid",sum(o.quantity) AS pcs,count(o.id) AS customer_orders FROM orderbatch b JOIN "order" o ON o."batchId"=b.id GROUP BY b.id,b."isPaid" HAVING sum(o.quantity)<5;
SELECT count(*) AS paid_batches_without_explicit_admin_acceptance FROM orderbatch b WHERE b."isPaid" AND NOT EXISTS(SELECT 1 FROM log WHERE id='batch-review:'||b.id AND action='BATCH_APPROVE');
-- An opening cannot be inferred from wallet.balance - SUM(journal): missing history is unknown evidence.
SELECT count(*) AS reference_less_legacy_entries FROM "transaction" WHERE "referenceId" IS NULL;
ROLLBACK;
