-- cascade_admin lacked grants on the two newest cascade tables (every older
-- cascade table grants it ALL). The gap only surfaces when the nurture
-- worker restarts and its entrypoint schema check touches funnel_members —
-- observed in production 2026-08-16 after a secret-rotation restart.
--
-- Guarded: ephemeral CI databases bootstrap only the runtime roles, so the
-- grant applies wherever the administrative role actually exists.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cascade_admin') THEN
		GRANT ALL PRIVILEGES ON "cascade"."funnel_members" TO "cascade_admin";
		GRANT ALL PRIVILEGES ON "cascade"."plain_text_emails" TO "cascade_admin";
	END IF;
END $$;
