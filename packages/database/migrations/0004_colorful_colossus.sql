CREATE TABLE "notification_preferences" (
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("organization_id","user_id","category","channel")
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"attention_item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"acted_at" timestamp with time zone,
	CONSTRAINT "notification_recipients_status_check" CHECK (status = ANY (ARRAY['unread'::text, 'seen'::text, 'dismissed'::text, 'acted'::text]))
);
--> statement-breakpoint
ALTER TABLE "notification_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_event_projections" (
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"event_id" uuid NOT NULL,
	"projector" text NOT NULL,
	"policy_version" integer NOT NULL,
	"outcome" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_event_projections_pkey" PRIMARY KEY("organization_id","event_id","projector","policy_version"),
	CONSTRAINT "product_event_projections_outcome_check" CHECK (outcome = ANY (ARRAY['notified'::text, 'suppressed'::text]))
);
--> statement-breakpoint
ALTER TABLE "product_event_projections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "attention_items" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "event_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "origin" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "connector_id" text;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "external_event_id" text;--> statement-breakpoint
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_id_organization_key" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_attention_item_id_fkey" FOREIGN KEY ("attention_item_id","organization_id") REFERENCES "public"."attention_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_event_projections" ADD CONSTRAINT "product_event_projections_event_id_fkey" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."product_events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipients_item_user_key" ON "notification_recipients" USING btree ("organization_id","attention_item_id","user_id");--> statement-breakpoint
CREATE INDEX "notification_recipients_inbox_idx" ON "notification_recipients" USING btree ("organization_id","user_id","status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "product_event_projections_event_idx" ON "product_event_projections" USING btree ("organization_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_external_delivery_key" ON "product_events" USING btree ("organization_id","connector_id","external_event_id","name") WHERE (origin = 'external_connector' AND connector_id IS NOT NULL AND external_event_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_origin_check" CHECK (origin = ANY (ARRAY['internal'::text, 'external_connector'::text]));--> statement-breakpoint
CREATE POLICY "notification_preferences_organization_policy" ON "notification_preferences" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "notification_recipients_organization_policy" ON "notification_recipients" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "product_event_projections_organization_policy" ON "product_event_projections" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_event_projections" FORCE ROW LEVEL SECURITY;
