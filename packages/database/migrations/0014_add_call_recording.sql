CREATE TABLE "call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT current_setting('app.organization_id'::text, true) NOT NULL,
	"subject_id" text NOT NULL,
	"oauth_issuer" text NOT NULL,
	"lead_id" text,
	"idempotency_key" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"detected_platform" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"quality_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_recordings_id_organization_key" UNIQUE("id", "organization_id"),
	CONSTRAINT "call_recordings_owner_idempotency_key" UNIQUE("organization_id", "subject_id", "idempotency_key"),
	CONSTRAINT "call_recordings_source_check" CHECK (source = ANY (ARRAY['auto_detect'::text, 'manual'::text])),
	CONSTRAINT "call_recordings_status_check" CHECK (status = ANY (ARRAY['uploading'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'deleting'::text, 'deleted'::text])),
	CONSTRAINT "call_recordings_format_check" CHECK (format_version > 0)
);
--> statement-breakpoint

CREATE TABLE "call_recording_tracks" (
	"organization_id" text DEFAULT current_setting('app.organization_id'::text, true) NOT NULL,
	"recording_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"codec" text NOT NULL,
	"sample_rate" integer NOT NULL,
	"channels" integer NOT NULL,
	"bitrate" integer,
	"expected_chunks" integer,
	"duration_ms" bigint,
	"final_sha256" text,
	"object_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_recording_tracks_pkey" PRIMARY KEY("organization_id", "recording_id", "kind"),
	CONSTRAINT "call_recording_tracks_kind_check" CHECK (kind = ANY (ARRAY['operator'::text, 'remote'::text])),
	CONSTRAINT "call_recording_tracks_format_check" CHECK (sample_rate > 0 AND channels > 0 AND (bitrate IS NULL OR bitrate > 0) AND (expected_chunks IS NULL OR expected_chunks >= 0) AND (duration_ms IS NULL OR duration_ms >= 0))
);
--> statement-breakpoint

CREATE TABLE "call_recording_chunks" (
	"organization_id" text DEFAULT current_setting('app.organization_id'::text, true) NOT NULL,
	"recording_id" uuid NOT NULL,
	"track_kind" text NOT NULL,
	"sequence" integer NOT NULL,
	"start_offset_ms" bigint NOT NULL,
	"end_offset_ms" bigint NOT NULL,
	"source_sample_count" bigint NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"discontinuity" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_recording_chunks_pkey" PRIMARY KEY("organization_id", "recording_id", "track_kind", "sequence"),
	CONSTRAINT "call_recording_chunks_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "call_recording_chunks_track_check" CHECK (track_kind = ANY (ARRAY['operator'::text, 'remote'::text])),
	CONSTRAINT "call_recording_chunks_values_check" CHECK (sequence >= 0 AND start_offset_ms >= 0 AND end_offset_ms >= start_offset_ms AND source_sample_count >= 0 AND byte_size > 0 AND sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

CREATE TABLE "call_recording_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT current_setting('app.organization_id'::text, true) NOT NULL,
	"recording_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_recording_jobs_recording_type_key" UNIQUE("organization_id", "recording_id", "type"),
	CONSTRAINT "call_recording_jobs_type_check" CHECK (type = ANY (ARRAY['process'::text, 'delete_raw'::text])),
	CONSTRAINT "call_recording_jobs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'completed'::text, 'failed'::text])),
	CONSTRAINT "call_recording_jobs_attempt_check" CHECK (attempt >= 0 AND max_attempts > 0)
);
--> statement-breakpoint

ALTER TABLE "call_recording_tracks" ADD CONSTRAINT "call_recording_tracks_recording_fk" FOREIGN KEY ("recording_id", "organization_id") REFERENCES "public"."call_recordings"("id", "organization_id") ON DELETE cascade;
ALTER TABLE "call_recording_chunks" ADD CONSTRAINT "call_recording_chunks_track_fk" FOREIGN KEY ("organization_id", "recording_id", "track_kind") REFERENCES "public"."call_recording_tracks"("organization_id", "recording_id", "kind") ON DELETE cascade;
ALTER TABLE "call_recording_jobs" ADD CONSTRAINT "call_recording_jobs_recording_fk" FOREIGN KEY ("recording_id", "organization_id") REFERENCES "public"."call_recordings"("id", "organization_id") ON DELETE cascade;
--> statement-breakpoint

CREATE INDEX "call_recordings_owner_status_idx" ON "call_recordings" USING btree ("organization_id", "subject_id", "status", "created_at" DESC NULLS FIRST);
CREATE INDEX "call_recordings_retention_idx" ON "call_recordings" USING btree ("status", "retention_expires_at") WHERE retention_expires_at IS NOT NULL;
CREATE INDEX "call_recording_chunks_recording_idx" ON "call_recording_chunks" USING btree ("organization_id", "recording_id", "track_kind", "sequence");
CREATE INDEX "call_recording_jobs_claim_idx" ON "call_recording_jobs" USING btree ("status", "next_attempt_at", "lease_expires_at");
CREATE UNIQUE INDEX "outreach_lead_evidence_external_source_key" ON "outreach_lead_evidence" USING btree ("organization_id", "lead_id", "source_key") WHERE source_key IS NOT NULL AND meeting_id IS NULL;
--> statement-breakpoint

ALTER TABLE "call_recordings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_recordings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_tracks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_chunks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_recording_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "call_recordings_organization_policy" ON "call_recordings" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "call_recording_tracks_organization_policy" ON "call_recording_tracks" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "call_recording_chunks_organization_policy" ON "call_recording_chunks" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
CREATE POLICY "call_recording_jobs_organization_policy" ON "call_recording_jobs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
--> statement-breakpoint

DO $$
DECLARE
	runtime_role text;
BEGIN
	FOREACH runtime_role IN ARRAY ARRAY['web_app', 'jobs_app'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
			EXECUTE format(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
					"call_recordings",
					"call_recording_tracks",
					"call_recording_chunks",
					"call_recording_jobs"
				 TO %I',
				runtime_role
			);
		END IF;
	END LOOP;
END $$;
