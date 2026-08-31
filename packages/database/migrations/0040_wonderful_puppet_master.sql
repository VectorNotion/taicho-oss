ALTER TABLE "enterprise_inquiry" ADD COLUMN "company_url" text;--> statement-breakpoint
ALTER TABLE "enterprise_inquiry" ADD COLUMN "consent_recorded_at" timestamp with time zone;--> statement-breakpoint
UPDATE "enterprise_inquiry"
SET "company_url" = '',
    "consent_recorded_at" = "created_at"
WHERE "company_url" IS NULL OR "consent_recorded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "enterprise_inquiry" ALTER COLUMN "company_url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_inquiry" ALTER COLUMN "consent_recorded_at" SET NOT NULL;
