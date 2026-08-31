-- One tenant-scoped read projection for schedules owned by product modules.
-- Producers write the existing product_events ledger; only the jobs runtime
-- applies normalized calendar entries. The control-plane role never receives
-- event titles, descriptions, links, or metadata.
CREATE TABLE "calendar_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "module_key" text NOT NULL,
  "kind_key" text NOT NULL,
  "source_id" text NOT NULL,
  "source_revision" text NOT NULL,
  "state" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone,
  "all_day" boolean DEFAULT false NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "href" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_event_id" uuid,
  "event_occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_entries_org_module_source_key"
    UNIQUE("organization_id", "module_key", "source_id"),
  CONSTRAINT "calendar_entries_organization_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade,
  CONSTRAINT "calendar_entries_last_event_id_fkey"
    FOREIGN KEY ("last_event_id") REFERENCES "public"."product_events"("id") ON DELETE set null,
  CONSTRAINT "calendar_entries_state_check"
    CHECK (state = ANY (ARRAY[
      'scheduled'::text,
      'in_progress'::text,
      'completed'::text,
      'cancelled'::text,
      'failed'::text
    ])),
  CONSTRAINT "calendar_entries_time_check"
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
--> statement-breakpoint
CREATE INDEX "calendar_entries_org_time_idx"
  ON "calendar_entries" USING btree ("organization_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "calendar_entries_org_state_time_idx"
  ON "calendar_entries" USING btree ("organization_id", "state", "starts_at");
--> statement-breakpoint
ALTER TABLE "calendar_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calendar_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "calendar_entries_organization_policy" ON "calendar_entries"
  AS PERMISSIVE FOR ALL TO public
  USING (organization_id = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobs_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "calendar_entries" TO jobs_app;
  END IF;
END $$;
