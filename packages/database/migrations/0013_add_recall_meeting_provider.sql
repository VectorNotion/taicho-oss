ALTER TABLE "outreach_lead_meetings" DROP CONSTRAINT "outreach_lead_meetings_provider_check";
--> statement-breakpoint
ALTER TABLE "outreach_lead_meetings" ALTER COLUMN "provider" SET DEFAULT 'recall';
--> statement-breakpoint
ALTER TABLE "outreach_lead_meetings" ADD CONSTRAINT "outreach_lead_meetings_provider_check" CHECK (provider = ANY (ARRAY['attendee'::text, 'recall'::text]));
