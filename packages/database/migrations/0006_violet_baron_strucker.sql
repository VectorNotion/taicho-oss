CREATE TABLE "publishing"."content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"generation_run_id" uuid NOT NULL,
	"output_index" integer NOT NULL,
	"draft_id" text NOT NULL,
	"asset_role" text DEFAULT 'primary' NOT NULL,
	"media_kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"r2_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"byte_size" integer NOT NULL,
	"is_selected" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_assets_byte_size_check" CHECK (byte_size >= 0),
	CONSTRAINT "content_assets_kind_check" CHECK (media_kind = ANY (ARRAY['image'::text, 'video'::text, 'audio'::text])),
	CONSTRAINT "content_assets_output_index_check" CHECK (output_index >= 0)
);
--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publishing"."content_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"draft_id" text NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"media_kind" text NOT NULL,
	"asset_role" text DEFAULT 'primary' NOT NULL,
	"model_key" text NOT NULL,
	"deployment_id" text NOT NULL,
	"provider" text DEFAULT 'fal' NOT NULL,
	"provider_request_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_result" jsonb,
	"error" text,
	"credit_reservation_id" uuid,
	"estimated_credits" integer DEFAULT 0 NOT NULL,
	"actual_credits" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_generation_runs_kind_check" CHECK (media_kind = ANY (ARRAY['image'::text, 'video'::text, 'audio'::text])),
	CONSTRAINT "content_generation_runs_progress_check" CHECK ((progress >= 0) AND (progress <= 100)),
	CONSTRAINT "content_generation_runs_provider_check" CHECK (provider = 'fal'::text),
	CONSTRAINT "content_generation_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'submitted'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "content_generation_runs_organization_id_id_key" ON "publishing"."content_generation_runs" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD CONSTRAINT "content_assets_generation_run_organization_fkey" FOREIGN KEY ("organization_id","generation_run_id") REFERENCES "publishing"."content_generation_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_assets_draft_idx" ON "publishing"."content_assets" USING btree ("organization_id","draft_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_assets_run_idx" ON "publishing"."content_assets" USING btree ("organization_id","generation_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_run_output_key" ON "publishing"."content_assets" USING btree ("organization_id","generation_run_id","output_index");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_selected_role_key" ON "publishing"."content_assets" USING btree ("organization_id","draft_id","asset_role") WHERE is_selected = true;--> statement-breakpoint
CREATE INDEX "content_generation_runs_draft_idx" ON "publishing"."content_generation_runs" USING btree ("organization_id","draft_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_generation_runs_reconcile_idx" ON "publishing"."content_generation_runs" USING btree ("status","updated_at") WHERE (status = ANY (ARRAY['submitted'::text, 'processing'::text]));--> statement-breakpoint
CREATE UNIQUE INDEX "content_generation_runs_provider_request_key" ON "publishing"."content_generation_runs" USING btree ("provider","provider_request_id") WHERE provider_request_id IS NOT NULL;--> statement-breakpoint
CREATE POLICY "content_assets_organization_policy" ON "publishing"."content_assets" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "content_generation_runs_organization_policy" ON "publishing"."content_generation_runs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
