CREATE SCHEMA "assistant";
--> statement-breakpoint
CREATE SCHEMA "automation";
--> statement-breakpoint
CREATE SCHEMA "cascade";
--> statement-breakpoint
CREATE SCHEMA "observability";
--> statement-breakpoint
CREATE SCHEMA "publishing";
--> statement-breakpoint
CREATE SCHEMA "sync";
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cascade"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"checkout_session_id" uuid,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"current_start" timestamp with time zone,
	"current_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_plan_id" text,
	"scheduled_plan_id" text,
	"scheduled_plan_version" integer,
	"scheduled_provider_plan_id" text,
	"scheduled_seats" integer,
	"billing_country" text,
	CONSTRAINT "billing_subscription_provider_subscription_id_key" UNIQUE("provider_subscription_id"),
	CONSTRAINT "billing_subscription_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])),
	CONSTRAINT "billing_subscription_scheduled_seats_check" CHECK (scheduled_seats > 0),
	CONSTRAINT "billing_subscription_seats_check" CHECK (seats > 0)
);
--> statement-breakpoint
CREATE TABLE "cascade"."cascade_settings" (
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."cascade_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publishing"."channels" (
	"id" text NOT NULL,
	"destination" text NOT NULL,
	"name" text NOT NULL,
	"credential_kind" text NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_expiry" timestamp with time zone,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"org_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_pkey" PRIMARY KEY("id","org_id"),
	CONSTRAINT "channels_credential_kind_check" CHECK (credential_kind = ANY (ARRAY['oauth2'::text, 'oauth1'::text, 'api_key'::text, 'signing_secret'::text, 'none'::text]))
);
--> statement-breakpoint
ALTER TABLE "publishing"."channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_plan_price" (
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"market" text NOT NULL,
	"provider" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"display_price" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_plan_price_pkey" PRIMARY KEY("plan_id","plan_version","market"),
	CONSTRAINT "commercial_plan_price_amount_minor_check" CHECK (amount_minor > 0),
	CONSTRAINT "commercial_plan_price_currency_check" CHECK (currency = ANY (ARRAY['INR'::text, 'USD'::text])),
	CONSTRAINT "commercial_plan_price_market_check" CHECK (market = ANY (ARRAY['india'::text, 'international'::text])),
	CONSTRAINT "commercial_plan_price_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'paypal'::text]))
);
--> statement-breakpoint
CREATE TABLE "commercial_plan_version" (
	"plan_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"display_price" text NOT NULL,
	"weekly_credits" bigint NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"per_seat" boolean DEFAULT false NOT NULL,
	"contact_sales" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payload_plan_id" text,
	"catalog_version" text,
	"catalog_country" text,
	"catalog_provider" text,
	"catalog_environment" text,
	"billing_model" text DEFAULT 'fixed' NOT NULL,
	"call_to_action_label" text,
	"highlighted" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"billing_interval_count" integer,
	"per_user" boolean DEFAULT false NOT NULL,
	"provider_plan_id" text,
	"existing_subscriber_policy" text DEFAULT 'cycle-end' NOT NULL,
	"included_credits" bigint DEFAULT 0 NOT NULL,
	"credit_owner" text DEFAULT 'user' NOT NULL,
	"credit_cadence" text DEFAULT 'billing-period' NOT NULL,
	"trial_days" integer,
	"billing_interval" text,
	CONSTRAINT "commercial_plan_version_pkey" PRIMARY KEY("plan_id","version"),
	CONSTRAINT "commercial_plan_version_amount_minor_check" CHECK (amount_minor >= 0),
	CONSTRAINT "commercial_plan_version_billing_interval_check" CHECK (billing_interval = ANY (ARRAY['month'::text, 'year'::text])),
	CONSTRAINT "commercial_plan_version_billing_interval_count_check" CHECK (billing_interval_count > 0),
	CONSTRAINT "commercial_plan_version_billing_model_check" CHECK (billing_model = ANY (ARRAY['trial'::text, 'per-user'::text, 'per-seat'::text, 'contact-sales'::text])),
	CONSTRAINT "commercial_plan_version_credit_cadence_check" CHECK (credit_cadence = ANY (ARRAY['trial'::text, 'billing-period'::text, 'none'::text])),
	CONSTRAINT "commercial_plan_version_credit_owner_check" CHECK (credit_owner = ANY (ARRAY['user'::text, 'organization'::text])),
	CONSTRAINT "commercial_plan_version_existing_subscriber_policy_check" CHECK (existing_subscriber_policy = ANY (ARRAY['cycle-end'::text, 'new-customers-only'::text])),
	CONSTRAINT "commercial_plan_version_included_credits_check" CHECK (included_credits >= 0),
	CONSTRAINT "commercial_plan_version_trial_days_check" CHECK (trial_days > 0),
	CONSTRAINT "commercial_plan_version_weekly_credits_check" CHECK (weekly_credits >= 0)
);
--> statement-breakpoint
CREATE TABLE "commercial_rate_card" (
	"kind" text NOT NULL,
	"provider" text DEFAULT '*' NOT NULL,
	"model" text DEFAULT '*' NOT NULL,
	"version" integer NOT NULL,
	"unit" text NOT NULL,
	"credits_per_unit" numeric(18, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{"normalized_credit_usd":0.001}'::jsonb NOT NULL,
	CONSTRAINT "commercial_rate_card_pkey" PRIMARY KEY("kind","provider","model","version"),
	CONSTRAINT "commercial_rate_card_credits_per_unit_check" CHECK (credits_per_unit >= (0)::numeric)
);
--> statement-breakpoint
CREATE TABLE "commercial_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"requested_plan_id" text,
	"requested_credits" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_request_kind_check" CHECK (kind = ANY (ARRAY['upgrade'::text, 'top_up'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_link_id" uuid NOT NULL,
	"canonical_field" text NOT NULL,
	"last_common_value_ciphertext" text,
	"crm_value_ciphertext" text,
	"vector_notion_value_ciphertext" text,
	"crm_changed_at" timestamp with time zone,
	"vector_notion_changed_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflicts_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "conflicts_resolution_check" CHECK (resolution = ANY (ARRAY['crm'::text, 'vector_notion'::text, 'custom'::text, 'unchanged'::text])),
	CONSTRAINT "conflicts_status_check" CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"auth_kind" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"api_base_url" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_key_version" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"sync_mode" text DEFAULT 'two_way' NOT NULL,
	"reconciliation_interval_minutes" integer DEFAULT 15 NOT NULL,
	"selected_objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"last_error_code" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"target_roles" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "connections_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "connections_organization_id_provider_external_account_id_key" UNIQUE("organization_id","provider","external_account_id"),
	CONSTRAINT "connections_auth_kind_check" CHECK (auth_kind = ANY (ARRAY['oauth2'::text, 'api_key'::text])),
	CONSTRAINT "connections_reconciliation_interval_minutes_check" CHECK ((reconciliation_interval_minutes >= 5) AND (reconciliation_interval_minutes <= 10080)),
	CONSTRAINT "connections_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text, 'degraded'::text, 'reconnect_required'::text, 'resnapshot_required'::text, 'disabled'::text, 'disconnected'::text])),
	CONSTRAINT "connections_sync_mode_check" CHECK (sync_mode = ANY (ARRAY['two_way'::text, 'inbound_only'::text, 'disabled'::text])),
	CONSTRAINT "connections_target_roles_check" CHECK (target_roles <@ ARRAY['outreach'::text])
);
--> statement-breakpoint
CREATE TABLE "sync"."contact_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"identity_kind" text NOT NULL,
	"normalized_value" text NOT NULL,
	"contact_id" text NOT NULL,
	"confidence" text DEFAULT 'exact' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identities_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "contact_identities_organization_id_identity_kind_normalized_key" UNIQUE("organization_id","identity_kind","normalized_value"),
	CONSTRAINT "contact_identities_confidence_check" CHECK (confidence = ANY (ARRAY['exact'::text, 'high'::text, 'suggested'::text])),
	CONSTRAINT "contact_identities_identity_kind_check" CHECK (identity_kind = ANY (ARRAY['email'::text, 'linkedin'::text, 'phone'::text]))
);
--> statement-breakpoint
CREATE TABLE "cascade"."contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timezone" text,
	"subscription_status" text DEFAULT 'subscribed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outreach_lead_id" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	"workspace_contact_id" text,
	"workspace_contact_linked_at" timestamp with time zone,
	CONSTRAINT "contacts_subscription_status_check" CHECK (subscription_status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'suppressed'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"slots" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."content" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant"."conversations" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"surface" text NOT NULL,
	"subject_id" text NOT NULL,
	"account_id" text,
	"user_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"lead_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failed_answer_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "conversations_status_check" CHECK (status = ANY (ARRAY['open'::text, 'escalated'::text, 'resolved'::text, 'closed'::text])),
	CONSTRAINT "conversations_surface_check" CHECK (surface = ANY (ARRAY['sales'::text, 'support'::text]))
);
--> statement-breakpoint
ALTER TABLE "assistant"."conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"lot_id" uuid,
	"reservation_id" uuid,
	"actor_user_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount" bigint NOT NULL,
	"remaining" bigint NOT NULL,
	"grant_key" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_lot_grant_key_key" UNIQUE("grant_key"),
	CONSTRAINT "credit_lot_amount_check" CHECK (amount > 0),
	CONSTRAINT "credit_lot_remaining_check" CHECK (remaining >= 0),
	CONSTRAINT "credit_lot_source_check" CHECK (source = ANY (ARRAY['included'::text, 'weekly_grant'::text, 'purchased'::text, 'adjustment'::text]))
);
--> statement-breakpoint
CREATE TABLE "credit_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"initiating_user_id" text NOT NULL,
	"action" text NOT NULL,
	"estimated" bigint NOT NULL,
	"settled" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "credit_reservation_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "credit_reservation_estimated_check" CHECK (estimated > 0),
	CONSTRAINT "credit_reservation_status_check" CHECK (status = ANY (ARRAY['active'::text, 'settled'::text, 'released'::text]))
);
--> statement-breakpoint
CREATE TABLE "credit_wallet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"debt" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_wallet_organization_id_user_id_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "credit_wallet_debt_check" CHECK (debt >= 0),
	CONSTRAINT "credit_wallet_reserved_check" CHECK (reserved >= 0)
);
--> statement-breakpoint
CREATE TABLE "automation"."dead_letters" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"error" text NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cascade"."delivery_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider_domain_id" text,
	"verification_status" text DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "delivery_domains_verification_status_check" CHECK (verification_status = ANY (ARRAY['unknown'::text, 'pending'::text, 'verified'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."delivery_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."delivery_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_key_version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"health_status" text DEFAULT 'unchecked' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error_code" text,
	"webhook_status" text DEFAULT 'not_configured' NOT NULL,
	"webhook_configured_at" timestamp with time zone,
	"webhook_last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "delivery_provider_connections_health_status_check" CHECK (health_status = ANY (ARRAY['unchecked'::text, 'connected'::text, 'error'::text])),
	CONSTRAINT "delivery_provider_connections_provider_check" CHECK (provider = ANY (ARRAY['resend'::text, 'sendgrid'::text, 'mailchimp'::text])),
	CONSTRAINT "delivery_provider_connections_webhook_status_check" CHECK (webhook_status = ANY (ARRAY['not_configured'::text, 'configured'::text, 'receiving'::text, 'error'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."delivery_provider_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."delivery_sender_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"verification_status" text DEFAULT 'unknown' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "delivery_sender_identities_verification_status_check" CHECK (verification_status = ANY (ARRAY['unknown'::text, 'pending'::text, 'verified'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."delivery_sender_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant"."documents" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((((COALESCE(title, ''::text) || ' '::text) || COALESCE(heading, ''::text)) || ' '::text) || content))) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "documents_tenant_id_source_id_key" UNIQUE("tenant_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "assistant"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"interest_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "emails_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "cascade"."emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"current_step_id" uuid,
	"state" text DEFAULT 'active' NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "enrollments_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))),
	CONSTRAINT "enrollments_state_check" CHECK (state = ANY (ARRAY['active'::text, 'completed'::text, 'stopped'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enterprise_inquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"team_size" text,
	"requirements" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."entity_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"revision" integer NOT NULL,
	"origin_kind" text NOT NULL,
	"origin_connection_id" uuid,
	"changed_fields" jsonb NOT NULL,
	"suppress_outbound" boolean DEFAULT false NOT NULL,
	"mutation_payload_ciphertext" text,
	"mutation_fingerprint" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "entity_mutations_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "entity_mutations_organization_id_entity_kind_entity_id_revi_key" UNIQUE("organization_id","entity_kind","entity_id","revision"),
	CONSTRAINT "entity_mutations_organization_id_mutation_fingerprint_key" UNIQUE("organization_id","mutation_fingerprint"),
	CONSTRAINT "entity_mutations_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "entity_mutations_origin_kind_check" CHECK (origin_kind = ANY (ARRAY['user'::text, 'file'::text, 'inbound_sync'::text, 'conflict_resolution'::text, 'system'::text])),
	CONSTRAINT "entity_mutations_revision_check" CHECK (revision > 0),
	CONSTRAINT "entity_mutations_status_check" CHECK (status = ANY (ARRAY['reserved'::text, 'projecting'::text, 'applied'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "automation"."event_fanout_cursor" (
	"id" smallint PRIMARY KEY NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"last_event_id" uuid NOT NULL,
	CONSTRAINT "event_fanout_cursor_id_check" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "cascade"."events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cascade"."cascade.events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"contact_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"send_id" uuid,
	"type" text NOT NULL,
	"value" numeric,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "events_type_check" CHECK (type = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'open'::text, 'click'::text, 'bounce'::text, 'complaint'::text, 'unsub'::text, 'interest'::text, 'convert'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync"."events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync"."sync.events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"connection_id" uuid,
	"run_id" uuid,
	"cycle_id" uuid,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata_redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_organization_id_id_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "observability"."execution_event" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"support_code" text NOT NULL,
	"execution_id" text NOT NULL,
	"request_id" text NOT NULL,
	"parent_execution_id" text,
	"organization_id" text,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"session_id" text,
	"run_id" text,
	"job_id" text,
	"trace_id" text,
	"span_id" text,
	"service_name" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"safe_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_type" text,
	"error_code" text,
	"error_fingerprint" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" double precision,
	"retained_until" timestamp with time zone NOT NULL,
	CONSTRAINT "execution_event_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "execution_event_status_check" CHECK (status = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."external_entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"first_run_id" uuid,
	"last_run_id" uuid,
	"source_updated_at" timestamp with time zone,
	"remote_version" text,
	"fingerprint" text,
	"remote_deleted_at" timestamp with time zone,
	"remote_merged_into_id" text,
	"sync_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_entity_links_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "external_entity_links_organization_id_provider_external_acc_key" UNIQUE("organization_id","provider","external_account_id","object_type","external_id"),
	CONSTRAINT "external_entity_links_sync_status_check" CHECK (sync_status = ANY (ARRAY['active'::text, 'deleted'::text, 'merged'::text, 'conflict'::text, 'disabled'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."field_sync_state" (
	"organization_id" text NOT NULL,
	"entity_link_id" uuid NOT NULL,
	"canonical_field" text NOT NULL,
	"last_common_value_hash" text,
	"crm_value_hash" text,
	"vector_notion_value_hash" text,
	"crm_changed_at" timestamp with time zone,
	"vector_notion_changed_at" timestamp with time zone,
	"last_direction" text,
	"last_inbound_event_id" uuid,
	"last_outbound_command_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_sync_state_pkey" PRIMARY KEY("organization_id","entity_link_id","canonical_field"),
	CONSTRAINT "field_sync_state_last_direction_check" CHECK (last_direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"sheet_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "files_organization_id_object_key_key" UNIQUE("organization_id","object_key"),
	CONSTRAINT "files_size_bytes_check" CHECK (size_bytes >= 0)
);
--> statement-breakpoint
CREATE TABLE "cascade"."funnel_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_funnel_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"to_funnel_id" uuid NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_routes_from_funnel_id_outcome_key" UNIQUE("from_funnel_id","outcome"),
	CONSTRAINT "funnel_routes_outcome_check" CHECK (outcome = ANY (ARRAY['completed'::text, 'interest'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."funnel_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "funnel_steps_funnel_id_position_key" UNIQUE("funnel_id","position"),
	CONSTRAINT "funnel_steps_position_check" CHECK ("position" >= 1),
	CONSTRAINT "funnel_steps_type_check" CHECK (type = ANY (ARRAY['email'::text, 'delay'::text, 'branch'::text, 'goal'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnel_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"open_ended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	"builder_layout" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cascade"."funnels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant"."idempotency_keys" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("tenant_id","key","operation")
);
--> statement-breakpoint
ALTER TABLE "assistant"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant"."identity_links" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"source_subject_id" text NOT NULL,
	"target_subject_id" text NOT NULL,
	"verified_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_links_pkey" PRIMARY KEY("tenant_id","source_subject_id","target_subject_id"),
	CONSTRAINT "identity_links_verified_by_check" CHECK (verified_by = ANY (ARRAY['authenticated_session'::text, 'verified_email'::text]))
);
--> statement-breakpoint
ALTER TABLE "assistant"."identity_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync"."inbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"event_action" text NOT NULL,
	"event_time" timestamp with time zone,
	"payload_ciphertext" text,
	"signature_verified" boolean NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "inbox_events_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "inbox_events_connection_id_provider_event_id_key" UNIQUE("connection_id","provider_event_id"),
	CONSTRAINT "inbox_events_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "inbox_events_event_action_check" CHECK (event_action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'restore'::text, 'merge'::text])),
	CONSTRAINT "inbox_events_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'processed'::text, 'ignored'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"inviterId" text NOT NULL,
	"teamId" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"product" varchar(20) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	"initiating_user_id" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"wallet_user_id" text,
	"credit_reservation_id" uuid,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "jobs_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "valid_status" CHECK ((status)::text = ANY ((ARRAY['queued'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync"."mapping_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"entity_kind" text NOT NULL,
	"provider" text,
	"connection_id" uuid,
	"source_object" text NOT NULL,
	"version" integer NOT NULL,
	"field_map" jsonb NOT NULL,
	"field_policies" jsonb NOT NULL,
	"transforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_versions_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "mapping_versions_organization_id_name_version_key" UNIQUE("organization_id","name","version"),
	CONSTRAINT "mapping_versions_version_check" CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE "mastra_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text NOT NULL,
	"model" jsonb NOT NULL,
	"tools" jsonb,
	"defaultOptions" jsonb,
	"workflows" jsonb,
	"agents" jsonb,
	"inputProcessors" jsonb,
	"outputProcessors" jsonb,
	"memory" jsonb,
	"scorers" jsonb,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mastra_ai_spans" (
	"traceId" text NOT NULL,
	"spanId" text NOT NULL,
	"name" text NOT NULL,
	"spanType" text NOT NULL,
	"isEvent" boolean NOT NULL,
	"startedAt" timestamp NOT NULL,
	"parentSpanId" text,
	"entityType" text,
	"entityId" text,
	"entityName" text,
	"userId" text,
	"organizationId" text,
	"resourceId" text,
	"runId" text,
	"sessionId" text,
	"threadId" text,
	"requestId" text,
	"environment" text,
	"source" text,
	"serviceName" text,
	"scope" jsonb,
	"metadata" jsonb,
	"tags" jsonb,
	"attributes" jsonb,
	"links" jsonb,
	"input" jsonb,
	"output" jsonb,
	"error" jsonb,
	"endedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp,
	"startedAtZ" timestamp with time zone DEFAULT now(),
	"endedAtZ" timestamp with time zone DEFAULT now(),
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now(),
	CONSTRAINT "public_mastra_ai_spans_traceid_spanid_pk" PRIMARY KEY("traceId","spanId")
);
--> statement-breakpoint
CREATE TABLE "mastra_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"content" text NOT NULL,
	"role" text NOT NULL,
	"type" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"resourceId" text,
	"createdAtZ" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mastra_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"workingMemory" text,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mastra_scorers" (
	"id" text PRIMARY KEY NOT NULL,
	"scorerId" text NOT NULL,
	"traceId" text,
	"spanId" text,
	"runId" text NOT NULL,
	"scorer" jsonb NOT NULL,
	"preprocessStepResult" jsonb,
	"extractStepResult" jsonb,
	"analyzeStepResult" jsonb,
	"score" double precision NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"preprocessPrompt" text,
	"extractPrompt" text,
	"generateScorePrompt" text,
	"generateReasonPrompt" text,
	"analyzePrompt" text,
	"reasonPrompt" text,
	"input" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"additionalContext" jsonb,
	"requestContext" jsonb,
	"entityType" text,
	"entity" jsonb,
	"entityId" text,
	"source" text NOT NULL,
	"resourceId" text,
	"threadId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mastra_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"resourceId" text NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mastra_workflow_snapshot" (
	"workflow_name" text NOT NULL,
	"run_id" text NOT NULL,
	"resourceId" text,
	"snapshot" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"createdAtZ" timestamp with time zone DEFAULT now(),
	"updatedAtZ" timestamp with time zone DEFAULT now(),
	CONSTRAINT "public_mastra_workflow_snapshot_workflow_name_run_id_key" UNIQUE("workflow_name","run_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"oauth_client_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"affected_entity_ids" text[] DEFAULT '{}' NOT NULL,
	"error_code" text,
	"idempotency_key" text,
	"credit_delta" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "mcp_audit_event_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text])),
	CONSTRAINT "mcp_audit_event_status_check" CHECK (status = ANY (ARRAY['succeeded'::text, 'failed'::text, 'denied'::text]))
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"server_url" text NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"credential_env" text,
	"header_name" text,
	"allowed_tools" text[] DEFAULT '{}' NOT NULL,
	"pinned_tool_schemas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discovered_server" jsonb,
	"last_tested_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connection_organization_id_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "mcp_connection_auth_type_check" CHECK (auth_type = ANY (ARRAY['none'::text, 'bearer_env'::text, 'header_env'::text, 'oauth_client_credentials_env'::text]))
);
--> statement-breakpoint
ALTER TABLE "mcp_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_idempotency_key" (
	"organization_id" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"lease_expires_at" timestamp with time zone DEFAULT (now() + '00:02:00'::interval) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_idempotency_key_pkey" PRIMARY KEY("organization_id","oauth_client_id","capability_id","idempotency_key"),
	CONSTRAINT "mcp_idempotency_key_status_check" CHECK (status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "mcp_idempotency_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_media_upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"actor_user_id" text,
	"actor_type" text DEFAULT 'service' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"token_hash" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"max_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"media_key" text,
	"byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_media_upload_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "mcp_media_upload_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "mcp_media_upload_max_bytes_check" CHECK (max_bytes > 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_media_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"actor_user_id" text,
	"actor_type" text DEFAULT 'service' NOT NULL,
	"billing_user_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"result" jsonb,
	"error" jsonb,
	"credit_reservation_id" uuid,
	"estimated_credits" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_operation_organization_id_oauth_client_id_action_idempo_key" UNIQUE("organization_id","oauth_client_id","action","idempotency_key"),
	CONSTRAINT "mcp_operation_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "mcp_operation_progress_check" CHECK ((progress >= 0) AND (progress <= 100)),
	CONSTRAINT "mcp_operation_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "mcp_operation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_service_principal" (
	"oauth_client_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"billing_user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"allowed_scopes" text[] DEFAULT '{"vn:read"}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant"."messages" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "messages_tenant_id_conversation_id_request_id_role_key" UNIQUE("tenant_id","conversation_id","request_id","role"),
	CONSTRAINT "messages_role_check" CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))
);
--> statement-breakpoint
ALTER TABLE "assistant"."messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "metric_ingest_tokens" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "metric_ingest_tokens_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "metric_ingest_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"refreshId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"scopes" jsonb NOT NULL,
	CONSTRAINT "oauthAccessToken_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"disabled" boolean,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" jsonb,
	"userId" text,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" jsonb,
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" jsonb NOT NULL,
	"postLogoutRedirectUris" jsonb,
	"tokenEndpointAuthMethod" text,
	"grantTypes" jsonb,
	"responseTypes" jsonb,
	"public" boolean,
	"type" text,
	"requirePKCE" boolean,
	"referenceId" text,
	"metadata" jsonb,
	CONSTRAINT "oauthClient_clientId_key" UNIQUE("clientId")
);
--> statement-breakpoint
CREATE TABLE "oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text,
	"referenceId" text,
	"scopes" jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"authTime" timestamp with time zone,
	"scopes" jsonb NOT NULL,
	CONSTRAINT "oauthRefreshToken_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sync"."oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"pkce_verifier_ciphertext" text,
	"return_path" text NOT NULL,
	"requested_scopes" text[] DEFAULT '{}' NOT NULL,
	"provider_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_organization_id_id_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "cascade"."offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"claim" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"createdAt" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_entitlement" (
	"organization_id" text NOT NULL,
	"product" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_entitlement_pkey" PRIMARY KEY("organization_id","product"),
	CONSTRAINT "organization_entitlement_product_check" CHECK (product = ANY (ARRAY['outreach'::text, 'content'::text, 'cascade'::text]))
);
--> statement-breakpoint
CREATE TABLE "organization_subscription" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"seat_count" integer DEFAULT 1 NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"period_end" timestamp with time zone DEFAULT (now() + '1 mon'::interval) NOT NULL,
	"scheduled_plan_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_plan_version" integer,
	"scheduled_seat_count" integer,
	"trial_started_at" timestamp with time zone,
	"credit_user_id" text,
	CONSTRAINT "organization_subscription_scheduled_seat_count_check" CHECK (scheduled_seat_count > 0),
	CONSTRAINT "organization_subscription_seat_count_check" CHECK (seat_count > 0),
	CONSTRAINT "organization_subscription_status_check" CHECK (status = ANY (ARRAY['active'::text, 'scheduled_change'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."outbox_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_mutation_id" uuid NOT NULL,
	"entity_link_id" uuid,
	"object_type" text NOT NULL,
	"operation" text NOT NULL,
	"writable_fields" jsonb NOT NULL,
	"expected_remote_version" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"provider_request_id" text,
	"provider_result_redacted" jsonb,
	"applied_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"writable_fields_ciphertext" text,
	"created_by" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "outbox_commands_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "outbox_commands_organization_id_idempotency_key_key" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "outbox_commands_connection_id_entity_mutation_id_object_typ_key" UNIQUE("connection_id","entity_mutation_id","object_type"),
	CONSTRAINT "outbox_commands_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "outbox_commands_operation_check" CHECK (operation = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text])),
	CONSTRAINT "outbox_commands_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'succeeded'::text, 'conflict'::text, 'rejected'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "payment_checkout_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_subscription_id" text,
	"provider_payment_id" text,
	"return_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market" text DEFAULT 'india' NOT NULL,
	"billing_country" text DEFAULT 'IN' NOT NULL,
	"provider_plan_id" text,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	CONSTRAINT "payment_checkout_session_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "payment_checkout_session_provider_subscription_id_key" UNIQUE("provider_subscription_id"),
	CONSTRAINT "payment_checkout_session_amount_minor_check" CHECK (amount_minor > 0),
	CONSTRAINT "payment_checkout_session_billing_interval_check" CHECK (billing_interval = ANY (ARRAY['month'::text, 'year'::text])),
	CONSTRAINT "payment_checkout_session_market_check" CHECK (market = ANY (ARRAY['india'::text, 'international'::text])),
	CONSTRAINT "payment_checkout_session_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])),
	CONSTRAINT "payment_checkout_session_seats_check" CHECK (seats > 0),
	CONSTRAINT "payment_checkout_session_status_check" CHECK (status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "payment_provider_event" (
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_provider_event_pkey" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "payment_provider_event_processing_status_check" CHECK (processing_status = ANY (ARRAY['received'::text, 'processed'::text, 'ignored'::text, 'failed'::text])),
	CONSTRAINT "payment_provider_event_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text]))
);
--> statement-breakpoint
CREATE TABLE "payment_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_payment_id" text NOT NULL,
	"provider_subscription_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"captured_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"top_up_session_id" uuid,
	CONSTRAINT "payment_transaction_provider_payment_id_key" UNIQUE("provider_payment_id"),
	CONSTRAINT "payment_transaction_amount_minor_check" CHECK (amount_minor >= 0),
	CONSTRAINT "payment_transaction_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])),
	CONSTRAINT "payment_transaction_session_check" CHECK (((checkout_session_id IS NOT NULL) AND (top_up_session_id IS NULL)) OR ((checkout_session_id IS NULL) AND (top_up_session_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "platform_catalog_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"catalog" jsonb NOT NULL,
	"source_generated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"post_id" text NOT NULL,
	"draft_id" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "post_metric_snapshots_source_check" CHECK (source = ANY (ARRAY['human'::text, 'platform_api'::text, 'plugin'::text, 'provider_webhook'::text, 'link_redirect'::text]))
);
--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publishing"."posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" text,
	"destination" text NOT NULL,
	"channel_id" text NOT NULL,
	"copy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_key" text,
	"publish_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"idempotency_key" text,
	"result_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "posts_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))),
	CONSTRAINT "posts_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "publishing"."posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pricing_rollout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"environment" text NOT NULL,
	"plan_id" text NOT NULL,
	"catalog_country" text NOT NULL,
	"from_provider_plan_id" text NOT NULL,
	"to_provider_plan_id" text NOT NULL,
	"target_plan_version" integer NOT NULL,
	"policy" text DEFAULT 'cycle-end' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_catalog_version" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rollout_provider_environment_catalog_country_plan_i_key" UNIQUE("provider","environment","plan_id","catalog_country","from_provider_plan_id","to_provider_plan_id"),
	CONSTRAINT "pricing_rollout_environment_check" CHECK (environment = ANY (ARRAY['test'::text, 'live'::text])),
	CONSTRAINT "pricing_rollout_policy_check" CHECK (policy = ANY (ARRAY['cycle-end'::text, 'new-customers-only'::text])),
	CONSTRAINT "pricing_rollout_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'scheduled'::text, 'attention'::text, 'completed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "pricing_rollout_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rollout_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"seats" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_status" text,
	"payment_method" text,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rollout_item_rollout_id_provider_subscription_id_key" UNIQUE("rollout_id","provider_subscription_id"),
	CONSTRAINT "pricing_rollout_item_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "pricing_rollout_item_seats_check" CHECK (seats > 0),
	CONSTRAINT "pricing_rollout_item_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'retry'::text, 'scheduled'::text, 'applied'::text, 'skipped'::text, 'blocked'::text]))
);
--> statement-breakpoint
CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_id" text,
	"lead_id" text,
	"post_id" text,
	"send_id" text,
	"source" text DEFAULT 'product' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync"."provider_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"object_type" text NOT NULL,
	"event_types" text[] NOT NULL,
	"verification_secret_ciphertext" text,
	"metadata_ciphertext" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"renew_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_subscriptions_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "provider_subscriptions_organization_id_connection_id_provid_key" UNIQUE("organization_id","connection_id","provider_subscription_id"),
	CONSTRAINT "provider_subscriptions_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'degraded'::text, 'expired'::text, 'disabled'::text]))
);
--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "assistant"."rate_limit_buckets" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"key" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "assistant"."rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync"."records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"external_id" text NOT NULL,
	"raw_object_key" text,
	"normalized" jsonb,
	"fingerprint" text NOT NULL,
	"disposition" text NOT NULL,
	"match_reason" text,
	"error_code" text,
	"error_detail_redacted" text,
	"applied_revision" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_contact_id" text,
	CONSTRAINT "records_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "records_organization_id_run_id_ordinal_key" UNIQUE("organization_id","run_id","ordinal"),
	CONSTRAINT "records_disposition_check" CHECK (disposition = ANY (ARRAY['pending'::text, 'create'::text, 'update'::text, 'skip'::text, 'review'::text, 'error'::text, 'applied'::text])),
	CONSTRAINT "records_ordinal_check" CHECK (ordinal >= 0)
);
--> statement-breakpoint
CREATE TABLE "assistant"."request_receipts" (
	"tenant_id" text DEFAULT NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text) NOT NULL,
	"purpose" text NOT NULL,
	"request_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "request_receipts_pkey" PRIMARY KEY("tenant_id","purpose","request_id"),
	CONSTRAINT "request_receipts_purpose_check" CHECK (purpose = ANY (ARRAY['sales'::text, 'knowledge'::text]))
);
--> statement-breakpoint
ALTER TABLE "assistant"."request_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation"."run_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_run_id" uuid,
	"name" text NOT NULL,
	"content_type" text DEFAULT 'application/json' NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation"."run_events" (
	"sequence" bigserial PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_run_id" uuid,
	"node_id" text,
	"level" text DEFAULT 'info' NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	CONSTRAINT "run_events_id_key" UNIQUE("id"),
	CONSTRAINT "run_events_level_check" CHECK (level = ANY (ARRAY['debug'::text, 'info'::text, 'warning'::text, 'error'::text]))
);
--> statement-breakpoint
CREATE TABLE "automation"."run_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"entity_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"provider" text,
	"connection_id" uuid,
	"source_file_id" uuid,
	"source_object" text NOT NULL,
	"selection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping_version_id" uuid,
	"conflict_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"phase" text DEFAULT 'draft' NOT NULL,
	"checkpoint" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"error_code" text,
	"total_estimate" integer,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"valid_count" integer DEFAULT 0 NOT NULL,
	"create_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "runs_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "runs_organization_id_idempotency_key_key" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "runs_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "runs_source_kind_check" CHECK (source_kind = ANY (ARRAY['file'::text, 'crm'::text])),
	CONSTRAINT "runs_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'acquiring'::text, 'mapping_ready'::text, 'preview_ready'::text, 'queued'::text, 'fetching'::text, 'resolving'::text, 'applying'::text, 'waiting_for_provider'::text, 'completed'::text, 'completed_with_review'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "cascade"."sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"provider_message_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"variant_id" uuid,
	"created_by" text,
	"actor_type" text,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	"delivery_provider_id" uuid,
	"sender_identity_id" uuid,
	CONSTRAINT "sends_enrollment_id_step_id_key" UNIQUE("enrollment_id","step_id"),
	CONSTRAINT "sends_actor_type_check" CHECK ((actor_type IS NULL) OR (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text]))),
	CONSTRAINT "sends_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"activeOrganizationId" text,
	"activeTeamId" text,
	CONSTRAINT "session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "cascade"."stage_daily_stats" (
	"day" date NOT NULL,
	"funnel_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"interests" integer DEFAULT 0 NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "stage_daily_stats_pkey" PRIMARY KEY("day","funnel_id","step_id")
);
--> statement-breakpoint
ALTER TABLE "cascade"."stage_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation"."step_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"summary" text,
	"error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	CONSTRAINT "step_runs_run_id_node_id_key" UNIQUE("run_id","node_id"),
	CONSTRAINT "step_runs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'waiting'::text, 'needs_approval'::text, 'retry_scheduled'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "sync"."sync_cursors" (
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"cursor_kind" text NOT NULL,
	"cursor" jsonb,
	"cursor_expires_at" timestamp with time zone,
	"last_advanced_at" timestamp with time zone,
	"resnapshot_required_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_pkey" PRIMARY KEY("organization_id","connection_id","object_type","cursor_kind")
);
--> statement-breakpoint
CREATE TABLE "sync"."sync_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"inbound_count" integer DEFAULT 0 NOT NULL,
	"outbound_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"request_id" text,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "sync_cycles_organization_id_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "sync_cycles_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "sync_cycles_kind_check" CHECK (kind = ANY (ARRAY['event'::text, 'incremental'::text, 'reconciliation'::text, 'outbound'::text, 'resnapshot'::text, 'subscription_renewal'::text])),
	CONSTRAINT "sync_cycles_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'reconciled'::text, 'completed_with_conflicts'::text, 'degraded'::text, 'failed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teamMember" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_administrator" (
	"team_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_administrator_pkey" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "cascade"."templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"mjml" text NOT NULL,
	"compiled_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"design_json" jsonb,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "top_up_payment_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"catalog_version" text NOT NULL,
	"billing_country" text NOT NULL,
	"top_up_code" text NOT NULL,
	"top_up_name" text NOT NULL,
	"top_up_description" text NOT NULL,
	"credits" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"validity_days" integer NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"provider_receipt" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"return_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"next_reconcile_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reconcile_error" text,
	CONSTRAINT "top_up_payment_session_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "top_up_payment_session_provider_receipt_key" UNIQUE("provider_receipt"),
	CONSTRAINT "top_up_payment_session_provider_order_id_key" UNIQUE("provider_order_id"),
	CONSTRAINT "top_up_payment_session_provider_payment_id_key" UNIQUE("provider_payment_id"),
	CONSTRAINT "top_up_payment_session_amount_minor_check" CHECK (amount_minor > 0),
	CONSTRAINT "top_up_payment_session_credits_check" CHECK (credits > 0),
	CONSTRAINT "top_up_payment_session_provider_check" CHECK (provider = ANY (ARRAY['razorpay'::text, 'stripe'::text, 'paypal'::text])),
	CONSTRAINT "top_up_payment_session_reconcile_attempts_check" CHECK (reconcile_attempts >= 0),
	CONSTRAINT "top_up_payment_session_status_check" CHECK (status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])),
	CONSTRAINT "top_up_payment_session_validity_days_check" CHECK (validity_days > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"wallet_id" uuid NOT NULL,
	"reservation_id" uuid,
	"kind" text NOT NULL,
	"provider" text,
	"model" text,
	"measured_units" bigint DEFAULT 0 NOT NULL,
	"credits" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_idempotency_key_key" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cascade"."variant_stats" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"interests" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" numeric DEFAULT '0' NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text)
);
--> statement-breakpoint
ALTER TABLE "cascade"."variant_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cascade"."variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"segment" text DEFAULT 'all' NOT NULL,
	"email_id" uuid NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text DEFAULT 'human' NOT NULL,
	"validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text),
	CONSTRAINT "variants_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'validated'::text, 'active'::text, 'retired'::text]))
);
--> statement-breakpoint
ALTER TABLE "cascade"."variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cascade"."webhook_receipts" (
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	"id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipts_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "cascade"."webhook_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation"."workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"initiated_by" text,
	"idempotency_key" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"request_id" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"parent_execution_id" text,
	"trace_id" text,
	"traceparent" text,
	CONSTRAINT "workflow_runs_organization_id_idempotency_key_key" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "workflow_runs_actor_type_check" CHECK (actor_type = ANY (ARRAY['user'::text, 'service'::text, 'system'::text])),
	CONSTRAINT "workflow_runs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'starting'::text, 'running'::text, 'waiting'::text, 'needs_approval'::text, 'retry_scheduled'::text, 'paused'::text, 'cancelling'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'timed_out'::text])),
	CONSTRAINT "workflow_runs_trigger_type_check" CHECK (trigger_type = ANY (ARRAY['manual'::text, 'schedule'::text, 'webhook'::text, 'event'::text]))
);
--> statement-breakpoint
CREATE TABLE "automation"."workflow_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" text DEFAULT NULLIF(current_setting('app.organization_id'::text, true), ''::text) NOT NULL,
	CONSTRAINT "workflow_versions_workflow_id_version_key" UNIQUE("workflow_id","version")
);
--> statement-breakpoint
CREATE TABLE "automation"."workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_def" jsonb NOT NULL,
	"published_version_id" uuid,
	"schedule" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"next_run_at" timestamp with time zone,
	"webhook_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_organization_id_webhook_token_key" UNIQUE("organization_id","webhook_token"),
	CONSTRAINT "workflows_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'archived'::text]))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."payment_checkout_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_plan_id_plan_version_fkey" FOREIGN KEY ("plan_id","plan_version") REFERENCES "public"."commercial_plan_version"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_plan_price" ADD CONSTRAINT "commercial_plan_price_plan_id_plan_version_fkey" FOREIGN KEY ("plan_id","plan_version") REFERENCES "public"."commercial_plan_version"("plan_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."credit_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lot" ADD CONSTRAINT "credit_lot_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallet" ADD CONSTRAINT "credit_wallet_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_organization_id_id_key" ON "cascade"."contacts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_organization_id_id_key" ON "cascade"."content" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_domains_organization_id_id_key" ON "cascade"."delivery_domains" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_provider_connections_organization_id_id_key" ON "cascade"."delivery_provider_connections" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_sender_identities_organization_id_id_key" ON "cascade"."delivery_sender_identities" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_organization_id_id_key" ON "cascade"."emails" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollments_organization_id_id_key" ON "cascade"."enrollments" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_steps_organization_id_id_key" ON "cascade"."funnel_steps" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnels_organization_id_id_key" ON "cascade"."funnels" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_organization_id_id_key" ON "cascade"."sends" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_organization_id_id_key" ON "cascade"."templates" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_organization_id_id_key" ON "cascade"."variants" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "cascade"."delivery_domains" ADD CONSTRAINT "delivery_domains_provider_connection_id_organization_fkey" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "cascade"."delivery_provider_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."delivery_sender_identities" ADD CONSTRAINT "delivery_sender_identities_domain_id_organization_fkey" FOREIGN KEY ("organization_id","domain_id") REFERENCES "cascade"."delivery_domains"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."delivery_sender_identities" ADD CONSTRAINT "delivery_sender_identities_provider_connection_id_organization_" FOREIGN KEY ("organization_id","provider_connection_id") REFERENCES "cascade"."delivery_provider_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."emails" ADD CONSTRAINT "emails_content_id_organization_fkey" FOREIGN KEY ("organization_id","content_id") REFERENCES "cascade"."content"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."emails" ADD CONSTRAINT "emails_template_id_organization_fkey" FOREIGN KEY ("organization_id","template_id") REFERENCES "cascade"."templates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."enrollments" ADD CONSTRAINT "enrollments_contact_id_organization_fkey" FOREIGN KEY ("organization_id","contact_id") REFERENCES "cascade"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."enrollments" ADD CONSTRAINT "enrollments_current_step_id_organization_fkey" FOREIGN KEY ("organization_id","current_step_id") REFERENCES "cascade"."funnel_steps"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."enrollments" ADD CONSTRAINT "enrollments_funnel_id_organization_fkey" FOREIGN KEY ("organization_id","funnel_id") REFERENCES "cascade"."funnels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."events" ADD CONSTRAINT "events_contact_id_organization_fkey" FOREIGN KEY ("organization_id","contact_id") REFERENCES "cascade"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."events" ADD CONSTRAINT "events_enrollment_id_organization_fkey" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "cascade"."enrollments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."events" ADD CONSTRAINT "events_send_id_organization_fkey" FOREIGN KEY ("organization_id","send_id") REFERENCES "cascade"."sends"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_routes" ADD CONSTRAINT "funnel_routes_from_funnel_id_organization_fkey" FOREIGN KEY ("organization_id","from_funnel_id") REFERENCES "cascade"."funnels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_routes" ADD CONSTRAINT "funnel_routes_to_funnel_id_organization_fkey" FOREIGN KEY ("organization_id","to_funnel_id") REFERENCES "cascade"."funnels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_steps" ADD CONSTRAINT "funnel_steps_funnel_id_organization_fkey" FOREIGN KEY ("organization_id","funnel_id") REFERENCES "cascade"."funnels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_event" ADD CONSTRAINT "mcp_audit_event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency_key" ADD CONSTRAINT "mcp_idempotency_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_media_upload" ADD CONSTRAINT "mcp_media_upload_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_operation" ADD CONSTRAINT "mcp_operation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD CONSTRAINT "mcp_service_principal_billing_user_id_fkey" FOREIGN KEY ("billing_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD CONSTRAINT "mcp_service_principal_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD CONSTRAINT "mcp_service_principal_oauth_client_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_service_principal" ADD CONSTRAINT "mcp_service_principal_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant"."messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "assistant"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "public"."oauthRefreshToken"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_entitlement" ADD CONSTRAINT "organization_entitlement_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscription" ADD CONSTRAINT "organization_subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscription" ADD CONSTRAINT "organization_subscription_plan_id_plan_version_fkey" FOREIGN KEY ("plan_id","plan_version") REFERENCES "public"."commercial_plan_version"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkout_session" ADD CONSTRAINT "payment_checkout_session_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkout_session" ADD CONSTRAINT "payment_checkout_session_plan_id_plan_version_fkey" FOREIGN KEY ("plan_id","plan_version") REFERENCES "public"."commercial_plan_version"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checkout_session" ADD CONSTRAINT "payment_checkout_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."payment_checkout_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_top_up_session_id_fkey" FOREIGN KEY ("top_up_session_id") REFERENCES "public"."top_up_payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing"."posts" ADD CONSTRAINT "posts_channel_organization_fkey" FOREIGN KEY ("organization_id","channel_id") REFERENCES "publishing"."channels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rollout" ADD CONSTRAINT "pricing_rollout_plan_id_target_plan_version_fkey" FOREIGN KEY ("plan_id","target_plan_version") REFERENCES "public"."commercial_plan_version"("plan_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rollout_item" ADD CONSTRAINT "pricing_rollout_item_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rollout_item" ADD CONSTRAINT "pricing_rollout_item_rollout_id_fkey" FOREIGN KEY ("rollout_id") REFERENCES "public"."pricing_rollout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."sends" ADD CONSTRAINT "sends_delivery_provider_id_organization_fkey" FOREIGN KEY ("organization_id","delivery_provider_id") REFERENCES "cascade"."delivery_provider_connections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."sends" ADD CONSTRAINT "sends_enrollment_id_organization_fkey" FOREIGN KEY ("organization_id","enrollment_id") REFERENCES "cascade"."enrollments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."sends" ADD CONSTRAINT "sends_sender_identity_id_organization_fkey" FOREIGN KEY ("organization_id","sender_identity_id") REFERENCES "cascade"."delivery_sender_identities"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."sends" ADD CONSTRAINT "sends_step_id_organization_fkey" FOREIGN KEY ("organization_id","step_id") REFERENCES "cascade"."funnel_steps"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."sends" ADD CONSTRAINT "sends_variant_id_organization_fkey" FOREIGN KEY ("organization_id","variant_id") REFERENCES "cascade"."variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."stage_daily_stats" ADD CONSTRAINT "stage_daily_stats_funnel_id_organization_fkey" FOREIGN KEY ("organization_id","funnel_id") REFERENCES "cascade"."funnels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."stage_daily_stats" ADD CONSTRAINT "stage_daily_stats_step_id_organization_fkey" FOREIGN KEY ("organization_id","step_id") REFERENCES "cascade"."funnel_steps"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_administrator" ADD CONSTRAINT "team_administrator_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_administrator" ADD CONSTRAINT "team_administrator_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_up_payment_session" ADD CONSTRAINT "top_up_payment_session_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_up_payment_session" ADD CONSTRAINT "top_up_payment_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."credit_reservation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."variant_stats" ADD CONSTRAINT "variant_stats_variant_id_organization_fkey" FOREIGN KEY ("organization_id","variant_id") REFERENCES "cascade"."variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."variants" ADD CONSTRAINT "variants_email_id_organization_fkey" FOREIGN KEY ("organization_id","email_id") REFERENCES "cascade"."emails"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cascade"."variants" ADD CONSTRAINT "variants_step_id_organization_fkey" FOREIGN KEY ("organization_id","step_id") REFERENCES "cascade"."funnel_steps"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_source_key" ON "cascade"."assets" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_organization_id_id_key" ON "cascade"."assets" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cascade_settings_org_key" ON "cascade"."cascade_settings" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_plan_source_idx" ON "commercial_plan_version" USING btree ("plan_id","catalog_version") WHERE (catalog_version IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "conflicts_one_open_field_idx" ON "sync"."conflicts" USING btree ("organization_id","entity_link_id","canonical_field") WHERE (status = 'open'::text);--> statement-breakpoint
CREATE INDEX "conflicts_open_idx" ON "sync"."conflicts" USING btree ("organization_id","connection_id","created_at") WHERE (status = 'open'::text);--> statement-breakpoint
CREATE INDEX "connections_due_idx" ON "sync"."connections" USING btree ("status","last_reconciled_at") WHERE (status = ANY (ARRAY['active'::text, 'degraded'::text]));--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_email_key" ON "cascade"."contacts" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_workspace_contact_key" ON "cascade"."contacts" USING btree ("organization_id","workspace_contact_id") WHERE (workspace_contact_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "content_org_name_key" ON "cascade"."content" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "conversations_account_idx" ON "assistant"."conversations" USING btree ("tenant_id","account_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_subject_idx" ON "assistant"."conversations" USING btree ("tenant_id","subject_id","updated_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_wallet_idx" ON "credit_ledger" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_lot_spend_idx" ON "credit_lot" USING btree ("wallet_id","expires_at","created_at") WHERE (remaining > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letters_organization_id_id_key" ON "automation"."dead_letters" USING btree ("organization_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_domain_org_name_key" ON "cascade"."delivery_domains" USING btree ("organization_id","provider_connection_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_provider_org_default_key" ON "cascade"."delivery_provider_connections" USING btree ("organization_id") WHERE (is_default = true);--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_provider_org_provider_key" ON "cascade"."delivery_provider_connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_sender_org_default_key" ON "cascade"."delivery_sender_identities" USING btree ("organization_id") WHERE (is_default = true);--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_sender_org_email_key" ON "cascade"."delivery_sender_identities" USING btree ("organization_id","provider_connection_id","email");--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "assistant"."documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "enrollments_due_idx" ON "cascade"."enrollments" USING btree ("next_run_at") WHERE (state = 'active'::text);--> statement-breakpoint
CREATE INDEX "entity_mutations_queue_idx" ON "sync"."entity_mutations" USING btree ("status","available_at","lease_expires_at") WHERE (status = ANY (ARRAY['reserved'::text, 'projecting'::text, 'failed'::text]));--> statement-breakpoint
CREATE UNIQUE INDEX "events_organization_id_id_key" ON "cascade"."events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "events_timeline_idx" ON "sync"."events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "execution_event_org_time_idx" ON "observability"."execution_event" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "execution_event_request_idx" ON "observability"."execution_event" USING btree ("request_id","started_at");--> statement-breakpoint
CREATE INDEX "execution_event_support_code_idx" ON "observability"."execution_event" USING btree ("support_code","started_at");--> statement-breakpoint
CREATE INDEX "external_entity_links_entity_idx" ON "sync"."external_entity_links" USING btree ("organization_id","entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_routes_organization_id_id_key" ON "cascade"."funnel_routes" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "assistant"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inbox_events_queue_idx" ON "sync"."inbox_events" USING btree ("status","available_at","lease_expires_at") WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "idx_jobs_created_at" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_entity" ON "jobs" USING btree ("entity_id","entity_type");--> statement-breakpoint
CREATE INDEX "idx_jobs_org_status" ON "jobs" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_entitytype_entityid_idx" ON "mastra_ai_spans" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_entitytype_entityname_idx" ON "mastra_ai_spans" USING btree ("entityType","entityName");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_metadata_gin_idx" ON "mastra_ai_spans" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_name_idx" ON "mastra_ai_spans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_orgid_userid_idx" ON "mastra_ai_spans" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_parentspanid_startedat_idx" ON "mastra_ai_spans" USING btree ("parentSpanId","startedAt");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_root_spans_idx" ON "mastra_ai_spans" USING btree ("startedAt") WHERE ("parentSpanId" IS NULL);--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_spantype_startedat_idx" ON "mastra_ai_spans" USING btree ("spanType","startedAt");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_tags_gin_idx" ON "mastra_ai_spans" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "mastra_ai_spans_traceid_startedat_idx" ON "mastra_ai_spans" USING btree ("traceId","startedAt");--> statement-breakpoint
CREATE INDEX "mastra_messages_thread_id_createdat_idx" ON "mastra_messages" USING btree ("thread_id","createdAt");--> statement-breakpoint
CREATE INDEX "mastra_scores_trace_id_span_id_created_at_idx" ON "mastra_scorers" USING btree ("traceId","spanId","createdAt");--> statement-breakpoint
CREATE INDEX "mastra_threads_resourceid_createdat_idx" ON "mastra_threads" USING btree ("resourceId","createdAt");--> statement-breakpoint
CREATE INDEX "mcp_audit_event_org_time_idx" ON "mcp_audit_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mcp_connection_org_idx" ON "mcp_connection" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "mcp_media_upload_org_idx" ON "mcp_media_upload" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_operation_org_time_idx" ON "mcp_operation" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_operation_queue_idx" ON "mcp_operation" USING btree ("status","lease_expires_at","created_at") WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "mcp_service_principal_organization_idx" ON "mcp_service_principal" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "assistant"."messages" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken" USING btree ("refreshId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthClient_userId_idx" ON "oauthClient" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_org_code_key" ON "cascade"."offers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_organization_id_id_key" ON "cascade"."offers" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "outbox_commands_queue_idx" ON "sync"."outbox_commands" USING btree ("status","available_at","lease_expires_at") WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "payment_checkout_expiry_idx" ON "payment_checkout_session" USING btree ("expires_at") WHERE (status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "payment_checkout_org_idx" ON "payment_checkout_session" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_post_metric_snapshots_org_draft" ON "post_metric_snapshots" USING btree ("organization_id","draft_id","captured_at");--> statement-breakpoint
CREATE INDEX "idx_post_metric_snapshots_org_post" ON "post_metric_snapshots" USING btree ("organization_id","post_id","captured_at");--> statement-breakpoint
CREATE INDEX "idx_publishing_posts_due" ON "publishing"."posts" USING btree ("status","publish_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_org_idempotency_key" ON "publishing"."posts" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "pricing_rollout_status_idx" ON "pricing_rollout" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pricing_rollout_item_claim_idx" ON "pricing_rollout_item" USING btree ("status","next_attempt_at","created_at") WHERE (status = ANY (ARRAY['queued'::text, 'retry'::text]));--> statement-breakpoint
CREATE INDEX "idx_product_events_org_name_time" ON "product_events" USING btree ("organization_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_product_events_time" ON "product_events" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "assistant"."rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "records_run_disposition_idx" ON "sync"."records" USING btree ("organization_id","run_id","disposition","ordinal");--> statement-breakpoint
CREATE INDEX "request_receipts_expiry_idx" ON "assistant"."request_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_artifacts_organization_id_id_key" ON "automation"."run_artifacts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "event_run_sequence_idx" ON "automation"."run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_organization_id_id_key" ON "automation"."run_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_signals_organization_id_id_key" ON "automation"."run_signals" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "runs_queue_idx" ON "sync"."runs" USING btree ("status","lease_expires_at","created_at") WHERE (status = ANY (ARRAY['queued'::text, 'fetching'::text, 'resolving'::text, 'applying'::text, 'waiting_for_provider'::text]));--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "step_run_run_idx" ON "automation"."step_runs" USING btree ("run_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cycles_one_active_connection_idx" ON "sync"."sync_cycles" USING btree ("connection_id") WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "sync_cycles_queue_idx" ON "sync"."sync_cycles" USING btree ("status","available_at","lease_expires_at") WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "team_organizationId_idx" ON "team" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "teamMember_teamId_idx" ON "teamMember" USING btree ("teamId");--> statement-breakpoint
CREATE INDEX "teamMember_userId_idx" ON "teamMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "teamMember" USING btree ("teamId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_org_name_key" ON "cascade"."templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "top_up_payment_expiry_idx" ON "top_up_payment_session" USING btree ("expires_at") WHERE (status = ANY (ARRAY['created'::text, 'checkout_ready'::text, 'processing'::text]));--> statement-breakpoint
CREATE INDEX "top_up_payment_org_idx" ON "top_up_payment_session" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "top_up_payment_reconcile_idx" ON "top_up_payment_session" USING btree ("next_reconcile_at") WHERE ((fulfilled_at IS NULL) AND (provider_order_id IS NOT NULL) AND (status = ANY (ARRAY['checkout_ready'::text, 'processing'::text, 'expired'::text])));--> statement-breakpoint
CREATE INDEX "usage_event_org_idx" ON "usage_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "run_claim_idx" ON "automation"."workflow_runs" USING btree ("available_at","created_at") WHERE (status = ANY (ARRAY['queued'::text, 'retry_scheduled'::text, 'waiting'::text]));--> statement-breakpoint
CREATE INDEX "run_workflow_history_idx" ON "automation"."workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_due_idx" ON "automation"."workflows" USING btree ("next_run_at") WHERE ((status = 'published'::text) AND (next_run_at IS NOT NULL));--> statement-breakpoint
CREATE INDEX "workflow_org_updated_idx" ON "automation"."workflows" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE POLICY "assets_organization_policy" ON "cascade"."assets" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "cascade_settings_organization_policy" ON "cascade"."cascade_settings" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "channels_organization_policy" ON "publishing"."channels" AS PERMISSIVE FOR ALL TO public USING ((org_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((org_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "conflicts_organization_policy" ON "sync"."conflicts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "connections_organization_policy" ON "sync"."connections" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "contact_identities_organization_policy" ON "sync"."contact_identities" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "contacts_organization_policy" ON "cascade"."contacts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "content_organization_policy" ON "cascade"."content" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "conversations_tenant_policy" ON "assistant"."conversations" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "dead_letters_organization_policy" ON "automation"."dead_letters" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "delivery_domains_organization_policy" ON "cascade"."delivery_domains" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "delivery_provider_connections_organization_policy" ON "cascade"."delivery_provider_connections" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "delivery_sender_identities_organization_policy" ON "cascade"."delivery_sender_identities" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "documents_tenant_policy" ON "assistant"."documents" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "emails_organization_policy" ON "cascade"."emails" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "enrollments_organization_policy" ON "cascade"."enrollments" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "entity_mutations_organization_policy" ON "sync"."entity_mutations" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "events_organization_policy" ON "cascade"."events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "events_organization_policy" ON "sync"."events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "external_entity_links_organization_policy" ON "sync"."external_entity_links" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "field_sync_state_organization_policy" ON "sync"."field_sync_state" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "files_organization_policy" ON "sync"."files" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnel_routes_organization_policy" ON "cascade"."funnel_routes" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnel_steps_organization_policy" ON "cascade"."funnel_steps" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "funnels_organization_policy" ON "cascade"."funnels" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_policy" ON "assistant"."idempotency_keys" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "identity_links_tenant_policy" ON "assistant"."identity_links" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "inbox_events_organization_policy" ON "sync"."inbox_events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "jobs_organization_policy" ON "jobs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mapping_versions_organization_policy" ON "sync"."mapping_versions" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mcp_audit_event_organization_policy" ON "mcp_audit_event" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mcp_connection_organization_policy" ON "mcp_connection" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mcp_idempotency_key_organization_policy" ON "mcp_idempotency_key" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mcp_media_upload_organization_policy" ON "mcp_media_upload" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "mcp_operation_organization_policy" ON "mcp_operation" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "messages_tenant_policy" ON "assistant"."messages" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "metric_ingest_tokens_organization_policy" ON "metric_ingest_tokens" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "oauth_states_organization_policy" ON "sync"."oauth_states" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "offers_organization_policy" ON "cascade"."offers" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "outbox_commands_organization_policy" ON "sync"."outbox_commands" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "post_metric_snapshots_organization_policy" ON "post_metric_snapshots" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "posts_organization_policy" ON "publishing"."posts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "product_events_organization_policy" ON "product_events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "provider_subscriptions_organization_policy" ON "sync"."provider_subscriptions" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "rate_limit_buckets_tenant_policy" ON "assistant"."rate_limit_buckets" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "records_organization_policy" ON "sync"."records" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "request_receipts_tenant_policy" ON "assistant"."request_receipts" AS PERMISSIVE FOR ALL TO public USING ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text))) WITH CHECK ((tenant_id = NULLIF(current_setting('app.assistant_tenant_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "run_artifacts_organization_policy" ON "automation"."run_artifacts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "run_events_organization_policy" ON "automation"."run_events" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "run_signals_organization_policy" ON "automation"."run_signals" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "runs_organization_policy" ON "sync"."runs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "sends_organization_policy" ON "cascade"."sends" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "stage_daily_stats_organization_policy" ON "cascade"."stage_daily_stats" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "step_runs_organization_policy" ON "automation"."step_runs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "sync_cursors_organization_policy" ON "sync"."sync_cursors" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "sync_cycles_organization_policy" ON "sync"."sync_cycles" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "templates_organization_policy" ON "cascade"."templates" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "variant_stats_organization_policy" ON "cascade"."variant_stats" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "variants_organization_policy" ON "cascade"."variants" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "webhook_receipts_organization_policy" ON "cascade"."webhook_receipts" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "workflow_runs_organization_policy" ON "automation"."workflow_runs" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "workflow_versions_organization_policy" ON "automation"."workflow_versions" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));--> statement-breakpoint
CREATE POLICY "workflows_organization_policy" ON "automation"."workflows" AS PERMISSIVE FOR ALL TO public USING ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text))) WITH CHECK ((organization_id = NULLIF(current_setting('app.organization_id'::text, true), ''::text)));
