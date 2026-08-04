-- Runtime roles are deliberately restricted, non-owner roles. PostgreSQL
-- does not copy table privileges from existing relations when a migration
-- creates a new table, so every new runtime relation must be granted
-- explicitly while forced row-level security remains enabled.

CREATE VIEW "job_workspace_member_ids"
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
	"organizationId" AS "organization_id",
	"userId" AS "user_id"
FROM "member"
WHERE "organizationId" = NULLIF(current_setting('app.organization_id'::text, true), ''::text);
--> statement-breakpoint
REVOKE ALL ON TABLE "job_workspace_member_ids" FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
	runtime_role text;
BEGIN
	FOREACH runtime_role IN ARRAY ARRAY['jobs_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
			EXECUTE format(
				'GRANT SELECT, INSERT ON TABLE "product_events" TO %I',
				runtime_role
			);
			EXECUTE format(
				'GRANT SELECT ON TABLE "job_workspace_member_ids" TO %I',
				runtime_role
			);
			EXECUTE format(
				'GRANT SELECT ON TABLE "external_webhook_endpoint" TO %I',
				runtime_role
			);
			EXECUTE format(
				'GRANT INSERT ON TABLE "external_webhook_delivery" TO %I',
				runtime_role
			);
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					"attention_items",
					"intelligence_api_tokens",
					"intelligence_artifact_outcomes",
					"intelligence_artifacts",
					"intelligence_runs",
					"notification_preferences",
					"notification_recipients",
					"product_event_projections"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;

	FOREACH runtime_role IN ARRAY ARRAY['capability_app', 'mcp_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					"external_api_rate_limit",
					"external_webhook_delivery",
					"external_webhook_endpoint"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;

	FOREACH runtime_role IN ARRAY ARRAY['publishing_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format('GRANT USAGE ON SCHEMA publishing TO %I', runtime_role);
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					publishing."content_assets",
					publishing."content_generation_runs"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;

	FOREACH runtime_role IN ARRAY ARRAY['cascade_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format('GRANT USAGE ON SCHEMA cascade TO %I', runtime_role);
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					cascade."funnel_members",
					cascade."plain_text_emails"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;
END $$;
