CREATE TABLE "outreach_lead_source_identities" (
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"provider" text DEFAULT 'linkedin_sales_navigator' NOT NULL,
	"source_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"linkedin_url" text,
	"sales_navigator_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_lead_source_identities_pkey" PRIMARY KEY("organization_id", "provider", "source_id"),
	CONSTRAINT "outreach_lead_source_identities_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
	CONSTRAINT "outreach_lead_source_identities_provider_check" CHECK (provider = 'linkedin_sales_navigator'),
	CONSTRAINT "outreach_lead_source_identities_source_id_check" CHECK (length(btrim(source_id)) > 0)
);
--> statement-breakpoint
CREATE INDEX "outreach_lead_source_identities_lead_idx" ON "outreach_lead_source_identities" USING btree ("organization_id", "lead_id");
--> statement-breakpoint
ALTER TABLE "outreach_lead_source_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_source_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "outreach_lead_source_identities_organization_policy" ON "outreach_lead_source_identities" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
--> statement-breakpoint
DO $$
DECLARE
	runtime_role text;
BEGIN
	FOREACH runtime_role IN ARRAY ARRAY['capability_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE ON TABLE "outreach_lead_source_identities" TO %I',
				runtime_role
			);
		END IF;
	END LOOP;
END $$;
