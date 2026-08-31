UPDATE "publishing"."content_generation_runs"
   SET "visual_brief" = jsonb_set(
     "visual_brief",
     '{creativeDirection}',
     to_jsonb(left("visual_brief"->>'creativeDirection', 2000)),
     false
   )
 WHERE jsonb_typeof("visual_brief"->'creativeDirection') = 'string'
   AND char_length("visual_brief"->>'creativeDirection') > 2000;--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" DROP CONSTRAINT "content_generation_runs_status_check";--> statement-breakpoint
DROP INDEX "publishing"."content_generation_runs_reconcile_idx";--> statement-breakpoint
CREATE INDEX "content_generation_runs_reconcile_idx" ON "publishing"."content_generation_runs" USING btree ("status","updated_at") WHERE (status = ANY (ARRAY['preparing'::text, 'queued'::text, 'submitted'::text, 'processing'::text]));--> statement-breakpoint
ALTER TABLE "publishing"."content_generation_runs" ADD CONSTRAINT "content_generation_runs_status_check" CHECK (status = ANY (ARRAY['preparing'::text, 'queued'::text, 'submitted'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]));
