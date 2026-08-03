CREATE TABLE "cascade"."funnel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_members_funnel_id_contact_id_key" UNIQUE("funnel_id","contact_id"),
	CONSTRAINT "funnel_members_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."plain_text_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "plain_text_emails_funnel_id_name_key" UNIQUE("funnel_id","name"),
	CONSTRAINT "plain_text_emails_name_check" CHECK (length(btrim(name)) > 0),
	CONSTRAINT "plain_text_emails_subject_check" CHECK (length(btrim(subject)) > 0),
	CONSTRAINT "plain_text_emails_body_check" CHECK (length(btrim(body)) > 0),
	CONSTRAINT "plain_text_emails_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."plain_text_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."plain_text_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD CONSTRAINT "funnel_members_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD CONSTRAINT "funnel_members_contact_id_organization_fkey" FOREIGN KEY ("contact_id","organization_id") REFERENCES "cascade"."contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."plain_text_emails" ADD CONSTRAINT "plain_text_emails_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_members_organization_id_id_key" ON "cascade"."funnel_members" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "funnel_members_funnel_created_idx" ON "cascade"."funnel_members" USING btree ("funnel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plain_text_emails_organization_id_id_key" ON "cascade"."plain_text_emails" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "plain_text_emails_funnel_updated_idx" ON "cascade"."plain_text_emails" USING btree ("funnel_id","updated_at");--> statement-breakpoint
CREATE POLICY "funnel_members_organization_policy" ON "cascade"."funnel_members" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "plain_text_emails_organization_policy" ON "cascade"."plain_text_emails" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint

-- Collapse historical workflow enrollment into static funnel membership.
INSERT INTO "cascade"."funnel_members" (
  "funnel_id", "contact_id", "created_at", "created_by", "actor_type",
  "request_id", "parent_execution_id", "trace_id", "traceparent", "organization_id"
)
SELECT DISTINCT ON ("funnel_id", "contact_id")
  "funnel_id", "contact_id", "created_at", "created_by", "actor_type",
  "request_id", "parent_execution_id", "trace_id", "traceparent", "organization_id"
FROM "cascade"."enrollments"
ORDER BY "funnel_id", "contact_id", "created_at"
ON CONFLICT ("funnel_id", "contact_id") DO NOTHING;--> statement-breakpoint

-- Preserve every valid historical inline email step as a named, manually
-- managed text email. No renderer or delivery state is carried forward.
INSERT INTO "cascade"."plain_text_emails" (
  "funnel_id", "name", "subject", "body", "organization_id"
)
SELECT
  "funnel_id",
  'Email ' || "position"::text,
  btrim("config"->>'subject'),
  "config"->>'body',
  "organization_id"
FROM "cascade"."funnel_steps"
WHERE "type" = 'email'
  AND length(btrim(coalesce("config"->>'subject', ''))) > 0
  AND length(btrim(coalesce("config"->>'body', ''))) > 0
ON CONFLICT ("funnel_id", "name") DO NOTHING;--> statement-breakpoint

-- The static-list model has no execution, delivery, template, experiment, or
-- scheduled-work state. The only retained data was copied above.
TRUNCATE TABLE
  "cascade"."variant_stats",
  "cascade"."variants",
  "cascade"."sends",
  "cascade"."events",
  "cascade"."webhook_receipts",
  "cascade"."stage_daily_stats",
  "cascade"."enrollments",
  "cascade"."funnel_routes",
  "cascade"."funnel_steps",
  "cascade"."emails",
  "cascade"."content",
  "cascade"."templates",
  "cascade"."delivery_sender_identities",
  "cascade"."delivery_domains",
  "cascade"."delivery_provider_connections",
  "cascade"."assets",
  "cascade"."offers",
  "cascade"."cascade_settings"
CASCADE;--> statement-breakpoint

-- A short-lived development version of this migration introduced an outbox.
-- Remove it if that version was ever applied locally; clean databases never
-- create it.
DROP TABLE IF EXISTS "cascade"."prepared_emails" CASCADE;
