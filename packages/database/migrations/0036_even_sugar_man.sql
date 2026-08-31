CREATE TABLE "cascade"."funnel_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" boolean NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_decisions_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."funnel_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"node_id" uuid,
	"attempt" integer,
	"body" text NOT NULL,
	"classification" text,
	"classifier_note" text DEFAULT '' NOT NULL,
	"routed_outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_replies_classification_check" CHECK ((classification IS NULL) OR (classification = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, 'ooo'::text, 'unsubscribe'::text]))),
	CONSTRAINT "funnel_replies_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."step_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'generated' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "step_outputs_member_node_attempt_key" UNIQUE("member_id","node_id","attempt"),
	CONSTRAINT "step_outputs_status_check" CHECK (status = ANY (ARRAY['generated'::text, 'approved'::text, 'sent'::text, 'failed'::text])),
	CONSTRAINT "step_outputs_attempt_check" CHECK (attempt >= 1),
	CONSTRAINT "step_outputs_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."step_outputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_decisions" ADD CONSTRAINT "funnel_decisions_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_decisions" ADD CONSTRAINT "funnel_decisions_member_id_organization_fkey" FOREIGN KEY ("member_id","organization_id") REFERENCES "cascade"."funnel_members"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_replies" ADD CONSTRAINT "funnel_replies_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_replies" ADD CONSTRAINT "funnel_replies_member_id_organization_fkey" FOREIGN KEY ("member_id","organization_id") REFERENCES "cascade"."funnel_members"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."step_outputs" ADD CONSTRAINT "step_outputs_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."step_outputs" ADD CONSTRAINT "step_outputs_member_id_organization_fkey" FOREIGN KEY ("member_id","organization_id") REFERENCES "cascade"."funnel_members"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."step_outputs" ADD CONSTRAINT "step_outputs_node_id_organization_fkey" FOREIGN KEY ("node_id","organization_id") REFERENCES "cascade"."funnel_nodes"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_decisions_organization_id_id_key" ON "cascade"."funnel_decisions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "funnel_decisions_member_decided_idx" ON "cascade"."funnel_decisions" USING btree ("member_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_replies_organization_id_id_key" ON "cascade"."funnel_replies" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "funnel_replies_funnel_received_idx" ON "cascade"."funnel_replies" USING btree ("funnel_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "step_outputs_organization_id_id_key" ON "cascade"."step_outputs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "step_outputs_funnel_status_idx" ON "cascade"."step_outputs" USING btree ("funnel_id","status");--> statement-breakpoint
CREATE POLICY "funnel_decisions_organization_policy" ON "cascade"."funnel_decisions" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnel_replies_organization_policy" ON "cascade"."funnel_replies" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "step_outputs_organization_policy" ON "cascade"."step_outputs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));