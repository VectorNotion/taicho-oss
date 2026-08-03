CREATE TABLE "external_api_rate_limit" (
	"organization_id" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "external_api_rate_limit_pkey" PRIMARY KEY("organization_id","oauth_client_id","bucket","window_start"),
	CONSTRAINT "external_api_rate_limit_count_check" CHECK (request_count > 0)
);
--> statement-breakpoint
ALTER TABLE "external_api_rate_limit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_api_rate_limit" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "external_webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"response_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_webhook_delivery_endpoint_event_key" UNIQUE("endpoint_id","event_id"),
	CONSTRAINT "external_webhook_delivery_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'delivering'::text, 'succeeded'::text, 'failed'::text])),
	CONSTRAINT "external_webhook_delivery_attempt_check" CHECK (attempt >= 0 AND max_attempts > 0)
);
--> statement-breakpoint
ALTER TABLE "external_webhook_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_webhook_delivery" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "external_webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_oauth_client_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"event_types" text[] NOT NULL,
	"signing_secret_ciphertext" text NOT NULL,
	"signing_secret_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_webhook_endpoint_org_url_key" UNIQUE("organization_id","url"),
	CONSTRAINT "external_webhook_endpoint_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "external_webhook_endpoint_events_check" CHECK (cardinality(event_types) > 0)
);
--> statement-breakpoint
ALTER TABLE "external_webhook_endpoint" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_webhook_endpoint" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD COLUMN "allowed_resources" text[] DEFAULT '{"mcp"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_api_rate_limit" ADD CONSTRAINT "external_api_rate_limit_oauth_client_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_api_rate_limit" ADD CONSTRAINT "external_api_rate_limit_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_webhook_delivery" ADD CONSTRAINT "external_webhook_delivery_endpoint_fk" FOREIGN KEY ("endpoint_id","organization_id") REFERENCES "public"."external_webhook_endpoint"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_webhook_delivery" ADD CONSTRAINT "external_webhook_delivery_event_fk" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."product_events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_webhook_endpoint" ADD CONSTRAINT "external_webhook_endpoint_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_webhook_endpoint" ADD CONSTRAINT "external_webhook_endpoint_client_fk" FOREIGN KEY ("created_by_oauth_client_id") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_api_rate_limit_expiry_idx" ON "external_api_rate_limit" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "external_webhook_delivery_claim_idx" ON "external_webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "external_webhook_delivery_org_time_idx" ON "external_webhook_delivery" USING btree ("organization_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "external_webhook_endpoint_org_enabled_idx" ON "external_webhook_endpoint" USING btree ("organization_id","enabled");--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD CONSTRAINT "mcp_service_principal_allowed_resources_check" CHECK (cardinality(allowed_resources) > 0 AND allowed_resources <@ ARRAY['api'::text, 'mcp'::text]);--> statement-breakpoint
CREATE POLICY "external_api_rate_limit_organization_policy" ON "external_api_rate_limit" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "external_webhook_delivery_organization_policy" ON "external_webhook_delivery" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "external_webhook_endpoint_organization_policy" ON "external_webhook_endpoint" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
