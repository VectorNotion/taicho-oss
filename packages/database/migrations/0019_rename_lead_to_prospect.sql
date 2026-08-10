-- icp-update-v2 entity normalization: nothing named "lead" remains.
-- Renames the five outreach lead tables (with their columns, indexes,
-- constraints and policies), product_events.lead_id, cascade.contacts
-- linkage column, and the assistant conversation capture state.

-- ── outreach_lead_source_identities ─────────────────────────────────────
ALTER TABLE "outreach_lead_source_identities" RENAME TO "outreach_prospect_source_identities";--> statement-breakpoint
ALTER TABLE "outreach_prospect_source_identities" RENAME COLUMN "lead_id" TO "prospect_id";--> statement-breakpoint
ALTER INDEX "outreach_lead_source_identities_lead_idx" RENAME TO "outreach_prospect_source_identities_prospect_idx";--> statement-breakpoint
ALTER TABLE "outreach_prospect_source_identities" RENAME CONSTRAINT "outreach_lead_source_identities_pkey" TO "outreach_prospect_source_identities_pkey";--> statement-breakpoint
ALTER TABLE "outreach_prospect_source_identities" RENAME CONSTRAINT "outreach_lead_source_identities_organization_fk" TO "outreach_prospect_source_identities_organization_fk";--> statement-breakpoint
ALTER TABLE "outreach_prospect_source_identities" RENAME CONSTRAINT "outreach_lead_source_identities_provider_check" TO "outreach_prospect_source_identities_provider_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_source_identities" RENAME CONSTRAINT "outreach_lead_source_identities_source_id_check" TO "outreach_prospect_source_identities_source_id_check";--> statement-breakpoint
ALTER POLICY "outreach_lead_source_identities_organization_policy" ON "outreach_prospect_source_identities" RENAME TO "outreach_prospect_source_identities_organization_policy";--> statement-breakpoint

-- ── outreach_lead_meetings ──────────────────────────────────────────────
ALTER TABLE "outreach_lead_meetings" RENAME TO "outreach_prospect_meetings";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meetings" RENAME COLUMN "lead_id" TO "prospect_id";--> statement-breakpoint
ALTER INDEX "outreach_lead_meetings_lead_time_idx" RENAME TO "outreach_prospect_meetings_prospect_time_idx";--> statement-breakpoint
ALTER INDEX "outreach_lead_meetings_provider_bot_key" RENAME TO "outreach_prospect_meetings_provider_bot_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meetings" RENAME CONSTRAINT "outreach_lead_meetings_id_organization_key" TO "outreach_prospect_meetings_id_organization_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meetings" RENAME CONSTRAINT "outreach_lead_meetings_organization_fk" TO "outreach_prospect_meetings_organization_fk";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meetings" RENAME CONSTRAINT "outreach_lead_meetings_provider_check" TO "outreach_prospect_meetings_provider_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meetings" RENAME CONSTRAINT "outreach_lead_meetings_status_check" TO "outreach_prospect_meetings_status_check";--> statement-breakpoint
ALTER POLICY "outreach_lead_meetings_organization_policy" ON "outreach_prospect_meetings" RENAME TO "outreach_prospect_meetings_organization_policy";--> statement-breakpoint

-- ── outreach_lead_meeting_events ────────────────────────────────────────
ALTER TABLE "outreach_lead_meeting_events" RENAME TO "outreach_prospect_meeting_events";--> statement-breakpoint
ALTER INDEX "outreach_lead_meeting_events_meeting_time_idx" RENAME TO "outreach_prospect_meeting_events_meeting_time_idx";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meeting_events" RENAME CONSTRAINT "outreach_lead_meeting_events_delivery_key" TO "outreach_prospect_meeting_events_delivery_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meeting_events" RENAME CONSTRAINT "outreach_lead_meeting_events_id_organization_key" TO "outreach_prospect_meeting_events_id_organization_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_meeting_events" RENAME CONSTRAINT "outreach_lead_meeting_events_meeting_fk" TO "outreach_prospect_meeting_events_meeting_fk";--> statement-breakpoint
ALTER POLICY "outreach_lead_meeting_events_organization_policy" ON "outreach_prospect_meeting_events" RENAME TO "outreach_prospect_meeting_events_organization_policy";--> statement-breakpoint

-- ── outreach_lead_evidence ──────────────────────────────────────────────
ALTER TABLE "outreach_lead_evidence" RENAME TO "outreach_prospect_evidence";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME COLUMN "lead_id" TO "prospect_id";--> statement-breakpoint
ALTER INDEX "outreach_lead_evidence_lead_time_idx" RENAME TO "outreach_prospect_evidence_prospect_time_idx";--> statement-breakpoint
ALTER INDEX "outreach_lead_evidence_source_key" RENAME TO "outreach_prospect_evidence_source_key";--> statement-breakpoint
ALTER INDEX "outreach_lead_evidence_external_source_key" RENAME TO "outreach_prospect_evidence_external_source_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_id_organization_key" TO "outreach_prospect_evidence_id_organization_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_event_fk" TO "outreach_prospect_evidence_event_fk";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_meeting_fk" TO "outreach_prospect_evidence_meeting_fk";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_actor_type_check" TO "outreach_prospect_evidence_actor_type_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_content_check" TO "outreach_prospect_evidence_content_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_evidence" RENAME CONSTRAINT "outreach_lead_evidence_kind_check" TO "outreach_prospect_evidence_kind_check";--> statement-breakpoint
ALTER POLICY "outreach_lead_evidence_organization_policy" ON "outreach_prospect_evidence" RENAME TO "outreach_prospect_evidence_organization_policy";--> statement-breakpoint

-- ── outreach_lead_insight_snapshots ─────────────────────────────────────
ALTER TABLE "outreach_lead_insight_snapshots" RENAME TO "outreach_prospect_insight_snapshots";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME COLUMN "lead_id" TO "prospect_id";--> statement-breakpoint
ALTER INDEX "outreach_lead_insights_lead_time_idx" RENAME TO "outreach_prospect_insights_prospect_time_idx";--> statement-breakpoint
ALTER INDEX "outreach_lead_insights_current_key" RENAME TO "outreach_prospect_insights_current_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_id_organization_key" TO "outreach_prospect_insights_id_organization_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_organization_fk" TO "outreach_prospect_insights_organization_fk";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_revision_key" TO "outreach_prospect_insights_revision_key";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_reason_check" TO "outreach_prospect_insights_reason_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_revision_check" TO "outreach_prospect_insights_revision_check";--> statement-breakpoint
ALTER TABLE "outreach_prospect_insight_snapshots" RENAME CONSTRAINT "outreach_lead_insights_status_check" TO "outreach_prospect_insights_status_check";--> statement-breakpoint
ALTER POLICY "outreach_lead_insights_organization_policy" ON "outreach_prospect_insight_snapshots" RENAME TO "outreach_prospect_insights_organization_policy";--> statement-breakpoint

-- ── entity-ref and linkage columns ──────────────────────────────────────
ALTER TABLE "product_events" RENAME COLUMN "lead_id" TO "prospect_id";--> statement-breakpoint
ALTER TABLE "cascade"."contacts" RENAME COLUMN "outreach_lead_id" TO "outreach_prospect_id";--> statement-breakpoint
ALTER TABLE "assistant"."conversations" RENAME COLUMN "lead_state" TO "prospect_state";
