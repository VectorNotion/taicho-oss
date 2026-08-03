DROP POLICY "conflicts_organization_policy" ON "sync"."conflicts" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."conflicts" CASCADE;--> statement-breakpoint
DROP POLICY "connections_organization_policy" ON "sync"."connections" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."connections" CASCADE;--> statement-breakpoint
DROP POLICY "contact_identities_organization_policy" ON "sync"."contact_identities" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."contact_identities" CASCADE;--> statement-breakpoint
DROP POLICY "dead_letters_organization_policy" ON "automation"."dead_letters" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."dead_letters" CASCADE;--> statement-breakpoint
DROP POLICY "entity_mutations_organization_policy" ON "sync"."entity_mutations" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."entity_mutations" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."event_fanout_cursor" CASCADE;--> statement-breakpoint
DROP POLICY "events_organization_policy" ON "sync"."events" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."events" CASCADE;--> statement-breakpoint
DROP POLICY "external_entity_links_organization_policy" ON "sync"."external_entity_links" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."external_entity_links" CASCADE;--> statement-breakpoint
DROP POLICY "field_sync_state_organization_policy" ON "sync"."field_sync_state" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."field_sync_state" CASCADE;--> statement-breakpoint
DROP POLICY "files_organization_policy" ON "sync"."files" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."files" CASCADE;--> statement-breakpoint
DROP POLICY "inbox_events_organization_policy" ON "sync"."inbox_events" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."inbox_events" CASCADE;--> statement-breakpoint
DROP POLICY "mapping_versions_organization_policy" ON "sync"."mapping_versions" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."mapping_versions" CASCADE;--> statement-breakpoint
DROP TABLE "mastra_workflow_snapshot" CASCADE;--> statement-breakpoint
DROP POLICY "oauth_states_organization_policy" ON "sync"."oauth_states" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."oauth_states" CASCADE;--> statement-breakpoint
DROP POLICY "outbox_commands_organization_policy" ON "sync"."outbox_commands" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."outbox_commands" CASCADE;--> statement-breakpoint
DROP POLICY "provider_subscriptions_organization_policy" ON "sync"."provider_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."provider_subscriptions" CASCADE;--> statement-breakpoint
DROP POLICY "records_organization_policy" ON "sync"."records" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."records" CASCADE;--> statement-breakpoint
DROP POLICY "run_artifacts_organization_policy" ON "automation"."run_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."run_artifacts" CASCADE;--> statement-breakpoint
DROP POLICY "run_events_organization_policy" ON "automation"."run_events" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."run_events" CASCADE;--> statement-breakpoint
DROP POLICY "run_signals_organization_policy" ON "automation"."run_signals" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."run_signals" CASCADE;--> statement-breakpoint
DROP POLICY "runs_organization_policy" ON "sync"."runs" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."runs" CASCADE;--> statement-breakpoint
DROP POLICY "step_runs_organization_policy" ON "automation"."step_runs" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."step_runs" CASCADE;--> statement-breakpoint
DROP POLICY "sync_cursors_organization_policy" ON "sync"."sync_cursors" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."sync_cursors" CASCADE;--> statement-breakpoint
DROP POLICY "sync_cycles_organization_policy" ON "sync"."sync_cycles" CASCADE;--> statement-breakpoint
DROP TABLE "sync"."sync_cycles" CASCADE;--> statement-breakpoint
DROP POLICY "workflow_runs_organization_policy" ON "automation"."workflow_runs" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."workflow_runs" CASCADE;--> statement-breakpoint
DROP POLICY "workflow_versions_organization_policy" ON "automation"."workflow_versions" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."workflow_versions" CASCADE;--> statement-breakpoint
DROP POLICY "workflows_organization_policy" ON "automation"."workflows" CASCADE;--> statement-breakpoint
DROP TABLE "automation"."workflows" CASCADE;--> statement-breakpoint
DROP SCHEMA "automation";
--> statement-breakpoint
DROP SCHEMA "sync";
