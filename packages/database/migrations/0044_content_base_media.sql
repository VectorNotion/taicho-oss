CREATE TABLE "publishing"."content_post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"post_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_post_media_position_check" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "publishing"."content_post_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" DROP CONSTRAINT "content_generation_runs_provider_check";--> statement-breakpoint
DROP INDEX "publishing"."content_assets_draft_idx";--> statement-breakpoint
DROP INDEX "publishing"."content_assets_selected_role_key";--> statement-breakpoint
DROP INDEX "publishing"."content_generation_runs_draft_idx";--> statement-breakpoint
DROP INDEX "publishing"."content_generation_runs_reconcile_idx";--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ALTER COLUMN "draft_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "draft_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "model_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "deployment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "provider" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "content_base_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "origin_post_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "parent_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "visual_type" text DEFAULT 'editorial-scene' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ADD COLUMN "alt_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "content_base_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "origin_post_id" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "parent_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "visual_type" text DEFAULT 'editorial-scene' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "visual_brief" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "compiled_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "negative_prompt" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "render_spec" jsonb;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "renderer_version" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "provider_params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "provider_request_url" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "provider_status_url" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "provider_result_url" text;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD COLUMN "provider_cancel_url" text;--> statement-breakpoint
UPDATE "publishing"."content_generation_runs"
   SET "origin_post_id" = "draft_id",
       "visual_type" = CASE
         WHEN "media_kind" = 'video' THEN 'cinematic-clip'
         WHEN "template_key" = 'ad-creative' THEN 'product-showcase'
         ELSE 'editorial-scene'
       END,
       "visual_brief" = jsonb_build_object(
         'kind', CASE WHEN "media_kind" = 'video' THEN 'video' ELSE 'image' END,
         'visualType', CASE WHEN "media_kind" = 'video' THEN 'cinematic-clip' ELSE 'editorial-scene' END,
         'creativeDirection', COALESCE("input"->>'prompt', "input"->>'text', '')
       ),
       "compiled_prompt" = COALESCE("input"->>'prompt', "input"->>'text', '');--> statement-breakpoint
UPDATE "publishing"."content_assets" AS asset
   SET "origin_post_id" = asset."draft_id",
       "visual_type" = run."visual_type",
       "description" = COALESCE(NULLIF(asset."metadata"->>'description', ''), asset."file_name"),
       "alt_text" = COALESCE(NULLIF(asset."metadata"->>'altText', ''), NULLIF(asset."metadata"->>'description', ''), asset."file_name")
  FROM "publishing"."content_generation_runs" AS run
 WHERE asset."organization_id" = run."organization_id"
   AND asset."generation_run_id" = run."id";--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ALTER COLUMN "visual_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ALTER COLUMN "description" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" ALTER COLUMN "alt_text" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "visual_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ALTER COLUMN "compiled_prompt" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_organization_id_id_key" ON "publishing"."content_assets" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "publishing"."content_post_media" ADD CONSTRAINT "content_post_media_asset_organization_fkey" FOREIGN KEY ("organization_id","asset_id") REFERENCES "publishing"."content_assets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_post_media_post_asset_key" ON "publishing"."content_post_media" USING btree ("organization_id","post_id","asset_id");--> statement-breakpoint
CREATE INDEX "content_post_media_post_idx" ON "publishing"."content_post_media" USING btree ("organization_id","post_id","position");--> statement-breakpoint
CREATE INDEX "content_post_media_asset_idx" ON "publishing"."content_post_media" USING btree ("organization_id","asset_id");--> statement-breakpoint
CREATE INDEX "content_assets_base_idx" ON "publishing"."content_assets" USING btree ("organization_id","content_base_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_assets_origin_post_idx" ON "publishing"."content_assets" USING btree ("organization_id","origin_post_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_generation_runs_base_idx" ON "publishing"."content_generation_runs" USING btree ("organization_id","content_base_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_generation_runs_origin_post_idx" ON "publishing"."content_generation_runs" USING btree ("organization_id","origin_post_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "content_generation_runs_reconcile_idx" ON "publishing"."content_generation_runs" USING btree ("status","updated_at") WHERE (status = ANY (ARRAY['queued'::text, 'submitted'::text, 'processing'::text]));--> statement-breakpoint
INSERT INTO "publishing"."content_post_media" ("organization_id", "post_id", "asset_id", "role", "position")
SELECT "organization_id", "draft_id", "id", "asset_role", 0
  FROM "publishing"."content_assets"
 WHERE "is_selected" = true
   AND "draft_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing"."content_assets" DROP COLUMN "is_selected";--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD CONSTRAINT "content_generation_runs_provider_check" CHECK (provider IS NULL OR provider = ANY (ARRAY['openrouter'::text, 'fal'::text, 'renderer'::text, 'local'::text]));--> statement-breakpoint
CREATE POLICY "content_post_media_organization_policy" ON "publishing"."content_post_media" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
