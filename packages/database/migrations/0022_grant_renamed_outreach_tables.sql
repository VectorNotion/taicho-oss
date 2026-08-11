-- 0019 renamed the outreach lead_* tables to prospect_* but did not carry over
-- the runtime-role grants that 0018 (and the meeting-intelligence migrations)
-- had applied under the old names. On long-lived databases the grants were not
-- preserved, so verifyDatabaseGrants (packages/database/migrate.ts) fails at
-- service startup and every service that migrates at boot crashes.
--
-- Re-grant the runtime roles their contracted privileges on the RENAMED tables.
-- Idempotent (GRANT is repeatable) and guarded on the role existing, matching
-- the pattern in 0018, so it is a no-op where the grants already hold or the
-- role is absent (e.g. local dev / fresh CI).
--
-- NOTE: the CAPABILITY role differs by environment — CI creates `capability_app`
-- and sets CAPABILITY_DATABASE_ROLE=capability_app, but staging/prod map
-- CAPABILITY_DATABASE_ROLE=`mcp_app`. 0018 only granted `capability_app`, so the
-- grant never reached the real role in staging/prod. Grant both (guarded) so the
-- privilege lands on whichever role the environment actually uses.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capability_app') THEN
		GRANT SELECT, INSERT, UPDATE ON TABLE "outreach_prospect_source_identities" TO capability_app;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_app') THEN
		GRANT SELECT, INSERT, UPDATE ON TABLE "outreach_prospect_source_identities" TO mcp_app;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outreach_prospect_evidence" TO jobs_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outreach_prospect_insight_snapshots" TO jobs_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outreach_prospect_meeting_events" TO jobs_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outreach_prospect_meetings" TO jobs_app;
	END IF;
END $$;
