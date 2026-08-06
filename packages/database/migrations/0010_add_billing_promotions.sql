CREATE TABLE "promotion_version" (
	"promotion_id" text NOT NULL,
	"version" integer NOT NULL,
	"payload_promotion_id" text NOT NULL,
	"payload_updated_at" timestamp with time zone NOT NULL,
	"catalog_version" text NOT NULL,
	"catalog_country" text NOT NULL,
	"catalog_environment" text NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_offer_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"code_hash" text NOT NULL,
	"kind" text NOT NULL,
	"trial_days" integer,
	"discount_type" text,
	"percent_off_basis_points" integer,
	"amount_off_minor" bigint,
	"maximum_discount_minor" bigint,
	"currency" text,
	"duration" text,
	"duration_cycles" integer,
	"eligible_plan_ids" text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"new_customers_only" boolean DEFAULT true NOT NULL,
	"max_redemptions" integer,
	"per_organization_limit" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_version_pkey" PRIMARY KEY("promotion_id", "version"),
	CONSTRAINT "promotion_version_catalog_country_check" CHECK (catalog_country ~ '^[A-Z]{2}$'),
	CONSTRAINT "promotion_version_catalog_environment_check" CHECK (catalog_environment = ANY (ARRAY['test'::text, 'live'::text])),
	CONSTRAINT "promotion_version_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])),
	CONSTRAINT "promotion_version_kind_check" CHECK (kind = ANY (ARRAY['trial'::text, 'discount'::text])),
	CONSTRAINT "promotion_version_discount_type_check" CHECK (discount_type IS NULL OR discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text])),
	CONSTRAINT "promotion_version_duration_check" CHECK (duration IS NULL OR duration = ANY (ARRAY['once'::text, 'repeating'::text, 'forever'::text])),
	CONSTRAINT "promotion_version_time_check" CHECK (ends_at > starts_at),
	CONSTRAINT "promotion_version_trial_days_check" CHECK (trial_days IS NULL OR (trial_days > 0 AND trial_days <= 90)),
	CONSTRAINT "promotion_version_percent_check" CHECK (percent_off_basis_points IS NULL OR (percent_off_basis_points > 0 AND percent_off_basis_points <= 10000)),
	CONSTRAINT "promotion_version_amount_check" CHECK (amount_off_minor IS NULL OR amount_off_minor > 0),
	CONSTRAINT "promotion_version_maximum_discount_check" CHECK (maximum_discount_minor IS NULL OR maximum_discount_minor > 0),
	CONSTRAINT "promotion_version_duration_cycles_check" CHECK (duration_cycles IS NULL OR duration_cycles > 1),
	CONSTRAINT "promotion_version_eligible_plans_check" CHECK (cardinality(eligible_plan_ids) > 0),
	CONSTRAINT "promotion_version_max_redemptions_check" CHECK (max_redemptions IS NULL OR max_redemptions > 0),
	CONSTRAINT "promotion_version_per_organization_limit_check" CHECK (per_organization_limit > 0)
);

CREATE UNIQUE INDEX "promotion_version_catalog_idx" ON "promotion_version" USING btree ("promotion_id", "catalog_version");
CREATE INDEX "promotion_version_code_idx" ON "promotion_version" USING btree ("code_hash", "catalog_version", "catalog_country", "catalog_environment");

ALTER TABLE "billing_subscription"
	ADD COLUMN "promotion_id" text,
	ADD COLUMN "promotion_version" integer,
	ADD COLUMN "provider_offer_id" text,
	ADD COLUMN "promotion_paid_count" integer DEFAULT 0 NOT NULL,
	ADD COLUMN "promotion_applied_at" timestamp with time zone,
	ADD CONSTRAINT "billing_subscription_promotion_id_version_fkey"
		FOREIGN KEY ("promotion_id", "promotion_version")
		REFERENCES "promotion_version"("promotion_id", "version"),
	ADD CONSTRAINT "billing_subscription_promotion_paid_count_check"
		CHECK (promotion_paid_count >= 0);

ALTER TABLE "payment_checkout_session"
	ADD COLUMN "catalog_version" text;

ALTER TABLE "payment_transaction"
	ADD COLUMN "list_amount_minor" bigint,
	ADD COLUMN "discount_amount_minor" bigint,
	ADD COLUMN "promotion_id" text,
	ADD COLUMN "promotion_version" integer,
	ADD CONSTRAINT "payment_transaction_promotion_id_version_fkey"
		FOREIGN KEY ("promotion_id", "promotion_version")
		REFERENCES "promotion_version"("promotion_id", "version"),
	ADD CONSTRAINT "payment_transaction_list_amount_minor_check"
		CHECK (list_amount_minor IS NULL OR list_amount_minor >= amount_minor),
	ADD CONSTRAINT "payment_transaction_discount_amount_minor_check"
		CHECK (discount_amount_minor IS NULL OR discount_amount_minor >= 0);

CREATE TABLE "promotion_redemption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" text NOT NULL,
	"promotion_version" integer NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"provider_subscription_id" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_redemption_promotion_id_version_fkey"
		FOREIGN KEY ("promotion_id", "promotion_version")
		REFERENCES "promotion_version"("promotion_id", "version"),
	CONSTRAINT "promotion_redemption_organization_id_fkey"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade,
	CONSTRAINT "promotion_redemption_user_id_fkey"
		FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict,
	CONSTRAINT "promotion_redemption_checkout_session_id_fkey"
		FOREIGN KEY ("checkout_session_id") REFERENCES "payment_checkout_session"("id") ON DELETE cascade,
	CONSTRAINT "promotion_redemption_checkout_session_id_key" UNIQUE("checkout_session_id"),
	CONSTRAINT "promotion_redemption_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'applied'::text, 'released'::text]))
);

CREATE INDEX "promotion_redemption_promotion_status_idx" ON "promotion_redemption" USING btree ("promotion_id", "status", "reservation_expires_at");
CREATE INDEX "promotion_redemption_organization_idx" ON "promotion_redemption" USING btree ("organization_id", "promotion_id", "created_at");
