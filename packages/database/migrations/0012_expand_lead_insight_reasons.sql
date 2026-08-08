ALTER TABLE "outreach_lead_insight_snapshots"
	DROP CONSTRAINT "outreach_lead_insights_reason_check";
--> statement-breakpoint
ALTER TABLE "outreach_lead_insight_snapshots"
	ADD CONSTRAINT "outreach_lead_insights_reason_check"
	CHECK (generated_reason = ANY (ARRAY[
		'manual'::text,
		'manual_update'::text,
		'meeting_completed'::text,
		'activity_update'::text,
		'outreach_sent'::text
	]));
