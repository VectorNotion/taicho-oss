-- The jobs control-plane role discovers organization IDs and removes expired
-- terminal jobs. It bypasses RLS for those two bounded operations, but it must
-- not be able to create or mutate job payloads.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_admin') THEN
		GRANT USAGE ON SCHEMA public TO jobs_admin;
		GRANT SELECT, DELETE ON TABLE "jobs" TO jobs_admin;
	END IF;
END $$;
