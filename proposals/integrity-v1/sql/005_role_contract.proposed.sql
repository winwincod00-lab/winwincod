-- PROPOSED role/ownership gate. Roles must be provisioned by DBA, not inferred from credentials.
-- Run after 001..004 in the reviewed staging baseline; transaction rolls back on any failed gate.
BEGIN;
DO $roles$
DECLARE s text:=current_setting('winwincod.integrity_schema',true); owner_name text:=current_setting('winwincod.integrity_owner_role',true); app_name text:=current_setting('winwincod.integrity_app_role',true); r record;
BEGIN
 IF s IS NULL OR owner_name IS NULL OR app_name IS NULL OR owner_name=app_name THEN RAISE EXCEPTION 'Explicit distinct owner/app roles required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=owner_name AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'Owner must be provisioned NOLOGIN NOSUPERUSER NOBYPASSRLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=app_name AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'App role must be provisioned without superuser/RLS bypass'; END IF;
 IF pg_has_role(app_name,owner_name,'MEMBER') OR has_schema_privilege(app_name,s,'CREATE') THEN RAISE EXCEPTION 'App must not inherit owner or have CREATE in trusted search_path schema'; END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=s AND a.grantee=0 AND a.privilege_type='CREATE') THEN RAISE EXCEPTION 'PUBLIC CREATE in trusted schema must be removed by reviewed DBA baseline'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=s AND c.relname IN ('user','wallet','transaction','order','product','orderbatch','depositrequest','withdrawalrequest') AND pg_has_role(app_name,c.relowner,'MEMBER')) THEN RAISE EXCEPTION 'App cannot own/inherit ownership of fenced legacy tables'; END IF;
 PERFORM set_config('search_path',format('%I, pg_catalog, pg_temp',s),true);
 EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I',s,owner_name);
 EXECUTE format('GRANT SELECT ON TABLE "user",wallet,"transaction","order",product,orderbatch,depositrequest,withdrawalrequest,log TO %I',owner_name);
 EXECUTE format('GRANT UPDATE(id) ON TABLE wallet,"order",product,withdrawalrequest TO %I',owner_name); -- row-lock privilege only; no balance/status write privilege.
 FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=s AND left(c.relname,3)='fi_' AND c.relkind='r' LOOP
  EXECUTE format('ALTER TABLE %I OWNER TO %I',r.relname,owner_name);
 END LOOP;
 FOR r IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=s AND left(p.proname,3)='fi_' LOOP
  EXECUTE format('ALTER FUNCTION %I(%s) OWNER TO %I',r.proname,r.args,owner_name);
 END LOOP;
 -- Existing private development tables have RLS enabled and no API policies.
 -- A SELECT grant alone is insufficient: this policy is ONLY for the isolated NOLOGIN owner.
 FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=s AND c.relname IN ('user','wallet','transaction','order','product','orderbatch','depositrequest','withdrawalrequest','log') AND c.relrowsecurity LOOP
  EXECUTE format('CREATE POLICY fi_owner_read ON %I FOR SELECT TO %I USING (true)',r.relname,owner_name);
  IF r.relname IN ('wallet','order','product','withdrawalrequest') THEN EXECUTE format('CREATE POLICY fi_owner_lock ON %I FOR UPDATE TO %I USING (true) WITH CHECK (true)',r.relname,owner_name); END IF;
 END LOOP;
 -- Only SQL-only constraints need these trigger functions; no public invocation is granted.
 -- Trigger functions requiring private-table reads execute as the dedicated owner.
 FOR r IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=s AND left(p.proname,3)='fi_' AND p.prorettype='pg_catalog.trigger'::regtype LOOP
  EXECUTE format('ALTER FUNCTION %I(%s) SECURITY DEFINER',r.proname,r.args);
 END LOOP;
END $roles$;
-- Runtime adapters/entrypoint grants remain NOT IMPLEMENTED; this does not enable finance.
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
