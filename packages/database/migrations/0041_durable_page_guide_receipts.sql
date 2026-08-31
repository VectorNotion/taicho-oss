CREATE TABLE "page_guide_receipts" (
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"user_id" text NOT NULL,
	"guide_key" text NOT NULL,
	"last_seen_content_hash" varchar(64) NOT NULL,
	"dismissed_content_hash" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"open_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_guide_receipts_pkey" PRIMARY KEY("organization_id","user_id","guide_key"),
	CONSTRAINT "page_guide_receipts_last_seen_hash_check" CHECK (last_seen_content_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_guide_receipts_dismissed_hash_check" CHECK (dismissed_content_hash IS NULL OR dismissed_content_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_guide_receipts_dismissed_at_check" CHECK ((dismissed_content_hash IS NULL) = (dismissed_at IS NULL)),
	CONSTRAINT "page_guide_receipts_open_count_check" CHECK (open_count > 0)
);
--> statement-breakpoint
ALTER TABLE "page_guide_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_guide_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_guide_receipts" ADD CONSTRAINT "page_guide_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_guide_receipts" ADD CONSTRAINT "page_guide_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_guide_receipts_user_idx" ON "page_guide_receipts" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE POLICY "page_guide_receipts_organization_policy" ON "page_guide_receipts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
