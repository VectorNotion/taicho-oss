-- Drizzle models PostgreSQL policies and ENABLE ROW LEVEL SECURITY, but does
-- not currently expose FORCE ROW LEVEL SECURITY in its schema DSL. Keep this
-- PostgreSQL security setting in the ordered migration chain rather than in
-- application startup code.
ALTER TABLE "assistant"."conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."identity_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."rate_limit_buckets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant"."request_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."cascade_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."content" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."delivery_domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."delivery_provider_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."delivery_sender_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."enrollments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_routes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnel_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."funnels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."offers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."stage_daily_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."variant_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cascade"."webhook_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publishing"."channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "publishing"."posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_audit_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_connection" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_idempotency_key" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_media_upload" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_operation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metric_ingest_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_metric_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_events" FORCE ROW LEVEL SECURITY;
