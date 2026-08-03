CREATE TABLE "attention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"event_id" uuid,
	"artifact_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"suggested_action" jsonb NOT NULL,
	"assigned_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "attention_items_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
	CONSTRAINT "attention_items_status_check" CHECK (status = ANY (ARRAY['open'::text, 'seen'::text, 'resolved'::text, 'dismissed'::text]))
);
--> statement-breakpoint
ALTER TABLE "attention_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intelligence_api_tokens" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "intelligence_api_tokens_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "intelligence_api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intelligence_artifact_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"artifact_id" uuid NOT NULL,
	"delivery_id" text NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"external_ref" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_artifact_outcomes_org_delivery_key" UNIQUE("organization_id","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "intelligence_artifact_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intelligence_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_artifacts_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "intelligence_artifacts_status_check" CHECK (status = ANY (ARRAY['ready'::text, 'approved'::text, 'superseded'::text]))
);
--> statement-breakpoint
ALTER TABLE "intelligence_artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intelligence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"workflow_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"initiating_user_id" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "intelligence_runs_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "intelligence_runs_org_workflow_idempotency_key" UNIQUE("organization_id","workflow_key","idempotency_key"),
	CONSTRAINT "intelligence_runs_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "intelligence_runs_status_check" CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])),
	CONSTRAINT "intelligence_runs_trigger_check" CHECK (trigger = ANY (ARRAY['chat'::text, 'event'::text, 'external'::text, 'system'::text]))
);
--> statement-breakpoint
ALTER TABLE "intelligence_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_id_organization_key" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_event_id_fkey" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."product_events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_artifact_id_fkey" FOREIGN KEY ("artifact_id","organization_id") REFERENCES "public"."intelligence_artifacts"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_artifact_outcomes" ADD CONSTRAINT "intelligence_artifact_outcomes_artifact_id_fkey" FOREIGN KEY ("artifact_id","organization_id") REFERENCES "public"."intelligence_artifacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_artifacts" ADD CONSTRAINT "intelligence_artifacts_run_id_fkey" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."intelligence_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_items_org_status_time_idx" ON "attention_items" USING btree ("organization_id","status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "attention_items_org_event_key" ON "attention_items" USING btree ("organization_id","event_id") WHERE (event_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "intelligence_artifact_outcomes_artifact_idx" ON "intelligence_artifact_outcomes" USING btree ("organization_id","artifact_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "intelligence_artifacts_org_time_idx" ON "intelligence_artifacts" USING btree ("organization_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "intelligence_artifacts_run_idx" ON "intelligence_artifacts" USING btree ("organization_id","run_id");--> statement-breakpoint
CREATE INDEX "intelligence_runs_org_time_idx" ON "intelligence_runs" USING btree ("organization_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE POLICY "attention_items_organization_policy" ON "attention_items" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "intelligence_api_tokens_organization_policy" ON "intelligence_api_tokens" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "intelligence_artifact_outcomes_organization_policy" ON "intelligence_artifact_outcomes" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "intelligence_artifacts_organization_policy" ON "intelligence_artifacts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "intelligence_runs_organization_policy" ON "intelligence_runs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
ALTER TABLE "attention_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_api_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_artifact_outcomes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_artifacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intelligence_runs" FORCE ROW LEVEL SECURITY;
