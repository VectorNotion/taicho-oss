-- The tenant-scoped jobs runtime owns queue lifecycle reads and writes, but the
-- baseline jobs table predated the explicit runtime-grant migrations. Fresh and
-- adopted environments therefore created jobs_app without granting it access
-- to the table, causing every streamed action to fail while inserting its
-- queued job. Keep forced RLS in place and grant only table-level CRUD.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "jobs" TO jobs_app;
	END IF;
END $$;
