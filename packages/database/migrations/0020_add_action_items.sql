CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"prospect_id" text,
	"account_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "action_items_status_check" CHECK (status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text])),
	CONSTRAINT "action_items_source_check" CHECK (source = ANY (ARRAY['manual'::text, 'auto_followup'::text]))
);
--> statement-breakpoint
CREATE INDEX "idx_action_items_org_status_due" ON "action_items" USING btree ("organization_id","status","due_at");
--> statement-breakpoint
CREATE INDEX "idx_action_items_prospect" ON "action_items" USING btree ("prospect_id");
--> statement-breakpoint
ALTER TABLE "action_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "action_items_organization_policy" ON "action_items" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
--> statement-breakpoint
DO $$
DECLARE
	runtime_role text;
BEGIN
	FOREACH runtime_role IN ARRAY ARRAY['jobs_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "action_items" TO %I',
				runtime_role
			);
		END IF;
	END LOOP;
END $$;
