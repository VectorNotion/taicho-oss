CREATE TABLE "outreach_lead_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"lead_id" text NOT NULL,
	"provider" text DEFAULT 'attendee' NOT NULL,
	"provider_bot_id" text,
	"meeting_url" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"status_detail" text,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_lead_meetings_id_organization_key" UNIQUE("id", "organization_id"),
	CONSTRAINT "outreach_lead_meetings_provider_check" CHECK (provider = 'attendee'),
	CONSTRAINT "outreach_lead_meetings_status_check" CHECK (status = ANY (ARRAY['provisioning'::text, 'joining'::text, 'in_meeting'::text, 'post_processing'::text, 'completed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "outreach_lead_meeting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"meeting_id" uuid NOT NULL,
	"provider_delivery_id" text NOT NULL,
	"trigger" text NOT NULL,
	"event_type" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_lead_meeting_events_delivery_key" UNIQUE("organization_id", "provider_delivery_id"),
	CONSTRAINT "outreach_lead_meeting_events_id_organization_key" UNIQUE("id", "organization_id")
);
--> statement-breakpoint
CREATE TABLE "outreach_lead_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"lead_id" text NOT NULL,
	"meeting_id" uuid,
	"meeting_event_id" uuid,
	"kind" text NOT NULL,
	"source_key" text,
	"source_label" text NOT NULL,
	"content" text NOT NULL,
	"speaker_name" text,
	"speaker_external_id" text,
	"speaker_is_host" boolean,
	"offset_ms" bigint,
	"duration_ms" bigint,
	"occurred_at" timestamp with time zone,
	"created_by" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_lead_evidence_id_organization_key" UNIQUE("id", "organization_id"),
	CONSTRAINT "outreach_lead_evidence_kind_check" CHECK (kind = ANY (ARRAY['manual_update'::text, 'transcript_utterance'::text])),
	CONSTRAINT "outreach_lead_evidence_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "outreach_lead_evidence_content_check" CHECK (length(btrim(content)) > 0)
);
--> statement-breakpoint
CREATE TABLE "outreach_lead_insight_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"lead_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'current' NOT NULL,
	"summary" text NOT NULL,
	"content" jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_count" integer NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"generated_reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_lead_insights_revision_key" UNIQUE("organization_id", "lead_id", "revision"),
	CONSTRAINT "outreach_lead_insights_id_organization_key" UNIQUE("id", "organization_id"),
	CONSTRAINT "outreach_lead_insights_status_check" CHECK (status = ANY (ARRAY['current'::text, 'superseded'::text])),
	CONSTRAINT "outreach_lead_insights_reason_check" CHECK (generated_reason = ANY (ARRAY['manual'::text, 'manual_update'::text, 'meeting_completed'::text])),
	CONSTRAINT "outreach_lead_insights_revision_check" CHECK (revision > 0 AND evidence_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "outreach_lead_meetings" ADD CONSTRAINT "outreach_lead_meetings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outreach_lead_meeting_events" ADD CONSTRAINT "outreach_lead_meeting_events_meeting_fk" FOREIGN KEY ("meeting_id", "organization_id") REFERENCES "public"."outreach_lead_meetings"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outreach_lead_evidence" ADD CONSTRAINT "outreach_lead_evidence_meeting_fk" FOREIGN KEY ("meeting_id", "organization_id") REFERENCES "public"."outreach_lead_meetings"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outreach_lead_evidence" ADD CONSTRAINT "outreach_lead_evidence_event_fk" FOREIGN KEY ("meeting_event_id", "organization_id") REFERENCES "public"."outreach_lead_meeting_events"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outreach_lead_insight_snapshots" ADD CONSTRAINT "outreach_lead_insights_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "outreach_lead_meetings_lead_time_idx" ON "outreach_lead_meetings" USING btree ("organization_id", "lead_id", "created_at" DESC NULLS FIRST);
--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_lead_meetings_provider_bot_key" ON "outreach_lead_meetings" USING btree ("organization_id", "provider", "provider_bot_id") WHERE provider_bot_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "outreach_lead_meeting_events_meeting_time_idx" ON "outreach_lead_meeting_events" USING btree ("organization_id", "meeting_id", "received_at");
--> statement-breakpoint
CREATE INDEX "outreach_lead_evidence_lead_time_idx" ON "outreach_lead_evidence" USING btree ("organization_id", "lead_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_lead_evidence_source_key" ON "outreach_lead_evidence" USING btree ("organization_id", "meeting_id", "source_key") WHERE source_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "outreach_lead_insights_lead_time_idx" ON "outreach_lead_insight_snapshots" USING btree ("organization_id", "lead_id", "created_at" DESC NULLS FIRST);
--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_lead_insights_current_key" ON "outreach_lead_insight_snapshots" USING btree ("organization_id", "lead_id") WHERE status = 'current';
--> statement-breakpoint
ALTER TABLE "outreach_lead_meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_meetings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_meeting_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_meeting_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_insight_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_lead_insight_snapshots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "outreach_lead_meetings_organization_policy" ON "outreach_lead_meetings" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "outreach_lead_meeting_events_organization_policy" ON "outreach_lead_meeting_events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "outreach_lead_evidence_organization_policy" ON "outreach_lead_evidence" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "outreach_lead_insights_organization_policy" ON "outreach_lead_insight_snapshots" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
--> statement-breakpoint
DO $$
DECLARE
	runtime_role text;
BEGIN
	FOREACH runtime_role IN ARRAY ARRAY['jobs_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					"outreach_lead_meetings",
					"outreach_lead_meeting_events",
					"outreach_lead_evidence",
					"outreach_lead_insight_snapshots"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;
END $$;
