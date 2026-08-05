-- Capability workers use a privileged control-plane role only to discover the
-- organization that owns queued work. Keep that role column-restricted so it
-- cannot read tenant payloads before processing re-enters the scoped runtime
-- pool.

DO $$
DECLARE
	control_role text;
BEGIN
	FOREACH control_role IN ARRAY ARRAY['capability_admin', 'mcp_admin'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = control_role) THEN
			EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', control_role);
			EXECUTE format(
				'GRANT SELECT ("id", "organization_id", "status", "lease_expires_at", "attempt", "max_attempts", "created_at")
				 ON TABLE "mcp_operation" TO %I',
				control_role
			);
			EXECUTE format(
				'GRANT SELECT ("id", "organization_id")
				 ON TABLE "mcp_media_upload" TO %I',
				control_role
			);
			EXECUTE format(
				'GRANT SELECT ("id", "organization_id", "status", "next_attempt_at", "lease_expires_at", "attempt", "max_attempts")
				 ON TABLE "external_webhook_delivery" TO %I',
				control_role
			);
			EXECUTE format(
				'GRANT SELECT ("expires_at"), DELETE
				 ON TABLE "external_api_rate_limit" TO %I',
				control_role
			);
		END IF;
	END LOOP;
END $$;
