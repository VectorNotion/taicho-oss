CREATE TABLE "cascade"."funnel_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_edges_from_label_key" UNIQUE("from_node_id","label"),
	CONSTRAINT "funnel_edges_label_check" CHECK (label = ANY (ARRAY['next'::text, 'yes'::text, 'no'::text, 'responded'::text, 'exhausted'::text])),
	CONSTRAINT "funnel_edges_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_edges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"member_id" uuid,
	"node_id" uuid,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_events_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."funnel_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_nodes_type_check" CHECK (type = ANY (ARRAY['touch'::text, 'wait'::text, 'branch'::text, 'goal'::text, 'route'::text])),
	CONSTRAINT "funnel_nodes_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_nodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "current_node_id" uuid;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "entered_node_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_members" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "goal_type" text DEFAULT 'reply' NOT NULL;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "goal_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "send_window" jsonb;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "auto_approve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "reentry_days" integer;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ADD COLUMN "entry_node_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_nodes_organization_id_id_key" ON "cascade"."funnel_nodes" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "cascade"."funnel_edges" ADD CONSTRAINT "funnel_edges_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_edges" ADD CONSTRAINT "funnel_edges_from_node_organization_fkey" FOREIGN KEY ("from_node_id","organization_id") REFERENCES "cascade"."funnel_nodes"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_edges" ADD CONSTRAINT "funnel_edges_to_node_organization_fkey" FOREIGN KEY ("to_node_id","organization_id") REFERENCES "cascade"."funnel_nodes"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_events" ADD CONSTRAINT "funnel_events_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_nodes" ADD CONSTRAINT "funnel_nodes_funnel_id_organization_fkey" FOREIGN KEY ("funnel_id","organization_id") REFERENCES "cascade"."funnels"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_edges_organization_id_id_key" ON "cascade"."funnel_edges" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_organization_id_id_key" ON "cascade"."funnel_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "funnel_events_funnel_occurred_idx" ON "cascade"."funnel_events" USING btree ("funnel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "funnel_nodes_funnel_idx" ON "cascade"."funnel_nodes" USING btree ("funnel_id");--> statement-breakpoint
CREATE POLICY "funnel_edges_organization_policy" ON "cascade"."funnel_edges" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnel_events_organization_policy" ON "cascade"."funnel_events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnel_nodes_organization_policy" ON "cascade"."funnel_nodes" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));